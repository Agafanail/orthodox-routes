import { createHash, randomUUID } from 'node:crypto';
import { createPrivilegedSupabaseClient } from '@/lib/supabase/server-privileged';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LANGUAGES = new Set(['en', 'ru', 'it', 'ro', 'uk', 'de']);
const FIELD_LIMITS: Record<string, number> = {
  official_name: 200,
  source_name: 160,
  description_source: 4000,
  source_description: 4000,
};

type RpcResult = { data: unknown; error: unknown };
export type TranslationWorkerClient = {
  schema(name: 'api'): {
    rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
  };
};

export type TranslationJob = {
  translationId: string;
  sourceId: string;
  sourceVersion: number;
  sourceLanguage: string;
  targetLanguage: string;
  fieldName: string;
  originalText: string;
  attemptCount: number;
};

export type TranslationRequest = {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  fieldName: string;
  idempotencyKey: string;
};

export type TranslationAdapter = {
  translate(request: TranslationRequest, signal: AbortSignal): Promise<{
    text: string;
    providerName: string;
    model?: string;
    glossaryVersion?: number;
  }>;
};

type Dependencies = {
  adapter?: TranslationAdapter | null;
  client?: TranslationWorkerClient | null;
  leaseToken?: string;
  timeoutMs?: number;
};

function validSourceText(fieldName: string, value: string) {
  const length = Array.from(value).length;
  if (length < 1 || length > FIELD_LIMITS[fieldName]) return false;
  return fieldName === 'official_name' || fieldName === 'source_name'
    ? !/[\u0000-\u001f\u007f]/.test(value)
    : !/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}

export function parseTranslationJob(value: unknown): TranslationJob | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.claimed_translation_id !== 'string' || !UUID.test(item.claimed_translation_id)
    || typeof item.claimed_source_id !== 'string' || !UUID.test(item.claimed_source_id)
    || typeof item.claimed_source_version !== 'number'
    || !Number.isInteger(item.claimed_source_version) || item.claimed_source_version < 1
    || typeof item.claimed_source_language !== 'string'
    || !LANGUAGES.has(item.claimed_source_language)
    || typeof item.claimed_target_language !== 'string'
    || !LANGUAGES.has(item.claimed_target_language)
    || item.claimed_source_language === item.claimed_target_language
    || typeof item.claimed_field_name !== 'string'
    || !Object.hasOwn(FIELD_LIMITS, item.claimed_field_name)
    || typeof item.claimed_original_text !== 'string'
    || !validSourceText(item.claimed_field_name, item.claimed_original_text)
    || typeof item.claimed_attempt_count !== 'number'
    || !Number.isInteger(item.claimed_attempt_count)
    || item.claimed_attempt_count < 1 || item.claimed_attempt_count > 5) return null;
  return {
    translationId: item.claimed_translation_id,
    sourceId: item.claimed_source_id,
    sourceVersion: item.claimed_source_version,
    sourceLanguage: item.claimed_source_language,
    targetLanguage: item.claimed_target_language,
    fieldName: item.claimed_field_name,
    originalText: item.claimed_original_text,
    attemptCount: item.claimed_attempt_count,
  };
}

export async function processTranslationJobs(limit = 10, dependencies: Dependencies = {}) {
  const empty = { configured: false, claimed: 0, ready: 0, retry: 0, error: 0,
    superseded: 0, failed: 0 };
  const adapter = dependencies.adapter ?? null;
  if (!adapter) return empty;
  const client = dependencies.client === undefined
    ? createPrivilegedSupabaseClient() as TranslationWorkerClient | null
    : dependencies.client;
  if (!client) return empty;
  const batchLimit = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 50)) : 10;
  const timeoutMs = Math.max(1, Math.min(dependencies.timeoutMs ?? 20_000, 20_000));
  const api = client.schema('api');
  const outcome = { ...empty, configured: true };
  for (let index = 0; index < batchLimit; index += 1) {
    const leaseToken = dependencies.leaseToken ?? randomUUID();
    let claim: RpcResult;
    try {
      claim = await api.rpc('translation_worker_claim', {
        p_lease_token: leaseToken, p_limit: 1,
      });
    } catch {
      outcome.failed += 1;
      break;
    }
    if (claim.error || !Array.isArray(claim.data) || claim.data.length > 1) {
      outcome.failed += 1;
      break;
    }
    if (claim.data.length === 0) break;
    outcome.claimed += 1;
    const job = parseTranslationJob(claim.data[0]);
    if (!job) {
      outcome.failed += 1;
      continue;
    }
    let completionArgs: Record<string, unknown> = {
      p_translation_id: job.translationId,
      p_lease_token: leaseToken,
      p_outcome: 'temporary_failure',
    };
    const controller = new AbortController();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const timedOut = new Promise<never>((_, reject) => {
        deadline = setTimeout(() => {
          controller.abort();
          reject(new Error('Translation deadline exceeded.'));
        }, timeoutMs);
      });
      const result = await Promise.race([adapter.translate({
        text: job.originalText,
        sourceLanguage: job.sourceLanguage,
        targetLanguage: job.targetLanguage,
        fieldName: job.fieldName,
        idempotencyKey: createHash('sha256')
          .update(`${job.translationId}:${job.sourceVersion}`).digest('hex'),
      }, controller.signal), timedOut]);
      completionArgs = {
        ...completionArgs,
        p_outcome: 'success',
        p_translated_text: result.text,
        p_provider_name: result.providerName,
        p_provider_model: result.model ?? null,
        p_glossary_version: result.glossaryVersion ?? null,
      };
    } catch {
      // Provider details stay out of application logs and durable translation rows.
    } finally {
      clearTimeout(deadline);
    }
    let completion: RpcResult;
    try {
      completion = await api.rpc('translation_worker_complete', completionArgs);
    } catch {
      outcome.failed += 1;
      continue;
    }
    if (completion.error || !completion.data || typeof completion.data !== 'object'
      || Array.isArray(completion.data)) {
      outcome.failed += 1;
      continue;
    }
    const status = (completion.data as Record<string, unknown>).status;
    if (status === 'ready' || status === 'retry' || status === 'error' || status === 'superseded') {
      outcome[status] += 1;
    } else {
      outcome.failed += 1;
    }
  }
  return outcome;
}
