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

export function parseInviteJob(value: unknown): InviteJob | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.job_id !== 'string' || !UUID.test(item.job_id)
    || typeof item.invite_id !== 'string' || !UUID.test(item.invite_id)
    || typeof item.token !== 'string' || !TOKEN.test(item.token)
    || typeof item.church_slug !== 'string' || !SLUG.test(item.church_slug)
    || typeof item.church_name !== 'string' || item.church_name.length > 200
    || typeof item.destination_email !== 'string' || item.destination_email.length > 254
    || typeof item.language !== 'string' || !LANGUAGES.has(item.language)
    || typeof item.attempt_count !== 'number' || !Number.isInteger(item.attempt_count)
    || item.attempt_count < 1 || item.attempt_count > 5) return null;
  return {
    attemptCount: item.attempt_count,
    churchName: item.church_name,
    churchSlug: item.church_slug,
    destinationEmail: item.destination_email,
    inviteId: item.invite_id,
    jobId: item.job_id,
    language: item.language as InviteJob['language'],
    token: item.token,
  };
}

export function renderInviteMail(job: InviteJob, appOrigin: string) {
  const [subject, message, action] = copy[job.language];
  const link = new URL(`/churches/${job.churchSlug}/admin/invite`, appOrigin);
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

export async function processChurchInviteMail(limit = 10, dependencies: Dependencies = {}) {
  const adapter = dependencies.adapter === undefined
    ? (() => {
      const config = getResendNotificationConfig();
      return config ? createResendNotificationAdapter(config) : null;
    })()
    : dependencies.adapter;
  const client = dependencies.client === undefined
    ? createPrivilegedSupabaseClient() as InviteWorkerClient | null
    : dependencies.client;
  const appOrigin = dependencies.appOrigin === undefined ? getApplicationOrigin() : dependencies.appOrigin;
  if (!adapter || adapter.channel !== 'email' || !client || !appOrigin) {
    return { claimed: 0, configured: false, failed: 0, sent: 0 };
  }
  const leaseToken = dependencies.leaseToken ?? randomUUID();
  const api = client.schema('api');
  const claimed = await api.rpc('church_invite_worker_claim', {
    p_lease_token: leaseToken,
    p_limit: Math.max(1, Math.min(Math.trunc(limit), 50)),
  });
  if (claimed.error || !Array.isArray(claimed.data)) {
    return { claimed: 0, configured: true, failed: 1, sent: 0 };
  }
  let processed = 0;
  let sent = 0;
  let failed = 0;
  for (const raw of claimed.data) {
    const job = parseInviteJob(raw);
    if (!job) { failed += 1; continue; }
    processed += 1;
    const deliveryJob: NotificationDeliveryJob = {
      attemptCount: job.attemptCount, authKey: null, channel: 'email',
      destinationValue: job.destinationEmail, eventType: 'church.admin.invited',
      jobId: job.jobId, language: job.language, localizationKey: 'church.admin.invited',
      notificationId: job.inviteId, p256dhKey: null, safeParameters: {},
      safeRoute: `/churches/${job.churchSlug}`, vapidKeyVersion: null,
    };
    const result = await adapter.send(deliveryJob, renderInviteMail(job, appOrigin));
    const completion = await api.rpc('church_invite_worker_complete', {
      p_job_id: job.jobId, p_lease_token: leaseToken,
      p_outcome: result.outcome, p_provider_reference: result.providerReference,
    });
    if (!completion.error && completion.data === true && result.outcome === 'sent') sent += 1;
    else failed += 1;
  }
  return { claimed: processed, configured: true, failed, sent };
}
