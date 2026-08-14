import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getPublicSupabaseConfig } from './config';

function createAuthResponse(request: NextRequest) {
  const response = NextResponse.next({ request });
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

export async function updateAuthSession(request: NextRequest) {
  const config = getPublicSupabaseConfig();
  if (!config) return createAuthResponse(request);

  let response = createAuthResponse(request);
  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = createAuthResponse(request);
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
        Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
      },
    },
  });

  await supabase.auth.getClaims();
  return response;
}
