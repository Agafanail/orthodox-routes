import { canonicalComplaintNetworkAddress } from './rate-limit';
import { createComplaintPreparationRequestReader } from './request';
import { createComplaintEmailVerificationBroker } from './verification';
import { parseComplaintDraftReceipt } from './draft-receipt';

type Verify = ReturnType<typeof createComplaintEmailVerificationBroker>;
const reply = (status: string, code: number, receipt?: { draftId: string; expiresAt: string }) => Response.json(
  { status, ...receipt }, { status: code, headers: { 'cache-control': 'no-store, private', 'pragma': 'no-cache',
    'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' } },
);

// Unregistered composition: explicit same-origin POST and server-selected displayed route UUID.
// Never use this for Auth, mailbox changes, receipt of a complaint or automatic link handling.
export function createComplaintEmailVerificationController(dependencies: {
  applicationOrigin: unknown; expectedDraftId: unknown; trustedNetworkAddress: unknown; verify: Verify | null;
}) {
  const read = createComplaintPreparationRequestReader(dependencies.applicationOrigin);
  const { expectedDraftId, trustedNetworkAddress, verify } = dependencies;
  return async (request: Request): Promise<Response> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (new URL(request.url).search) {
        try { void request.body?.cancel().catch(() => {}); } catch { /* Do not retain rejected input. */ }
        return reply('invalid_request', 400);
      }
      const input = await read(request);
      if (input.status !== 'parsed') return reply(input.status, input.status === 'unavailable' ? 503 : 400);
      if (!verify || !canonicalComplaintNetworkAddress(trustedNetworkAddress) || request.signal.aborted) return reply('unavailable', 503);
      const result = await Promise.race([verify(input.input, expectedDraftId, trustedNetworkAddress),
        new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 11_000); })]);
      if (!result || request.signal.aborted) return reply('unavailable', 503);
      if (result.status === 'email_verified' || result.status === 'expired') {
        const receipt = parseComplaintDraftReceipt({ draft_id: result.draftId, status: result.status, expires_at: result.expiresAt });
        if (!receipt || typeof expectedDraftId !== 'string' || receipt.draftId.toLowerCase() !== expectedDraftId.toLowerCase()) {
          return reply('unavailable', 503);
        }
        return reply(receipt.status, receipt.status === 'expired' ? 410 : 200, { draftId: receipt.draftId, expiresAt: receipt.expiresAt });
      }
      if (result.status === 'rate_limited') return reply('rate_limited', 429);
      if (result.status === 'rejected') return reply('rejected', 400);
      return reply('unavailable', 503);
    } catch { return reply('unavailable', 503); }
    finally { clearTimeout(timer); }
  };
}
