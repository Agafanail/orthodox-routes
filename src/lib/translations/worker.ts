import { createHash, randomUUID } from 'node:crypto';
import { createPrivilegedSupabaseClient } from '@/lib/supabase/server-privileged';
import { getGoogleTranslationConfig } from './config';
import { createGoogleTranslationAdapter } from './google';
import { TRANSLATION_LANGUAGES, validSourceText } from './contract';
import type { TranslationAdapter, TranslationGlossary } from './contract';
export type { TranslationAdapter, TranslationRequest } from './contract';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

type Dependencies = {
  adapter?: TranslationAdapter | null;
  client?: TranslationWorkerClient | null;
  leaseToken?: string;
  timeoutMs?: number;
  monthlyCharacterLimit?: number;
};

export function parseTranslationJob(value: unknown): TranslationJob | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.claimed_translation_id !== 'string' || !UUID.test(item.claimed_translation_id)
    || typeof item.claimed_source_id !== 'string' || !UUID.test(item.claimed_source_id)
    || typeof item.claimed_source_version !== 'number'
    || !Number.isInteger(item.claimed_source_version) || item.claimed_source_version < 1
    || typeof item.claimed_source_language !== 'string'
    || !TRANSLATION_LANGUAGES.has(item.claimed_source_language)
    || typeof item.claimed_target_language !== 'string'
    || !TRANSLATION_LANGUAGES.has(item.claimed_target_language)
    || item.claimed_source_language === item.claimed_target_language
    || typeof item.claimed_field_name !== 'string'
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

export async function processTranslationJobs(limit?: number, dependencies: Dependencies = {}) {
  const empty = { configured: false, claimed: 0, ready: 0, retry: 0, error: 0,
    superseded: 0, deferred: 0, failed: 0 };
  const config = dependencies.adapter === undefined ? getGoogleTranslationConfig() : null;
  const adapter = dependencies.adapter === undefined
    ? config ? createGoogleTranslationAdapter(config) : null
    : dependencies.adapter;
  const monthlyCharacterLimit = dependencies.monthlyCharacterLimit ?? config?.monthlyCharacterLimit;
  if (!adapter || typeof monthlyCharacterLimit !== 'number' || !Number.isInteger(monthlyCharacterLimit)
    || monthlyCharacterLimit < 1 || monthlyCharacterLimit > 100_000_000) return empty;
  const client = dependencies.client === undefined
    ? createPrivilegedSupabaseClient() as TranslationWorkerClient | null
    : dependencies.client;
  if (!client) return empty;
  const requestedLimit = limit ?? config?.batchLimit ?? 10;
  const batchLimit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 50)) : 10;
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
    let glossary: TranslationGlossary | undefined;
    try {
      const preparation = await api.rpc('translation_worker_prepare', {
        p_translation_id: job.translationId, p_lease_token: leaseToken,
        p_monthly_character_limit: monthlyCharacterLimit,
      });
      if (preparation.error || !preparation.data || typeof preparation.data !== 'object'
        || Array.isArray(preparation.data)) throw new Error('Translation preparation failed.');
      const prepared = preparation.data as Record<string, unknown>;
      if (prepared.status === 'deferred') {
        outcome.deferred += 1;
        break;
      }
      if (prepared.status === 'superseded') {
        outcome.superseded += 1;
        continue;
      }
      if (prepared.status !== 'reserved') throw new Error('Translation preparation failed.');
      if (prepared.glossary !== null && prepared.glossary !== undefined) {
        const value = prepared.glossary as Record<string, unknown>;
        if (typeof value.resource !== 'string' || typeof value.version !== 'number'
          || !Number.isInteger(value.version) || value.version < 1) {
          throw new Error('Translation glossary is unavailable.');
        }
        glossary = { resource: value.resource, version: value.version };
      }
    } catch {
      outcome.failed += 1;
      break;
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
        ...(glossary ? { glossary } : {}),
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
