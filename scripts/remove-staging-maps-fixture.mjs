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
  if (result.status !== 0) fail('The authenticated staging CLI operation failed.');
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

// Ride records reference places and accounts, so the church goes first and cascades.
runCli(['db', 'query', '--linked', `
  delete from app.ride_agreement where driver_occurrence_id in (
    select id from app.driver_offer_occurrence where church_id in (
      select id from app.church where official_name like '%(проверка)%'
    )
  );
  delete from app.church where official_name like '%(проверка)%';
  delete from private.user_place where owner_account_id in (
    select id from app.account where display_name like '%(проверка)%'
  );
  delete from app.account where display_name like '%(проверка)%';
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
