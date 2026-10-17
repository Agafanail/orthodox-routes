import { randomUUID } from 'node:crypto';
import type { NotificationDeliveryJob, NotificationMessage, NotificationProviderAdapter } from '@/lib/notifications/adapter';
import { createResendNotificationAdapter } from '@/lib/notifications/resend';
import { getApplicationOrigin, getResendNotificationConfig } from '@/lib/supabase/config';
import { createPrivilegedSupabaseClient } from '@/lib/supabase/server-privileged';

type Language = NotificationDeliveryJob['language'];
type Copy = Readonly<{ subject: string; body: string; action: string; ignore: string }>;
export const complaintProofCopy: Readonly<Record<Language, Copy>> = {
  en: { subject: 'Confirm your email for Orthodox Routes', body: 'Confirm this email address to continue your report. This message does not mean your report has been received.', action: 'Confirm email', ignore: 'If you did not request this, ignore this email.' },
  ru: { subject: 'Подтвердите email для Orthodox Routes', body: 'Подтвердите этот адрес, чтобы продолжить отправку жалобы. Это письмо не означает, что жалоба уже получена.', action: 'Подтвердить email', ignore: 'Если вы этого не запрашивали, проигнорируйте письмо.' },
  uk: { subject: 'Підтвердьте email для Orthodox Routes', body: 'Підтвердьте цю адресу, щоб продовжити надсилання скарги. Цей лист не означає, що скаргу вже отримано.', action: 'Підтвердити email', ignore: 'Якщо ви цього не запитували, проігноруйте лист.' },
  de: { subject: 'E-Mail für Orthodox Routes bestätigen', body: 'Bestätigen Sie diese E-Mail-Adresse, um Ihre Meldung fortzusetzen. Diese Nachricht bedeutet nicht, dass Ihre Meldung bereits eingegangen ist.', action: 'E-Mail bestätigen', ignore: 'Wenn Sie dies nicht angefordert haben, ignorieren Sie diese E-Mail.' },
  it: { subject: 'Conferma la tua email per Orthodox Routes', body: 'Conferma questo indirizzo email per continuare la segnalazione. Questo messaggio non significa che la segnalazione sia già stata ricevuta.', action: 'Conferma email', ignore: 'Se non hai fatto questa richiesta, ignora questa email.' },
  ro: { subject: 'Confirmați adresa de email pentru Orthodox Routes', body: 'Confirmați această adresă de email pentru a continua sesizarea. Acest mesaj nu înseamnă că sesizarea a fost deja primită.', action: 'Confirmați emailul', ignore: 'Dacă nu ați solicitat acest lucru, ignorați acest email.' },
};
export const COMPLAINT_PROOF_COPY_VERSION = 1;

type RpcResult = { data: unknown; error: unknown };
type Client = { schema(name: 'api'): { rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult> } };
type Dependencies = { adapter?: NotificationProviderAdapter | null; client?: Client | null; appOrigin?: string | null };
type Job = { draftId: string; jobId: string; attemptCount: number; email: string; language: Language;
  token: string; expiresAt: number; leaseUntil: number };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/;
