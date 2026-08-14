'use server';

import { redirect } from 'next/navigation';
import {
  confirmEmailSignIn,
  requestEmailSignInLink,
  signOutCurrentSession,
} from '@/lib/auth/flow';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { EmailLinkActionState } from './state';

export async function requestEmailLinkAction(
  _previousState: EmailLinkActionState,
  formData: FormData,
): Promise<EmailLinkActionState> {
  const supabase = await createServerSupabaseClient();
  return requestEmailSignInLink(supabase?.auth ?? null, formData.get('email'));
}

export async function confirmEmailAction(formData: FormData) {
  const supabase = await createServerSupabaseClient();
  const result = await confirmEmailSignIn(supabase?.auth ?? null, {
    destination: formData.get('next'),
    tokenHash: formData.get('token_hash'),
    type: formData.get('type'),
  });

  if (result.status === 'verified') redirect(result.destination);
  redirect(`/auth/confirm?error=${result.status}`);
}

export async function signOutAction() {
  const supabase = await createServerSupabaseClient();
  const signedOut = await signOutCurrentSession(supabase?.auth ?? null);
  redirect(signedOut ? '/auth?status=signed-out' : '/auth?error=sign-out-failed');
}
