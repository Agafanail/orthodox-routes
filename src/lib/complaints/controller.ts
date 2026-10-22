import { isIP } from 'node:net';
import { createHmac } from 'node:crypto';
import { createComplaintPreparationRequestReader } from './request';
import { createComplaintPreparationRetryStore } from './retry-state';
import type { ComplaintPreparationIntent, ComplaintPreparationResult } from './preparation';
import type { ComplaintReporter } from './reporter';

export const COMPLAINT_PREPARATION_COOKIE_PREFIX = '__Host-orthodox-routes-complaint-preparation';
export const COMPLAINT_PREPARATION_HEADER = 'x-complaint-preparation';
type CookieOptions = { httpOnly: true; secure: true; sameSite: 'strict'; path: '/'; maxAge: number; expires: Date };
type CookieStore = { getAll(): { name: string; value: string }[]; set(name: string, value: string, options: CookieOptions): unknown };
type Prepare = (value: unknown, trusted: { reporterAccountId: string | null; trustedNetworkAddress: string },
  intent: ComplaintPreparationIntent) => Promise<ComplaintPreparationResult>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const reply = (status: string, code: number, receipt?: { draftId: string; expiresAt: string }) => Response.json(
  { status, ...receipt }, { status: code, headers: { 'cache-control': 'no-store, private', 'pragma': 'no-cache',
    'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' } },
);

// Unregistered Node HTTP composition. Every dependency is explicit server authority;
// never obtain reporter/network/intent from the parsed payload or forwarded headers here.
export function createComplaintPreparationController(dependencies: {
  applicationOrigin: unknown; retrySecret: unknown; cookieStore: CookieStore | null;
  resolveReporter: (() => Promise<ComplaintReporter>) | null; trustedNetworkAddress: unknown;
  prepare: Prepare | null; now?: () => number;
}) {
  const { cookieStore, resolveReporter, trustedNetworkAddress, prepare, retrySecret } = dependencies;
  const read = createComplaintPreparationRequestReader(dependencies.applicationOrigin);
  const now = dependencies.now ?? Date.now;
  const write = (name: string, ticket: string, expiresAt: number, time: number) => {
    cookieStore!.set(name, ticket, { httpOnly: true, secure: true, sameSite: 'strict', path: '/',
      maxAge: Math.ceil((expiresAt - time) / 1000), expires: new Date(expiresAt) });
  };
  const clear = (name: string) => cookieStore!.set(name, '', { httpOnly: true, secure: true,
    sameSite: 'strict', path: '/', maxAge: 0, expires: new Date(0) });
  return async (request: Request): Promise<Response> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const input = await read(request);
      if (input.status !== 'parsed') return reply(input.status, input.status === 'unavailable' ? 503 : 400);
      const rawSlot = request.headers.get(COMPLAINT_PREPARATION_HEADER);
      if (!rawSlot || !UUID.test(rawSlot)) return reply('invalid_request', 400);
      if (!cookieStore || !resolveReporter || !prepare || typeof trustedNetworkAddress !== 'string' || !isIP(trustedNetworkAddress)
        || typeof retrySecret !== 'string' || !/^[0-9a-f]{64}$/.test(retrySecret)
        || request.signal.aborted) return reply('unavailable', 503);
      // A browser-generated per-form UUID selects state; it is NOT the server-owned
      // idempotency key, actor, mailbox proof, or authority. Separate slots prevent tabs
      // from overwriting each other's retry identity; HMAC also prevents transplanting it.
      const slot = rawSlot.toLowerCase(), name = `${COMPLAINT_PREPARATION_COOKIE_PREFIX}-${slot}`;
      const slotSecret = createHmac('sha256', retrySecret).update(`orthodox-routes:complaint-retry-slot:v1:${slot}`).digest('hex');
      const retry = createComplaintPreparationRetryStore(slotSecret);
      // Reporter lookup already has bounded Auth/RPC reads; also contain a missing/stalled seam.
      const reporter = await Promise.race([resolveReporter(), new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 12_000); })]);
      clearTimeout(timer);
      if (!reporter || reporter.status !== 'resolved' || request.signal.aborted) return reply('unavailable', 503);
      const actor = reporter.reporterAccountId;
      if (!(actor === null || typeof actor === 'string' && UUID.test(actor))) return reply('unavailable', 503);
      const time = now();
      if (!Number.isSafeInteger(time) || time < 0) return reply('unavailable', 503);
      const cookies = cookieStore.getAll().filter((item) => item.name === name);
      if (cookies.length > 1) { clear(name); return reply('state_invalid', 409); }
      if (!cookies.length) {
        const issued = retry.issue(actor, time);
        if (!issued) return reply('unavailable', 503);
        write(name, issued.ticket, issued.expiresAt, time);
        // No draft/budget/challenge write on the response that FIRST sets its retry cookie.
        // Only a later cookie-bearing request proves browser retention before an uncertain write.
        return reply('state_required', 428);
      }
      const ticket = cookies[0].value, opened = retry.open(ticket, actor, time);
      if (!opened) { clear(name); return reply('state_invalid', 409); }
      const result = await Promise.race([
        prepare(input.input, { reporterAccountId: actor, trustedNetworkAddress }, opened.intent),
        new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 16_000); }),
      ]);
      clearTimeout(timer);
      if (!result) return reply('unavailable', 503);
      if (request.signal.aborted) return reply('unavailable', 503); // Unknown commit outcome: keep original retry identity.
      if (result.status === 'expired') { clear(name); return reply('expired', 410); }
      if (result.status === 'pending_email' || result.status === 'email_verified') {
        if (typeof result.draftId !== 'string' || !UUID.test(result.draftId)) return reply('unavailable', 503);
        const currentTime = now(), restricted = retry.restrict(ticket, actor, result.expiresAt, currentTime);
        const state = restricted && retry.open(restricted, actor, currentTime);
        if (!restricted || !state) return reply('unavailable', 503);
        write(name, restricted, state.expiresAt, currentTime);
        return reply(result.status, 200, { draftId: result.draftId, expiresAt: result.expiresAt });
      }
      // A prior explicit attempt may already have committed. Even a later rate/challenge
      // refusal must not discard that identity or renew its original lifetime.
      if (result.status === 'rate_limited') return reply('rate_limited', 429);
      if (result.status === 'rejected') return reply('rejected', 400);
      return reply('unavailable', 503);
    } catch { return reply('unavailable', 503); }
    finally { clearTimeout(timer); }
  };
}
