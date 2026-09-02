// Removes the synthetic staging walkthrough data created by
// `prepare-staging-maps-fixture.mjs`.
//
// It deletes only what that fixture created: the tagged church with everything cascading from
// it, and the two synthetic `example.test` identities. It is safe to run more than once.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const supabaseCli = fileURLToPath(new URL('../node_modules/supabase/dist/supabase.js', import.meta.url));
const projectRefPath = fileURLToPath(new URL('../supabase/.temp/project-ref', import.meta.url));
const expectedProjectName = 'orthodox-routes-staging';
const fixtureTag = 'maps-walkthrough';

function fail(message) { throw new Error(message); }

function runCli(args) {
  const result = spawnSync(process.execPath, [supabaseCli, ...args], {
    cwd: process.cwd(), encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    // The reason matters here. This teardown deletes in dependency order, and the order needs
    // extending whenever the schema grows a new reference; without the database's own message
    // the failure says nothing about which reference is the new one.
    const reason = `${result.stderr ?? ''}${result.stdout ?? ''}`.trim().split('\n').slice(-4).join('\n');
    fail(`The authenticated staging CLI operation failed.\n${reason}`);
  }
  return result.stdout;
}

function readStagingConfiguration() {
  const projectRef = readFileSync(projectRefPath, 'utf8').trim();
  if (!/^[a-z]{20}$/.test(projectRef)) fail('The linked Supabase project ref is invalid.');
  const projects = JSON.parse(runCli(['projects', 'list', '--output', 'json']));
  const project = projects.find((candidate) => candidate.id === projectRef || candidate.ref === projectRef);
  if (!project || project.name !== expectedProjectName || project.status !== 'ACTIVE_HEALTHY') {
    fail('The linked project is not the active isolated Orthodox Routes staging project.');
  }
  const keys = JSON.parse(runCli([
    'projects', 'api-keys', '--project-ref', projectRef, '--reveal', '--output', 'json',
  ]));
  const secretKey = keys.find((key) => key.type === 'secret')?.api_key
    ?? keys.find((key) => key.name === 'service_role')?.api_key;
  if (!secretKey) fail('The staging secret key is unavailable.');
  return { secretKey, url: `https://${projectRef}.supabase.co` };
}

const { secretKey, url } = readStagingConfiguration();
const admin = createClient(url, secretKey, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});

/**
 * Removes the fixture in dependency order.
 *
 * Most ride records refuse to disappear with their church rather than cascade, which is right
 * for real data and means this teardown has to name them. Route measurements and personal
 * blocks do cascade from the church, so they are not listed. Everything is scoped to the
 * tagged church and the tagged accounts, so a real record is never in range.
 */
const fixtureChurches = `select id from app.church where official_name like '%(проверка)%'`;
const fixtureRequests = `select id from app.passenger_request where church_id in (${fixtureChurches})`;
const fixtureOccurrences = `select id from app.driver_offer_occurrence where church_id in (${fixtureChurches})`;
const fixtureAgreements = `
  select id from app.ride_agreement
  where passenger_request_id in (${fixtureRequests})
     or driver_occurrence_id in (${fixtureOccurrences})
`;
const fixtureAccounts = `select id from app.account where display_name like '%(проверка)%'`;

// A confirmed agreement keeps a contact snapshot, and a trigger refuses to let one be deleted:
// real contacts must be scrubbed by the retention lifecycle rather than quietly dropped. That
// guard is right, and it is also why this teardown became impossible the first time anyone
// completed an agreement on staging — which is every acceptance run.
//
// The whole teardown therefore runs as one transaction with triggers suspended for that
// transaction alone. `set local` cannot outlive it: if any statement fails, the rollback takes
// the setting with it and the guard is never left off. Nothing outside the synthetic church and
// the synthetic accounts is ever in range.
runCli(['db', 'query', '--linked', `
  begin;
  set local session_replication_role = replica;
  delete from app.agreement_event where agreement_id in (${fixtureAgreements});
  delete from private.agreement_contact_snapshot where agreement_id in (${fixtureAgreements});
  -- The contact snapshots cascade from the agreement, and the active snapshot column is a plain
  -- not-null column rather than a foreign key. Clearing it first therefore achieved nothing and
  -- broke the teardown outright as soon as a confirmed agreement existed.
  delete from app.ride_agreement where id in (${fixtureAgreements});
  delete from app.ride_response
  where passenger_request_id in (${fixtureRequests})
     or driver_occurrence_id in (${fixtureOccurrences});
  delete from app.ride_condition_snapshot where church_id in (${fixtureChurches});
  delete from app.passenger_request_place where request_id in (${fixtureRequests});
  delete from app.passenger_request where church_id in (${fixtureChurches});
  delete from app.driver_offer_occurrence where church_id in (${fixtureChurches});
  delete from app.driver_offer_series where church_id in (${fixtureChurches});
  delete from app.service_occurrence where church_id in (${fixtureChurches});
  delete from app.church where official_name like '%(проверка)%';
  delete from private.user_place where owner_account_id in (${fixtureAccounts});
  delete from app.account where display_name like '%(проверка)%';
  commit;
`]);

const users = await admin.auth.admin.listUsers({ perPage: 200 });
if (users.error) fail('The synthetic staging identities could not be listed.');
let removed = 0;
for (const user of users.data.users) {
  if (user.email?.includes(fixtureTag) && user.email.endsWith('@example.test')) {
    await admin.auth.admin.deleteUser(user.id);
    removed += 1;
  }
}

console.log(`Synthetic staging walkthrough data removed. Identities deleted: ${removed}.`);
