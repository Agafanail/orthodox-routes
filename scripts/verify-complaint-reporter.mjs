import assert from 'node:assert/strict';
import { createServerClient } from '@supabase/ssr';
import { createComplaintReporterResolver } from '../src/lib/complaints/reporter.ts';
import { isSsrCookieEncodingSafe, ssrAuthCookieNames } from '../src/lib/supabase/cookie-boundary.ts';

// Only the parent's disposable local identity/session is used. The production resolver
// never calls getSession or treats these fixture tokens/cookie contents as authority.
export async function verifyComplaintReporter({ url, publicKey, signedInClient, accountId, accountExists }) {
  const jar = new Map();
  const ssr = (values) => createServerClient(url, publicKey, { cookies: {
    getAll: () => [...values].map(([name, value]) => ({ name, value })),
    setAll: (cookies) => cookies.forEach(({ name, value }) => values.set(name, value)),
  } });
  const keys = () => [...jar.keys()];
  const empty = ssr(jar);
  assert.deepEqual(await createComplaintReporterResolver({ client: empty, supabaseUrl: url })(keys(), false),
    { status: 'resolved', reporterAccountId: null });
  const fixtureSession = await signedInClient.auth.getSession();
  assert.equal(fixtureSession.error, null);
  assert.ok(fixtureSession.data.session);
  const seeded = await empty.auth.setSession({ access_token: fixtureSession.data.session.access_token,
    refresh_token: fixtureSession.data.session.refresh_token });
  assert.equal(seeded.error, null);
  assert.ok(jar.size > 0);
  assert.equal(await isSsrCookieEncodingSafe(url, [...jar].map(([name, value]) => ({ name, value }))), true);
  const reloaded = ssr(jar);
  const resolver = createComplaintReporterResolver({ client: reloaded, supabaseUrl: url });
  assert.deepEqual(await resolver(keys(), false), { status: 'resolved', reporterAccountId: accountExists ? accountId : null });
  assert.deepEqual(await resolver(keys(), true), { status: 'unavailable' });
  // A complete but unusable project-cookie state is an unavailable session, never a guest.
  const tampered = new Map([...jar].map(([name]) => [name, 'base64-not-a-session']));
  const tamperedValues = [...tampered].map(([name, value]) => ({ name, value }));
  assert.equal(await isSsrCookieEncodingSafe(url, tamperedValues), false);
  // Match the real server/proxy seam: never initialize the SDK with undecodable bytes.
  const guarded = await isSsrCookieEncodingSafe(url, tamperedValues) ? ssr(tampered) : null;
  assert.deepEqual(await createComplaintReporterResolver({ client: guarded, supabaseUrl: url })([...tampered.keys()], false),
    { status: 'unavailable' });
  const readableInvalid = new Map([[`sb-${new URL(url).hostname.split('.')[0]}-auth-token`, '{}']]);
  assert.equal(await isSsrCookieEncodingSafe(url, [...readableInvalid].map(([name, value]) => ({ name, value }))), true);
  const unusable = ssr(readableInvalid);
  assert.deepEqual(await createComplaintReporterResolver({ client: unusable, supabaseUrl: url })([...readableInvalid.keys()], false),
    { status: 'unavailable' });
  const recovered = new Map(tampered);
  recovered.set('synthetic-unrelated-state', 'preserved');
  for (const name of ssrAuthCookieNames(url, [...recovered.keys()].map((name) => ({ name })))) recovered.delete(name);
  assert.equal(recovered.get('synthetic-unrelated-state'), 'preserved');
  const fresh = ssr(recovered);
  const restored = await fresh.auth.setSession({ access_token: fixtureSession.data.session.access_token,
    refresh_token: fixtureSession.data.session.refresh_token });
  assert.equal(restored.error, null);
  assert.deepEqual(await createComplaintReporterResolver({ client: fresh, supabaseUrl: url })([...recovered.keys()], false),
    { status: 'resolved', reporterAccountId: accountExists ? accountId : null });
  process.stdout.write(`Complaint reporter real SSR/Auth proof passed (${accountExists ? 'existing account without eligibility gate' : 'verified pre-account guest'}).\n`);
}
