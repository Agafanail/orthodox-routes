import { randomBytes, randomUUID } from 'node:crypto';
import type { TurnstileAction, TurnstileOutcome } from '@/lib/anti-abuse/turnstile';
import { parseEmail } from '@/lib/auth/flow';
import { createComplaintRateLimiter, deriveComplaintRateKeys } from './rate-limit';
import { parseComplaintDraftReceipt } from './draft-receipt';

type RpcResult = { data: unknown; error: unknown };
type Client = { schema(name: 'api'): { rpc(name: string, args: Record<string, unknown>): {
  abortSignal(signal: AbortSignal): PromiseLike<RpcResult>;
} } };
type Challenge = (token: unknown, action: TurnstileAction, signal?: AbortSignal) => Promise<TurnstileOutcome>;
export type ComplaintPreparationIntent = Readonly<{ clientKey: string; resumeToken: string; emailToken: string }>;
export type ComplaintPreparationResult = { status: 'unavailable' | 'rejected' | 'rate_limited' }
  | { status: 'pending_email' | 'email_verified' | 'expired'; draftId: string; expiresAt: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{64}$/;
const fields = ['targetType', 'targetId', 'category', 'description', 'replyEmail', 'language', 'challengeToken'];

// Server-owned retry state, never a form payload. Keep the email capability private; the future
// HTTP boundary must retain this intent securely and expose at most its separate resume proof.
export function createComplaintPreparationIntent(): ComplaintPreparationIntent {
  return Object.freeze({ clientKey: randomUUID(), resumeToken: randomBytes(32).toString('hex'),
    emailToken: randomBytes(32).toString('hex') });
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype ? value as Record<string, unknown> : null;
}

function parseInput(value: unknown) {
  const item = record(value);
  if (!item || Object.keys(item).length !== fields.length || !fields.every((key) => Object.hasOwn(item, key))
    || typeof item.targetType !== 'string' || !['church', 'passenger_request', 'driver_occurrence', 'ride_agreement'].includes(item.targetType)
    || typeof item.targetId !== 'string' || !UUID.test(item.targetId)
    || typeof item.category !== 'string' || !/^[a-z_]{1,64}$/.test(item.category)
    || typeof item.description !== 'string' || item.description.length > 8000
    || /[\x00-\x09\x0b\x0c\x0e-\x1f\x7f]/.test(item.description)
    || typeof item.replyEmail !== 'string' || item.replyEmail.length > 512 || /[\x00-\x1f\x7f]/.test(item.replyEmail)
    || typeof item.language !== 'string' || !['en', 'ru', 'uk', 'it', 'ro', 'de'].includes(item.language)
    || typeof item.challengeToken !== 'string' || item.challengeToken.length < 1 || item.challengeToken.length > 2048
    || /[\s\x00-\x1f\x7f]/.test(item.challengeToken)) return null;
  const description = item.description.trim();
  const replyEmail = parseEmail(item.replyEmail)?.toLowerCase();
  if (!description || [...description].length > 4000 || !replyEmail) return null;
  return { targetType: item.targetType, targetId: item.targetId, category: item.category,
    description, replyEmail, language: item.language, challengeToken: item.challengeToken };
}

function receipt(value: unknown): ComplaintPreparationResult {
  return parseComplaintDraftReceipt(value) ?? { status: 'unavailable' };
}

async function bounded<T>(run: (signal: AbortSignal) => PromiseLike<T>): Promise<T | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => { controller.abort(); resolve(null); }, 5000);
    });
    return await Promise.race([deadline, run(controller.signal)]);
  } finally { clearTimeout(timer); controller.abort(); }
}

// Inactive server-only orchestration: no endpoint, environment defaults, session/header parsing,
// provider dispatch, or receipt of a complaint. The trusted HTTP boundary is still required.
export function createComplaintPreparationBroker(dependencies: {
  client: Client | null; rateSecret: unknown; verifyChallenge: Challenge | null;
}) {
  const { client, rateSecret, verifyChallenge } = dependencies;
  const consumeBudget = createComplaintRateLimiter({ client, secret: rateSecret });
  return async function prepare(value: unknown, trusted: {
    reporterAccountId: string | null; trustedNetworkAddress: string;
  }, intent: ComplaintPreparationIntent): Promise<ComplaintPreparationResult> {
    try {
      const input = parseInput(value);
      // Snapshot all caller state before any asynchronous dependency can mutate it.
      const actor = trusted?.reporterAccountId;
      const address = trusted?.trustedNetworkAddress;
      const clientKey = intent?.clientKey, resumeToken = intent?.resumeToken, emailToken = intent?.emailToken;
      if (!client || !verifyChallenge || !input
        || !(actor === null || (typeof actor === 'string' && UUID.test(actor)))
        || typeof clientKey !== 'string' || !UUID.test(clientKey)
        || typeof resumeToken !== 'string' || !TOKEN.test(resumeToken)
        || typeof emailToken !== 'string' || !TOKEN.test(emailToken) || resumeToken === emailToken
        || !deriveComplaintRateKeys({ trustedNetworkAddress: address, replyEmail: input.replyEmail }, rateSecret)) {
        return { status: 'unavailable' };
      }
      // Apply the cheap global/network/mailbox budget before spending a provider request.
      const budget = await consumeBudget({ trustedNetworkAddress: address, replyEmail: input.replyEmail });
      if (budget !== 'allowed') return { status: budget };
      const challenge = await bounded((signal) => verifyChallenge(input.challengeToken, 'complaint_submit', signal));
      if (challenge !== 'verified') return { status: challenge === 'rejected' ? 'rejected' : 'unavailable' };
      const result = await bounded((signal) => client.schema('api').rpc('prepare_complaint_email_draft', {
        p_target_type: input.targetType, p_target_id: input.targetId, p_reporter_account_id: actor,
        p_category: input.category, p_description: input.description, p_reply_email: input.replyEmail,
        p_language: input.language, p_client_key: clientKey, p_resume_token: resumeToken, p_email_token: emailToken,
      }).abortSignal(signal));
      return result && !result.error ? receipt(result.data) : { status: 'unavailable' };
    } catch { return { status: 'unavailable' }; }
  };
}
