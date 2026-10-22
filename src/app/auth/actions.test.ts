import { beforeEach, describe, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ client: vi.fn(), request: vi.fn(), confirm: vi.fn(), signOut: vi.fn(), redirect: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: f.redirect }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: f.client }));
vi.mock('@/lib/supabase/config', () => ({ getApplicationOrigin: () => 'https://routes.example.test' }));
vi.mock('@/lib/auth/flow', () => ({ requestEmailSignInLink: f.request, confirmEmailSignIn: f.confirm, signOutCurrentSession: f.signOut }));
vi.mock('@/lib/contextual-registration/flow', () => ({ attachContextualRegistrationEmail: vi.fn(), claimContextualRegistrationDraft: vi.fn(),
  buildAuthConfirmationUrl: () => 'https://routes.example.test/auth/confirm' }));
vi.mock('@/lib/contextual-registration/server', () => ({ clearContextualDraftTicket: vi.fn(), readContextualDraftTicket: vi.fn(),
  getContextualServerDependencies: async () => null }));
import { requestEmailLinkAction, confirmEmailAction, signOutAction } from './actions';

describe('explicit Auth actions permit malformed-cookie recovery without bypassing Auth', () => {
  beforeEach(() => {
    vi.resetAllMocks(); f.client.mockResolvedValue({ auth: { synthetic: true } });
    f.request.mockResolvedValue({ status: 'invalid-email' }); f.confirm.mockResolvedValue({ status: 'invalid-link' });
    f.signOut.mockResolvedValue(false);
  });
  it('enables recovery only as part of the explicit new-link action and still requires ordinary input/Auth', async () => {
    const form = new FormData(); form.set('email', 'not-email');
    expect(await requestEmailLinkAction({ status: 'idle' }, form)).toEqual({ status: 'invalid-email' });
    expect(f.client).toHaveBeenCalledExactlyOnceWith({ recoverMalformedCookies: true });
    expect(f.request).toHaveBeenCalledWith({ synthetic: true }, 'not-email', 'https://routes.example.test/auth/confirm');
  });
  it('retains explicit link proof and failure handling when confirmation recovers local state', async () => {
    await confirmEmailAction(new FormData());
    expect(f.client).toHaveBeenCalledExactlyOnceWith({ recoverMalformedCookies: true });
    expect(f.confirm).toHaveBeenCalledTimes(1); expect(f.redirect).toHaveBeenCalledWith('/auth/confirm?error=invalid-link');
  });
  it('does not claim successful sign-out merely because local state recovery was requested', async () => {
    await signOutAction();
    expect(f.client).toHaveBeenCalledExactlyOnceWith({ recoverMalformedCookies: true });
    expect(f.signOut).toHaveBeenCalledTimes(1); expect(f.redirect).toHaveBeenCalledWith('/auth?error=sign-out-failed');
  });
});
