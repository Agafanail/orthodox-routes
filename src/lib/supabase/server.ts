import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getPublicSupabaseConfig } from './config';
import { isSsrCookieEncodingSafe, ssrAuthCookieNames } from './cookie-boundary';

export async function createServerSupabaseClient(options: { recoverMalformedCookies?: boolean } = {}) {
  const config = getPublicSupabaseConfig();
  if (!config) return null;

  const cookieStore = await cookies();
  if (!await isSsrCookieEncodingSafe(config.url, cookieStore.getAll())) {
    // Only existing explicit Auth POST actions request recovery. GET/proxy/reporting
    // never silently clear failed state into a guest. Preserve every unrelated cookie.
    if (options.recoverMalformedCookies !== true) return null;
    try {
      for (const name of ssrAuthCookieNames(config.url, cookieStore.getAll())) cookieStore.delete(name);
      if (!await isSsrCookieEncodingSafe(config.url, cookieStore.getAll())) return null;
    } catch { return null; }
  }

  return createServerClient(config.url, config.key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot write cookies. The Auth proxy refreshes them.
        }
      },
    },
  });
}
