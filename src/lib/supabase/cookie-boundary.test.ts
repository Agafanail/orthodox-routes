import { describe, expect, it, vi } from 'vitest';
import { stringToBase64URL } from '@supabase/ssr';
import { isSsrCookieEncodingSafe, ssrAuthCookieNames } from './cookie-boundary';

const url = 'https://synthetic.supabase.co', key = 'sb-synthetic-auth-token';
const encoded = `base64-${stringToBase64URL('{"notIdentity":"Київ Żółć"}')}`;
describe('SSR encoding preflight, not session authentication', () => {
  it.each(['', '{}', 'legacy-json-session', encoded])('preserves readable legacy and current serialization %#', async (value) => {
    expect(await isSsrCookieEncodingSafe(url, [{ name: key, value }])).toBe(true);
  });
  it('reassembles chunks with the actual installed SDK before checking encoding', async () => {
    expect(await isSsrCookieEncodingSafe(url, [{ name: `${key}.1`, value: encoded.slice(13) },
      { name: `${key}.0`, value: encoded.slice(0, 13) }])).toBe(true);
    expect(await isSsrCookieEncodingSafe(url, [{ name: `${key}.0`, value: 'base64-' },
      { name: `${key}.1`, value: 'not-a-session' }])).toBe(false);
  });
  it.each([key, `${key}-code-verifier`])('contains undecodable %s bytes before background SDK startup', async (name) => {
    const error = vi.spyOn(console, 'error'), warn = vi.spyOn(console, 'warn');
    try {
      expect(await isSsrCookieEncodingSafe(url, [{ name, value: 'base64-not-a-session' }])).toBe(false);
      expect(error).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled();
    } finally { error.mockRestore(); warn.mockRestore(); }
  });
  it('ignores unrelated cookies without interpreting identity, JSON or signed claims', async () => {
    expect(await isSsrCookieEncodingSafe(url, [{ name: 'sb-other-auth-token', value: 'base64-not-a-session' },
      { name: key, value: `base64-${stringToBase64URL('{"sub":"forged-actor"}')}` }])).toBe(true);
  });
  it('fails closed on invalid project configuration', async () => {
    expect(await isSsrCookieEncodingSafe('not-url', [])).toBe(false);
  });
  it('selects only this project session/PKCE names and canonical chunks for explicit recovery', () => {
    const expected = [key, `${key}.0`, `${key}.12`, `${key}-code-verifier`, `${key}-code-verifier.1`];
    expect(ssrAuthCookieNames(url, [...expected, 'other-cookie', `${key}.invalid`, `${key}.01`,
      `${key}-unrelated`, 'sb-other-auth-token', '__Host-orthodox-routes-complaint-preparation']
      .map((name) => ({ name })))).toEqual(expected);
  });
});
