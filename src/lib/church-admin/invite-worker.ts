import { randomUUID } from 'node:crypto';
import { getApplicationOrigin, getResendNotificationConfig } from '@/lib/supabase/config';
import { createPrivilegedSupabaseClient } from '@/lib/supabase/server-privileged';
import type { NotificationDeliveryJob, NotificationProviderAdapter } from '@/lib/notifications/adapter';
import { createResendNotificationAdapter } from '@/lib/notifications/resend';

type RpcResult = { data: unknown; error: unknown };
type InviteWorkerClient = {
  schema(name: 'api'): {
    rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
  };
};

type InviteJob = {
  attemptCount: number;
  churchName: string;
  churchSlug: string;
  destinationEmail: string;
  inviteId: string;
  jobId: string;
  language: NotificationDeliveryJob['language'];
  token: string;
  expiresAt: number;
  leaseUntil: number;
};

type Dependencies = {
  adapter?: NotificationProviderAdapter | null;
  appOrigin?: string | null;
  client?: InviteWorkerClient | null;
  leaseToken?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{64}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LANGUAGES = new Set(['en', 'ru', 'it', 'ro', 'uk', 'de']);
const DATE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/;
const timestamp = (value: unknown) => typeof value === 'string' && DATE.test(value) ? Date.parse(value) : NaN;

function secureOrigin(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/'
      ? url.origin : null;
  } catch { return null; }
}

const copy = {
  de: ['Einladung zur Kirchenverwaltung', 'Sie wurden eingeladen, eine Kirchenseite bei Orthodox Routes zu verwalten.', 'Einladung öffnen'],
  en: ['Church administration invitation', 'You have been invited to administer a church page on Orthodox Routes.', 'Open invitation'],
  it: ['Invito ad amministrare una chiesa', 'Sei stato invitato ad amministrare una pagina di chiesa su Orthodox Routes.', 'Apri invito'],
  ro: ['Invitație pentru administrarea bisericii', 'Ați fost invitat să administrați o pagină de biserică pe Orthodox Routes.', 'Deschideți invitația'],
  ru: ['Приглашение управлять страницей храма', 'Вас пригласили управлять страницей храма в Orthodox Routes.', 'Открыть приглашение'],
  uk: ['Запрошення керувати сторінкою храму', 'Вас запросили керувати сторінкою храму в Orthodox Routes.', 'Відкрити запрошення'],
} as const;

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

export function parseInviteJob(value: unknown, now = Date.now(), claimElapsedMs = 0): InviteJob | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const evaluatedAt = timestamp(item.evaluated_at);
  // Relative database durations avoid trusting synchronized worker/database wall clocks.
  const leaseDuration = timestamp(item.lease_until) - evaluatedAt;
  const expiresAt = now + timestamp(item.expires_at) - evaluatedAt - claimElapsedMs;
  const leaseUntil = now + leaseDuration - claimElapsedMs;
  if (typeof item.job_id !== 'string' || !UUID.test(item.job_id)
    || typeof item.invite_id !== 'string' || !UUID.test(item.invite_id)
    || typeof item.token !== 'string' || !TOKEN.test(item.token) || item.token === '0'.repeat(64)
    || typeof item.church_slug !== 'string' || item.church_slug.length > 200 || !SLUG.test(item.church_slug)
    || typeof item.church_name !== 'string' || !item.church_name || item.church_name.length > 200 || /[\x00-\x1f\x7f]/.test(item.church_name)
    || typeof item.destination_email !== 'string' || item.destination_email.length > 254
    || !/^[^\s@\x00-\x1f\x7f]+@[^\s@\x00-\x1f\x7f]+\.[^\s@\x00-\x1f\x7f]+$/.test(item.destination_email)
    || typeof item.language !== 'string' || !LANGUAGES.has(item.language)
    || typeof item.attempt_count !== 'number' || !Number.isInteger(item.attempt_count)
    || item.attempt_count < 1 || item.attempt_count > 5
    || !Number.isFinite(now) || !Number.isFinite(evaluatedAt) || !Number.isFinite(expiresAt) || !Number.isFinite(leaseUntil)
    || !Number.isFinite(claimElapsedMs) || claimElapsedMs < 0
    || leaseDuration > 120_000 || leaseUntil <= now || leaseUntil > expiresAt) return null;
  return {
    attemptCount: item.attempt_count,
    churchName: item.church_name,
    churchSlug: item.church_slug,
    destinationEmail: item.destination_email,
    inviteId: item.invite_id,
    jobId: item.job_id,
    language: item.language as InviteJob['language'],
    token: item.token,
    expiresAt, leaseUntil,
  };
}

