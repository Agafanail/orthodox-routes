import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { parseTranslationJob, processTranslationJobs } from './worker';
import type { TranslationAdapter, TranslationWorkerClient } from './worker';

const translationId = '6d10e643-6101-4ce3-a1b8-5cd5bcaa109a';
const sourceId = '87077346-486e-4a50-af88-2da6e8250836';
const jobRow = {
  claimed_translation_id: translationId,
  claimed_source_id: sourceId,
  claimed_source_version: 3,
  claimed_source_language: 'en',
  claimed_target_language: 'ru',
  claimed_field_name: 'official_name',
  claimed_original_text: 'Orthodox Church',
  claimed_attempt_count: 1,
};

function clientWith(outcome: { status: string } = { status: 'ready' }) {
  const rpc = vi.fn(async (name: string) => name === 'translation_worker_claim'
    ? { data: [jobRow], error: null }
    : { data: outcome, error: null });
  const client = { schema: () => ({ rpc }) } as TranslationWorkerClient;
  return { client, rpc };
}

describe('translation worker job boundary', () => {
  it('accepts only allowlisted current source text and bounded fields', () => {
    expect(parseTranslationJob(jobRow)).toMatchObject({
      translationId, sourceId, originalText: 'Orthodox Church',
    });
    expect(parseTranslationJob({ ...jobRow, claimed_field_name: 'ride_comment' })).toBeNull();
    expect(parseTranslationJob({ ...jobRow, claimed_field_name: '__proto__' })).toBeNull();
    expect(parseTranslationJob({ ...jobRow, claimed_original_text: 'N'.repeat(201) })).toBeNull();
    expect(parseTranslationJob({ ...jobRow, claimed_original_text: 'Two\nlines' })).toBeNull();
    expect(parseTranslationJob({ ...jobRow, claimed_target_language: 'en' })).toBeNull();
    expect(parseTranslationJob({ ...jobRow, claimed_attempt_count: 6 })).toBeNull();
    expect(parseTranslationJob({ ...jobRow, claimed_field_name: 'source_description',
      claimed_original_text: 'First\nsecond' })).not.toBeNull();
  });

  it('does not claim without an injected adapter and a privileged database client', async () => {
    const { client, rpc } = clientWith();
    expect(await processTranslationJobs(10, { client })).toMatchObject({
      configured: false, claimed: 0,
    });
    expect(rpc).not.toHaveBeenCalled();
    const adapter: TranslationAdapter = { translate: vi.fn() };
    expect(await processTranslationJobs(10, { adapter, client: null })).toMatchObject({
      configured: false, claimed: 0,
    });
  });

  it('sends only one approved source to the adapter and completes the same lease', async () => {
    const { client, rpc } = clientWith();
    const translate = vi.fn().mockResolvedValue({
      text: 'Православный храм', providerName: 'synthetic', model: 'test-v1',
    });
    const result = await processTranslationJobs(1, {
      adapter: { translate }, client,
      leaseToken: 'c9ad043c-8184-47d9-a5d8-2a171e13fdf7',
    });
    expect(result).toEqual({ configured: true, claimed: 1, ready: 1, retry: 0,
      error: 0, superseded: 0, failed: 0 });
    expect(rpc).toHaveBeenNthCalledWith(1, 'translation_worker_claim', {
      p_lease_token: 'c9ad043c-8184-47d9-a5d8-2a171e13fdf7', p_limit: 1,
    });
    expect(translate).toHaveBeenCalledWith({
      sourceLanguage: 'en', targetLanguage: 'ru', fieldName: 'official_name',
      text: 'Orthodox Church',
      idempotencyKey: createHash('sha256').update(`${translationId}:3`).digest('hex'),
    }, expect.any(AbortSignal));
    expect(rpc).toHaveBeenNthCalledWith(2, 'translation_worker_complete', {
      p_translation_id: translationId,
      p_lease_token: 'c9ad043c-8184-47d9-a5d8-2a171e13fdf7',
      p_outcome: 'success', p_translated_text: 'Православный храм',
      p_provider_name: 'synthetic', p_provider_model: 'test-v1', p_glossary_version: null,
    });
  });

  it('records only a safe failure class when the provider throws', async () => {
    const { client, rpc } = clientWith({ status: 'retry' });
    const translate = vi.fn().mockRejectedValue(new Error('secret provider diagnostic'));
    expect(await processTranslationJobs(1, { adapter: { translate }, client })).toMatchObject({
      claimed: 1, retry: 1, failed: 0,
    });
    expect(rpc.mock.calls[1]).toEqual(['translation_worker_complete', expect.objectContaining({
      p_outcome: 'temporary_failure', p_translation_id: translationId,
    })]);
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('secret provider diagnostic');
  });

  it('never passes an unrecognized claimed payload to the provider', async () => {
    const rpc = vi.fn(async () => ({ data: [{ ...jobRow, claimed_field_name: 'ride_comment' }], error: null }));
    const client = { schema: () => ({ rpc }) } as TranslationWorkerClient;
    const translate = vi.fn();
    expect(await processTranslationJobs(1, { adapter: { translate }, client })).toMatchObject({
      claimed: 1, failed: 1,
    });
    expect(translate).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('claims the next job only after completing the current lease', async () => {
    const { client, rpc } = clientWith();
    const translate = vi.fn().mockResolvedValue({ text: 'Translated', providerName: 'synthetic' });
    expect(await processTranslationJobs(2, { adapter: { translate }, client })).toMatchObject({
      claimed: 2, ready: 2,
    });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'translation_worker_claim', 'translation_worker_complete',
      'translation_worker_claim', 'translation_worker_complete',
    ]);
  });

  it('aborts a stalled provider before the lease expires and records a safe retry', async () => {
    vi.useFakeTimers();
    try {
      const { client, rpc } = clientWith({ status: 'retry' });
      let signal: AbortSignal | undefined;
      const translate = vi.fn((_request, requestSignal: AbortSignal) => {
        signal = requestSignal;
        return new Promise<never>(() => {});
      });
      const pending = processTranslationJobs(1, {
        adapter: { translate }, client, timeoutMs: 100,
      });
      await vi.advanceTimersByTimeAsync(100);
      expect(await pending).toMatchObject({ claimed: 1, retry: 1, failed: 0 });
      expect(signal?.aborted).toBe(true);
      expect(rpc.mock.calls[1]).toEqual(['translation_worker_complete', expect.objectContaining({
        p_outcome: 'temporary_failure',
      })]);
    } finally {
      vi.useRealTimers();
    }
  });
});
