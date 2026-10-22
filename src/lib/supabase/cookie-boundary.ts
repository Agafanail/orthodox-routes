import { combineChunks, stringFromBase64URL } from '@supabase/ssr';

export function ssrAuthCookieNames(url: string, cookies: readonly { name: string }[]) {
  const key = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
  return cookies.filter(({ name }) => [key, `${key}-code-verifier`].some((base) => name === base
    || name.startsWith(`${base}.`) && /^(0|[1-9][0-9]*)$/.test(name.slice(base.length + 1))))
    .map(({ name }) => name);
}

// Encoding preflight only, NEVER authentication or decoded-session authority. The
// installed SSR SDK can reject during background initialization before getUser catches.
export async function isSsrCookieEncodingSafe(url: string, cookies: readonly { name: string; value: string }[]) {
  try {
    const storageKey = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
    for (const key of [storageKey, `${storageKey}-code-verifier`]) {
      const value = await combineChunks(key, (name) => cookies.find((cookie) => cookie.name === name)?.value);
      if (value?.startsWith('base64-')) stringFromBase64URL(value.slice(7));
    }
    return true;
  } catch { return false; }
}
