'use server';

import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { parseContextualDraftId } from '@/lib/contextual-registration/flow';
import { createServerSupabaseClient } from '@/lib/supabase/server';

function returnToDraft(draftId: string, status: string) {
  redirect(`/registration/${draftId}?status=${encodeURIComponent(status)}`);
}

async function ownedDraftClient(rawDraftId: FormDataEntryValue | null) {
  const draftId = parseContextualDraftId(rawDraftId);
  const supabase = await createServerSupabaseClient();
  if (!draftId || !supabase) return null;
  const current = await supabase.schema('api').rpc('current_contextual_draft', {
    p_draft_id: draftId,
  });
  return current.error || !current.data ? null : { draftId, supabase };
}

export async function createContextualAccountAction(formData: FormData) {
  const owned = await ownedDraftClient(formData.get('draft_id'));
  if (!owned) redirect('/auth?error=draft-unavailable');

  const displayName = formData.get('display_name');
  const phone = formData.get('phone');
  const language = formData.get('language');
  if (
    typeof displayName !== 'string'
    || typeof phone !== 'string'
    || typeof language !== 'string'
  ) returnToDraft(owned.draftId, 'account-input');

  const result = await owned.supabase.schema('api').rpc('materialize_contextual_account', {
    p_draft_id: owned.draftId,
    p_display_name: displayName,
    p_phone_e164: phone,
    p_preferred_language: language,
  });
  if (result.error) returnToDraft(owned.draftId, 'account-input');
  returnToDraft(owned.draftId, 'account-created');
}

export async function declareContextualAdultAction(formData: FormData) {
  const owned = await ownedDraftClient(formData.get('draft_id'));
  if (!owned) redirect('/auth?error=draft-unavailable');
  if (formData.get('adult') !== 'yes') returnToDraft(owned.draftId, 'adult-required');

  const result = await owned.supabase.schema('api').rpc('declare_adult');
  returnToDraft(owned.draftId, result.error ? 'account-unavailable' : 'adult-declared');
}

export async function requestContextualPhoneVerificationAction(formData: FormData) {
  const owned = await ownedDraftClient(formData.get('draft_id'));
  if (!owned) redirect('/auth?error=draft-unavailable');

  const account = await owned.supabase.schema('api').rpc('current_account');
  const phone = account.data && typeof account.data === 'object'
    ? (account.data as Record<string, unknown>).phone
    : null;
  if (typeof phone !== 'string') returnToDraft(owned.draftId, 'phone-unavailable');

  const result = await owned.supabase.schema('api').rpc('request_phone_verification', {
    p_client_key: randomUUID(),
    p_phone_e164: phone,
  });
  const status = result.data && typeof result.data === 'object'
    ? (result.data as Record<string, unknown>).status
    : null;
  if (status === 'queued' || status === 'already_verified') {
    returnToDraft(owned.draftId, status === 'queued' ? 'phone-requested' : 'phone-verified');
  }
  returnToDraft(owned.draftId, status === 'rate_limited' ? 'phone-rate-limited' : 'phone-unavailable');
}

export async function verifyContextualPhoneAction(formData: FormData) {
  const owned = await ownedDraftClient(formData.get('draft_id'));
  if (!owned) redirect('/auth?error=draft-unavailable');
  const code = formData.get('code');
  if (typeof code !== 'string' || !/^[0-9]{6}$/.test(code)) {
    returnToDraft(owned.draftId, 'phone-code-invalid');
  }

  const current = await owned.supabase.schema('api').rpc('current_phone_verification');
  const attemptId = current.data && typeof current.data === 'object'
    ? (current.data as Record<string, unknown>).attempt_id
    : null;
  if (typeof attemptId !== 'string') returnToDraft(owned.draftId, 'phone-unavailable');

  const result = await owned.supabase.schema('api').rpc('verify_phone_code', {
    p_attempt_id: attemptId,
    p_code: code,
  });
  const status = result.data && typeof result.data === 'object'
    ? (result.data as Record<string, unknown>).status
    : null;
  const safeStatus = status === 'verified'
    ? 'phone-verified'
    : status === 'invalid_code'
      ? 'phone-code-invalid'
      : status === 'delivery_pending'
        ? 'phone-delivery-pending'
        : 'phone-unavailable';
  returnToDraft(owned.draftId, safeStatus);
}

export async function cancelContextualDraftAction(formData: FormData) {
  const owned = await ownedDraftClient(formData.get('draft_id'));
  if (!owned) redirect('/auth?error=draft-unavailable');
  const result = await owned.supabase.schema('api').rpc('cancel_contextual_draft', {
    p_draft_id: owned.draftId,
  });
  redirect(result.error || !result.data ? `/registration/${owned.draftId}?status=cancel-failed` : '/?status=draft-cancelled');
}
