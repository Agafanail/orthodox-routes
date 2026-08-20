'use server';

import {
  attachContextualRegistrationEmail,
  createContextualRegistrationDraft,
  type ContextualDraftInput,
  type ContextualRegistrationProfile,
} from '@/lib/contextual-registration/flow';
import { requestEmailSignInLink } from '@/lib/auth/flow';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  getContextualServerDependencies,
  writeContextualDraftTicket,
} from '@/lib/contextual-registration/server';

function readContextualInput(formData: FormData): ContextualDraftInput | null {
  const actionType = formData.get('action_type');
  const clientKey = formData.get('client_key');
  const payload = formData.get('payload');
  const displayName = formData.get('display_name');
  const phone = formData.get('phone');
  const preferredLanguage = formData.get('preferred_language');
  const email = formData.get('email');
  if (
    typeof actionType !== 'string'
    || typeof clientKey !== 'string'
    || typeof payload !== 'string'
    || typeof displayName !== 'string'
    || typeof phone !== 'string'
    || typeof preferredLanguage !== 'string'
    || (email !== null && typeof email !== 'string')
  ) return null;

  try {
    return {
      actionType: actionType as ContextualDraftInput['actionType'],
      clientKey,
      payload: JSON.parse(payload) as Record<string, unknown>,
      registrationEmail: email || undefined,
      registrationProfile: {
        displayName,
        phone,
        preferredLanguage: preferredLanguage as ContextualRegistrationProfile['preferredLanguage'],
      },
    };
  } catch {
    return null;
  }
}

export async function beginContextualRegistrationAction(formData: FormData) {
  const input = readContextualInput(formData);
  if (!input) return { status: 'invalid' as const };
  const dependencies = await getContextualServerDependencies();
  const result = await createContextualRegistrationDraft(
    dependencies?.client ?? null,
    dependencies?.config ?? null,
    input,
    dependencies?.rateKey ?? '',
  );
  if (result.status !== 'ready' || !dependencies) return result;

  await writeContextualDraftTicket(result.ticket, dependencies.config.appOrigin);
  if (input.registrationEmail?.trim()) {
    const attached = await attachContextualRegistrationEmail(
      dependencies.client,
      dependencies.config,
      result.ticket,
      input.registrationEmail,
      dependencies.rateKey,
    );
    if (attached.status !== 'attached') return attached;
    const supabase = await createServerSupabaseClient();
    const requested = await requestEmailSignInLink(
      supabase?.auth ?? null,
      attached.email,
      attached.emailRedirectTo,
    );
    if (requested.status !== 'sent') return requested;
    return { draftId: result.draftId, status: 'email-sent' as const };
  }
  return { draftId: result.draftId, status: 'ready' as const };
}
