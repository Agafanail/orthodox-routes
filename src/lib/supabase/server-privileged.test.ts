import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), config: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));
vi.mock('./config', () => ({ getServerSupabaseConfig: mocks.config }));
import { createPrivilegedSupabaseClient } from './server-privileged';

describe('privileged client request deadlines', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.config.mockReturnValue({ url: 'https://synthetic.example.test', key: 'synthetic-secret' });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('preserves ordinary callers and fails closed without server configuration', () => {
    createPrivilegedSupabaseClient();
    expect(mocks.createClient.mock.calls[0][2].global).toBeUndefined();
    mocks.config.mockReturnValue(null);
    expect(createPrivilegedSupabaseClient({ requestTimeoutMs: 10_000 })).toBeNull();
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
  });

  it('preserves request headers while composing a live caller cancellation with the deadline', async () => {
    const fakeFetch = vi.fn().mockResolvedValue(new Response('ok'));
    vi.stubGlobal('fetch', fakeFetch);
    createPrivilegedSupabaseClient({ requestTimeoutMs: 10_000 });
    const boundedFetch = mocks.createClient.mock.calls[0][2].global.fetch as typeof fetch;
    const controller = new AbortController();
    await boundedFetch('https://synthetic.example.test/object', {
      headers: { 'x-synthetic': 'preserved' }, signal: controller.signal,
    });
    const init = fakeFetch.mock.calls[0][1] as RequestInit;
    expect(init.headers).toEqual({ 'x-synthetic': 'preserved' });
    expect(init.signal?.aborted).toBe(false);
    controller.abort();
    expect(init.signal?.aborted).toBe(true);
  });
});
