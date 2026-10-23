import { createHmac } from 'node:crypto';
import { canonicalComplaintNetworkAddress } from './rate-limit';
import { parseComplaintDraftReceipt } from './draft-receipt';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Result = { status: 'unavailable' | 'rejected' | 'rate_limited' }
  | { status: 'email_verified' | 'expired'; draftId: string; expiresAt: string };
type RpcResult = { data: unknown; error: unknown };
type Client = { schema(name: 'api'): { rpc(name: string, args: Record<string, unknown>): {
  abortSignal(signal: AbortSignal): PromiseLike<RpcResult>;
} } };

export function deriveComplaintVerificationRateKeys(address: unknown, draftId: unknown, secret: unknown) {
  const network = canonicalComplaintNetworkAddress(address);
  if (!network || typeof draftId !== 'string' || !UUID.test(draftId)
    || typeof secret !== 'string' || secret.length < 32 || secret.length > 256 || !/^[\x21-\x7e]+$/.test(secret)) return null;
  const key = (scope: string, value: string) => createHmac('sha256', secret)
    .update(`orthodox-routes:complaint-email-verify:v1:${scope}\0${value}`, 'utf8').digest('hex');
  return { networkKey: key('network', network), draftKey: key('draft', draftId.toLowerCase()) };
}

async function bounded(run: (signal: AbortSignal) => PromiseLike<RpcResult>): Promise<RpcResult | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([run(controller.signal), new Promise<null>((resolve) => {
      timer = setTimeout(() => { controller.abort(); resolve(null); }, 5000);
    })]);
  } finally { clearTimeout(timer); controller.abort(); }
}

// No route, GET consumption, Auth session, provider send or complaint receipt.
// The displayed route reference selects expectedDraftId; a body cannot substitute another one.
export function createComplaintEmailVerificationBroker(dependencies: { client: Client | null; rateSecret: unknown }) {
  const { client, rateSecret } = dependencies;
  return async (value: unknown, expectedDraftId: unknown, trustedNetworkAddress: unknown): Promise<Result> => {
    try {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return { status: 'unavailable' };
      const prototype = Object.getPrototypeOf(value), input = value as Record<string, unknown>;
      const proof = input.emailToken;
      const keys = deriveComplaintVerificationRateKeys(trustedNetworkAddress, expectedDraftId, rateSecret);
      if ((prototype !== null && prototype !== Object.prototype) || Object.keys(input).length !== 1
        || !Object.hasOwn(input, 'emailToken') || typeof proof !== 'string' || !/^[0-9a-f]{64}$/.test(proof)
        || !client || !keys || typeof expectedDraftId !== 'string') return { status: 'unavailable' };
      const draftId = expectedDraftId.toLowerCase();
      const api = client.schema('api');
      const budget = await bounded((signal) => api.rpc('consume_complaint_verification_rate_limit', {
        p_network_key: keys.networkKey, p_draft_key: keys.draftKey,
      }).abortSignal(signal));
      if (!budget || budget.error) return { status: 'unavailable' };
      if (budget.data === 'rate_limited') return { status: 'rate_limited' };
      if (budget.data !== 'allowed') return { status: 'unavailable' };
      const verified = await bounded((signal) => api.rpc('verify_complaint_email_draft_v2', {
        p_draft_id: draftId, p_email_token: proof,
      }).abortSignal(signal));
      if (!verified || verified.error) return { status: 'unavailable' };
      if (verified.data === null) return { status: 'rejected' };
      const receipt = parseComplaintDraftReceipt(verified.data);
      if (!receipt || receipt.draftId.toLowerCase() !== draftId || receipt.status === 'pending_email') return { status: 'unavailable' };
      return { ...receipt, status: receipt.status };
    } catch { return { status: 'unavailable' }; }
  };
}
