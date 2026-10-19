import { randomUUID } from 'node:crypto';
import {
  getApplicationOrigin,
  getResendNotificationConfig,
  getWebPushNotificationConfig,
} from '@/lib/supabase/config';
import { createPrivilegedSupabaseClient } from '@/lib/supabase/server-privileged';
import type {
  NotificationChannel,
  NotificationDeliveryJob,
  NotificationProviderAdapter,
  NotificationDeliveryResult,
} from './adapter';
import { containedFailure } from './adapter';
import { renderNotificationMessage } from './messages';
import { createResendNotificationAdapter } from './resend';
import { createWebPushNotificationAdapter } from './web-push';

type RpcResult = { data: unknown; error: unknown };

export type NotificationWorkerClient = {
  schema(name: 'api'): {
    rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
  };
};

type WorkerDependencies = {
  adapters?: Partial<Record<NotificationChannel, NotificationProviderAdapter>>;
  appOrigin?: string | null;
  client?: NotificationWorkerClient | null;
  leaseToken?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT = /^[a-z][a-z0-9_.]{1,79}$/;
const LOCALIZATION_KEY = /^[a-z][a-z0-9_.]{1,99}$/;
const SAFE_ROUTE = /^\/[a-z0-9][a-z0-9/_-]{0,239}$/;
const LANGUAGES = new Set(['en', 'ru', 'it', 'ro', 'uk', 'de']);
const DATE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/;
const timestamp = (value: unknown) => typeof value === 'string' && DATE.test(value) ? Date.parse(value) : NaN;
const FAILURE_CLASSES = new Set(['provider_unavailable', 'provider_rate_limited', 'provider_rejected',
  'invalid_provider_ack', 'vapid_key_unavailable', 'subscription_gone']);

function secureOrigin(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/'
      ? url.origin : null;
  } catch { return null; }
}

async function bounded<T>(task: PromiseLike<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve(task), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Notification worker deadline exceeded.')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

export function normalizeNotificationDeliveryResult(value: unknown, adapter: NotificationProviderAdapter): NotificationDeliveryResult {
  const fallback = containedFailure(adapter.adapterId, 'temporary_failure', 'provider_unavailable');
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const item = value as Record<string, unknown>;
  const code = typeof item.providerCode === 'string' && /^http_[1-5][0-9]{2}$/.test(item.providerCode) ? item.providerCode : null;
  if (item.providerAdapter !== adapter.adapterId || (item.providerCode !== null && !code)) return fallback;
  if (item.outcome === 'sent') {
    if (item.safeFailureClass !== null || !code?.startsWith('http_2') || (adapter.channel === 'web_push' && item.providerReference !== null)
      || (adapter.channel === 'email'
      && (typeof item.providerReference !== 'string' || !UUID.test(item.providerReference)))) return fallback;
    return { outcome: 'sent', providerAdapter: adapter.adapterId, providerCode: code,
      providerReference: adapter.channel === 'email' ? item.providerReference as string : null, safeFailureClass: null };
  }
  return (item.outcome === 'temporary_failure' || item.outcome === 'permanent_failure')
    && item.providerReference === null && typeof item.safeFailureClass === 'string' && FAILURE_CLASSES.has(item.safeFailureClass)
    ? containedFailure(adapter.adapterId, item.outcome,
      item.safeFailureClass, code)
    : fallback;
}

function safeParameters(value: unknown): value is Record<string, string | number | boolean | null> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value as Record<string, unknown>).every((item) => (
      item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
    ));
}

export function parseNotificationDeliveryJob(value: unknown): NotificationDeliveryJob | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.job_id !== 'string' || !UUID.test(item.job_id)
    || typeof item.notification_id !== 'string' || !UUID.test(item.notification_id)
    || (item.channel !== 'email' && item.channel !== 'web_push')
    || typeof item.destination_value !== 'string' || item.destination_value.length > 2048
    || typeof item.event_type !== 'string' || !EVENT.test(item.event_type)
    || typeof item.localization_key !== 'string' || !LOCALIZATION_KEY.test(item.localization_key)
    || typeof item.safe_route !== 'string' || !SAFE_ROUTE.test(item.safe_route)
    || typeof item.preferred_language !== 'string' || !LANGUAGES.has(item.preferred_language)
    || typeof item.attempt_count !== 'number' || !Number.isInteger(item.attempt_count)
    || item.attempt_count < 1 || item.attempt_count > 20
    || !safeParameters(item.safe_parameters)
  ) return null;

  const p256dhKey = typeof item.p256dh_key === 'string' ? item.p256dh_key : null;
  const authKey = typeof item.auth_key === 'string' ? item.auth_key : null;
  const vapidKeyVersion = typeof item.vapid_key_version === 'number' && Number.isInteger(item.vapid_key_version)
    ? item.vapid_key_version
    : null;
  if (item.channel === 'web_push' && (!p256dhKey || !authKey || !vapidKeyVersion)) return null;
  if (item.channel === 'email' && (p256dhKey || authKey || vapidKeyVersion)) return null;

  return {
    attemptCount: item.attempt_count,
    authKey,
    channel: item.channel,
    destinationValue: item.destination_value,
    eventType: item.event_type,
    jobId: item.job_id,
    language: item.preferred_language as NotificationDeliveryJob['language'],
    localizationKey: item.localization_key,
    notificationId: item.notification_id,
    p256dhKey,
    safeParameters: item.safe_parameters,
    safeRoute: item.safe_route,
    vapidKeyVersion,
  };
}

