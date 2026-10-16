import { createClient } from '@supabase/supabase-js';
import { getServerSupabaseConfig } from './config';

export function createPrivilegedSupabaseClient(options: { requestTimeoutMs?: number } = {}) {
  const config = getServerSupabaseConfig();
  if (!config) return null;
  const requestTimeoutMs = options.requestTimeoutMs;
  if (requestTimeoutMs !== undefined
    && (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 30_000)) return null;

  return createClient(config.url, config.key, {
    ...(requestTimeoutMs === undefined ? {} : {
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) => {
          const deadline = AbortSignal.timeout(requestTimeoutMs);
          const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
          return fetch(input, { ...init,
            signal: callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline,
          });
        },
      },
    }),
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
