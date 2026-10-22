import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getPublicSupabaseConfig } from './config';
import { isSsrCookieEncodingSafe } from './cookie-boundary';

export async function createServerSupabaseClient() {
  const config = getPublicSupabaseConfig();
  if (!config) return null;

  const cookieStore = await cookies();
  if (!await isSsrCookieEncodingSafe(config.url, cookieStore.getAll())) return null;

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
