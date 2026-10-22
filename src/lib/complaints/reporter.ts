const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Client = {
  auth: { getUser(): PromiseLike<{ data: { user: { id: string } | null }; error: unknown }> };
  schema(name: 'api'): { rpc(name: 'current_eligibility'): {
    abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: unknown }>;
  } };
};
export type ComplaintReporter = { status: 'resolved'; reporterAccountId: string | null } | { status: 'unavailable' };

async function bounded<T>(run: (signal: AbortSignal) => PromiseLike<T>): Promise<T | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<null>((resolve) => {
      timer = setTimeout(() => { controller.abort(); resolve(null); }, 5000);
    });
    return await Promise.race([deadline, run(controller.signal)]);
  } finally { clearTimeout(timer); controller.abort(); }
}

// Explicit server dependencies only: cookie names must be the complete framework jar
// used by this same request-scoped SSR client, never a form field or decoded session.
export function createComplaintReporterResolver({ client, supabaseUrl }: { client: Client | null; supabaseUrl: unknown }) {
  let storageKey: string | null = null;
  try {
    if (typeof supabaseUrl === 'string') {
      const url = new URL(supabaseUrl);
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
        && url.pathname === '/' && !url.search && !url.hash && url.hostname) {
        // Same default storage key as the installed Supabase client; no custom key is configured.
        storageKey = `sb-${url.hostname.split('.')[0]}-auth-token`;
      }
    }
  } catch { /* Missing/invalid explicit configuration is unavailable, including for guests. */ }
  return async (cookieNames: readonly string[], authorizationPresent: boolean): Promise<ComplaintReporter> => {
    try {
      if (!client || !storageKey || authorizationPresent !== false || !Array.isArray(cookieNames)
        || cookieNames.some((name) => typeof name !== 'string')) return { status: 'unavailable' };
      const names = cookieNames.filter((name) => name === storageKey || name.startsWith(`${storageKey}.`));
      if (!names.length) return { status: 'resolved', reporterAccountId: null };
      // Duplicate/base-plus-chunk state is ambiguous; never downgrade it to a guest.
      if (new Set(names).size !== names.length || names.includes(storageKey) && names.length !== 1) return { status: 'unavailable' };
      const identity = await bounded(() => client.auth.getUser());
      const id = identity?.data?.user?.id;
      if (!identity || identity.error || typeof id !== 'string' || !UUID.test(id)) return { status: 'unavailable' };
      // The existing minimal projection avoids fetching private contacts merely to check
      // account existence. No phone/adult/Terms/status/channel requirement is added.
      const account = await bounded((signal) => client.schema('api').rpc('current_eligibility').abortSignal(signal));
      if (!account || account.error || !account.data || typeof account.data !== 'object' || Array.isArray(account.data)
        || typeof (account.data as { account_exists?: unknown }).account_exists !== 'boolean') return { status: 'unavailable' };
      return { status: 'resolved', reporterAccountId: (account.data as { account_exists: boolean }).account_exists ? id.toLowerCase() : null };
    } catch { return { status: 'unavailable' }; }
  };
}
