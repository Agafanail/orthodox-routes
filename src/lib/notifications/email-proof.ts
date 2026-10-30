import { randomUUID } from 'node:crypto';
import type { NotificationDeliveryJob, NotificationMessage, NotificationProviderAdapter } from './adapter';
import { normalizeNotificationDeliveryResult } from './adapter';
import { createResendNotificationAdapter } from './resend';
import { getApplicationOrigin, getResendNotificationConfig } from '@/lib/supabase/config';
import { createPrivilegedSupabaseClient } from '@/lib/supabase/server-privileged';
import { emailProofDatabaseTimestamp } from './email-proof-receipt';

export type EmailProofLanguage = NotificationDeliveryJob['language'];
export type EmailProofCopy = Readonly<{ subject: string; body: string; action: string; ignore: string }>;
type RpcResult = { data: unknown; error: unknown };
type Client = { schema(name: 'api'): { rpc(name: string, args: Record<string, unknown>): {
  abortSignal(signal: AbortSignal): PromiseLike<RpcResult>;
} } };
export type EmailProofDependencies = { adapter?: NotificationProviderAdapter | null; client?: Client | null; appOrigin?: string | null };
export type EmailProofJob = { id: string; jobId: string; attemptCount: number; email: string; language: EmailProofLanguage;
  token: string; expiresAt: number; leaseUntil: number };
type Purpose = {
  idField: 'draft_id' | 'request_id';
  claimRpc: 'complaint_proof_mail_claim' | 'account_deletion_confirmation_mail_claim';
  completeRpc: 'complaint_proof_mail_complete' | 'account_deletion_confirmation_mail_complete';
  eventType: 'complaint.email.proof' | 'account.deletion.email.proof';
  copy: Readonly<Record<EmailProofLanguage, EmailProofCopy>>;
  path: (job: EmailProofJob) => string;
  fragmentIdKey?: 'deletion-request';
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{64}$/;
function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
function safeOrigin(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    return url.origin;
  } catch { return null; }
}
async function bounded<T>(task: PromiseLike<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve(task), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Email proof deadline exceeded.')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
async function boundedRpc(api: ReturnType<Client['schema']>, name: string, args: Record<string, unknown>): Promise<RpcResult | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => { controller.abort(); resolve(null); }, 5000);
    });
    return await Promise.race([deadline, api.rpc(name, args).abortSignal(controller.signal)]);
  } finally { clearTimeout(timer); controller.abort(); }
}