function timestamp(value: unknown) {
  return typeof value === 'string' && DATE.test(value) ? Date.parse(value) : NaN;
}
export function parseComplaintProofJob(value: unknown, now = Date.now(), claimElapsedMs = 0): Job | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const evaluatedAt = timestamp(item.evaluated_at);
  const draftDuration = timestamp(item.expires_at) - evaluatedAt;
  const leaseDuration = timestamp(item.lease_until) - evaluatedAt;
  // Trust relative database durations, not synchronized host clocks. Subtract the entire RPC
  // round trip conservatively so network/lock latency can never extend a live server lease.
  const expiresAt = now + draftDuration - claimElapsedMs;
  const leaseUntil = now + leaseDuration - claimElapsedMs;
  if (typeof item.draft_id !== 'string' || !UUID.test(item.draft_id)
    || typeof item.job_id !== 'string' || !UUID.test(item.job_id)
    || typeof item.email_token !== 'string' || !TOKEN.test(item.email_token)
    || typeof item.destination_email !== 'string' || item.destination_email.length > 254
    || !/^[^\s@\u0000-\u001f\u007f]+@[^\s@\u0000-\u001f\u007f]+\.[^\s@\u0000-\u001f\u007f]+$/.test(item.destination_email)
    || typeof item.language !== 'string' || !Object.hasOwn(complaintProofCopy, item.language)
    || typeof item.attempt_count !== 'number' || !Number.isInteger(item.attempt_count)
    || item.attempt_count < 1 || item.attempt_count > 5
    || !Number.isFinite(evaluatedAt) || !Number.isFinite(expiresAt) || !Number.isFinite(leaseUntil)
    || !Number.isFinite(claimElapsedMs) || claimElapsedMs < 0
    || leaseUntil <= now || leaseUntil > expiresAt || draftDuration > 900_000
    || leaseDuration > 45_000) return null;
  return { draftId: item.draft_id, jobId: item.job_id, attemptCount: item.attempt_count,
    email: item.destination_email, language: item.language as Language, token: item.email_token, expiresAt, leaseUntil };
}
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
export function renderComplaintProofMail(job: Job, appOrigin: string): NotificationMessage {
  const origin = safeOrigin(appOrigin);
  if (!origin) throw new Error('Complaint mail requires a secure application origin.');
  const copy = complaintProofCopy[job.language];
  const link = new URL(`/${job.language}/report/${job.draftId}`, origin);
  link.hash = `email-proof=${job.token}`;
  return { email: { subject: copy.subject,
    text: `${copy.body}\n\n${copy.action}: ${link.toString()}\n\n${copy.ignore}`,
    html: `<p>${escapeHtml(copy.body)}</p><p><a href="${escapeHtml(link.toString())}">${escapeHtml(copy.action)}</a></p><p>${escapeHtml(copy.ignore)}</p>` }, push: '' };
}
async function bounded<T>(task: PromiseLike<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve(task), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Complaint mail deadline exceeded.')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
export async function processComplaintProofMail(limit = 5, dependencies: Dependencies = {}) {
  const adapter = dependencies.adapter === undefined ? (() => {
    const config = getResendNotificationConfig();
    return config ? createResendNotificationAdapter(config) : null;
  })() : dependencies.adapter;
  const client = dependencies.client === undefined ? createPrivilegedSupabaseClient() as Client | null : dependencies.client;
  const origin = safeOrigin(dependencies.appOrigin === undefined ? getApplicationOrigin() : dependencies.appOrigin);
  const summary = { claimed: 0, configured: Boolean(adapter?.channel === 'email' && client && origin), failed: 0, sent: 0 };
  if (!summary.configured || !adapter || !client || !origin) return summary;
  const count = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), 10)) : 1;
  // Claim just one short lease at a time, not a batch that can expire while earlier jobs are sent.
  for (let index = 0; index < count; index += 1) {
    const leaseToken = randomUUID();
    try {
      const api = client.schema('api');
      const claimStarted = performance.now();
      const claimed = await bounded(api.rpc('complaint_proof_mail_claim', { p_lease_token: leaseToken }), 5_000);
      if (claimed.error) { summary.failed += 1; break; }
      if (claimed.data === null) break;
      const job = parseComplaintProofJob(claimed.data, Date.now(), Math.max(0, performance.now() - claimStarted));
      if (!job) { summary.failed += 1; break; }
      summary.claimed += 1;
      // Leave a full send window; an almost expired draft must not send a known-dead link.
      if (Math.min(job.expiresAt, job.leaseUntil) - Date.now() <= 15_000) { summary.failed += 1; break; }
      const delivery: NotificationDeliveryJob = { attemptCount: job.attemptCount, authKey: null, channel: 'email',
        destinationValue: job.email, eventType: 'complaint.email.proof', jobId: job.jobId, language: job.language,
        localizationKey: 'complaint.email.proof', notificationId: job.draftId, p256dhKey: null,
        safeParameters: {}, safeRoute: `/${job.language}/report/${job.draftId}`, vapidKeyVersion: null };
      let outcome: 'sent' | 'temporary_failure' | 'permanent_failure' = 'temporary_failure';
      try {
        const result = await bounded(adapter.send(delivery, renderComplaintProofMail(job, origin)), 12_000);
        if (['sent', 'temporary_failure', 'permanent_failure'].includes(result?.outcome)) outcome = result.outcome;
      } catch { /* An unknown transport result is retried under a fresh capability and attempt ID. */ }
      const complete = await bounded(api.rpc('complaint_proof_mail_complete', {
        p_job_id: job.jobId, p_lease_token: leaseToken, p_outcome: outcome,
      }), 5_000);
      if (!complete.error && complete.data === true && outcome === 'sent') summary.sent += 1;
      else summary.failed += 1;
    } catch { summary.failed += 1; break; }
  }
  return summary;
}
