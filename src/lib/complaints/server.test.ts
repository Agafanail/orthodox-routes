import { beforeEach, describe, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({
  cookies: vi.fn(), headers: vi.fn(), config: vi.fn(), client: vi.fn(),
}));
vi.mock('next/headers', () => ({ cookies: f.cookies, headers: f.headers }));
vi.mock('@/lib/supabase/config', () => ({ getPublicSupabaseConfig: f.config }));
vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: f.client }));
import { resolveComplaintReporter } from './server';

describe('unwired complaint SSR reporter seam', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    f.config.mockReturnValue({ url: 'https://synthetic.supabase.co', key: 'synthetic-public-key' });
    f.cookies.mockResolvedValue({ getAll: () => [{ name: 'harmless', value: 'not-authority' }] });
    f.headers.mockResolvedValue(new Headers());
    f.client.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: '10000000-0000-4000-8000-000000000001' } }, error: null }) },
      schema: () => ({ rpc: () => ({ abortSignal: async () => ({ data: { account_exists: true }, error: null }) }) }) });
  });
  it('derives guest state only from the actual framework cookie jar and configured public project', async () => {
    expect(await resolveComplaintReporter()).toEqual({ status: 'resolved', reporterAccountId: null });
  });
  it('uses verified identity for actual project session-shaped cookies without decoding cookie contents', async () => {
    f.cookies.mockResolvedValue({ getAll: () => [{ name: 'sb-synthetic-auth-token.0', value: 'forged-content-is-not-the-subject' }] });
    expect(await resolveComplaintReporter()).toEqual({ status: 'resolved', reporterAccountId: '10000000-0000-4000-8000-000000000001' });
  });
  it('rejects competing header authority, including forged browser bearer input', async () => {
    f.headers.mockResolvedValue(new Headers({ authorization: 'Bearer forged-private-token' }));
    expect(await resolveComplaintReporter()).toEqual({ status: 'unavailable' });
  });
  it('does not use browser actor headers or unrelated session-shaped cookies as identity', async () => {
    f.headers.mockResolvedValue(new Headers({ 'x-account-id': 'forged-account' }));
    expect(await resolveComplaintReporter()).toEqual({ status: 'resolved', reporterAccountId: null });
  });
  it('fails closed without public project configuration', async () => {
    f.config.mockReturnValue(null); expect(await resolveComplaintReporter()).toEqual({ status: 'unavailable' });
    expect(f.client).not.toHaveBeenCalled();
  });
  it.each(['cookies', 'headers', 'client'] as const)('contains unavailable framework %s state', async (name) => {
    f[name].mockRejectedValue(new Error('private-framework-state'));
    expect(await resolveComplaintReporter()).toEqual({ status: 'unavailable' });
  });
});
