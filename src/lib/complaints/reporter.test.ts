import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComplaintReporterResolver } from './reporter';

const id = '10000000-0000-4000-8000-000000000001';
const url = 'https://synthetic-project.supabase.co';
const cookie = 'sb-synthetic-project-auth-token';
function fixture() {
  const calls: string[] = [], signals: AbortSignal[] = [];
  const getUser = vi.fn(async (): Promise<{ data: { user: { id: string } | null }; error: unknown }> => {
    calls.push('getUser'); return { data: { user: { id } }, error: null };
  });
  const abortSignal = vi.fn(async (signal: AbortSignal): Promise<{ data: unknown; error: unknown }> => {
    calls.push('current_eligibility'); signals.push(signal);
    return { data: { account_exists: true, eligible: false, account_status: 'restricted', phone_verified: false,
      adult_declared: false, current_terms_accepted: false }, error: null };
  });
  const rpc = vi.fn(() => ({ abortSignal }));
  const client = { auth: { getUser }, schema: vi.fn(() => ({ rpc })) };
  const resolve = createComplaintReporterResolver({ client, supabaseUrl: url });
  return { resolve, client, getUser, rpc, abortSignal, calls, signals };
}

describe('complaint reporter server authority', () => {
  afterEach(() => vi.useRealTimers());
  it('treats only an absent project session as a guest without fetching contacts or identity', async () => {
    const f = fixture();
    expect(await f.resolve(['harmless-preference', 'sb-other-project-auth-token', `${cookie}-unrelated`], false))
      .toEqual({ status: 'resolved', reporterAccountId: null });
    expect(f.calls).toEqual([]);
  });
  it.each([{ names: [cookie] }, { names: [`${cookie}.0`, `${cookie}.1`] }, { names: [`${cookie}.unexpected`] }])('verifies project session-shaped state, never its decoded claims %#', async ({ names }) => {
    const f = fixture();
    expect(await f.resolve(names, false)).toEqual({ status: 'resolved', reporterAccountId: id });
    expect(f.calls).toEqual(['getUser', 'current_eligibility']);
    expect(f.client.schema).toHaveBeenCalledExactlyOnceWith('api');
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith('current_eligibility');
    expect(f.signals[0].aborted).toBe(true);
  });
  it('accepts verified identities without an app account only as guests, not invented accounts', async () => {
    const f = fixture(); f.abortSignal.mockResolvedValue({ data: { account_exists: false }, error: null });
    expect(await f.resolve([cookie], false)).toEqual({ status: 'resolved', reporterAccountId: null });
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith('current_eligibility');
  });
  it('does not require eligibility factors or optional transport delivery to associate an existing reporter', async () => {
    const f = fixture();
    expect(await f.resolve([cookie], false)).toEqual({ status: 'resolved', reporterAccountId: id });
    expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([{ names: [] }, { names: [cookie] }])('refuses competing Authorization authority before identity lookup %#', async ({ names }) => {
    const f = fixture(); expect(await f.resolve(names, true)).toEqual({ status: 'unavailable' }); expect(f.calls).toEqual([]);
  });
  it.each([{ names: [cookie, cookie] }, { names: [cookie, `${cookie}.0`] }, { names: [`${cookie}.0`, `${cookie}.0`] }])('refuses ambiguous session names without guest downgrade %#', async ({ names }) => {
    const f = fixture(); expect(await f.resolve(names, false)).toEqual({ status: 'unavailable' }); expect(f.calls).toEqual([]);
  });
  it.each([undefined, null, '', 'not-url', 'https://user:secret@synthetic-project.supabase.co',
    `${url}/extra`, `${url}?query=private`, `${url}#fragment`, 'ftp://synthetic-project.supabase.co'])('fails closed on explicit configuration %#', async (supabaseUrl) => {
    const f = fixture();
    expect(await createComplaintReporterResolver({ client: f.client, supabaseUrl })([], false)).toEqual({ status: 'unavailable' });
    expect(f.calls).toEqual([]);
  });
  it('refuses a missing client even for an apparent guest', async () => {
    expect(await createComplaintReporterResolver({ client: null, supabaseUrl: url })([], false)).toEqual({ status: 'unavailable' });
  });
  it.each([
    { data: { user: null }, error: null },
    { data: { user: { id } }, error: { message: 'private-provider-error' } },
    { data: { user: { id: 'forged-subject' } }, error: null },
  ])('never treats invalid/revoked/failed session resolution as guest %#', async (identity) => {
    const f = fixture(); f.getUser.mockResolvedValue(identity);
    expect(await f.resolve([cookie], false)).toEqual({ status: 'unavailable' }); expect(f.rpc).not.toHaveBeenCalled();
  });
  it.each([null, [], {}, { account_exists: null }, { account_exists: 'true' }, { account_exists: 1 }].map((data) => ({ data })))('refuses malformed account existence without fetching a private account %#', async ({ data }) => {
    const f = fixture(); f.abortSignal.mockResolvedValue({ data, error: null });
    expect(await f.resolve([cookie], false)).toEqual({ status: 'unavailable' });
  });
  it('contains account errors rather than downgrading them or forwarding private values', async () => {
    const f = fixture(); f.abortSignal.mockResolvedValue({ data: { account_exists: true }, error: { message: 'private-contact@example.test' } });
    expect(await f.resolve([cookie], false)).toEqual({ status: 'unavailable' });
  });
  it('snapshots the verified subject before the account read', async () => {
    const f = fixture(), user = { id };
    f.getUser.mockResolvedValue({ data: { user }, error: null });
    f.abortSignal.mockImplementation(async () => {
      user.id = '20000000-0000-4000-8000-000000000002'; return { data: { account_exists: true }, error: null };
    });
    expect(await f.resolve([cookie], false)).toEqual({ status: 'resolved', reporterAccountId: id });
  });
  it.each(['identity', 'account'] as const)('contains thrown private %s errors', async (stage) => {
    const f = fixture();
    if (stage === 'identity') f.getUser.mockRejectedValue(new Error('private-session@example.test'));
    else f.abortSignal.mockRejectedValue(new Error('private-session@example.test'));
    expect(await f.resolve([cookie], false)).toEqual({ status: 'unavailable' });
  });
  it('bounds an abort-ignoring identity lookup and never starts a late account read', async () => {
    vi.useFakeTimers(); const f = fixture();
    let finish!: (value: Awaited<ReturnType<typeof f.getUser>>) => void;
    f.getUser.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const result = f.resolve([cookie], false); await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toEqual({ status: 'unavailable' }); expect(f.rpc).not.toHaveBeenCalled();
    finish({ data: { user: { id } }, error: null }); await Promise.resolve(); expect(f.rpc).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds account RPCs and aborts even when they ignore cancellation', async () => {
    vi.useFakeTimers(); const f = fixture(); let signal!: AbortSignal;
    f.abortSignal.mockImplementation((value) => { signal = value; return new Promise(() => {}); });
    const result = f.resolve([cookie], false); await vi.advanceTimersByTimeAsync(5000);
    expect(await result).toEqual({ status: 'unavailable' }); expect(signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it('canonicalizes only the verified UUID and never returns session/user/provider/account details', async () => {
    const f = fixture(); f.getUser.mockResolvedValue({ data: { user: { id: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' } }, error: null });
    expect(await f.resolve([cookie], false)).toEqual({ status: 'resolved', reporterAccountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
  });
});
