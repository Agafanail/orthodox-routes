'use server';

import { redirect } from 'next/navigation';
import {
  confirmEmailSignIn,
  requestEmailSignInLink,
  signOutCurrentSession,
} from '@/lib/auth/flow';
import {
  attachContextualRegistrationEmail,
  buildAuthConfirmationUrl,
  claimContextualRegistrationDraft,
} from '@/lib/contextual-registration/flow';
import {
  clearContextualDraftTicket,
  getContextualServerDependencies,
  readContextualDraftTicket,
} from '@/lib/contextual-registration/server';
import { getApplicationOrigin } from '@/lib/supabase/config';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { EmailLinkActionState } from './state';

export async function requestEmailLinkAction(
  _previousState: EmailLinkActionState,
  formData: FormData,
): Promise<EmailLinkActionState> {
  const supabase = await createServerSupabaseClient();
  const contextual = formData.get('context') === 'contextual';
  const dependencies = await getContextualServerDependencies();
  const appOrigin = getApplicationOrigin();
  if (!appOrigin) return { status: 'unavailable' };
  let emailRedirectTo = buildAuthConfirmationUrl({ appOrigin });

  if (contextual) {
    const ticket = await readContextualDraftTicket();
    const attached = await attachContextualRegistrationEmail(
      dependencies?.client ?? null,
      dependencies?.config ?? null,
      ticket,
      formData.get('email'),
      dependencies?.rateKey ?? '',
    );
    if (attached.status !== 'attached') return attached;
    emailRedirectTo = attached.emailRedirectTo;
  }

  return requestEmailSignInLink(
    supabase?.auth ?? null,
    formData.get('email'),
    emailRedirectTo,
  );
}

export async function confirmEmailAction(formData: FormData) {
  const supabase = await createServerSupabaseClient();
  const result = await confirmEmailSignIn(supabase?.auth ?? null, {
    destination: formData.get('next'),
    tokenHash: formData.get('token_hash'),
    type: formData.get('type'),
  });

  if (result.status === 'verified' && formData.get('flow') === 'contextual') {
    const dependencies = await getContextualServerDependencies();
    const claimed = await claimContextualRegistrationDraft(
      supabase,
      dependencies?.config ?? null,
      formData.get('draft'),
    );
    if (!claimed) redirect('/auth/confirm?error=draft-unavailable');
    await clearContextualDraftTicket();
    redirect(`/registration/${claimed.draft_id}`);
  }
  if (result.status === 'verified') redirect(result.destination);
  redirect(`/auth/confirm?error=${result.status}`);
}

export async function signOutAction() {
  const supabase = await createServerSupabaseClient();
  const signedOut = await signOutCurrentSession(supabase?.auth ?? null);
  redirect(signedOut ? '/auth?status=signed-out' : '/auth?error=sign-out-failed');
}
