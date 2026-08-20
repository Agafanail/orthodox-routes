import { randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseEmail } from '@/lib/auth/flow';
import type { ContextualRegistrationConfig } from '@/lib/supabase/config';
import {
  isContextualTicket,
  openContextualResume,
  sealContextualResume,
} from './secure-token';

export const CONTEXTUAL_ACTION_TYPES = [
  'passenger_request',
  'driver_offer',
  'ride_response',
  'church_create',
  'church_admin_invite',
] as const;

export type ContextualActionType = (typeof CONTEXTUAL_ACTION_TYPES)[number];
export type ContextualRegistrationProfile = {
  displayName: string;
  phone: string;
  preferredLanguage: 'de' | 'en' | 'it' | 'ro' | 'ru' | 'uk';
};
export type ContextualDraftInput = {
  actionType: ContextualActionType;
  clientKey?: string;
  payload: Record<string, unknown>;
  registrationEmail?: string;
  registrationProfile?: ContextualRegistrationProfile;
};

type RpcClient = Pick<SupabaseClient, 'schema'>;

export type ClaimedContextualDraft = {
  action_type: ContextualActionType;
  created_at: string;
  draft_id: string;
  eligibility: Record<string, unknown>;
  expires_at: string;
  payload: Record<string, unknown>;
  payload_version: 1;
  status: 'claimed';
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FORBIDDEN_KEY_PATTERN = /(email|phone|contact|password|token|secret)/i;
const PHONE_PATTERN = /^\+[1-9][0-9]{7,14}$/;
const LANGUAGES = ['de', 'en', 'it', 'ro', 'ru', 'uk'] as const;

function containsForbiddenKey(value: unknown, seen = new WeakSet<object>()): boolean {
  if (Array.isArray(value)) {
    if (seen.has(value)) return false;
    seen.add(value);
    return value.some((entry) => containsForbiddenKey(entry, seen));
  }
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  return Object.entries(value).some(
    ([key, entry]) => FORBIDDEN_KEY_PATTERN.test(key) || containsForbiddenKey(entry, seen),
  );
}

export function parseContextualActionType(value: unknown): ContextualActionType | null {
  return typeof value === 'string' && CONTEXTUAL_ACTION_TYPES.includes(value as ContextualActionType)
    ? value as ContextualActionType
    : null;
}

export function parseContextualDraftId(value: unknown) {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null;
}

export function parseContextualPayload(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || containsForbiddenKey(value)) {
    return null;
  }

  try {
    const serialized = JSON.stringify(value);
    if (!serialized || Buffer.byteLength(serialized, 'utf8') > 16_384) return null;
    const parsed = JSON.parse(serialized) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function parseRegistrationProfile(value: ContextualDraftInput['registrationProfile']) {
  if (value === undefined) return null;
  const displayName = value.displayName.trim().replace(/\s+/g, ' ');
  const phone = value.phone.replace(/[\s\-()]/g, '');
  if (
    displayName.length < 1
    || displayName.length > 80
    || /[\u0000-\u001f\u007f]/.test(displayName)
    || !PHONE_PATTERN.test(phone)
    || !LANGUAGES.includes(value.preferredLanguage)
  ) return undefined;
  return { displayName, phone, preferredLanguage: value.preferredLanguage };
}

export function buildAuthConfirmationUrl(
  config: Pick<ContextualRegistrationConfig, 'appOrigin'>,
  ticket?: string,
) {
  const target = new URL('/auth/confirm', config.appOrigin);
  const fragment = new URLSearchParams({ flow: ticket ? 'contextual' : 'login' });
  if (ticket) fragment.set('draft', ticket);
  target.hash = fragment.toString();
  return target.toString();
}

export async function createContextualRegistrationDraft(
  client: RpcClient | null,
  config: ContextualRegistrationConfig | null,
  input: ContextualDraftInput,
  rateKey: string,
) {
  const actionType = parseContextualActionType(input.actionType);
  const clientKey = input.clientKey === undefined ? randomUUID() : parseContextualDraftId(input.clientKey);
  const payload = parseContextualPayload(input.payload);
  const registrationProfile = parseRegistrationProfile(input.registrationProfile);
  if (!actionType || !clientKey || !payload || registrationProfile === undefined) {
    return { status: 'invalid' as const };
  }
  if (!client || !config) return { status: 'unavailable' as const };

  const capability = randomBytes(32).toString('hex');
  try {
    const { data, error } = await client.schema('api').rpc('create_contextual_registration', {
      p_action_type: actionType,
      p_client_key: clientKey,
      p_display_name: registrationProfile?.displayName ?? null,
      p_payload: payload,
      p_payload_version: 1,
      p_phone_e164: registrationProfile?.phone ?? null,
      p_preferred_language: registrationProfile?.preferredLanguage ?? null,
      p_rate_key: rateKey,
      p_resume_token: capability,
    });
    if (error || !data || typeof data !== 'object') return { status: 'unavailable' as const };
    const result = data as Record<string, unknown>;
    if (result.status === 'rate_limited') return { status: 'rate-limited' as const };
    const draftId = parseContextualDraftId(result.draft_id);
    const expiresAt = typeof result.expires_at === 'string' ? result.expires_at : null;
    if (result.status !== 'open' || !draftId || !expiresAt || !Number.isFinite(Date.parse(expiresAt))) {
      return { status: 'unavailable' as const };
    }

    return {
      draftId,
      status: 'ready' as const,
      ticket: sealContextualResume({ capability, expiresAt }, config.secret),
    };
  } catch {
    return { status: 'unavailable' as const };
  }
}

export async function attachContextualRegistrationEmail(
  client: RpcClient | null,
  config: ContextualRegistrationConfig | null,
  ticket: unknown,
  rawEmail: unknown,
  rateKey: string,
) {
  const email = parseEmail(rawEmail);
  const resume = config ? openContextualResume(ticket, config.secret) : null;
  if (!email) return { status: 'invalid-email' as const };
  if (!client || !config || !resume) return { status: 'draft-unavailable' as const };

  try {
    const { data, error } = await client.schema('api').rpc('attach_contextual_draft_email', {
      p_email: email,
      p_rate_key: rateKey,
      p_resume_token: resume.capability,
    });
    if (error || !data || typeof data !== 'object') return { status: 'draft-unavailable' as const };
    const result = data as Record<string, unknown>;
    if (result.status === 'rate_limited') return { status: 'rate-limited' as const };
    if (result.status !== 'attached') return { status: 'draft-unavailable' as const };
    return {
      email,
      emailRedirectTo: buildAuthConfirmationUrl(config, ticket as string),
      status: 'attached' as const,
    };
  } catch {
    return { status: 'draft-unavailable' as const };
  }
}

function isClaimedDraft(value: unknown): value is ClaimedContextualDraft {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return candidate.status === 'claimed'
    && parseContextualDraftId(candidate.draft_id) !== null
    && parseContextualActionType(candidate.action_type) !== null
    && candidate.payload_version === 1
    && parseContextualPayload(candidate.payload) !== null;
}

export async function claimContextualRegistrationDraft(
  client: RpcClient | null,
  config: ContextualRegistrationConfig | null,
  ticket: unknown,
) {
  if (!client || !config || !isContextualTicket(ticket)) return null;
  const resume = openContextualResume(ticket, config.secret);
  if (!resume) return null;

  try {
    const { data, error } = await client.schema('api').rpc('claim_contextual_draft', {
      p_resume_token: resume.capability,
    });
    return !error && isClaimedDraft(data) ? data : null;
  } catch {
    return null;
  }
}