// Purpose definitions are static server modules, never request parameters.
// Both consumers share the same provider/lease boundary; no queue is activated here.
export function createEmailProofMailer(purpose: Purpose) {
  function parse(value: unknown, now = Date.now(), claimElapsedMs = 0): EmailProofJob | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const item = value as Record<string, unknown>;
    const id = item[purpose.idField];
    const evaluatedAt = emailProofDatabaseTimestamp(item.evaluated_at);
    const duration = emailProofDatabaseTimestamp(item.expires_at) - evaluatedAt;
    const leaseDuration = emailProofDatabaseTimestamp(item.lease_until) - evaluatedAt;
    // Relative database durations tolerate host clock skew. The entire claim RPC
    // round trip is subtracted conservatively; latency cannot extend a lease.
    const expiresAt = now + duration - claimElapsedMs;
    const leaseUntil = now + leaseDuration - claimElapsedMs;
    if (typeof id !== 'string' || !UUID.test(id) || typeof item.job_id !== 'string' || !UUID.test(item.job_id)
      || typeof item.email_token !== 'string' || !TOKEN.test(item.email_token)
      || typeof item.destination_email !== 'string' || item.destination_email.length > 254
      || !/^[^\s@\u0000-\u001f\u007f]+@[^\s@\u0000-\u001f\u007f]+\.[^\s@\u0000-\u001f\u007f]+$/.test(item.destination_email)
      || typeof item.language !== 'string' || !Object.hasOwn(purpose.copy, item.language)
      || typeof item.attempt_count !== 'number' || !Number.isInteger(item.attempt_count)
      || item.attempt_count < 1 || item.attempt_count > 5
      || !Number.isFinite(evaluatedAt) || !Number.isFinite(expiresAt) || !Number.isFinite(leaseUntil)
      || !Number.isFinite(claimElapsedMs) || claimElapsedMs < 0
      || leaseUntil <= now || leaseUntil > expiresAt || duration > 900_000 || leaseDuration > 45_000) return null;
    return { id, jobId: item.job_id, attemptCount: item.attempt_count, email: item.destination_email,
      language: item.language as EmailProofLanguage, token: item.email_token, expiresAt, leaseUntil };
  }
  function render(job: EmailProofJob, appOrigin: string): NotificationMessage {
    const origin = safeOrigin(appOrigin);
    if (!origin) throw new Error('Email proof requires a secure application origin.');
    const link = new URL(purpose.path(job), origin);
    if (link.origin !== origin || link.search || link.hash) throw new Error('Email proof destination is unavailable.');
    const fragment = new URLSearchParams();
    if (purpose.fragmentIdKey) fragment.set(purpose.fragmentIdKey, job.id);
    fragment.set('email-proof', job.token); link.hash = fragment.toString();
    const copy = purpose.copy[job.language];
    return { email: { subject: copy.subject,
      text: `${copy.body}\n\n${copy.action}: ${link.toString()}\n\n${copy.ignore}`,
      html: `<p>${escapeHtml(copy.body)}</p><p><a href="${escapeHtml(link.toString())}">${escapeHtml(copy.action)}</a></p><p>${escapeHtml(copy.ignore)}</p>` }, push: '' };
  }
  async function process(limit = 5, dependencies: EmailProofDependencies = {}) {
    const adapter = dependencies.adapter === undefined ? (() => {
      const config = getResendNotificationConfig();
      return config ? createResendNotificationAdapter(config) : null;
    })() : dependencies.adapter;
    const client = dependencies.client === undefined ? createPrivilegedSupabaseClient({ requestTimeoutMs: 5000 }) as Client | null : dependencies.client;
    const origin = safeOrigin(dependencies.appOrigin === undefined ? getApplicationOrigin() : dependencies.appOrigin);
    const summary = { claimed: 0, configured: Boolean(adapter?.channel === 'email' && client && origin), failed: 0, sent: 0 };
    if (!summary.configured || !adapter || !client || !origin) return summary;
    const count = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), 10)) : 1;
    for (let index = 0; index < count; index += 1) {
      const leaseToken = randomUUID();
      try {
        const api = client.schema('api'); const claimStarted = performance.now();
        const claimed = await boundedRpc(api, purpose.claimRpc, { p_lease_token: leaseToken });
        if (!claimed || claimed.error) { summary.failed += 1; break; }
        // A null single-candidate claim is not a queue-drain or completed-work assertion.
        if (claimed.data === null) break;
        const job = parse(claimed.data, Date.now(), Math.max(0, performance.now() - claimStarted));
        if (!job) { summary.failed += 1; break; }
        summary.claimed += 1;
        // Reserve the 12-second send plus five-second completion wait and margin.
        if (Math.min(job.expiresAt, job.leaseUntil) - Date.now() <= 20_000) { summary.failed += 1; break; }
        const delivery: NotificationDeliveryJob = { attemptCount: job.attemptCount, authKey: null, channel: 'email',
          destinationValue: job.email, eventType: purpose.eventType, jobId: job.jobId, language: job.language,
          localizationKey: purpose.eventType, notificationId: job.id, p256dhKey: null,
          safeParameters: {}, safeRoute: purpose.path(job), vapidKeyVersion: null };
        let outcome: 'sent' | 'temporary_failure' | 'permanent_failure' = 'temporary_failure';
        try {
          outcome = normalizeNotificationDeliveryResult(await bounded(adapter.send(delivery, render(job, origin)), 12_000), adapter).outcome;
        } catch { /* Unknown transport results retry with a new proof and attempt ID. */ }
        const completed = await boundedRpc(api, purpose.completeRpc, {
          p_job_id: job.jobId, p_lease_token: leaseToken, p_outcome: outcome,
        });
        if (!completed || completed.error || typeof completed.data !== 'boolean') { summary.failed += 1; break; }
        if (completed.data === true && outcome === 'sent') summary.sent += 1;
        else summary.failed += 1;
      } catch { summary.failed += 1; break; }
    }
    return summary;
  }
  return { parse, render, process };
}
