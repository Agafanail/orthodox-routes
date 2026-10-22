import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { parseEmail } from '@/lib/auth/flow';

export type ComplaintRateResult = 'allowed' | 'rate_limited' | 'unavailable';
type RpcResult = { data: unknown; error: unknown };
type Client = { schema(name: 'api'): { rpc(name: string, args: Record<string, unknown>): {
  abortSignal(signal: AbortSignal): PromiseLike<RpcResult>;
} } };
type Input = { trustedNetworkAddress: unknown; replyEmail: unknown };

export function canonicalComplaintNetworkAddress(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const family = isIP(value);
  if (!family) return null;
  try {
    if (family === 4) return value;
    const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
    if (!mapped) return canonical;
    const high = Number.parseInt(mapped[1], 16), low = Number.parseInt(mapped[2], 16);
    return [high >> 8, high & 255, low >> 8, low & 255].join('.');
  } catch { return null; }
}

// Server-only: callers must supply an address obtained from their verified hosting/proxy boundary.
// This module deliberately never reads request headers, cookies, account IDs, or complaint content.
export function deriveComplaintRateKeys(value: unknown, secret: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Partial<Input>;
  if (typeof secret !== 'string' || secret.length < 32 || secret.length > 256
    || !/^[\x21-\x7e]+$/.test(secret)
    || typeof input.trustedNetworkAddress !== 'string' || input.trustedNetworkAddress.length > 64
    || typeof input.replyEmail !== 'string' || input.replyEmail.length > 512
    || /[\x00-\x1f\x7f]/.test(input.replyEmail)) return null;
  const canonicalAddress = canonicalComplaintNetworkAddress(input.trustedNetworkAddress);
  if (!canonicalAddress) return null;
  const email = parseEmail(input.replyEmail)?.toLowerCase();
  if (!email) return null;
  const key = (scope: string, value: string) => createHmac('sha256', secret)
    .update(`orthodox-routes:complaint-prepare:v1:${scope}\0${value}`, 'utf8').digest('hex');
  return { networkKey: key('network', canonicalAddress), mailboxKey: key('mailbox', email) };
}

// This consumes an attempt budget, not a complaint receipt, email proof, or business capability.
// Missing secrets/policy/client fail closed. There is no automatic retry after an uncertain result.
export function createComplaintRateLimiter({ client, secret }: { client: Client | null; secret: unknown }) {
  return async (input: unknown): Promise<ComplaintRateResult> => {
    const keys = deriveComplaintRateKeys(input, secret);
    if (!client || !keys) return 'unavailable';
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<null>((resolve) => {
        timer = setTimeout(() => { controller.abort(); resolve(null); }, 5_000);
      });
      const result = await Promise.race([deadline, client.schema('api').rpc('consume_complaint_rate_limit', {
        p_network_key: keys.networkKey, p_mailbox_key: keys.mailboxKey,
      }).abortSignal(controller.signal)]);
      if (!result || result.error) return 'unavailable';
      return result.data === 'allowed' || result.data === 'rate_limited' ? result.data : 'unavailable';
    } catch { return 'unavailable'; }
    finally {
      clearTimeout(timer);
      controller.abort();
    }
  };
}
