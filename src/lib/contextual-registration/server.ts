import { cookies, headers } from 'next/headers';
import { getContextualRegistrationConfig } from '@/lib/supabase/config';
import { createPrivilegedSupabaseClient } from '@/lib/supabase/server-privileged';
import { deriveContextualRateKey, isContextualTicket } from './secure-token';

export const CONTEXTUAL_DRAFT_COOKIE = 'orthodox-routes-contextual-draft';

export async function getContextualServerDependencies() {
  const config = getContextualRegistrationConfig();
  const client = createPrivilegedSupabaseClient();
  if (!config || !client) return null;

  const requestHeaders = await headers();
  const forwarded = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim();
  const networkIdentity = forwarded || requestHeaders.get('x-real-ip')?.trim() || 'unavailable';
  return {
    client,
    config,
    rateKey: deriveContextualRateKey(networkIdentity, config.secret),
  };
}

export async function readContextualDraftTicket() {
  const ticket = (await cookies()).get(CONTEXTUAL_DRAFT_COOKIE)?.value;
  return isContextualTicket(ticket) ? ticket : null;
}

export async function writeContextualDraftTicket(ticket: string, appOrigin: string) {
  if (!isContextualTicket(ticket)) throw new Error('Invalid contextual draft ticket.');
  (await cookies()).set(CONTEXTUAL_DRAFT_COOKIE, ticket, {
    httpOnly: true,
    maxAge: 86_400,
    path: '/',
    sameSite: 'lax',
    secure: new URL(appOrigin).protocol === 'https:',
  });
}

export async function clearContextualDraftTicket() {
  (await cookies()).set(CONTEXTUAL_DRAFT_COOKIE, '', {
    expires: new Date(0),
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
  });
}