export function renderInviteMail(job: InviteJob, appOrigin: string) {
  const origin = secureOrigin(appOrigin);
  if (!origin) throw new Error('Invitation mail requires a secure application origin.');
  const [subject, message, action] = copy[job.language];
  const link = new URL(`/churches/${job.churchSlug}/admin/invite`, origin);
  link.hash = `invite=${job.inviteId}&token=${job.token}`;
  const plain = `${message}\n\n${job.churchName}\n\n${action}: ${link.toString()}`;
  return {
    email: {
      subject,
      text: plain,
      html: `<p>${escapeHtml(message)}</p><p>${escapeHtml(job.churchName)}</p><p><a href="${escapeHtml(link.toString())}">${escapeHtml(action)}</a></p>`,
    },
    push: '',
  };
}

async function bounded<T>(task: PromiseLike<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve(task), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Invitation mail deadline exceeded.')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

export async function processChurchInviteMail(limit = 10, dependencies: Dependencies = {}) {
  const adapter = dependencies.adapter === undefined
    ? (() => {
      const config = getResendNotificationConfig();
      return config ? createResendNotificationAdapter(config) : null;
    })()
    : dependencies.adapter;
  const client = dependencies.client === undefined
    ? createPrivilegedSupabaseClient({ requestTimeoutMs: 5000 }) as InviteWorkerClient | null
    : dependencies.client;
  const appOrigin = secureOrigin(dependencies.appOrigin === undefined ? getApplicationOrigin() : dependencies.appOrigin);
  const summary = { claimed: 0, configured: Boolean(adapter?.channel === 'email' && client && appOrigin), failed: 0, sent: 0 };
  if (!summary.configured || !adapter || !client || !appOrigin) return summary;
  const count = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), 50)) : 1;
  // A later job must not spend its lease waiting for earlier provider calls.
  for (let index = 0; index < count; index += 1) {
    const leaseToken = index === 0 && dependencies.leaseToken ? dependencies.leaseToken : randomUUID();
    try {
      const api = client.schema('api');
      const started = performance.now();
      const claimed = await bounded(api.rpc('church_invite_worker_claim', { p_lease_token: leaseToken, p_limit: 1 }), 5000);
      if (claimed.error || !Array.isArray(claimed.data) || claimed.data.length > 1) { summary.failed += 1; break; }
      if (!claimed.data.length) break;
      const job = parseInviteJob(claimed.data[0], Date.now(), Math.max(0, performance.now() - started));
      if (!job) { summary.failed += 1; break; }
      summary.claimed += 1;
      if (Math.min(job.expiresAt, job.leaseUntil) - Date.now() <= 20_000) { summary.failed += 1; break; }
      const deliveryJob: NotificationDeliveryJob = {
        attemptCount: job.attemptCount, authKey: null, channel: 'email',
        destinationValue: job.destinationEmail, eventType: 'church.admin.invited',
        jobId: job.jobId, language: job.language, localizationKey: 'church.admin.invited',
        notificationId: job.inviteId, p256dhKey: null, safeParameters: {},
        safeRoute: `/churches/${job.churchSlug}`, vapidKeyVersion: null,
      };
      let outcome: 'sent' | 'temporary_failure' | 'permanent_failure' = 'temporary_failure';
      let reference: string | null = null;
      try {
        const result = await bounded(adapter.send(deliveryJob, renderInviteMail(job, appOrigin)), 12_000);
        if (result?.outcome === 'sent' && typeof result.providerReference === 'string' && UUID.test(result.providerReference)) {
          outcome = 'sent'; reference = result.providerReference;
        } else if (result?.outcome === 'permanent_failure') outcome = 'permanent_failure';
      } catch { /* An uncertain external send is not proof of cancellation or exactly-once delivery. */ }
      const completed = await bounded(api.rpc('church_invite_worker_complete', {
        p_job_id: job.jobId, p_lease_token: leaseToken, p_outcome: outcome, p_provider_reference: reference,
      }), 5000);
      if (!completed.error && completed.data === true && outcome === 'sent') summary.sent += 1;
      else summary.failed += 1;
    } catch { summary.failed += 1; break; }
  }
  return summary;
}
