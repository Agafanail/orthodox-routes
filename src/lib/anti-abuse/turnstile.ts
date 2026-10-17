import { randomUUID } from 'node:crypto';
import { getApplicationOrigin } from '@/lib/supabase/config';

export type TurnstileConfig = { secretKey: string; expectedHostname: string };
export type TurnstileAction = 'complaint_submit' | 'support_submit';
export type TurnstileOutcome = 'verified' | 'rejected' | 'unavailable';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MAX_RESPONSE_BYTES = 16_384;
const DEADLINE_MS = 5_000;
const TEST_SECRETS = new Set([
  '1x0000000000000000000000000000000AA',
  '2x0000000000000000000000000000000AA',
  '3x0000000000000000000000000000000AA',
]);

function validConfig(config: TurnstileConfig) {
  return typeof config.secretKey === 'string' && config.secretKey.length >= 16 && config.secretKey.length <= 256
    && !/[\s\u0000-\u001f\u007f]/.test(config.secretKey) && !TEST_SECRETS.has(config.secretKey)
    && typeof config.expectedHostname === 'string' && config.expectedHostname.length <= 253
    && config.expectedHostname.includes('.') && !config.expectedHostname.endsWith('.')
    && config.expectedHostname.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    && !/^\d+(?:\.\d+){3}$/.test(config.expectedHostname);
}

export function getTurnstileConfig(): TurnstileConfig | null {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  const origin = getApplicationOrigin();
  if (!secretKey || !origin) return null;
  const parsed = new URL(origin);
  if (parsed.protocol !== 'https:') return null;
  const config = { secretKey, expectedHostname: parsed.hostname };
  return validConfig(config) ? config : null;
}

async function readProviderJson(response: Response, signal: AbortSignal): Promise<Record<string, unknown> | null> {
  if (!response.ok || !response.body || signal.aborted) {
    void response.body?.cancel().catch(() => undefined);
    return null;
  }
  const reader = response.body.getReader();
  const cancelBody = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancelBody, { once: true });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(chunk.value);
    }
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } finally {
    signal.removeEventListener('abort', cancelBody);
    reader.releaseLock();
  }
}

/** Server-only provider boundary. The trusted handler selects the action, never request input. */
export function createTurnstileVerifier(config: TurnstileConfig | null, providerFetch: typeof fetch = fetch) {
  return async function verify(token: unknown, action: TurnstileAction, callerSignal?: AbortSignal): Promise<TurnstileOutcome> {
    if (!config || !validConfig(config) || callerSignal?.aborted) return 'unavailable';
    if (typeof token !== 'string' || token.length < 1 || token.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(token)
      || (action !== 'complaint_submit' && action !== 'support_submit')) return 'rejected';
    const controller = new AbortController();
    const signal = callerSignal ? AbortSignal.any([callerSignal, controller.signal]) : controller.signal;
    let timeout: ReturnType<typeof setTimeout>;
    const deadline = new Promise<TurnstileOutcome>((resolve) => {
      timeout = setTimeout(() => { controller.abort(); resolve('unavailable'); }, DEADLINE_MS);
    });
    try {
      const verification = async (): Promise<TurnstileOutcome> => {
        const response = await providerFetch(SITEVERIFY, {
          method: 'POST', redirect: 'error', cache: 'no-store', credentials: 'omit', signal,
          headers: { 'content-type': 'application/json' },
          // Do not forward IP headers, account/case identifiers, text, or client-controlled cdata.
          body: JSON.stringify({ secret: config.secretKey, response: token, idempotency_key: randomUUID() }),
        });
        const value = await readProviderJson(response, signal);
        if (!value || signal.aborted) return 'unavailable';
        if (value.success === false) {
          const codes = value['error-codes'];
          return Array.isArray(codes) && codes.length > 0
            && codes.every((code) => code === 'invalid-input-response' || code === 'timeout-or-duplicate')
            ? 'rejected' : 'unavailable';
        }
        if (value.success !== true || (value['error-codes'] !== undefined
          && (!Array.isArray(value['error-codes']) || value['error-codes'].length !== 0))) return 'unavailable';
        if (value.hostname !== config.expectedHostname || value.action !== action) return 'rejected';
        const challengeTime = typeof value.challenge_ts === 'string' ? Date.parse(value.challenge_ts) : NaN;
        const ageMs = Date.now() - challengeTime;
        if (!Number.isFinite(challengeTime) || ageMs < -60_000 || ageMs > 300_000) return 'rejected';
        return 'verified';
      };
      return await Promise.race([verification(), deadline]);
    } catch {
      return 'unavailable';
    } finally {
      clearTimeout(timeout!);
      controller.abort();
    }
  };
}
