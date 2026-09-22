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
} from './adapter';
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
    .filter((channel) => adapters[channel]?.channel === channel);
  const client = dependencies.client === undefined
    ? createPrivilegedSupabaseClient() as NotificationWorkerClient | null
    : dependencies.client;
  const appOrigin = dependencies.appOrigin === undefined ? getApplicationOrigin() : dependencies.appOrigin;
  if (!client || !appOrigin || channels.length === 0) {
    return { claimed: 0, configured: false, failed: 0, sent: 0 };
  }

  const leaseToken = dependencies.leaseToken ?? randomUUID();
  const api = client.schema('api');
  const scheduled = await api.rpc('notification_worker_enqueue_scheduled', {});
  if (scheduled.error) {
    return { claimed: 0, configured: true, failed: 1, sent: 0 };
  }
  const claimed = await api.rpc('notification_worker_claim_jobs_v2', {
    p_channels: channels,
    p_lease_token: leaseToken,
    p_limit: Math.max(1, Math.min(Math.trunc(limit), 50)),
  });
  if (claimed.error || !Array.isArray(claimed.data)) {
    return { claimed: 0, configured: true, failed: 0, sent: 0 };
  }

  let failed = 0;
  let sent = 0;
  let parsed = 0;
  for (const raw of claimed.data) {
    const job = parseNotificationDeliveryJob(raw);
    if (!job) continue;
    parsed += 1;
    const adapter = adapters[job.channel];
    if (!adapter) continue;
    const result = await adapter.send(job, renderNotificationMessage(job, appOrigin));
    const completion = await api.rpc('notification_worker_complete_job', {
      p_job_id: job.jobId,
      p_lease_token: leaseToken,
      p_outcome: result.outcome,
      p_provider_adapter: result.providerAdapter,
      p_provider_code: result.providerCode,
      p_provider_reference: result.providerReference,
      p_safe_failure_class: result.safeFailureClass,
    });
    if (!completion.error && completion.data === true && result.outcome === 'sent') sent += 1;
    else failed += 1;
  }
  return { claimed: parsed, configured: true, failed, sent };
}
