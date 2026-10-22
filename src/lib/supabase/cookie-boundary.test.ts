import { describe, expect, it, vi } from 'vitest';
import { stringToBase64URL } from '@supabase/ssr';
import { isSsrCookieEncodingSafe } from './cookie-boundary';

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
});