function configuredAdapters() {
  const resend = getResendNotificationConfig();
  const webPush = getWebPushNotificationConfig();
  return {
    ...(resend ? { email: createResendNotificationAdapter(resend) } : {}),
    ...(webPush ? { web_push: createWebPushNotificationAdapter(webPush) } : {}),
  } satisfies Partial<Record<NotificationChannel, NotificationProviderAdapter>>;
}

export async function processNotificationDeliveries(
  limit = 20,
  dependencies: WorkerDependencies = {},
) {
  const adapters = dependencies.adapters ?? configuredAdapters();
  const channels = (Object.keys(adapters) as NotificationChannel[])
    .filter((channel) => (channel === 'email' || channel === 'web_push') && adapters[channel]?.channel === channel
      && /^[a-z][a-z0-9-]{0,63}$/.test(adapters[channel]!.adapterId));
  const client = dependencies.client === undefined
    ? createPrivilegedSupabaseClient({ requestTimeoutMs: 5000 }) as NotificationWorkerClient | null
    : dependencies.client;
  const appOrigin = secureOrigin(dependencies.appOrigin === undefined ? getApplicationOrigin() : dependencies.appOrigin);
  const summary = { claimed: 0, configured: Boolean(client && appOrigin && channels.length), failed: 0, sent: 0 };
  if (!summary.configured || !client || !appOrigin) return summary;
  try {
    const api = client.schema('api');
    const scheduled = await bounded(api.rpc('notification_worker_enqueue_scheduled', {}), 5000);
    if (scheduled.error) { summary.failed += 1; return summary; }
    const count = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), 50)) : 1;
    for (let index = 0; index < count; index += 1) {
      const leaseToken = index === 0 && dependencies.leaseToken ? dependencies.leaseToken : randomUUID();
      const started = performance.now();
      const claimed = await bounded(api.rpc('notification_worker_claim_job_v3', {
        p_channels: channels, p_lease_token: leaseToken,
      }), 5000);
      if (claimed.error) { summary.failed += 1; break; }
      if (claimed.data === null) break;
      const job = parseNotificationDeliveryJob(claimed.data);
      const raw = claimed.data as Record<string, unknown> | null;
      const duration = timestamp(raw?.lease_until) - timestamp(raw?.evaluated_at);
      const remaining = duration - Math.max(0, performance.now() - started);
      if (!job || job.attemptCount > 5 || !Number.isFinite(duration) || duration > 60_000 || remaining <= 20_000
        || !channels.includes(job.channel)) { summary.failed += 1; break; }
      summary.claimed += 1;
      const adapter = adapters[job.channel]!;
      let result = containedFailure(adapter.adapterId, 'temporary_failure', 'provider_unavailable');
      try {
        result = normalizeNotificationDeliveryResult(
          await bounded(adapter.send(job, renderNotificationMessage(job, appOrigin)), 12_000), adapter);
      } catch { /* Unknown provider outcomes remain fixed retryable failures, never raw diagnostics. */ }
      const completed = await bounded(api.rpc('notification_worker_complete_job', {
        p_job_id: job.jobId, p_lease_token: leaseToken, p_outcome: result.outcome,
        p_provider_adapter: result.providerAdapter, p_provider_code: result.providerCode,
        p_provider_reference: result.providerReference, p_safe_failure_class: result.safeFailureClass,
      }), 5000);
      if (!completed.error && completed.data === true && result.outcome === 'sent') summary.sent += 1;
      else summary.failed += 1;
    }
  } catch { summary.failed += 1; }
  return summary;
}
