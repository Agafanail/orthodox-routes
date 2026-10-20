import { randomUUID } from 'node:crypto';
import { createPrivilegedSupabaseClient } from '@/lib/supabase/server-privileged';
import { getBirdSmsConfig } from '@/lib/supabase/config';
import {
  deliverPhoneVerificationCode,
  type PhoneVerificationDelivery,
  type PhoneVerificationProviderAdapter,
} from './adapter';
import { createBirdSmsAdapter } from './bird';
import { isPhoneSmsTemplate } from './messages';

type RpcResult = { data: unknown; error: unknown };

export type PhoneVerificationWorkerClient = {
  schema(name: 'api'): {
    rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
  };
};

type WorkerDependencies = {
  adapter?: PhoneVerificationProviderAdapter | null;
  client?: PhoneVerificationWorkerClient | null;
  leaseToken?: string;
};

export type PhoneVerificationWorkerOutcome = {
  attemptId: string;
  delivered: boolean;
};

const unavailableAdapter: PhoneVerificationProviderAdapter = {
  adapterId: 'bird-unconfigured',
  async sendVerificationCode() {
    return { delivered: false };
  },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/;
const timestamp = (value: unknown) => typeof value === 'string' && DATE.test(value) ? Date.parse(value) : NaN;

async function bounded<T>(task: PromiseLike<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve(task), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Phone delivery deadline exceeded.')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

function delivery(value: unknown): PhoneVerificationDelivery | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return typeof record.attempt_id === 'string'
    && typeof record.expires_at === 'string'
    && typeof record.phone_e164 === 'string'
    && typeof record.verification_code === 'string'
    && (record.sms_template_version === 1 || record.sms_template_version === 2)
    && isPhoneSmsTemplate(record.sms_template_version, record.sms_language)
    ? {
      attemptId: record.attempt_id,
      expiresAt: record.expires_at,
      phoneE164: record.phone_e164,
      verificationCode: record.verification_code,
      smsTemplateVersion: record.sms_template_version,
      smsLanguage: record.sms_language,
    }
    : null;
}

export async function processPhoneVerificationDelivery(
  attemptId: string,
  dependencies: WorkerDependencies = {},
) {
  const configuredAdapter = dependencies.adapter === undefined
    ? (() => {
      const config = getBirdSmsConfig();
      return config ? createBirdSmsAdapter(config) : null;
    })()
    : dependencies.adapter;
  const adapter = configuredAdapter ?? unavailableAdapter;
  const privileged = dependencies.client === undefined
    ? createPrivilegedSupabaseClient({ requestTimeoutMs: 5000 }) as PhoneVerificationWorkerClient | null
    : dependencies.client;
  const configured = Boolean(privileged && configuredAdapter);
  const outcomes: PhoneVerificationWorkerOutcome[] = [];
  if (!privileged || !UUID.test(attemptId)) return { configured, outcomes };
  try {
    const leaseToken = dependencies.leaseToken ?? randomUUID();
    const api = privileged.schema('api');
    const started = performance.now();
    const claimed = await bounded(api.rpc('phone_worker_claim_delivery_v3', {
      p_attempt_id: attemptId, p_lease_token: leaseToken,
    }), 5000);
    if (claimed.error || !claimed.data) return { configured, outcomes };
    const item = delivery(claimed.data);
    const raw = claimed.data as Record<string, unknown>;
    const evaluated = timestamp(raw.evaluated_at);
    const leaseDuration = timestamp(raw.lease_until) - evaluated;
    const expiryDuration = timestamp(raw.expires_at) - evaluated;
    const remaining = Math.min(leaseDuration, expiryDuration) - Math.max(0, performance.now() - started);
    if (!item || item.attemptId !== attemptId || !Number.isFinite(remaining) || leaseDuration > 300_000
      || remaining <= 20_000) return { configured, outcomes };
    let result = { delivered: false, providerAdapter: adapter.adapterId, providerReference: null as string | null };
    try { result = await bounded(deliverPhoneVerificationCode(adapter, item), 12_000); }
    catch { /* Unknown outcomes are never exposed or retried automatically. */ }
    const completed = await bounded(api.rpc('phone_worker_complete_delivery', {
      p_attempt_id: item.attemptId,
      p_lease_token: leaseToken,
      p_delivered: result.delivered,
      p_provider_adapter: result.providerAdapter,
      p_provider_reference: result.providerReference,
    }), 5000);
    outcomes.push({
      attemptId: item.attemptId,
      delivered: result.delivered && !completed.error && completed.data === true,
    });
  } catch { /* A transport timeout does not prove database rollback or provider cancellation. */ }
  return { configured, outcomes };
}
