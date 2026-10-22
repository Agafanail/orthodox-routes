import assert from 'node:assert/strict';
import { createServerClient } from '@supabase/ssr';
import { createComplaintReporterResolver } from '../src/lib/complaints/reporter.ts';

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
  const reloaded = ssr(jar);
  const resolver = createComplaintReporterResolver({ client: reloaded, supabaseUrl: url });
  assert.deepEqual(await resolver(keys(), false), { status: 'resolved', reporterAccountId: accountExists ? accountId : null });
  assert.deepEqual(await resolver(keys(), true), { status: 'unavailable' });
  // A complete but unusable project-cookie state is an unavailable session, never a guest.
  const tampered = new Map([...jar].map(([name]) => [name, 'base64-not-a-session']));
  assert.deepEqual(await createComplaintReporterResolver({ client: ssr(tampered), supabaseUrl: url })([...tampered.keys()], false),
    { status: 'unavailable' });
  process.stdout.write(`Complaint reporter real SSR/Auth proof passed (${accountExists ? 'existing account without eligibility gate' : 'verified pre-account guest'}).\n`);
}
