import { randomUUID } from 'node:crypto';
import { createPrivilegedSupabaseClient } from '@/lib/supabase/server-privileged';
import { getBirdSmsConfig } from '@/lib/supabase/config';
import {
  deliverPhoneVerificationCode,
  type PhoneVerificationDelivery,
  type PhoneVerificationProviderAdapter,
} from './adapter';
import { createBirdSmsAdapter } from './bird';

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

function delivery(value: unknown): PhoneVerificationDelivery | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return typeof record.attempt_id === 'string'
    && typeof record.expires_at === 'string'
    && typeof record.phone_e164 === 'string'
    && typeof record.verification_code === 'string'
    ? {
      attemptId: record.attempt_id,
      expiresAt: record.expires_at,
      phoneE164: record.phone_e164,
      verificationCode: record.verification_code,
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
    ? createPrivilegedSupabaseClient() as PhoneVerificationWorkerClient | null
    : dependencies.client;
  const configured = Boolean(privileged && configuredAdapter);
  if (!privileged) return { configured, outcomes: [] as PhoneVerificationWorkerOutcome[] };

  const leaseToken = dependencies.leaseToken ?? randomUUID();
  const api = privileged.schema('api');
  const claimed = await api.rpc('phone_worker_claim_delivery', {
    p_attempt_id: attemptId,
    p_lease_token: leaseToken,
  });
  if (claimed.error || !Array.isArray(claimed.data)) {
    return { configured, outcomes: [] as PhoneVerificationWorkerOutcome[] };
  }

  const outcomes: PhoneVerificationWorkerOutcome[] = [];
  for (const raw of claimed.data) {
    const item = delivery(raw);
    if (!item) continue;
    const result = await deliverPhoneVerificationCode(adapter, item);
    const completed = await api.rpc('phone_worker_complete_delivery', {
      p_attempt_id: item.attemptId,
      p_lease_token: leaseToken,
      p_delivered: result.delivered,
      p_provider_adapter: result.providerAdapter,
      p_provider_reference: result.providerReference,
    });
    outcomes.push({
      attemptId: item.attemptId,
      delivered: result.delivered && !completed.error && completed.data === true,
    });
  }
  return { configured, outcomes };
}
