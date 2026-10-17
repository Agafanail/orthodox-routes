import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { verifyHiddenScheduleRepairs } from './verify-hidden-schedule-repairs.mjs';

const supabaseCli = fileURLToPath(
  new URL('../node_modules/supabase/dist/supabase.js', import.meta.url),
);

function fail(message) {
  throw new Error(message);
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function readLocalConfig() {
  const status = spawnSync(process.execPath, [supabaseCli, 'status', '--output', 'env'], {
    cwd: process.cwd(), encoding: 'utf8',
  });
  if (status.status !== 0) fail('The local Supabase church-administration test stack is not running.');
  const values = new Map();
  for (const line of status.stdout.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) values.set(match[1], match[2].replace(/^"|"$/g, ''));
  }
  const url = values.get('API_URL');
  const publicKey = values.get('PUBLISHABLE_KEY') ?? values.get('ANON_KEY');
  const serviceRoleKey = values.get('SERVICE_ROLE_KEY');
  if (!url || !publicKey || !serviceRoleKey) fail('Required local-only integration configuration is unavailable.');
  return { publicKey, serviceRoleKey, url };
}

function findDatabaseContainer() {
  const result = spawnSync('docker', ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
  if (result.status !== 0) fail('Docker is unavailable for church-administration verification.');
  const container = result.stdout.split(/\r?\n/).map((value) => value.trim())
    .find((value) => value === 'supabase_db_orthodox-routes');
  if (!container) fail('The local Orthodox Routes database container is unavailable.');
  return container;
}

function runSql(container, statement, { expectFailure = false } = {}) {
  const result = spawnSync(
    'docker',
    ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-f', '-'],
    { encoding: 'utf8', input: statement },
  );
  if (expectFailure) {
    assert.notEqual(result.status, 0, 'The church-administration database operation unexpectedly succeeded.');
    return result.stderr;
  }
  if (result.status !== 0) fail('A synthetic church-administration database operation failed.');
  return result.stdout.trim();
}

function translationIdFor(container, objectType, publicId, fieldName, targetLanguage) {
  const objectTable = objectType === 'church' ? 'app.church' : 'app.service_occurrence';
  return runSql(container, `select translation.id from app.content_translation as translation
    join app.content_source as source on source.id = translation.content_source_id
    where source.object_type = ${sqlLiteral(objectType)}
      and source.object_id = (select id from ${objectTable}
        where public_id = ${sqlLiteral(publicId)}::uuid)
      and source.field_name = ${sqlLiteral(fieldName)}
      and source.source_version = translation.source_version
      and translation.target_language = ${sqlLiteral(targetLanguage)};`);
}

// Synthetic trusted-processor attestation only; this is not real Storage verification.
function syntheticImageManifest() {
  const imageId = randomUUID();
  return { imageId, files: [
    ['master', 1800, 900], ['480', 480, 240], ['960', 960, 480], ['1600', 1600, 800],
  ].map(([role, width, height]) => ({
    role, width, height, objectKey: `${imageId}/${role}.webp`, contentType: 'image/webp',
    byteLength: 1000, sha256: 'a'.repeat(64),
  })) };
}

function userClient(url, publicKey) {
  return createClient(url, publicKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
}

async function signIn(client, email, password) {
  const result = await client.auth.signInWithPassword({ email, password });
  if (result.error || !result.data.session) fail('A synthetic church administrator could not sign in.');
}

async function rpc(client, name, args = {}) {
  const result = await client.schema('api').rpc(name, args);
  if (result.error) fail(`Protected church-administration RPC failed: ${name}.`);
  return result.data;
}

async function rpcFailure(client, name, args = {}) {
  const result = await client.schema('api').rpc(name, args);
  assert.ok(result.error, `${name} unexpectedly succeeded.`);
  return result.error;
}

async function rpcConflict(client, name, args) {
  const result = await client.schema('api').rpc(name, args).abortSignal(AbortSignal.timeout(10_000));
  assert.equal(result.status, 409, `${name} must return a conflict within the request deadline.`);
  assert.equal(result.error?.code, 'PT409');
}

const { publicKey, serviceRoleKey, url } = readLocalConfig();
const container = findDatabaseContainer();
const suffix = `${Date.now()}-${process.pid}`;
const compactSuffix = suffix.replaceAll('-', '');
const translationGlossaryReference = `projects/synthetic-project/locations/us-central1/glossaries/test-${compactSuffix}`;
const password = `Church-${suffix}-Aa1!`;
const identities = Array.from({ length: 5 }, (_, index) => ({
  email: `church-admin-${index + 1}-${suffix}@example.test`,
  name: `Church Administrator ${index + 1}`,
  phone: `+3900000010${index + 1}`,
}));
const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});
const createdUserIds = [];

const churchArgs = (overrides = {}) => ({
  p_address_display: 'Via Test 10, Torino',
  p_client_key: randomUUID(),
  p_country_code: 'IT',
  p_lat: 45.0703,
  p_lng: 7.6869,
  p_locality: 'Torino',
  p_official_name: 'Synthetic Orthodox Church',
  p_slug: `synthetic-church-${compactSuffix}`,
  p_source_language: 'en',
  p_timezone: 'Europe/Rome',
  ...overrides,
});

try {
  // Reapplying the real code-only migration must preserve every API body, signature, and ACL.
  const conflictMigration = readFileSync(new URL(
    '../supabase/migrations/20261016160000_church_version_http_conflicts.sql', import.meta.url,
  ), 'utf8');
  runSql(container, `begin;
    create temporary table conflict_api_snapshot on commit drop as
      select routine.oid, pg_get_functiondef(routine.oid) as definition, routine.proacl
      from pg_proc as routine join pg_namespace as namespace on namespace.oid = routine.pronamespace
      where namespace.nspname = 'api' and routine.prokind = 'f';
    ${conflictMigration}
    do $verify$
    begin
      if exists (select 1 from conflict_api_snapshot as snapshot
        join pg_proc as routine on routine.oid = snapshot.oid
        where pg_get_functiondef(routine.oid) is distinct from snapshot.definition
          or routine.proacl is distinct from snapshot.proacl) then
        raise exception 'Conflict migration reapplication changed API definitions or grants.';
      end if;
      if exists (select 1 from pg_proc as routine
        join pg_namespace as namespace on namespace.oid = routine.pronamespace
        where namespace.nspname = 'api' and routine.prokind = 'f'
          and position('errcode = ''40001''' in pg_get_functiondef(routine.oid)) > 0) then
        raise exception 'Application version conflict still uses serialization SQLSTATE.';
      end if;
    end;
    $verify$;
    commit;`);
  for (const identity of identities) {
    const created = await admin.auth.admin.createUser({
      email: identity.email, email_confirm: true, password,
    });
    if (created.error || !created.data.user) fail('A synthetic church identity could not be created.');
    identity.id = created.data.user.id;
    createdUserIds.push(identity.id);
  }

  const clients = identities.map(() => userClient(url, publicKey));
  for (let index = 0; index < clients.length; index += 1) {
    await signIn(clients[index], identities[index].email, password);
    await rpc(clients[index], 'create_account', {
      p_display_name: identities[index].name,
      p_phone_e164: identities[index].phone,
      p_preferred_language: 'en',
    });
    await rpc(clients[index], 'declare_adult');
  }
  runSql(container, `
    insert into app.legal_document_version (
      document_type, version, language_codes, effective_at, status, content_hash
    ) values (
      'terms', ${sqlLiteral(`church-test-${suffix}`)}, array['en'],
      now() - interval '1 hour', 'published', repeat('d', 64)
    );
  `);
  for (const client of clients) await rpc(client, 'accept_current_terms');
  runSql(container, `
    update private.account_contact set phone_verified_at = now()
    where account_id in (${identities.slice(0, 4).map((identity) => `${sqlLiteral(identity.id)}::uuid`).join(', ')});
  `);

  await rpc(clients[0], 'update_notification_preference', {
    p_client_key: randomUUID(), p_ride_email_enabled: false, p_web_push_enabled: false,
  });
  assert.equal((await rpc(clients[0], 'current_notification_preferences')).has_effective_external_channel, false);

  const anonymousCreate = await fetch(`${url}/rest/v1/rpc/create_church`, {
    method: 'POST', headers: { apikey: publicKey, 'content-type': 'application/json' },
    body: JSON.stringify(churchArgs()),
  });
  assert.ok([401, 403, 404].includes(anonymousCreate.status));
  await rpcFailure(clients[4], 'create_church', churchArgs({
    p_slug: `ineligible-church-${compactSuffix}`,
  }));

  const creationKey = randomUUID();
  const firstArgs = churchArgs({ p_client_key: creationKey });
  const created = await rpc(clients[0], 'create_church', firstArgs);
  assert.equal(created.status, 'created');
  assert.equal(created.slug, firstArgs.p_slug);
  assert.equal(created.safe_route, `/churches/${firstArgs.p_slug}`);
  assert.deepEqual(await rpc(clients[0], 'create_church', firstArgs), created);
  const missingRideChannel = await rpcFailure(clients[0], 'publish_passenger_request', {
    p_child_seat_required: false, p_children_count: 0,
    p_church_id: created.church_id, p_client_key: randomUUID(),
    p_desired_arrival_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    p_places: [], p_public_note: null, p_return_required: false,
    p_service_occurrence_id: null, p_timezone: 'UTC', p_total_passengers: 1,
  });
  assert.match(missingRideChannel.message, /effective external notification channel/i);
  await rpcFailure(clients[0], 'create_church', {
    ...firstArgs, p_official_name: 'Changed input with reused key',
  });

  const publicChurch = await rpc(userClient(url, publicKey), 'transport_church_by_slug', {
    p_slug: firstArgs.p_slug,
  });
  assert.equal(publicChurch.church_id, created.church_id);
  assert.equal(publicChurch.official_name, firstArgs.p_official_name);
  assert.equal(publicChurch.address, firstArgs.p_address_display);

  const managedByCreator = await rpc(clients[0], 'current_managed_churches');
  assert.equal(managedByCreator.length, 1);
  assert.equal(managedByCreator[0].church_id, created.church_id);
  assert.equal(managedByCreator[0].administrator_count, 1);
  assert.equal(managedByCreator[0].content_version, 1);
  assert.deepEqual(await rpc(clients[1], 'current_managed_churches'), []);

  const editArgs = {
    p_church_id: created.church_id,
    p_official_name: 'Synthetic Orthodox Church Updated',
    p_description_source: 'A public description of this synthetic church.',
    p_expected_version: 1,
    p_client_key: randomUUID(),
  };
  await rpcFailure(clients[1], 'update_church_content', editArgs);
  const edited = await rpc(clients[0], 'update_church_content', editArgs);
  assert.equal(edited.status, 'saved');
  assert.equal(edited.content_version, 2);
  assert.deepEqual(await rpc(clients[0], 'update_church_content', editArgs), edited);
  await rpcFailure(clients[0], 'update_church_content', {
    ...editArgs, p_official_name: 'Reused key with different content',
  });
  await rpcConflict(clients[0], 'update_church_content', {
    ...editArgs, p_client_key: randomUUID(),
  });
  const editedPublicChurch = await rpc(userClient(url, publicKey), 'transport_church_by_slug', {
    p_slug: firstArgs.p_slug,
  });
  assert.equal(editedPublicChurch.official_name, editArgs.p_official_name);
  assert.equal(editedPublicChurch.description, editArgs.p_description_source);
  assert.equal(editedPublicChurch.address, firstArgs.p_address_display);
  assert.equal((await rpc(clients[0], 'current_managed_churches'))[0].content_version, 2);
  assert.equal(runSql(container, `select count(*) from app.church_admin_event
    where church_id = (select id from app.church where public_id = ${sqlLiteral(created.church_id)}::uuid)
      and event_type = 'church.content_updated';`), '1');

  const serviceArgs = {
    p_church_id: created.church_id,
    p_source_name: 'Synthetic Vespers',
    p_source_description: 'A one-off synthetic service.',
    p_starts_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    p_client_key: randomUUID(),
  };
  await rpcFailure(clients[1], 'create_one_off_service', serviceArgs);
  await rpcFailure(clients[4], 'create_one_off_service', serviceArgs);
  const service = await rpc(clients[0], 'create_one_off_service', serviceArgs);
  assert.equal(service.status, 'created');
  assert.equal(service.version, 1);
  assert.deepEqual(await rpc(clients[0], 'create_one_off_service', serviceArgs), service);
  await rpcFailure(clients[0], 'create_one_off_service', {
    ...serviceArgs, p_source_name: 'Different service with reused key',
  });
  await rpcFailure(clients[0], 'create_one_off_service', {
    ...serviceArgs, p_client_key: randomUUID(),
  });
  const publicSchedule = await rpc(userClient(url, publicKey), 'published_church_schedule', {
    p_church_id: created.church_id,
  });
  assert.equal(publicSchedule.length, 1);
  assert.equal(publicSchedule[0].service_id, service.service_id);
  assert.equal(publicSchedule[0].source_name, serviceArgs.p_source_name);
  assert.equal(publicSchedule[0].description, serviceArgs.p_source_description);
  assert.equal(Date.parse(publicSchedule[0].starts_at), Date.parse(serviceArgs.p_starts_at));
  assert.equal(publicSchedule[0].timezone, 'Europe/Rome');
  assert.equal(publicSchedule[0].status, 'scheduled');
  assert.equal(publicSchedule[0].time_changed, false);
  assert.equal(runSql(container, `select count(*) from app.content_source
    where object_type = 'church' and object_id = (select id from app.church
      where public_id = ${sqlLiteral(created.church_id)}::uuid)
      and field_name in ('official_name', 'description_source');`), '2');
  assert.equal(runSql(container, `select count(*) from app.content_source
    where object_type = 'service_occurrence'
      and object_id = (select id from app.service_occurrence
        where public_id = ${sqlLiteral(service.service_id)}::uuid)
      and field_name in ('source_name', 'source_description');`), '2');
  assert.match(runSql(container, `select app.sync_content_source(
    'ride_comment', gen_random_uuid(), 'public_note', 'en', 'private');`,
  { expectFailure: true }), /Translation source is not approved/);
  assert.equal(runSql(container, `select source_version from app.content_source
    where object_type = 'church' and object_id = (select id from app.church
      where public_id = ${sqlLiteral(created.church_id)}::uuid)
      and field_name = 'official_name';`), '2');
  assert.equal(runSql(container, `select count(*) from app.content_translation as translation
    join app.content_source as source on source.id = translation.content_source_id
    where source.object_type = 'church' and source.object_id = (select id from app.church
      where public_id = ${sqlLiteral(created.church_id)}::uuid)
      and source.field_name = 'official_name'
      and translation.source_version = 1 and translation.status = 'stale';`), '5');
  assert.match(runSql(container, `set role anon;
    select count(*) from app.content_translation;`, { expectFailure: true }),
  /permission denied/);
  const anonymousClient = userClient(url, publicKey);
  const translatedChurchFallback = await rpc(anonymousClient,
    'published_church_translated_content', {
      p_slug: firstArgs.p_slug, p_language: 'ru',
    });
  assert.equal(translatedChurchFallback.display_name, editArgs.p_official_name);
  assert.equal(translatedChurchFallback.description, editArgs.p_description_source);
  await rpcFailure(anonymousClient, 'published_church_translated_content', {
    p_slug: firstArgs.p_slug, p_language: 'fr',
  });
  runSql(container, `update app.content_translation as translation
    set translated_text = 'Synthetic translated church', status = 'ready',
      provider_name = 'synthetic', updated_at = clock_timestamp()
    from app.content_source as source
    where source.id = translation.content_source_id
      and source.object_type = 'church'
      and source.object_id = (select id from app.church
        where public_id = ${sqlLiteral(created.church_id)}::uuid)
      and source.field_name = 'official_name'
      and translation.source_version = source.source_version
      and translation.target_language = 'ru';
  update app.content_translation as translation
    set translated_text = 'Synthetic translated service', status = 'ready',
      provider_name = 'synthetic', updated_at = clock_timestamp()
    from app.content_source as source
    where source.id = translation.content_source_id
      and source.object_type = 'service_occurrence'
      and source.object_id = (select id from app.service_occurrence
        where public_id = ${sqlLiteral(service.service_id)}::uuid)
      and source.field_name = 'source_name'
      and translation.source_version = source.source_version
      and translation.target_language = 'ru';`);
  const translatedChurch = await rpc(anonymousClient, 'published_church_translated_content', {
    p_slug: firstArgs.p_slug, p_language: 'ru',
  });
  assert.equal(translatedChurch.official_name, editArgs.p_official_name);
  assert.equal(translatedChurch.display_name, 'Synthetic translated church');
  assert.equal(translatedChurch.name_automatically_translated, true);
  const translatedSchedule = await rpc(anonymousClient, 'published_church_schedule_translated', {
    p_church_id: created.church_id, p_language: 'ru',
  });
  assert.equal(translatedSchedule[0].source_name, 'Synthetic translated service');
  assert.equal(translatedSchedule[0].original_source_name, serviceArgs.p_source_name);
  assert.equal(translatedSchedule[0].name_automatically_translated, true);
  await rpcFailure(anonymousClient, 'managed_church_translation_source', {
    p_object_type: 'church', p_object_public_id: created.church_id,
    p_field_name: 'official_name',
  });
  await rpcFailure(clients[1], 'managed_church_translation_source', {
    p_object_type: 'church', p_object_public_id: created.church_id,
    p_field_name: 'official_name',
  });
  const managedTranslation = await rpc(clients[0], 'managed_church_translation_source', {
    p_object_type: 'church', p_object_public_id: created.church_id,
    p_field_name: 'official_name',
  });
  assert.equal(managedTranslation.source_version, 2);
  assert.equal(managedTranslation.original_text, editArgs.p_official_name);
  assert.equal(managedTranslation.translations.find((item) => item.target_language === 'ru')
    .content_version, 1);
  const correctionArgs = {
    p_object_type: 'church', p_object_public_id: created.church_id,
    p_field_name: 'official_name', p_target_language: 'ru',
    p_translated_text: 'Synthetic corrected church',
    p_expected_source_version: 2, p_expected_translation_version: 1,
    p_client_key: randomUUID(),
  };
  await rpcFailure(clients[0], 'correct_church_content_translation', {
    ...correctionArgs, p_translated_text: 'N'.repeat(201), p_client_key: randomUUID(),
  });
  await rpcFailure(clients[0], 'correct_church_content_translation', {
    ...correctionArgs, p_translated_text: 'Multiline\nchurch', p_client_key: randomUUID(),
  });
  await rpcFailure(clients[0], 'correct_church_content_translation', {
    ...correctionArgs, p_field_name: 'description_source',
    p_translated_text: 'D'.repeat(4001), p_client_key: randomUUID(),
  });
  await rpcFailure(clients[0], 'correct_church_content_translation', {
    ...correctionArgs, p_object_type: 'service_occurrence',
    p_object_public_id: service.service_id, p_field_name: 'source_name',
    p_translated_text: 'S'.repeat(161), p_client_key: randomUUID(),
  });
  await rpcFailure(clients[1], 'correct_church_content_translation', correctionArgs);
  const correction = await rpc(clients[0], 'correct_church_content_translation', correctionArgs);
  assert.equal(correction.translation_version, 2);
  assert.deepEqual(await rpc(clients[0], 'correct_church_content_translation', correctionArgs),
    correction);
  await rpcFailure(clients[0], 'correct_church_content_translation', {
    ...correctionArgs, p_client_key: randomUUID(),
  });
  await rpcFailure(clients[0], 'correct_church_content_translation', {
    ...correctionArgs, p_translated_text: 'Different text',
  });
  await rpcFailure(clients[0], 'correct_church_content_translation', {
    ...correctionArgs, p_target_language: 'en', p_client_key: randomUUID(),
  });
  assert.equal(runSql(container, `select count(*) from app.church_admin_event
    where church_id = (select id from app.church
      where public_id = ${sqlLiteral(created.church_id)}::uuid)
      and event_type = 'translation.corrected';`), '1');
  const correctedPublicChurch = await rpc(anonymousClient, 'published_church_translated_content', {
    p_slug: firstArgs.p_slug, p_language: 'ru',
  });
  assert.equal(correctedPublicChurch.display_name, 'Synthetic corrected church');
  assert.equal(correctedPublicChurch.name_automatically_translated, false);
  const serviceCorrection = await rpc(clients[0], 'correct_church_content_translation', {
    p_object_type: 'service_occurrence', p_object_public_id: service.service_id,
    p_field_name: 'source_name', p_target_language: 'ru',
    p_translated_text: 'Synthetic corrected service',
    p_expected_source_version: 1, p_expected_translation_version: 1,
    p_client_key: randomUUID(),
  });
  assert.equal(serviceCorrection.translation_version, 2);
  assert.equal((await rpc(anonymousClient, 'published_church_schedule_translated', {
    p_church_id: created.church_id, p_language: 'ru',
  }))[0].source_name, 'Synthetic corrected service');
  const churchDescriptionTranslationId = translationIdFor(
    container, 'church', created.church_id, 'description_source', 'ru',
  );
  const firstTranslationLease = randomUUID();
  const workerClaimArgs = {
    p_lease_token: firstTranslationLease, p_limit: 1,
    p_translation_id: churchDescriptionTranslationId,
  };
  await rpcFailure(anonymousClient, 'translation_worker_claim', workerClaimArgs);
  await rpcFailure(clients[0], 'translation_worker_claim', workerClaimArgs);
  assert.deepEqual(await rpc(admin, 'translation_worker_claim', {
    ...workerClaimArgs, p_translation_id: translationIdFor(
      container, 'church', created.church_id, 'official_name', 'ru',
    ),
  }), []);
  const claimedTranslation = await rpc(admin, 'translation_worker_claim', workerClaimArgs);
  assert.equal(claimedTranslation.length, 1);
  assert.equal(claimedTranslation[0].claimed_translation_id, churchDescriptionTranslationId);
  assert.equal(claimedTranslation[0].claimed_field_name, 'description_source');
  assert.equal(claimedTranslation[0].claimed_original_text, editArgs.p_description_source);
  assert.equal(claimedTranslation[0].claimed_attempt_count, 1);
  runSql(container, `insert into app.translation_glossary_version (
    source_language, target_language, checksum, provider_reference
  ) values ('en', 'ru', ${sqlLiteral('a'.repeat(64))}, ${sqlLiteral(translationGlossaryReference)});`);
  const glossaryVersion = Number(runSql(container, `select id from app.translation_glossary_version
    where provider_reference = ${sqlLiteral(translationGlossaryReference)};`));
  const prepareArgs = {
    p_translation_id: churchDescriptionTranslationId, p_lease_token: firstTranslationLease,
    p_monthly_character_limit: 1000000,
  };
  await rpcFailure(anonymousClient, 'translation_worker_prepare', prepareArgs);
  await rpcFailure(clients[0], 'translation_worker_prepare', prepareArgs);
  await rpcFailure(admin, 'translation_worker_prepare', {
    ...prepareArgs, p_monthly_character_limit: 0,
  });
  const usageBefore = Number(runSql(container, `select coalesce((select reserved_characters
    from ops.translation_monthly_usage
    where month_start = date_trunc('month', now() at time zone 'UTC')::date), 0);`));
  const prepared = await rpc(admin, 'translation_worker_prepare', prepareArgs);
  assert.ok(Date.parse(prepared.dispatch_deadline) > Date.now());
  assert.deepEqual(prepared, { status: 'reserved', dispatch_deadline: prepared.dispatch_deadline, glossary: {
    resource: translationGlossaryReference, version: glossaryVersion,
  } });
  assert.deepEqual(await rpc(admin, 'translation_worker_prepare', prepareArgs), prepared);
  const sourceCharacters = Array.from(editArgs.p_description_source).length;
  assert.equal(Number(runSql(container, `select reserved_characters from ops.translation_monthly_usage
    where month_start = date_trunc('month', now() at time zone 'UTC')::date;`)),
  usageBefore + sourceCharacters);
  assert.match(runSql(container, `set role service_role;
    select * from ops.translation_monthly_usage;`, { expectFailure: true }), /permission denied/);
  assert.deepEqual(await rpc(admin, 'translation_worker_claim', {
    ...workerClaimArgs, p_lease_token: randomUUID(),
  }), []);
  const invalidTranslation = await rpc(admin, 'translation_worker_complete', {
    p_translation_id: churchDescriptionTranslationId, p_lease_token: firstTranslationLease,
    p_outcome: 'success', p_translated_text: 'D'.repeat(4001),
    p_provider_name: 'synthetic',
  });
  assert.equal(invalidTranslation.status, 'retry');
  assert.equal(runSql(container, `select last_safe_error from app.content_translation
    where id = ${sqlLiteral(churchDescriptionTranslationId)}::uuid;`), 'invalid_output');
  runSql(container, `update app.content_translation set next_attempt_at = now() - interval '1 second'
    where id = ${sqlLiteral(churchDescriptionTranslationId)}::uuid;`);
  const secondTranslationLease = randomUUID();
  const retriedTranslation = await rpc(admin, 'translation_worker_claim', {
    ...workerClaimArgs, p_lease_token: secondTranslationLease,
  });
  assert.equal(retriedTranslation[0].claimed_attempt_count, 2);
  assert.equal((await rpc(admin, 'translation_worker_prepare', {
    ...prepareArgs, p_lease_token: secondTranslationLease,
  })).status, 'reserved');
  const completedTranslation = await rpc(admin, 'translation_worker_complete', {
    p_translation_id: churchDescriptionTranslationId, p_lease_token: secondTranslationLease,
    p_outcome: 'success', p_translated_text: 'Synthetic translated description',
    p_provider_name: 'synthetic', p_provider_model: 'test-v1',
  });
  assert.equal(completedTranslation.status, 'ready');
  assert.equal((await rpc(anonymousClient, 'published_church_translated_content', {
    p_slug: firstArgs.p_slug, p_language: 'ru',
  })).description, 'Synthetic translated description');
  const budgetJobs = ['it', 'uk'].map((language) => ({
    translationId: translationIdFor(container, 'church', created.church_id, 'description_source', language),
    leaseToken: randomUUID(),
  }));
  for (const job of budgetJobs) {
    assert.equal((await rpc(admin, 'translation_worker_claim', {
      p_translation_id: job.translationId, p_lease_token: job.leaseToken, p_limit: 1,
    })).length, 1);
  }
  const concurrentBudget = usageBefore + sourceCharacters * 3;
  const budgetResults = await Promise.all(budgetJobs.map((job) => rpc(admin, 'translation_worker_prepare', {
    p_translation_id: job.translationId, p_lease_token: job.leaseToken,
    p_monthly_character_limit: concurrentBudget,
  })));
  assert.deepEqual(budgetResults.map((item) => item.status).sort(), ['deferred', 'reserved']);
  assert.equal(Number(runSql(container, `select reserved_characters from ops.translation_monthly_usage
    where month_start = date_trunc('month', now() at time zone 'UTC')::date;`)), concurrentBudget);
  const deferredJob = budgetJobs[budgetResults.findIndex((item) => item.status === 'deferred')];
  assert.equal(runSql(container, `select (status = 'pending' and attempt_count = 0
    and lease_token is null and lease_deadline is null)::text from app.content_translation
    where id = ${sqlLiteral(deferredJob.translationId)}::uuid;`), 'true');
  const reservedJob = budgetJobs[budgetResults.findIndex((item) => item.status === 'reserved')];
  await rpc(admin, 'translation_worker_complete', {
    p_translation_id: reservedJob.translationId, p_lease_token: reservedJob.leaseToken,
    p_outcome: 'permanent_failure',
  });
  const serviceDescriptionTranslationId = translationIdFor(
    container, 'service_occurrence', service.service_id, 'source_description', 'ru',
  );
  const serviceTranslationLease = randomUUID();
  assert.equal((await rpc(admin, 'translation_worker_claim', {
    p_lease_token: serviceTranslationLease, p_limit: 1,
    p_translation_id: serviceDescriptionTranslationId,
  })).length, 1);
  const serviceDescriptionCorrection = await rpc(clients[0],
    'correct_church_content_translation', {
      p_object_type: 'service_occurrence', p_object_public_id: service.service_id,
      p_field_name: 'source_description', p_target_language: 'ru',
      p_translated_text: 'Synthetic manually corrected description',
      p_expected_source_version: 1, p_expected_translation_version: 1,
      p_client_key: randomUUID(),
    });
  assert.equal(serviceDescriptionCorrection.translation_version, 2);
  assert.equal((await rpc(admin, 'translation_worker_complete', {
    p_translation_id: serviceDescriptionTranslationId, p_lease_token: serviceTranslationLease,
    p_outcome: 'success', p_translated_text: 'Late machine description',
    p_provider_name: 'synthetic',
  })).status, 'superseded');
  assert.equal((await rpc(anonymousClient, 'published_church_schedule_translated', {
    p_church_id: created.church_id, p_language: 'ru',
  }))[0].description, 'Synthetic manually corrected description');
  assert.deepEqual(await rpc(anonymousClient, 'published_church_schedule_translated', {
    p_church_id: randomUUID(), p_language: 'ru',
  }), []);
  const churchWithSchedule = await rpc(userClient(url, publicKey), 'transport_church_by_slug', {
    p_slug: firstArgs.p_slug,
  });
  assert.ok(Number.isFinite(Date.parse(churchWithSchedule.schedule_updated_at)));
  assert.deepEqual(await rpc(userClient(url, publicKey), 'published_church_schedule', {
    p_church_id: created.church_id, p_limit: 0,
  }), []);
  const hiddenTranslationId = translationIdFor(
    container, 'church', created.church_id, 'description_source', 'de',
  );
  const hiddenLease = randomUUID();
  assert.equal((await rpc(admin, 'translation_worker_claim', {
    p_lease_token: hiddenLease, p_limit: 1, p_translation_id: hiddenTranslationId,
  })).length, 1);
  const hiddenExpiredId = translationIdFor(
    container, 'church', created.church_id, 'description_source', 'ro',
  );
  assert.equal((await rpc(admin, 'translation_worker_claim', {
    p_lease_token: randomUUID(), p_limit: 1, p_translation_id: hiddenExpiredId,
  })).length, 1);
  runSql(container, `update app.church set status = 'hidden'
    where public_id = ${sqlLiteral(created.church_id)}::uuid;
    update app.content_translation set lease_deadline = now() - interval '1 second'
    where id = ${sqlLiteral(hiddenExpiredId)}::uuid;`);
  assert.equal((await rpc(admin, 'translation_worker_prepare', {
    p_translation_id: hiddenTranslationId, p_lease_token: hiddenLease,
    p_monthly_character_limit: 100000000,
  })).status, 'superseded');
  assert.equal(runSql(container, `select (status = 'pending' and attempt_count = 0
    and lease_token is null and lease_deadline is null)::text from app.content_translation
    where id = ${sqlLiteral(hiddenTranslationId)}::uuid;`), 'true');
  assert.deepEqual(await rpc(admin, 'translation_worker_claim', {
    p_lease_token: randomUUID(), p_limit: 1, p_translation_id: hiddenExpiredId,
  }), []);
  assert.equal(runSql(container, `select (status = 'pending' and attempt_count = 1
    and lease_token is null and lease_deadline is null and last_safe_error = 'lease_expired')::text
    from app.content_translation where id = ${sqlLiteral(hiddenExpiredId)}::uuid;`), 'true');
  assert.deepEqual(await rpc(admin, 'translation_worker_claim', {
    p_lease_token: randomUUID(), p_limit: 1, p_translation_id: hiddenTranslationId,
  }), []);
  assert.deepEqual(await rpc(userClient(url, publicKey), 'published_church_schedule', {
    p_church_id: created.church_id,
  }), []);
  runSql(container, `update app.church set status = 'published'
    where public_id = ${sqlLiteral(created.church_id)}::uuid;
    update app.content_translation set next_attempt_at = now() - interval '1 second'
    where id = ${sqlLiteral(hiddenTranslationId)}::uuid;`);
  const expiredLease = randomUUID();
  assert.equal((await rpc(admin, 'translation_worker_claim', {
    p_lease_token: expiredLease, p_limit: 1, p_translation_id: hiddenTranslationId,
  })).length, 1);
  runSql(container, `update app.content_translation
    set lease_deadline = now() - interval '1 second'
    where id = ${sqlLiteral(hiddenTranslationId)}::uuid;`);
  const reclaimedLease = randomUUID();
  assert.equal((await rpc(admin, 'translation_worker_claim', {
    p_lease_token: reclaimedLease, p_limit: 1, p_translation_id: hiddenTranslationId,
  }))[0].claimed_attempt_count, 2);
  assert.equal((await rpc(admin, 'translation_worker_complete', {
    p_translation_id: hiddenTranslationId, p_lease_token: expiredLease,
    p_outcome: 'success', p_translated_text: 'Late translation',
    p_provider_name: 'synthetic',
  })).status, 'superseded');
  assert.equal((await rpc(admin, 'translation_worker_complete', {
    p_translation_id: hiddenTranslationId, p_lease_token: reclaimedLease,
    p_outcome: 'permanent_failure',
  })).status, 'error');
  assert.deepEqual(await rpc(admin, 'translation_worker_claim', {
    p_lease_token: randomUUID(), p_limit: 1, p_translation_id: hiddenTranslationId,
  }), []);
  const pastServicePublicId = randomUUID();
  runSql(container, `insert into app.service_occurrence (
    public_id, church_id, source_name, starts_at, timezone
  ) values (
    ${sqlLiteral(pastServicePublicId)}::uuid,
    (select id from app.church where public_id = ${sqlLiteral(created.church_id)}::uuid),
    'Synthetic past service', now() - interval '1 day', 'Europe/Rome'
  );`);
  const pastTranslationId = translationIdFor(
    container, 'service_occurrence', pastServicePublicId, 'source_name', 'ru',
  );
  assert.deepEqual(await rpc(admin, 'translation_worker_claim', {
    p_lease_token: randomUUID(), p_limit: 1, p_translation_id: pastTranslationId,
  }), []);
  assert.equal(runSql(container, `select count(*) from app.church_admin_event
    where church_id = (select id from app.church where public_id = ${sqlLiteral(created.church_id)}::uuid)
      and event_type = 'service.created';`), '1');

  const serviceInternalId = runSql(container,
    `select id from app.service_occurrence where public_id = ${sqlLiteral(service.service_id)}::uuid;`);
  const serviceStart = sqlLiteral(serviceArgs.p_starts_at);
  runSql(container, `
    insert into private.user_place (owner_account_id, exact_address, public_area_name)
    values
      (${sqlLiteral(identities[1].id)}::uuid, 'Synthetic meeting', 'Synthetic area'),
      (${sqlLiteral(identities[2].id)}::uuid, 'Synthetic departure', 'Synthetic area'),
      (${sqlLiteral(identities[3].id)}::uuid, 'Synthetic custom departure', 'Synthetic area');
    insert into app.passenger_request (
      author_account_id, church_id, service_occurrence_id, desired_arrival_at,
      timezone, service_name_snapshot, total_passengers, child_seat_required,
      return_required, remaining_passengers, terms_version
    ) values (
      ${sqlLiteral(identities[1].id)}::uuid,
      (select id from app.church where public_id = ${sqlLiteral(created.church_id)}::uuid),
      ${sqlLiteral(serviceInternalId)}::uuid, ${serviceStart}::timestamptz,
      'Europe/Rome', 'Synthetic Vespers', 1, false, false, 1,
      ${sqlLiteral(`church-test-${suffix}`)}
    );
    insert into app.driver_offer_occurrence (
      publication_key, author_account_id, church_id, service_occurrence_id,
      departure_at, arrival_at, timezone, service_name_snapshot,
      origin_place_id, total_seats, max_detour_km, children_allowed,
      driver_child_seat_available, return_available
    ) values (
      ${sqlLiteral(randomUUID())}::uuid, ${sqlLiteral(identities[2].id)}::uuid,
      (select id from app.church where public_id = ${sqlLiteral(created.church_id)}::uuid),
      ${sqlLiteral(serviceInternalId)}::uuid,
      ${serviceStart}::timestamptz - interval '2 hours', ${serviceStart}::timestamptz,
      'Europe/Rome', 'Synthetic Vespers',
      (select id from private.user_place where owner_account_id = ${sqlLiteral(identities[2].id)}::uuid
        and exact_address = 'Synthetic departure' limit 1),
      2, 5, true, false, false
    );
    insert into app.driver_offer_occurrence (
      publication_key, author_account_id, church_id, departure_at, arrival_at,
      timezone, origin_place_id, total_seats, max_detour_km, children_allowed,
      driver_child_seat_available, return_available
    ) values (
      ${sqlLiteral(randomUUID())}::uuid, ${sqlLiteral(identities[3].id)}::uuid,
      (select id from app.church where public_id = ${sqlLiteral(created.church_id)}::uuid),
      ${serviceStart}::timestamptz - interval '2 hours', ${serviceStart}::timestamptz,
      'Europe/Rome',
      (select id from private.user_place where owner_account_id = ${sqlLiteral(identities[3].id)}::uuid
        and exact_address = 'Synthetic custom departure' limit 1),
      2, 5, true, false, false
    );
    insert into app.ride_condition_snapshot (
      passenger_request_id, driver_occurrence_id, church_id, passenger_count,
      scheduled_arrival_at, timezone, children_count, child_seat_required,
      children_allowed, driver_child_seat_available, passenger_return_required,
      driver_return_available, max_detour_km, request_content_version,
      occurrence_conditions_version
    ) values (
      (select id from app.passenger_request where service_occurrence_id = ${sqlLiteral(serviceInternalId)}::uuid),
      (select id from app.driver_offer_occurrence where author_account_id = ${sqlLiteral(identities[3].id)}::uuid
        and service_occurrence_id is null limit 1),
      (select id from app.church where public_id = ${sqlLiteral(created.church_id)}::uuid),
      1, ${serviceStart}::timestamptz, 'Europe/Rome', 0, false,
      true, false, false, false, 5, 1, 1
    );
    insert into app.ride_response (
      direction, passenger_account_id, driver_account_id, passenger_request_id,
      driver_occurrence_id, offered_passenger_count, conditions_snapshot_id,
      status, expires_at
    ) values (
      'passenger_to_driver', ${sqlLiteral(identities[1].id)}::uuid,
      ${sqlLiteral(identities[3].id)}::uuid,
      (select id from app.passenger_request where service_occurrence_id = ${sqlLiteral(serviceInternalId)}::uuid),
      (select id from app.driver_offer_occurrence where author_account_id = ${sqlLiteral(identities[3].id)}::uuid
        and service_occurrence_id is null limit 1),
      1,
      (select id from app.ride_condition_snapshot where passenger_request_id in
        (select id from app.passenger_request where service_occurrence_id = ${sqlLiteral(serviceInternalId)}::uuid)
        and driver_occurrence_id in (select id from app.driver_offer_occurrence
          where author_account_id = ${sqlLiteral(identities[3].id)}::uuid
            and service_occurrence_id is null) limit 1),
      'await_driver', now() + interval '1 day'
    );
  `);
  assert.equal(runSql(container, `select count(*) from app.quality_match_candidate
    where request_id in (select id from app.passenger_request
      where service_occurrence_id = ${sqlLiteral(serviceInternalId)}::uuid);`), '2');
  await rpcFailure(clients[1], 'preview_one_off_service_edit', {
    p_service_id: service.service_id,
  });
  const editPreview = await rpc(clients[0], 'preview_one_off_service_edit', {
    p_service_id: service.service_id,
  });
  assert.equal(editPreview.source_name, serviceArgs.p_source_name);
  assert.equal(editPreview.version, 1);
  assert.equal(editPreview.passenger_requests, 1);
  assert.equal(editPreview.driver_offers, 1);
  assert.equal(editPreview.pending_responses, 1);
  const serviceEditArgs = {
    p_service_id: service.service_id,
    p_source_name: 'Synthetic Vespers Updated',
    p_source_description: 'Updated description of a synthetic one-off service.',
    p_expected_version: 1, p_client_key: randomUUID(),
  };
  await rpcFailure(clients[1], 'update_one_off_service_content', serviceEditArgs);
  const editedService = await rpc(clients[0], 'update_one_off_service_content', serviceEditArgs);
  assert.equal(editedService.status, 'saved');
  assert.equal(editedService.version, 2);
  assert.deepEqual(await rpc(clients[0], 'update_one_off_service_content', serviceEditArgs), editedService);
  await rpcFailure(clients[0], 'update_one_off_service_content', {
    ...serviceEditArgs, p_source_name: 'Reused key with changed service content',
  });
  await rpcConflict(clients[0], 'update_one_off_service_content', {
    ...serviceEditArgs, p_client_key: randomUUID(),
  });
  assert.equal((await rpc(userClient(url, publicKey), 'published_church_schedule', {
    p_church_id: created.church_id,
  }))[0].source_name, serviceEditArgs.p_source_name);
  assert.equal(runSql(container, `select source_version from app.content_source
    where object_type = 'service_occurrence'
      and object_id = ${sqlLiteral(serviceInternalId)}::uuid
      and field_name = 'source_name';`), '2');
  assert.equal(runSql(container, `select count(*) from app.content_translation as translation
    join app.content_source as source on source.id = translation.content_source_id
    where source.object_type = 'service_occurrence'
      and source.object_id = ${sqlLiteral(serviceInternalId)}::uuid
      and source.field_name = 'source_name'
      and translation.source_version = 1 and translation.status = 'stale';`), '5');
  assert.equal((await rpc(anonymousClient, 'published_church_schedule_translated', {
    p_church_id: created.church_id, p_language: 'ru',
  }))[0].source_name, serviceEditArgs.p_source_name);
  assert.equal(runSql(container, `select count(*) from app.passenger_request
    where service_occurrence_id = ${sqlLiteral(serviceInternalId)}::uuid
      and service_name_snapshot = ${sqlLiteral(serviceArgs.p_source_name)};`), '1');
  assert.equal(runSql(container, `select count(*) from app.notification
    where event_type = 'church.service.updated'
      and object_public_id = ${sqlLiteral(service.service_id)}::uuid
      and safe_route = '/trips';`), '3');
  assert.equal(runSql(container, `select routine.provolatile from pg_proc as routine
    join pg_namespace as namespace on namespace.oid = routine.pronamespace
    where namespace.nspname = 'app' and routine.proname = 'assert_transport_reference';`), 'v');
  const rescheduledAt = new Date(Date.parse(serviceArgs.p_starts_at) + 24 * 60 * 60 * 1000).toISOString();
  const rescheduleArgs = {
    p_service_id: service.service_id, p_starts_at: rescheduledAt,
    p_expected_version: 2, p_client_key: randomUUID(),
  };
  await rpcFailure(clients[1], 'update_one_off_service_time', rescheduleArgs);
  const rescheduled = await rpc(clients[0], 'update_one_off_service_time', rescheduleArgs);
  assert.equal(rescheduled.status, 'saved');
  assert.equal(rescheduled.version, 3);
  assert.equal(rescheduled.schedule_generation, 2);
  assert.equal(Date.parse(rescheduled.starts_at), Date.parse(rescheduledAt));
  assert.deepEqual(await rpc(clients[0], 'update_one_off_service_time', rescheduleArgs), rescheduled);
  await rpcFailure(clients[0], 'update_one_off_service_time', {
    ...rescheduleArgs, p_starts_at: serviceArgs.p_starts_at,
  });
  await rpcFailure(clients[0], 'update_one_off_service_time', {
    ...rescheduleArgs, p_client_key: randomUUID(),
  });
  assert.equal((await rpc(clients[0], 'update_one_off_service_time', {
    ...rescheduleArgs, p_expected_version: 3, p_client_key: randomUUID(),
  })).version, 3);
  const rescheduledPublicSchedule = await rpc(userClient(url, publicKey), 'published_church_schedule', {
    p_church_id: created.church_id,
  });
  assert.equal(Date.parse(rescheduledPublicSchedule[0].starts_at), Date.parse(rescheduledAt));
  assert.equal(rescheduledPublicSchedule[0].time_changed, true);
  assert.equal(runSql(container, `select count(*) from app.passenger_request
    where service_occurrence_id = ${sqlLiteral(serviceInternalId)}::uuid
      and desired_arrival_at = ${serviceStart}::timestamptz
      and service_generation_snapshot = 1;`), '1');
  runSql(container, `update app.passenger_request
    set service_occurrence_id = service_occurrence_id, service_generation_snapshot = 2
    where service_occurrence_id = ${sqlLiteral(serviceInternalId)}::uuid;
    update app.driver_offer_occurrence
    set service_occurrence_id = service_occurrence_id, service_generation_snapshot = 2
    where service_occurrence_id = ${sqlLiteral(serviceInternalId)}::uuid;`);
  assert.equal(runSql(container, `select count(*) from app.passenger_request
    where service_occurrence_id = ${sqlLiteral(serviceInternalId)}::uuid
      and service_generation_snapshot = 1;`), '1');
  assert.equal(runSql(container, `select count(*) from app.driver_offer_occurrence
    where service_occurrence_id = ${sqlLiteral(serviceInternalId)}::uuid
      and service_generation_snapshot = 1;`), '1');
  assert.equal(runSql(container, `select count(*) from app.notification
    where event_type = 'church.service.rescheduled'
      and object_public_id = ${sqlLiteral(service.service_id)}::uuid
      and safe_route = '/trips';`), '3');
  const newGenerationOfferKey = randomUUID();
  runSql(container, `insert into app.driver_offer_occurrence (
    publication_key, author_account_id, church_id, service_occurrence_id,
    departure_at, arrival_at, timezone, service_name_snapshot,
    origin_place_id, total_seats, max_detour_km, children_allowed,
    driver_child_seat_available, return_available
  ) values (
    ${sqlLiteral(newGenerationOfferKey)}::uuid, ${sqlLiteral(identities[3].id)}::uuid,
    (select id from app.church where public_id = ${sqlLiteral(created.church_id)}::uuid),
    ${sqlLiteral(serviceInternalId)}::uuid,
    ${sqlLiteral(rescheduledAt)}::timestamptz - interval '2 hours',
    ${sqlLiteral(rescheduledAt)}::timestamptz, 'Europe/Rome',
    ${sqlLiteral(serviceEditArgs.p_source_name)},
    (select id from private.user_place where owner_account_id = ${sqlLiteral(identities[3].id)}::uuid
      and exact_address = 'Synthetic custom departure' limit 1),
    2, 5, true, false, false
  );`);
  const newGenerationOfferId = runSql(container, `select id from app.driver_offer_occurrence
    where publication_key = ${sqlLiteral(newGenerationOfferKey)}::uuid;`);
  assert.equal(runSql(container, `select service_generation_snapshot from app.driver_offer_occurrence
    where id = ${sqlLiteral(newGenerationOfferId)}::uuid;`), '2');
  assert.equal(runSql(container, `select count(*) from app.quality_match_candidate
    where request_id in (select id from app.passenger_request
      where service_occurrence_id = ${sqlLiteral(serviceInternalId)}::uuid);`), '2');
  runSql(container, `delete from app.driver_offer_occurrence
    where id = ${sqlLiteral(newGenerationOfferId)}::uuid;`);
  runSql(container, `update app.driver_offer_occurrence
    set service_occurrence_id = ${sqlLiteral(serviceInternalId)}::uuid
    where author_account_id = ${sqlLiteral(identities[3].id)}::uuid
      and service_occurrence_id is null;`);
  const mixedGenerationResponse = runSql(container, `update app.ride_response set status = status
    where passenger_request_id in (select id from app.passenger_request
      where service_occurrence_id = ${sqlLiteral(serviceInternalId)}::uuid)
      and driver_account_id = ${sqlLiteral(identities[3].id)}::uuid;`, { expectFailure: true });
  assert.match(mixedGenerationResponse, /The linked service changed/);
  runSql(container, `update app.driver_offer_occurrence set service_occurrence_id = null
    where author_account_id = ${sqlLiteral(identities[3].id)}::uuid
      and service_occurrence_id = ${sqlLiteral(serviceInternalId)}::uuid;`);
  await rpcFailure(clients[1], 'preview_one_off_service_cancellation', {
    p_service_id: service.service_id,
  });
  const cancellationPreview = await rpc(clients[0], 'preview_one_off_service_cancellation', {
    p_service_id: service.service_id,
  });
  assert.equal(cancellationPreview.version, 3);
  assert.equal(cancellationPreview.passenger_requests, 1);
  assert.equal(cancellationPreview.driver_offers, 1);
  assert.equal(cancellationPreview.pending_responses, 1);
  assert.equal(cancellationPreview.agreements, 0);
  const cancellationArgs = {
    p_service_id: service.service_id, p_expected_version: 3, p_client_key: randomUUID(),
  };
  await rpcFailure(clients[1], 'cancel_one_off_service', cancellationArgs);
  const cancelledService = await rpc(clients[0], 'cancel_one_off_service', cancellationArgs);
  assert.equal(cancelledService.status, 'cancelled');
  assert.equal(cancelledService.version, 4);
  assert.deepEqual(await rpc(clients[0], 'cancel_one_off_service', cancellationArgs), cancelledService);
  await rpcFailure(clients[0], 'cancel_one_off_service', {
    ...cancellationArgs, p_client_key: randomUUID(),
  });
  await rpcFailure(clients[0], 'update_one_off_service_content', {
    ...serviceEditArgs, p_expected_version: 4, p_client_key: randomUUID(),
  });
  assert.equal(runSql(container, `select count(*) from app.quality_match_candidate
    where request_id in (select id from app.passenger_request
      where service_occurrence_id = ${sqlLiteral(serviceInternalId)}::uuid);`), '0');
  assert.equal(runSql(container, `select count(*) from app.passenger_request
    where service_occurrence_id = ${sqlLiteral(serviceInternalId)}::uuid and status = 'active';`), '1');
  assert.equal(runSql(container, `select count(*) from app.driver_offer_occurrence
    where service_occurrence_id = ${sqlLiteral(serviceInternalId)}::uuid and status = 'active';`), '1');
  assert.equal(runSql(container, `select count(*) from app.notification
    where event_type = 'church.service.cancelled'
      and object_public_id = ${sqlLiteral(service.service_id)}::uuid;`), '3');
  const rejectedResponse = runSql(container, `
    update app.ride_response set status = status
    where passenger_request_id in (select id from app.passenger_request
      where service_occurrence_id = ${sqlLiteral(serviceInternalId)}::uuid)
      and driver_account_id = ${sqlLiteral(identities[3].id)}::uuid;
  `, { expectFailure: true });
  assert.match(rejectedResponse, /The linked service was cancelled/);
  const rejectedAgreement = runSql(container, `
    insert into app.ride_agreement (
      response_id, driver_occurrence_id, passenger_request_id,
      driver_account_id, passenger_account_id, confirmed_passenger_count,
      active_snapshot_id, selected_exact_place_id, contact_visible_until,
      exact_data_delete_due_at
    ) select response.id, response.driver_occurrence_id, response.passenger_request_id,
      response.driver_account_id, response.passenger_account_id, 1,
      response.conditions_snapshot_id,
      (select id from private.user_place where owner_account_id = ${sqlLiteral(identities[1].id)}::uuid
        and exact_address = 'Synthetic meeting' limit 1),
      ${serviceStart}::timestamptz + interval '1 day',
      ${serviceStart}::timestamptz + interval '2 days'
    from app.ride_response as response
    where response.passenger_request_id in (select id from app.passenger_request
      where service_occurrence_id = ${sqlLiteral(serviceInternalId)}::uuid)
      and response.driver_account_id = ${sqlLiteral(identities[3].id)}::uuid;
  `, { expectFailure: true });
  assert.match(rejectedAgreement, /The linked service was cancelled/);
  assert.equal((await rpc(userClient(url, publicKey), 'published_church_schedule', {
    p_church_id: created.church_id,
  }))[0].status, 'cancelled');

  const recurringStart = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const recurringEnd = new Date(recurringStart.getTime() + 14 * 24 * 60 * 60 * 1000);
  const recurringArgs = {
    p_church_id: created.church_id, p_source_name: 'Synthetic Weekly Matins',
    p_source_description: 'Synthetic recurring service.',
    p_weekdays: [recurringStart.getUTCDay()], p_local_start_time: '09:30:00',
    p_starts_on: recurringStart.toISOString().slice(0, 10),
    p_ends_on: recurringEnd.toISOString().slice(0, 10), p_client_key: randomUUID(),
  };
  await rpcFailure(clients[1], 'create_recurring_service', recurringArgs);
  await rpcFailure(clients[0], 'create_recurring_service', {
    ...recurringArgs, p_weekdays: [recurringStart.getUTCDay(), recurringStart.getUTCDay()],
  });
  await rpcFailure(clients[0], 'create_recurring_service', {
    ...recurringArgs, p_weekdays: [(recurringStart.getUTCDay() + 1) % 7],
    p_ends_on: recurringArgs.p_starts_on, p_client_key: randomUUID(),
  });
  const recurring = await rpc(clients[0], 'create_recurring_service', recurringArgs);
  assert.equal(recurring.status, 'created');
  assert.equal(recurring.materialized_count, 3);
  assert.equal(runSql(container, `select (materialized_through = ends_on)::text
    from app.service_series where public_id = ${sqlLiteral(recurring.series_id)}::uuid;`), 'true');
  assert.deepEqual(await rpc(clients[0], 'create_recurring_service', recurringArgs), recurring);
  await rpcFailure(clients[0], 'create_recurring_service', {
    ...recurringArgs, p_source_name: 'Changed key content',
  });
  assert.equal(runSql(container, `select count(*) from app.service_occurrence as service
    join app.service_series as series on series.id = service.source_series_id
    where series.public_id = ${sqlLiteral(recurring.series_id)}::uuid
      and service.source_kind = 'recurring'
      and service.local_start_time = '09:30:00'::time
      and service.starts_at = (service.local_date + service.local_start_time)
        at time zone 'Europe/Rome';`), '3');
  await rpcFailure(clients[0], 'service_schedule_worker_materialize');
  assert.equal(await rpc(admin, 'service_schedule_worker_materialize'), 0);
  const recurringPublic = await rpc(userClient(url, publicKey), 'published_church_schedule', {
    p_church_id: created.church_id,
  });
  assert.equal(recurringPublic.filter((item) => item.source_name === recurringArgs.p_source_name).length, 3);
  const openSeries = await rpc(clients[0], 'create_recurring_service', {
    ...recurringArgs, p_source_name: 'Synthetic Open Weekly Service',
    p_ends_on: null, p_client_key: randomUUID(),
  });
  assert.ok(openSeries.materialized_count >= 12);
  const scheduleUpdatedBeforeAdvance = runSql(container, `select schedule_updated_at::text
    from app.church where public_id = ${sqlLiteral(created.church_id)}::uuid;`);
  assert.equal(runSql(container, `select app.materialize_service_series(id, now() + interval '7 days')
    from app.service_series where public_id = ${sqlLiteral(openSeries.series_id)}::uuid;`), '1');
  assert.equal(runSql(container, `select (schedule_updated_at >
    ${sqlLiteral(scheduleUpdatedBeforeAdvance)}::timestamptz)::text
    from app.church where public_id = ${sqlLiteral(created.church_id)}::uuid;`), 'true');
  assert.equal(await rpc(admin, 'service_schedule_worker_materialize'), 0);

  const collisionDate = new Date(recurringStart.getTime() + 91 * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const collisionAt = runSql(container, `select ((${sqlLiteral(collisionDate)}::date
    + '09:30:00'::time) at time zone 'Europe/Rome')::text;`);
  await rpc(clients[0], 'create_one_off_service', {
    p_church_id: created.church_id, p_source_name: 'Synthetic Collision Service',
    p_source_description: null, p_starts_at: collisionAt, p_client_key: randomUUID(),
  });
  const collisionSeries = await rpc(clients[0], 'create_recurring_service', {
    ...recurringArgs, p_source_name: 'Synthetic Collision Service',
    p_ends_on: null, p_client_key: randomUUID(),
  });
  assert.ok(collisionSeries.materialized_count >= 12);
  assert.equal(runSql(container, `select app.materialize_service_series(id, now() + interval '7 days')
    from app.service_series where public_id = ${sqlLiteral(collisionSeries.series_id)}::uuid;`), '0');
  assert.equal(runSql(container, `select count(*) from ops.operational_alert as alert
    join app.service_occurrence as service on service.public_id = alert.safe_reference
    where alert.alert_type = 'church.schedule_conflict'
      and service.source_name = 'Synthetic Collision Service';`), '1');

  const recurringDate = recurringPublic.find((item) => item.source_name === recurringArgs.p_source_name);
  const recurringDateInternalId = runSql(container, `select id from app.service_occurrence
    where public_id = ${sqlLiteral(recurringDate.service_id)}::uuid;`);
  const recurringDateTime = sqlLiteral(recurringDate.starts_at);
  runSql(container, `insert into app.passenger_request (
    author_account_id, church_id, service_occurrence_id, desired_arrival_at,
    timezone, service_name_snapshot, total_passengers, child_seat_required,
    return_required, remaining_passengers, terms_version
  ) values (
    ${sqlLiteral(identities[1].id)}::uuid,
    (select id from app.church where public_id = ${sqlLiteral(created.church_id)}::uuid),
    ${sqlLiteral(recurringDateInternalId)}::uuid, ${recurringDateTime}::timestamptz,
    'Europe/Rome', ${sqlLiteral(recurringArgs.p_source_name)}, 1, false, false, 1,
    ${sqlLiteral(`church-test-${suffix}`)}
  );
  insert into app.driver_offer_occurrence (
    publication_key, author_account_id, church_id, service_occurrence_id,
    departure_at, arrival_at, timezone, service_name_snapshot,
    origin_place_id, total_seats, max_detour_km, children_allowed,
    driver_child_seat_available, return_available
  ) values (
    ${sqlLiteral(randomUUID())}::uuid, ${sqlLiteral(identities[2].id)}::uuid,
    (select id from app.church where public_id = ${sqlLiteral(created.church_id)}::uuid),
    ${sqlLiteral(recurringDateInternalId)}::uuid,
    ${recurringDateTime}::timestamptz - interval '2 hours',
    ${recurringDateTime}::timestamptz, 'Europe/Rome',
    ${sqlLiteral(recurringArgs.p_source_name)},
    (select id from private.user_place where owner_account_id = ${sqlLiteral(identities[2].id)}::uuid
      and exact_address = 'Synthetic departure' limit 1),
    2, 5, true, false, false
  );`);
  assert.equal(runSql(container, `select count(*) from app.quality_match_candidate
    where request_id in (select id from app.passenger_request
      where service_occurrence_id = ${sqlLiteral(recurringDateInternalId)}::uuid);`), '1');
  await rpcFailure(clients[1], 'preview_recurring_service_date_cancellation', {
    p_service_id: recurringDate.service_id,
  });
  const datePreview = await rpc(clients[0], 'preview_recurring_service_date_cancellation', {
    p_service_id: recurringDate.service_id,
  });
  assert.equal(datePreview.version, 1);
  assert.equal(datePreview.passenger_requests, 1);
  assert.equal(datePreview.driver_offers, 1);
  const dateCancelArgs = {
    p_service_id: recurringDate.service_id, p_expected_version: 1, p_client_key: randomUUID(),
  };
  await rpcFailure(clients[1], 'cancel_recurring_service_date', dateCancelArgs);
  const cancelledDate = await rpc(clients[0], 'cancel_recurring_service_date', dateCancelArgs);
  assert.equal(cancelledDate.status, 'cancelled');
  assert.equal(cancelledDate.version, 2);
  assert.deepEqual(await rpc(clients[0], 'cancel_recurring_service_date', dateCancelArgs), cancelledDate);
  await rpcFailure(clients[0], 'cancel_recurring_service_date', {
    ...dateCancelArgs, p_client_key: randomUUID(),
  });
  assert.equal(runSql(container, `select count(*) from app.service_exception
    where service_occurrence_id = ${sqlLiteral(recurringDateInternalId)}::uuid
      and action = 'cancelled';`), '1');
  assert.equal(runSql(container, `select count(*) from app.service_occurrence
    where source_series_id = (select id from app.service_series
      where public_id = ${sqlLiteral(recurring.series_id)}::uuid)
      and status = 'scheduled';`), '2');
  assert.equal(runSql(container, `select count(*) from app.passenger_request
    where service_occurrence_id = ${sqlLiteral(recurringDateInternalId)}::uuid
      and desired_arrival_at = ${recurringDateTime}::timestamptz;`), '1');
  assert.equal(runSql(container, `select count(*) from app.notification
    where event_type = 'church.service.cancelled'
      and object_public_id = ${sqlLiteral(recurringDate.service_id)}::uuid
      and safe_route = '/trips';`), '2');
  assert.equal(runSql(container, `select count(*) from app.quality_match_candidate
    where request_id in (select id from app.passenger_request
      where service_occurrence_id = ${sqlLiteral(recurringDateInternalId)}::uuid);`), '0');
  assert.equal((await rpc(userClient(url, publicKey), 'published_church_schedule', {
    p_church_id: created.church_id,
  })).find((item) => item.service_id === recurringDate.service_id).status, 'cancelled');

  const movingDate = recurringPublic.filter((item) => item.source_name === recurringArgs.p_source_name)[1];
  const movingDateInternalId = runSql(container, `select id from app.service_occurrence
    where public_id = ${sqlLiteral(movingDate.service_id)}::uuid;`);
  const movingOldTime = sqlLiteral(movingDate.starts_at);
  runSql(container, `insert into app.passenger_request (
    author_account_id, church_id, service_occurrence_id, desired_arrival_at,
    timezone, service_name_snapshot, total_passengers, child_seat_required,
    return_required, remaining_passengers, terms_version
  ) values (
    ${sqlLiteral(identities[1].id)}::uuid,
    (select id from app.church where public_id = ${sqlLiteral(created.church_id)}::uuid),
    ${sqlLiteral(movingDateInternalId)}::uuid, ${movingOldTime}::timestamptz,
    'Europe/Rome', ${sqlLiteral(recurringArgs.p_source_name)}, 1, false, false, 1,
    ${sqlLiteral(`church-test-${suffix}`)}
  );
  insert into app.driver_offer_occurrence (
    publication_key, author_account_id, church_id, service_occurrence_id,
    departure_at, arrival_at, timezone, service_name_snapshot,
    origin_place_id, total_seats, max_detour_km, children_allowed,
    driver_child_seat_available, return_available
  ) values (
    ${sqlLiteral(randomUUID())}::uuid, ${sqlLiteral(identities[2].id)}::uuid,
    (select id from app.church where public_id = ${sqlLiteral(created.church_id)}::uuid),
    ${sqlLiteral(movingDateInternalId)}::uuid,
    ${movingOldTime}::timestamptz - interval '2 hours',
    ${movingOldTime}::timestamptz, 'Europe/Rome',
    ${sqlLiteral(recurringArgs.p_source_name)},
    (select id from private.user_place where owner_account_id = ${sqlLiteral(identities[2].id)}::uuid
      and exact_address = 'Synthetic departure' limit 1),
    2, 5, true, false, false
  );`);
  await rpcFailure(clients[1], 'preview_recurring_service_date_edit', {
    p_service_id: movingDate.service_id,
  });
  const movingPreview = await rpc(clients[0], 'preview_recurring_service_date_edit', {
    p_service_id: movingDate.service_id,
  });
  assert.equal(movingPreview.passenger_requests, 1);
  assert.equal(movingPreview.driver_offers, 1);
  const dateContentArgs = {
    p_service_id: movingDate.service_id, p_source_name: 'Synthetic Date Exception',
    p_source_description: 'Only this service date changed.',
    p_expected_version: 1, p_client_key: randomUUID(),
  };
  await rpcFailure(clients[1], 'update_recurring_service_date_content', dateContentArgs);
  const editedDate = await rpc(clients[0], 'update_recurring_service_date_content', dateContentArgs);
  assert.equal(editedDate.version, 2);
  assert.deepEqual(await rpc(clients[0], 'update_recurring_service_date_content', dateContentArgs), editedDate);
  await rpcFailure(clients[0], 'update_recurring_service_date_content', {
    ...dateContentArgs, p_client_key: randomUUID(),
  });
  await rpcFailure(clients[0], 'update_recurring_service_date_content', {
    ...dateContentArgs, p_source_name: 'Different input',
  });
  assert.equal(runSql(container, `select count(*) from app.service_exception
    where service_occurrence_id = ${sqlLiteral(movingDateInternalId)}::uuid
      and action = 'content_updated' and original_source_name = ${sqlLiteral(recurringArgs.p_source_name)}
      and replacement_source_name = 'Synthetic Date Exception';`), '1');
  assert.equal(runSql(container, `select count(*) from app.passenger_request
    where service_occurrence_id = ${sqlLiteral(movingDateInternalId)}::uuid
      and service_name_snapshot = ${sqlLiteral(recurringArgs.p_source_name)};`), '1');
  assert.equal(runSql(container, `select count(*) from app.notification
    where event_type = 'church.service.updated'
      and object_public_id = ${sqlLiteral(movingDate.service_id)}::uuid
      and safe_route = '/trips';`), '2');
  const dateContentPublic = await rpc(userClient(url, publicKey), 'published_church_schedule', {
    p_church_id: created.church_id,
  });
  assert.equal(dateContentPublic.find((item) => item.service_id === movingDate.service_id).source_name,
    'Synthetic Date Exception');
  assert.equal(dateContentPublic.filter((item) => item.source_name === recurringArgs.p_source_name).length,
    2);
  const movedTime = new Date(Date.parse(movingDate.starts_at) + 24 * 60 * 60 * 1000).toISOString();
  const moveArgs = {
    p_service_id: movingDate.service_id, p_starts_at: movedTime,
    p_expected_version: 2, p_client_key: randomUUID(),
  };
  await rpcFailure(clients[1], 'reschedule_recurring_service_date', moveArgs);
  const movedDate = await rpc(clients[0], 'reschedule_recurring_service_date', moveArgs);
  assert.equal(movedDate.version, 3);
  assert.equal(movedDate.schedule_generation, 2);
  const movedPublicDate = (await rpc(userClient(url, publicKey), 'published_church_schedule', {
    p_church_id: created.church_id,
  })).find((item) => item.service_id === movingDate.service_id);
  assert.equal(Date.parse(movedPublicDate.starts_at), Date.parse(movedTime));
  assert.equal(movedPublicDate.time_changed, true);
  assert.deepEqual(await rpc(clients[0], 'reschedule_recurring_service_date', moveArgs), movedDate);
  await rpcFailure(clients[0], 'reschedule_recurring_service_date', {
    ...moveArgs, p_starts_at: movingDate.starts_at,
  });
  assert.equal(runSql(container, `select count(*) from app.service_exception
    where service_occurrence_id = ${sqlLiteral(movingDateInternalId)}::uuid
      and action = 'rescheduled'
      and original_starts_at = ${movingOldTime}::timestamptz
      and replacement_starts_at = ${sqlLiteral(movedTime)}::timestamptz;`), '1');
  assert.equal(runSql(container, `select count(*) from app.passenger_request
    where service_occurrence_id = ${sqlLiteral(movingDateInternalId)}::uuid
      and desired_arrival_at = ${movingOldTime}::timestamptz
      and service_generation_snapshot = 1;`), '1');
  assert.equal(runSql(container, `select count(*) from app.notification
    where event_type = 'church.service.rescheduled'
      and object_public_id = ${sqlLiteral(movingDate.service_id)}::uuid
      and safe_route = '/trips';`), '2');
  const movedAgainTime = new Date(Date.parse(movedTime) + 24 * 60 * 60 * 1000).toISOString();
  const movedAgain = await rpc(clients[0], 'reschedule_recurring_service_date', {
    ...moveArgs, p_starts_at: movedAgainTime, p_expected_version: 3,
    p_client_key: randomUUID(),
  });
  assert.equal(movedAgain.version, 4);
  assert.equal(movedAgain.schedule_generation, 3);
  assert.equal(runSql(container, `select count(*) from app.service_exception
    where service_occurrence_id = ${sqlLiteral(movingDateInternalId)}::uuid
      and action = 'rescheduled' and version = 2
      and original_starts_at = ${movingOldTime}::timestamptz
      and replacement_starts_at = ${sqlLiteral(movedAgainTime)}::timestamptz;`), '1');
  const newDateOfferKey = randomUUID();
  runSql(container, `insert into app.driver_offer_occurrence (
    publication_key, author_account_id, church_id, service_occurrence_id,
    departure_at, arrival_at, timezone, service_name_snapshot,
    origin_place_id, total_seats, max_detour_km, children_allowed,
    driver_child_seat_available, return_available
  ) values (
    ${sqlLiteral(newDateOfferKey)}::uuid, ${sqlLiteral(identities[3].id)}::uuid,
    (select id from app.church where public_id = ${sqlLiteral(created.church_id)}::uuid),
    ${sqlLiteral(movingDateInternalId)}::uuid,
    ${sqlLiteral(movedAgainTime)}::timestamptz - interval '2 hours',
    ${sqlLiteral(movedAgainTime)}::timestamptz, 'Europe/Rome',
    ${sqlLiteral(recurringArgs.p_source_name)},
    (select id from private.user_place where owner_account_id = ${sqlLiteral(identities[3].id)}::uuid
      and exact_address = 'Synthetic custom departure' limit 1),
    2, 5, true, false, false
  );`);
  assert.equal(runSql(container, `select count(*) from app.quality_match_candidate
    where request_id in (select id from app.passenger_request
      where service_occurrence_id = ${sqlLiteral(movingDateInternalId)}::uuid);`), '1');
  runSql(container, `delete from app.driver_offer_occurrence
    where publication_key = ${sqlLiteral(newDateOfferKey)}::uuid;`);
  const cancelledMovedDate = await rpc(clients[0], 'cancel_recurring_service_date', {
    p_service_id: movingDate.service_id, p_expected_version: 4, p_client_key: randomUUID(),
  });
  assert.equal(cancelledMovedDate.version, 5);
  assert.equal(runSql(container, `select count(*) from app.service_exception
    where service_occurrence_id = ${sqlLiteral(movingDateInternalId)}::uuid
      and action in ('content_updated', 'rescheduled', 'cancelled');`), '3');

  const openDates = (await rpc(userClient(url, publicKey), 'published_church_schedule', {
    p_church_id: created.church_id,
  })).filter((item) => item.source_name === 'Synthetic Open Weekly Service');
  assert.ok(openDates.length >= 3);
  const futureCutoff = openDates[2];
  const futureCutoffInternalId = runSql(container, `select id from app.service_occurrence
    where public_id = ${sqlLiteral(futureCutoff.service_id)}::uuid;`);
  const futureCutoffTime = sqlLiteral(futureCutoff.starts_at);
  assert.equal(runSql(container, `select count(*) from app.passenger_request
    where author_account_id = ${sqlLiteral(identities[1].id)}::uuid
      and church_id = (select id from app.church
        where public_id = ${sqlLiteral(created.church_id)}::uuid)
      and desired_arrival_at = ${futureCutoffTime}::timestamptz
      and status in ('active', 'partial', 'fulfilled', 'restore');`), '0');
  runSql(container, `insert into app.passenger_request (
    author_account_id, church_id, service_occurrence_id, desired_arrival_at,
    timezone, service_name_snapshot, total_passengers, child_seat_required,
    return_required, remaining_passengers, terms_version
  ) values (
    ${sqlLiteral(identities[1].id)}::uuid,
    (select id from app.church where public_id = ${sqlLiteral(created.church_id)}::uuid),
    ${sqlLiteral(futureCutoffInternalId)}::uuid, ${futureCutoffTime}::timestamptz,
    'Europe/Rome', 'Synthetic Open Weekly Service', 1, false, false, 1,
    ${sqlLiteral(`church-test-${suffix}`)}
  );
  insert into app.driver_offer_occurrence (
    publication_key, author_account_id, church_id, service_occurrence_id,
    departure_at, arrival_at, timezone, service_name_snapshot,
    origin_place_id, total_seats, max_detour_km, children_allowed,
    driver_child_seat_available, return_available
  ) values (
    ${sqlLiteral(randomUUID())}::uuid, ${sqlLiteral(identities[2].id)}::uuid,
    (select id from app.church where public_id = ${sqlLiteral(created.church_id)}::uuid),
    ${sqlLiteral(futureCutoffInternalId)}::uuid,
    ${futureCutoffTime}::timestamptz - interval '2 hours',
    ${futureCutoffTime}::timestamptz, 'Europe/Rome', 'Synthetic Open Weekly Service',
    (select id from private.user_place where owner_account_id = ${sqlLiteral(identities[2].id)}::uuid
      and exact_address = 'Synthetic departure' limit 1),
    2, 5, true, false, false
  );`);
  await rpcFailure(clients[1], 'preview_recurring_service_future_cancellation', {
    p_service_id: futureCutoff.service_id,
  });
  const futurePreview = await rpc(clients[0], 'preview_recurring_service_future_cancellation', {
    p_service_id: futureCutoff.service_id,
  });
  assert.ok(futurePreview.service_count >= 2);
  assert.equal(futurePreview.passenger_requests, 1);
  assert.equal(futurePreview.driver_offers, 1);
  assert.equal(futurePreview.series_version, 1);
  const futureCancelArgs = {
    p_service_id: futureCutoff.service_id, p_expected_series_version: 1,
    p_client_key: randomUUID(),
  };
  await rpcFailure(clients[1], 'cancel_recurring_service_future', futureCancelArgs);
  const futureCancelled = await rpc(clients[0], 'cancel_recurring_service_future', futureCancelArgs);
  assert.equal(futureCancelled.cancelled_service_count, futurePreview.service_count);
  assert.equal(futureCancelled.series_version, 2);
  assert.deepEqual(await rpc(clients[0], 'cancel_recurring_service_future', futureCancelArgs),
    futureCancelled);
  await rpcFailure(clients[0], 'cancel_recurring_service_future', {
    ...futureCancelArgs, p_client_key: randomUUID(),
  });
  assert.equal(runSql(container, `select count(*) from app.service_occurrence
    where source_series_id = (select id from app.service_series
      where public_id = ${sqlLiteral(openSeries.series_id)}::uuid)
      and status = 'scheduled';`), '2');
  assert.equal(runSql(container, `select count(*) from app.service_exception
    where source_series_id = (select id from app.service_series
      where public_id = ${sqlLiteral(openSeries.series_id)}::uuid)
      and action = 'cancelled';`), String(futurePreview.service_count));
  assert.equal(runSql(container, `select (ends_on = ${sqlLiteral(futurePreview.from_local_date)}::date
    - 1)::text from app.service_series
    where public_id = ${sqlLiteral(openSeries.series_id)}::uuid;`), 'true');
  assert.equal(runSql(container, `select count(*) from app.notification
    where event_type = 'church.service.cancelled'
      and object_public_id = ${sqlLiteral(futureCutoff.service_id)}::uuid
      and safe_route = '/trips';`), '2');
  const afterFuturePublic = await rpc(userClient(url, publicKey), 'published_church_schedule', {
    p_church_id: created.church_id,
  });
  assert.equal(afterFuturePublic.find((item) => item.service_id === openDates[0].service_id).status,
    'scheduled');
  assert.equal(afterFuturePublic.find((item) => item.service_id === futureCutoff.service_id).status,
    'cancelled');
  assert.equal(runSql(container, `select count(*) from app.passenger_request
    where service_occurrence_id = ${sqlLiteral(futureCutoffInternalId)}::uuid
      and desired_arrival_at = ${futureCutoffTime}::timestamptz;`), '1');
  assert.equal(await rpc(admin, 'service_schedule_worker_materialize'), 0);

  const futureContentReader = userClient(url, publicKey);
  const futureContentSeries = await rpc(clients[0], 'create_recurring_service', {
    ...recurringArgs, p_source_name: 'Synthetic Future Content Source',
    p_local_start_time: '11:45:00', p_ends_on: null, p_client_key: randomUUID(),
  });
  const futureContentDates = (await rpc(futureContentReader, 'published_church_schedule', {
    p_church_id: created.church_id, p_limit: 100,
  })).filter((item) => item.source_name === 'Synthetic Future Content Source');
  assert.ok(futureContentDates.length >= 4);
  const futureContentSelected = futureContentDates[1];
  const futureContentCancelledDate = futureContentDates[2];
  await rpc(clients[0], 'cancel_recurring_service_date', {
    p_service_id: futureContentCancelledDate.service_id, p_expected_version: 1, p_client_key: randomUUID(),
  });
  const futureContentInternalId = runSql(container, `select id from app.service_occurrence
    where public_id = ${sqlLiteral(futureContentSelected.service_id)}::uuid;`);
  runSql(container, `insert into app.passenger_request (
    author_account_id, church_id, service_occurrence_id, desired_arrival_at, timezone,
    service_name_snapshot, total_passengers, child_seat_required, return_required,
    remaining_passengers, terms_version
  ) select author_account_id, church_id, ${sqlLiteral(futureContentInternalId)}::uuid,
    ${sqlLiteral(futureContentSelected.starts_at)}::timestamptz, timezone,
    'Synthetic Future Content Source', total_passengers, child_seat_required, return_required,
    remaining_passengers, terms_version from app.passenger_request
    where service_occurrence_id = ${sqlLiteral(futureCutoffInternalId)}::uuid;
  insert into app.driver_offer_occurrence (
    publication_key, author_account_id, church_id, service_occurrence_id, departure_at,
    arrival_at, timezone, service_name_snapshot, origin_place_id, total_seats,
    max_detour_km, children_allowed, driver_child_seat_available, return_available
  ) select gen_random_uuid(), author_account_id, church_id,
    ${sqlLiteral(futureContentInternalId)}::uuid,
    ${sqlLiteral(futureContentSelected.starts_at)}::timestamptz - interval '2 hours',
    ${sqlLiteral(futureContentSelected.starts_at)}::timestamptz, timezone,
    'Synthetic Future Content Source', origin_place_id, total_seats, max_detour_km,
    children_allowed, driver_child_seat_available, return_available
  from app.driver_offer_occurrence
  where service_occurrence_id = ${sqlLiteral(futureCutoffInternalId)}::uuid;`);
  const futureContentPreviewArgs = { p_service_id: futureContentSelected.service_id };
  await rpcFailure(futureContentReader, 'preview_recurring_service_future_content', futureContentPreviewArgs);
  await rpcFailure(clients[1], 'preview_recurring_service_future_content', futureContentPreviewArgs);
  await rpcFailure(admin, 'preview_recurring_service_future_content', futureContentPreviewArgs);
  let futureContentPreview = await rpc(clients[0], 'preview_recurring_service_future_content', futureContentPreviewArgs);
  assert.equal(futureContentPreview.series_id, futureContentSeries.series_id);
  assert.equal(futureContentPreview.source_name, 'Synthetic Future Content Source');
  assert.equal(futureContentPreview.passenger_requests, 1);
  assert.equal(futureContentPreview.driver_offers, 1);
  assert.equal(futureContentPreview.service_count, futureContentDates.length - 2);
  const futureContentInput = (preview) => ({
    p_service_id: futureContentSelected.service_id,
    p_source_name: 'Synthetic Updated Future Content', p_source_description: 'Synthetic future description',
    p_expected_series_version: preview.series_version,
    p_expected_schedule_updated_at: preview.schedule_updated_at, p_client_key: randomUUID(),
  });
  const staleFutureContent = futureContentInput(futureContentPreview);
  // A date-only edit must invalidate the whole-series preview even though its source version stays unchanged.
  await rpc(clients[0], 'update_recurring_service_date_content', {
    p_service_id: futureContentDates[3].service_id, p_source_name: 'Synthetic Date Override',
    p_source_description: null, p_expected_version: 1, p_client_key: randomUUID(),
  });
  await rpcConflict(clients[0], 'update_recurring_service_future_content', staleFutureContent);
  futureContentPreview = await rpc(clients[0], 'preview_recurring_service_future_content', futureContentPreviewArgs);
  const futureContentSaveArgs = futureContentInput(futureContentPreview);
  await rpcFailure(futureContentReader, 'update_recurring_service_future_content', futureContentSaveArgs);
  await rpcFailure(clients[1], 'update_recurring_service_future_content', futureContentSaveArgs);
  await rpcFailure(admin, 'update_recurring_service_future_content', futureContentSaveArgs);
  await rpcFailure(clients[0], 'update_recurring_service_future_content', {
    ...futureContentSaveArgs, p_source_name: ' ',
  });
  await rpcFailure(clients[0], 'update_recurring_service_future_content', {
    ...futureContentSaveArgs, p_expected_schedule_updated_at: null,
  });
  const futureContentSaved = await rpc(clients[0], 'update_recurring_service_future_content', futureContentSaveArgs);
  assert.equal(futureContentSaved.series_version, 2);
  assert.equal(futureContentSaved.updated_service_count, futureContentPreview.service_count);
  assert.deepEqual(await rpc(clients[0], 'update_recurring_service_future_content', futureContentSaveArgs),
    futureContentSaved);
  await rpcFailure(clients[0], 'update_recurring_service_future_content', {
    ...futureContentSaveArgs, p_source_name: 'Changed retry input',
  });
  await rpcConflict(clients[0], 'update_recurring_service_future_content', {
    ...futureContentSaveArgs, p_client_key: randomUUID(),
  });
  const futureContentAfter = await rpc(futureContentReader, 'published_church_schedule', {
    p_church_id: created.church_id, p_limit: 100,
  });
  assert.equal(futureContentAfter.find((item) => item.service_id === futureContentDates[0].service_id).source_name,
    'Synthetic Future Content Source');
  assert.equal(futureContentAfter.find((item) => item.service_id === futureContentCancelledDate.service_id).source_name,
    'Synthetic Future Content Source');
  assert.equal(futureContentAfter.find((item) => item.service_id === futureContentCancelledDate.service_id).status,
    'cancelled');
  for (const date of futureContentDates.filter((item) => item.service_id !== futureContentDates[0].service_id
    && item.service_id !== futureContentCancelledDate.service_id)) {
    const updated = futureContentAfter.find((item) => item.service_id === date.service_id);
    assert.equal(updated.source_name, futureContentSaveArgs.p_source_name);
    assert.equal(Date.parse(updated.starts_at), Date.parse(date.starts_at));
  }
  assert.equal(runSql(container, `select count(*) from app.passenger_request
    where service_occurrence_id = ${sqlLiteral(futureContentInternalId)}::uuid
      and desired_arrival_at = ${sqlLiteral(futureContentSelected.starts_at)}::timestamptz
      and service_name_snapshot = 'Synthetic Future Content Source';`), '1');
  assert.equal(runSql(container, `select count(*) from app.driver_offer_occurrence
    where service_occurrence_id = ${sqlLiteral(futureContentInternalId)}::uuid
      and arrival_at = ${sqlLiteral(futureContentSelected.starts_at)}::timestamptz
      and service_name_snapshot = 'Synthetic Future Content Source';`), '1');
  assert.equal(runSql(container, `select count(*) from app.notification
    where event_type = 'church.service.updated'
      and object_public_id = ${sqlLiteral(futureContentSelected.service_id)}::uuid
      and safe_route = '/trips';`), '2');
  assert.equal(runSql(container, `select source_version from app.content_source
    where object_type = 'service_occurrence' and object_id = ${sqlLiteral(futureContentInternalId)}::uuid
      and field_name = 'source_name';`), '2');
  assert.equal(runSql(container, `select count(*) from app.service_exception
    where service_occurrence_id = (select id from app.service_occurrence
      where public_id = ${sqlLiteral(futureContentDates[3].service_id)}::uuid)
      and action = 'content_updated';`), '2');
  const currentFutureContentPreview = await rpc(clients[0], 'preview_recurring_service_future_content', futureContentPreviewArgs);
  const noOpFutureContent = await rpc(clients[0], 'update_recurring_service_future_content',
    futureContentInput(currentFutureContentPreview));
  assert.equal(noOpFutureContent.series_version, 2);
  assert.equal(noOpFutureContent.updated_service_count, 0);
  assert.equal((await rpc(clients[0], 'preview_recurring_service_future_content', futureContentPreviewArgs))
    .schedule_updated_at, currentFutureContentPreview.schedule_updated_at);
  const futureContentRace = await Promise.all(['A', 'B'].map((name) => clients[0].schema('api')
    .rpc('update_recurring_service_future_content', {
      ...futureContentInput(currentFutureContentPreview), p_source_name: `Synthetic Future Content Winner ${name}`,
    }).abortSignal(AbortSignal.timeout(10_000))));
  assert.equal(futureContentRace.filter((item) => !item.error).length, 1);
  assert.equal(futureContentRace.filter((item) => item.status === 409 && item.error?.code === 'PT409').length, 1);
  assert.deepEqual(await rpc(clients[0], 'update_recurring_service_future_content', futureContentSaveArgs),
    futureContentSaved);
  const futureContentWinner = await rpc(clients[0], 'preview_recurring_service_future_content', futureContentPreviewArgs);
  assert.match(futureContentWinner.source_name, /^Synthetic Future Content Winner [AB]$/);
  assert.equal(futureContentWinner.series_version, 3);
  assert.equal(runSql(container, `select app.materialize_service_series(id, now() + interval '14 days')
    from app.service_series where public_id = ${sqlLiteral(futureContentSeries.series_id)}::uuid;`), '2');
  assert.equal(runSql(container, `select count(*) from app.service_occurrence as service
    join app.service_series as series on series.id = service.source_series_id
    where series.public_id = ${sqlLiteral(futureContentSeries.series_id)}::uuid
      and service.source_name = ${sqlLiteral(futureContentWinner.source_name)};`), String(futureContentPreview.service_count + 2));

  const futureTimePreviewArgs = { p_service_id: futureContentSelected.service_id };
  await rpcFailure(futureContentReader, 'preview_recurring_service_future_time', futureTimePreviewArgs);
  await rpcFailure(clients[1], 'preview_recurring_service_future_time', futureTimePreviewArgs);
  await rpcFailure(admin, 'preview_recurring_service_future_time', futureTimePreviewArgs);
  let futureTimePreview = await rpc(clients[0], 'preview_recurring_service_future_time', futureTimePreviewArgs);
  assert.equal(futureTimePreview.local_start_time, '11:45:00');
  assert.equal(futureTimePreview.timezone, 'Europe/Rome');
  assert.equal(futureTimePreview.passenger_requests, 1);
  assert.equal(futureTimePreview.driver_offers, 1);
  const futureTimeInput = (preview) => ({
    p_service_id: futureContentSelected.service_id, p_local_start_time: '12:20:00',
    p_expected_series_version: preview.series_version,
    p_expected_schedule_updated_at: preview.schedule_updated_at, p_client_key: randomUUID(),
  });
  const staleFutureTime = futureTimeInput(futureTimePreview);
  const futureTimeException = await rpc(clients[0], 'preview_recurring_service_date_edit', {
    p_service_id: futureContentDates[3].service_id,
  });
  await rpc(clients[0], 'reschedule_recurring_service_date', {
    p_service_id: futureContentDates[3].service_id,
    p_starts_at: new Date(Date.parse(futureContentDates[3].starts_at) + 20 * 60 * 1000).toISOString(),
    p_expected_version: futureTimeException.version, p_client_key: randomUUID(),
  });
  await rpcConflict(clients[0], 'reschedule_recurring_service_future', staleFutureTime);
  futureTimePreview = await rpc(clients[0], 'preview_recurring_service_future_time', futureTimePreviewArgs);
  const futureTimeArgs = futureTimeInput(futureTimePreview);
  await rpcFailure(futureContentReader, 'reschedule_recurring_service_future', futureTimeArgs);
  await rpcFailure(clients[1], 'reschedule_recurring_service_future', futureTimeArgs);
  await rpcFailure(admin, 'reschedule_recurring_service_future', futureTimeArgs);
  await rpcFailure(clients[0], 'reschedule_recurring_service_future', {
    ...futureTimeArgs, p_local_start_time: null,
  });
  await rpcFailure(clients[0], 'reschedule_recurring_service_future', {
    ...futureTimeArgs, p_expected_schedule_updated_at: null,
  });
  // Force a collision on a later date: earlier loop work, notifications, and exceptions must roll back.
  const collisionFutureTime = runSql(container, `select ((local_date + '12:20:00'::time)
    at time zone timezone)::text from app.service_occurrence
    where public_id = ${sqlLiteral(futureContentDates[3].service_id)}::uuid;`);
  const collisionFutureService = await rpc(clients[0], 'create_one_off_service', {
    p_church_id: created.church_id, p_source_name: futureContentWinner.source_name,
    p_source_description: null, p_starts_at: collisionFutureTime, p_client_key: randomUUID(),
  });
  const collisionFuturePreview = await rpc(clients[0], 'preview_recurring_service_future_time', futureTimePreviewArgs);
  const collisionFutureArgs = futureTimeInput(collisionFuturePreview);
  assert.equal((await rpcFailure(clients[0], 'reschedule_recurring_service_future', collisionFutureArgs)).code, '23505');
  assert.equal(runSql(container, `select schedule_generation from app.service_occurrence
    where public_id = ${sqlLiteral(futureContentSelected.service_id)}::uuid;`), '1');
  assert.equal(runSql(container, `select count(*) from app.notification
    where event_type = 'church.service.rescheduled'
      and object_public_id = ${sqlLiteral(futureContentSelected.service_id)}::uuid;`), '0');
  assert.equal(runSql(container, `select count(*) from private.church_operation
    where operation_type = 'reschedule_recurring_service_future'
      and client_key = ${sqlLiteral(collisionFutureArgs.p_client_key)}::uuid;`), '0');
  // Delete only the collision fixture; real service history is never deleted by this API.
  runSql(container, `delete from app.content_translation where content_source_id in (
      select source.id from app.content_source as source
      where source.object_type = 'service_occurrence' and source.object_id = (
        select id from app.service_occurrence where public_id = ${sqlLiteral(collisionFutureService.service_id)}::uuid));
    delete from app.content_source where object_type = 'service_occurrence' and object_id = (
      select id from app.service_occurrence where public_id = ${sqlLiteral(collisionFutureService.service_id)}::uuid);
    delete from app.service_occurrence where public_id = ${sqlLiteral(collisionFutureService.service_id)}::uuid;`);
  const futureTimeSaved = await rpc(clients[0], 'reschedule_recurring_service_future', collisionFutureArgs);
  assert.equal(futureTimeSaved.series_version, 4);
  assert.equal(futureTimeSaved.rescheduled_service_count, collisionFuturePreview.service_count);
  assert.deepEqual(await rpc(clients[0], 'reschedule_recurring_service_future', collisionFutureArgs), futureTimeSaved);
  await rpcFailure(clients[0], 'reschedule_recurring_service_future', {
    ...collisionFutureArgs, p_local_start_time: '12:25:00',
  });
  await rpcConflict(clients[0], 'reschedule_recurring_service_future', {
    ...collisionFutureArgs, p_client_key: randomUUID(),
  });
  const afterFutureTimePreview = await rpc(clients[0], 'preview_recurring_service_future_time', futureTimePreviewArgs);
  const futureTimeNoOp = await rpc(clients[0], 'reschedule_recurring_service_future',
    futureTimeInput(afterFutureTimePreview));
  assert.equal(futureTimeNoOp.series_version, 4);
  assert.equal(futureTimeNoOp.rescheduled_service_count, 0);
  assert.equal(runSql(container, `select count(*) from app.service_occurrence as service
    where service.source_series_id = (select id from app.service_series
      where public_id = ${sqlLiteral(futureContentSeries.series_id)}::uuid)
      and service.status = 'scheduled'
      and service.local_date >= ${sqlLiteral(afterFutureTimePreview.from_local_date)}::date
      and service.starts_at = (service.local_date + '12:20:00'::time) at time zone service.timezone
      and service.schedule_generation >= 2;`), String(futureTimeSaved.rescheduled_service_count));
  assert.equal(runSql(container, `select count(*) from app.service_occurrence
    where public_id in (${sqlLiteral(futureContentDates[0].service_id)}::uuid,
      ${sqlLiteral(futureContentCancelledDate.service_id)}::uuid)
      and schedule_generation = 1;`), '2');
  assert.equal(runSql(container, `select count(*) from app.passenger_request
    where service_occurrence_id = ${sqlLiteral(futureContentInternalId)}::uuid
      and desired_arrival_at = ${sqlLiteral(futureContentSelected.starts_at)}::timestamptz
      and service_generation_snapshot = 1;`), '1');
  assert.equal(runSql(container, `select count(*) from app.driver_offer_occurrence
    where service_occurrence_id = ${sqlLiteral(futureContentInternalId)}::uuid
      and arrival_at = ${sqlLiteral(futureContentSelected.starts_at)}::timestamptz
      and service_generation_snapshot = 1;`), '1');
  assert.equal(runSql(container, `select count(*) from app.notification
    where event_type = 'church.service.rescheduled'
      and object_public_id = ${sqlLiteral(futureContentSelected.service_id)}::uuid
      and safe_route = '/trips';`), '2');
  assert.equal(runSql(container, `select app.materialize_service_series(id, now() + interval '21 days')
    from app.service_series where public_id = ${sqlLiteral(futureContentSeries.series_id)}::uuid;`), '1');
  assert.equal(runSql(container, `select count(*) from app.service_occurrence as service
    join app.service_series as series on series.id = service.source_series_id
    where series.public_id = ${sqlLiteral(futureContentSeries.series_id)}::uuid
      and service.local_start_time = '12:20:00'::time
      and service.starts_at = (service.local_date + '12:20:00'::time) at time zone service.timezone;`), '1');
  const futureTimeRacePreview = await rpc(clients[0], 'preview_recurring_service_future_time', futureTimePreviewArgs);
  const futureTimeRace = await Promise.all(['12:30:00', '12:40:00'].map((time) => clients[0].schema('api')
    .rpc('reschedule_recurring_service_future', {
      ...futureTimeInput(futureTimeRacePreview), p_local_start_time: time,
    }).abortSignal(AbortSignal.timeout(10_000))));
  assert.equal(futureTimeRace.filter((item) => !item.error).length, 1);
  assert.equal(futureTimeRace.filter((item) => item.status === 409 && item.error?.code === 'PT409').length, 1);
  assert.deepEqual(await rpc(clients[0], 'reschedule_recurring_service_future', collisionFutureArgs), futureTimeSaved);
  const futureTimeWinner = await rpc(clients[0], 'preview_recurring_service_future_time', futureTimePreviewArgs);
  assert.ok(['12:30:00', '12:40:00'].includes(futureTimeWinner.local_start_time));
  assert.equal(futureTimeWinner.series_version, 5);

  const extensionReader = userClient(url, publicKey);
  const extensionSeries = await rpc(clients[0], 'create_recurring_service', {
    ...recurringArgs, p_source_name: 'Synthetic Extended Weekly', p_local_start_time: '14:00:00', p_client_key: randomUUID(),
  });
  const extensionDates = (await rpc(extensionReader, 'published_church_schedule', {
    p_church_id: created.church_id, p_limit: 100,
  })).filter((item) => item.source_name === 'Synthetic Extended Weekly');
  assert.equal(extensionDates.length, 3);
  await rpc(clients[0], 'cancel_recurring_service_date', {
    p_service_id: extensionDates[1].service_id, p_expected_version: 1, p_client_key: randomUUID(),
  });
  const extensionPreviewArgs = { p_service_id: extensionDates[0].service_id };
  const extendDate = (date, days) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const extensionInput = (preview, end = extendDate(preview.ends_on, 7)) => ({
    ...extensionPreviewArgs, p_ends_on: end, p_expected_series_version: preview.series_version,
    p_expected_schedule_updated_at: preview.schedule_updated_at, p_client_key: randomUUID(),
  });
  let extensionPreview = await rpc(clients[0], 'preview_recurring_service_extension', extensionPreviewArgs);
  assert.equal(extensionPreview.ends_on, recurringArgs.p_ends_on);
  assert.deepEqual(extensionPreview.weekdays, recurringArgs.p_weekdays);
  const staleExtension = extensionInput(extensionPreview);
  await rpc(clients[0], 'update_recurring_service_date_content', {
    p_service_id: extensionDates[2].service_id, p_source_name: 'Synthetic Extension Date Override',
    p_source_description: null, p_expected_version: 1, p_client_key: randomUUID(),
  });
  await rpcConflict(clients[0], 'extend_recurring_service', staleExtension);
  extensionPreview = await rpc(clients[0], 'preview_recurring_service_extension', extensionPreviewArgs);
  const extensionArgs = extensionInput(extensionPreview);
  for (const outsider of [extensionReader, clients[1], admin]) {
    await rpcFailure(outsider, 'preview_recurring_service_extension', extensionPreviewArgs);
    await rpcFailure(outsider, 'extend_recurring_service', extensionArgs);
  }
  await rpcFailure(clients[0], 'extend_recurring_service', { ...extensionArgs, p_expected_schedule_updated_at: null });
  await rpcFailure(clients[0], 'extend_recurring_service', {
    ...extensionArgs, p_ends_on: extendDate(extensionPreview.ends_on, -1),
  });
  const originalExtensionRows = () => runSql(container, `select encode(extensions.digest(convert_to(
    jsonb_agg(to_jsonb(service) order by service.id)::text, 'UTF8'), 'sha256'), 'hex')
    from app.service_occurrence as service where service.public_id in (
      ${extensionDates.map((item) => `${sqlLiteral(item.service_id)}::uuid`).join(',')});`);
  const rideRows = () => runSql(container, `select jsonb_build_object(
    'request', (select jsonb_agg(to_jsonb(request) order by request.id) from app.passenger_request as request
      where request.service_occurrence_id = ${sqlLiteral(futureContentInternalId)}::uuid),
    'offer', (select jsonb_agg(to_jsonb(offer) order by offer.id) from app.driver_offer_occurrence as offer
      where offer.service_occurrence_id = ${sqlLiteral(futureContentInternalId)}::uuid));`);
  const beforeExtensionRows = originalExtensionRows();
  const beforeExtensionRides = rideRows();
  const extensionSaved = await rpc(clients[0], 'extend_recurring_service', extensionArgs);
  assert.equal(extensionSaved.series_version, 2);
  assert.equal(extensionSaved.new_service_count, 1);
  assert.equal(extensionSaved.ends_on, extensionArgs.p_ends_on);
  assert.equal(originalExtensionRows(), beforeExtensionRows);
  assert.equal(rideRows(), beforeExtensionRides);
  assert.deepEqual(await rpc(clients[0], 'extend_recurring_service', extensionArgs), extensionSaved);
  await rpcFailure(clients[0], 'extend_recurring_service', {
    ...extensionArgs, p_ends_on: extendDate(extensionArgs.p_ends_on, 7),
  });
  await rpcConflict(clients[0], 'extend_recurring_service', { ...extensionArgs, p_client_key: randomUUID() });
  const extensionNoOpPreview = await rpc(clients[0], 'preview_recurring_service_extension', extensionPreviewArgs);
  const extensionNoOp = await rpc(clients[0], 'extend_recurring_service',
    extensionInput(extensionNoOpPreview, extensionNoOpPreview.ends_on));
  assert.equal(extensionNoOp.series_version, 2);
  assert.equal(extensionNoOp.new_service_count, 0);
  assert.equal((await rpc(clients[0], 'preview_recurring_service_extension', extensionPreviewArgs)).schedule_updated_at,
    extensionNoOpPreview.schedule_updated_at);
  const extensionRace = await Promise.all([7, 14].map((days) => clients[0].schema('api').rpc('extend_recurring_service',
    extensionInput(extensionNoOpPreview, extendDate(extensionNoOpPreview.ends_on, days))).abortSignal(AbortSignal.timeout(10_000))));
  assert.equal(extensionRace.filter((item) => !item.error).length, 1);
  assert.equal(extensionRace.filter((item) => item.status === 409 && item.error?.code === 'PT409').length, 1);
  const extensionWinner = await rpc(clients[0], 'preview_recurring_service_extension', extensionPreviewArgs);
  assert.equal(extensionWinner.series_version, 3);
  assert.deepEqual(await rpc(clients[0], 'extend_recurring_service', extensionArgs), extensionSaved);
  assert.equal((await rpc(clients[0], 'preview_recurring_service_extension', extensionPreviewArgs)).ends_on, extensionWinner.ends_on);
  const unboundedExtension = await rpc(clients[0], 'extend_recurring_service', extensionInput(extensionWinner, null));
  assert.equal(unboundedExtension.series_version, 4);
  assert.equal(unboundedExtension.ends_on, null);
  assert.ok(unboundedExtension.new_service_count > 0 && unboundedExtension.new_service_count <= 13);
  const unboundedPreview = await rpc(clients[0], 'preview_recurring_service_extension', extensionPreviewArgs);
  const unboundedNoOp = await rpc(clients[0], 'extend_recurring_service', extensionInput(unboundedPreview, null));
  assert.equal(unboundedNoOp.series_version, 4);
  assert.equal(unboundedNoOp.new_service_count, 0);
  await rpcFailure(clients[0], 'extend_recurring_service', extensionInput(unboundedPreview, extensionWinner.ends_on));
  assert.equal(runSql(container, `select app.materialize_service_series(id,
    ((materialized_through - 69) + time '12:00') at time zone timezone)
    from app.service_series where public_id = ${sqlLiteral(extensionSeries.series_id)}::uuid;`), '3');
  assert.equal(originalExtensionRows(), beforeExtensionRows);
  assert.equal(rideRows(), beforeExtensionRides);

  await verifyHiddenScheduleRepairs({ actor: clients[0], outsiders: [extensionReader, clients[1], admin],
    anonymous: extensionReader, rpc, rpcFailure, churchId: created.church_id, churchSlug: created.slug, recurringArgs,
    runSql: (statement, options) => runSql(container, statement, options) });

  const duplicateArgs = churchArgs({
    p_client_key: randomUUID(), p_lat: 45.0705, p_lng: 7.6871,
    p_official_name: 'Duplicate Attempt', p_slug: `duplicate-church-${compactSuffix}`,
  });
  const duplicate = await rpc(clients[1], 'create_church', duplicateArgs);
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(duplicate.church_id, created.church_id);
  assert.deepEqual(await rpc(clients[1], 'current_managed_churches'), []);

  const suspicious = await rpc(clients[1], 'create_church', churchArgs({
    p_client_key: randomUUID(), p_lat: 46.0703, p_lng: 8.6869,
    p_official_name: 'Same Address Far Away', p_slug: `suspicious-church-${compactSuffix}`,
  }));
  assert.equal(suspicious.status, 'potential_duplicate');
  assert.equal(suspicious.church_id, undefined);

  const secondArgs = churchArgs({
    p_address_display: 'Piazza Test 20, Milano',
    p_client_key: randomUUID(),
    p_lat: 45.4642,
    p_lng: 9.19,
    p_locality: 'Milano',
    p_official_name: 'Second Synthetic Orthodox Church',
    p_slug: `second-synthetic-church-${compactSuffix}`,
  });
  const second = await rpc(clients[1], 'create_church', secondArgs);
  assert.equal(second.status, 'created');
  assert.equal((await rpc(clients[1], 'current_managed_churches'))[0].church_id, second.church_id);

  const publicReader = userClient(url, publicKey);
  const readSecondChurch = () => rpc(publicReader, 'transport_church_by_slug', {
    p_slug: secondArgs.p_slug,
  });
  assert.equal((await readSecondChurch()).public_contact_details, undefined);
  const contactArgs = {
    p_church_id: second.church_id,
    p_public_contact_details: 'Church office: office@example.invalid\nhttps://parish.example.invalid',
    p_expected_version: 1, p_client_key: randomUUID(),
  };
  await rpcFailure(publicReader, 'update_church_public_contacts', contactArgs);
  await rpcFailure(admin, 'update_church_public_contacts', contactArgs);
  await rpcFailure(clients[0], 'update_church_public_contacts', contactArgs);
  await rpcFailure(clients[4], 'update_church_public_contacts', contactArgs);
  for (const invalidContact of ['x'.repeat(4001), 'Office\u0001details']) {
    await rpcFailure(clients[1], 'update_church_public_contacts', {
      ...contactArgs, p_public_contact_details: invalidContact, p_client_key: randomUUID(),
    });
  }
  const contactsSaved = await rpc(clients[1], 'update_church_public_contacts', contactArgs);
  assert.equal(contactsSaved.content_version, 2);
  assert.deepEqual(await rpc(clients[1], 'update_church_public_contacts', contactArgs), contactsSaved);
  await rpcFailure(clients[1], 'update_church_public_contacts', {
    ...contactArgs, p_public_contact_details: 'Changed retry input',
  });
  await rpcFailure(clients[1], 'update_church_public_contacts', {
    ...contactArgs, p_client_key: randomUUID(),
  });
  const publicWithContacts = await readSecondChurch();
  assert.equal(publicWithContacts.public_contact_details, contactArgs.p_public_contact_details);
  for (const identity of identities) assert.equal(JSON.stringify(publicWithContacts).includes(identity.email), false);
  assert.equal((await rpc(clients[1], 'current_managed_churches'))
    .find((item) => item.church_id === second.church_id).public_contact_details,
  contactArgs.p_public_contact_details);
  assert.equal((await rpc(clients[1], 'update_church_public_contacts', {
    ...contactArgs, p_public_contact_details: ` \n${contactArgs.p_public_contact_details}\r\n `,
    p_expected_version: 2, p_client_key: randomUUID(),
  })).content_version, 2);
  assert.equal(runSql(container, `select count(*) from app.church_admin_event
    where church_id = (select id from app.church where public_id = ${sqlLiteral(second.church_id)}::uuid)
      and event_type = 'church.content_updated';`), '1');
  assert.equal(runSql(container, `select count(*) from app.content_source
    where object_type = 'church'
      and object_id = (select id from app.church where public_id = ${sqlLiteral(second.church_id)}::uuid)
      and (field_name not in ('official_name', 'description_source')
        or original_text like '%office@example.invalid%' or source_version <> 1);`), '0');
  for (const unavailableStatus of ['hidden', 'archived']) {
    runSql(container, `update app.church set status = ${sqlLiteral(unavailableStatus)}
      where public_id = ${sqlLiteral(second.church_id)}::uuid;`);
    assert.equal(await readSecondChurch(), null);
    if (unavailableStatus === 'archived') {
      await rpcFailure(clients[1], 'update_church_public_contacts', {
        ...contactArgs, p_expected_version: 2, p_client_key: randomUUID(),
      });
    }
  }
  runSql(container, `update app.church set status = 'published'
    where public_id = ${sqlLiteral(second.church_id)}::uuid;`);
  const contactsCleared = await rpc(clients[1], 'update_church_public_contacts', {
    ...contactArgs, p_public_contact_details: ' \n \r\n ', p_expected_version: 2, p_client_key: randomUUID(),
  });
  assert.equal(contactsCleared.content_version, 3);
  assert.equal((await readSecondChurch()).public_contact_details, undefined);
  assert.equal((await rpc(clients[1], 'update_church_public_contacts', {
    ...contactArgs, p_public_contact_details: '\r\n ', p_expected_version: 3, p_client_key: randomUUID(),
  })).content_version, 3);
  // An old successful retry cannot restore contacts after a newer removal.
  assert.deepEqual(await rpc(clients[1], 'update_church_public_contacts', contactArgs), contactsSaved);
  assert.equal((await readSecondChurch()).public_contact_details, undefined);

  const photoArgs = {
    p_church_id: second.church_id, p_expected_version: 3, p_upload_sha256: 'c'.repeat(64),
    p_rights_confirmed: true, p_attribution: 'Synthetic photographer', p_client_key: randomUUID(),
  };
  await rpcFailure(publicReader, 'prepare_church_image_replacement', photoArgs);
  await rpcFailure(admin, 'prepare_church_image_replacement', photoArgs);
  await rpcFailure(clients[0], 'prepare_church_image_replacement', photoArgs);
  await rpcFailure(clients[4], 'prepare_church_image_replacement', photoArgs);
  await rpcFailure(clients[1], 'prepare_church_image_replacement', { ...photoArgs, p_rights_confirmed: false });
  await rpcFailure(clients[1], 'prepare_church_image_replacement', { ...photoArgs, p_attribution: 'x'.repeat(1001) });
  const photoIntent = await rpc(clients[1], 'prepare_church_image_replacement', photoArgs);
  assert.equal(photoIntent.status, 'prepared');
  assert.deepEqual(await rpc(clients[1], 'prepare_church_image_replacement', photoArgs), photoIntent);
  await rpcFailure(clients[1], 'prepare_church_image_replacement', { ...photoArgs, p_upload_sha256: 'd'.repeat(64) });
  const photoManifest = syntheticImageManifest();
  const stagePhoto = { p_replacement_id: photoIntent.replacement_id,
    p_upload_sha256: photoArgs.p_upload_sha256, p_manifest: photoManifest };
  const finishPhoto = { p_replacement_id: photoIntent.replacement_id };
  await rpcFailure(clients[1], 'inspect_church_image_replacement', finishPhoto);
  assert.equal((await rpc(admin, 'inspect_church_image_replacement', finishPhoto)).state, 'pending');
  await rpcFailure(clients[1], 'stage_church_image_replacement', stagePhoto);
  await rpcFailure(clients[1], 'complete_church_image_replacement', finishPhoto);
  await rpcFailure(admin, 'complete_church_image_replacement', finishPhoto);
  await rpcFailure(admin, 'stage_church_image_replacement', { ...stagePhoto, p_upload_sha256: 'd'.repeat(64) });
  for (const invalidManifest of [
    null, [], 'not a manifest', { ...photoManifest, files: [null, null, null, null] },
    { ...photoManifest, data: 'untouched upload must not reach SQL' },
    { ...photoManifest, files: photoManifest.files.map((file) => ({ ...file, data: 'encoded bytes' })) },
    { ...photoManifest, files: photoManifest.files.map((file) => ({ ...file, objectKey: '../other.webp' })) },
    { ...photoManifest, files: photoManifest.files.map((file) => ({ ...file, width: 10001 })) },
    { ...photoManifest, files: photoManifest.files.map((file) => ({ ...file, width: `${file.width}` })) },
  ]) await rpcFailure(admin, 'stage_church_image_replacement', { ...stagePhoto, p_manifest: invalidManifest });
  assert.equal(await rpc(admin, 'stage_church_image_replacement', stagePhoto), true);
  assert.equal(await rpc(admin, 'stage_church_image_replacement', stagePhoto), true);
  assert.deepEqual((await rpc(admin, 'inspect_church_image_replacement', finishPhoto)).manifest, photoManifest);
  await rpcFailure(admin, 'stage_church_image_replacement', { ...stagePhoto, p_manifest: syntheticImageManifest() });
  assert.equal(await rpc(publicReader, 'published_church_image', { p_church_id: second.church_id }), null);
  runSql(container, `update private.account_contact set phone_verified_at = null
    where account_id = ${sqlLiteral(identities[1].id)}::uuid;`);
  await rpcFailure(admin, 'complete_church_image_replacement', finishPhoto);
  runSql(container, `update private.account_contact set phone_verified_at = clock_timestamp()
    where account_id = ${sqlLiteral(identities[1].id)}::uuid;`);
  runSql(container, `update app.church_admin_membership set status = 'ended', ended_at = clock_timestamp()
    where account_id = ${sqlLiteral(identities[1].id)}::uuid
      and church_id = (select id from app.church where public_id = ${sqlLiteral(second.church_id)}::uuid);`);
  await rpcFailure(clients[1], 'prepare_church_image_replacement', photoArgs);
  await rpcFailure(admin, 'complete_church_image_replacement', finishPhoto);
  runSql(container, `update app.church_admin_membership set status = 'active', ended_at = null
    where account_id = ${sqlLiteral(identities[1].id)}::uuid
      and church_id = (select id from app.church where public_id = ${sqlLiteral(second.church_id)}::uuid);`);
  const photoSaved = await rpc(admin, 'complete_church_image_replacement', finishPhoto);
  assert.equal(photoSaved.content_version, 4);
  assert.equal(photoSaved.image_id, photoManifest.imageId);
  assert.deepEqual(await rpc(admin, 'complete_church_image_replacement', finishPhoto), photoSaved);
  const inspectedPhoto = await rpc(admin, 'inspect_church_image_replacement', finishPhoto);
  assert.deepEqual(Object.keys(inspectedPhoto).sort(), ['state', 'expires_at', 'manifest', 'result'].sort());
  assert.deepEqual(inspectedPhoto.result, photoSaved);
  assert.deepEqual(await rpc(clients[1], 'prepare_church_image_replacement', photoArgs), photoSaved);
  const publicPhoto = await rpc(publicReader, 'published_church_image', { p_church_id: second.church_id });
  assert.deepEqual(Object.keys(publicPhoto).sort(), ['image_id', 'attribution', 'variants'].sort());
  assert.equal(publicPhoto.attribution, photoArgs.p_attribution);
  assert.deepEqual(publicPhoto.variants.map((file) => file.role), ['480', '960', '1600']);
  for (const file of publicPhoto.variants) assert.deepEqual(Object.keys(file).sort(),
    ['role', 'content_type', 'width', 'height'].sort());
  const publishedPhotoObjectArgs = {
    p_church_id: second.church_id, p_image_id: photoSaved.image_id, p_role: '480',
  };
  await rpcFailure(publicReader, 'published_church_image_object', publishedPhotoObjectArgs);
  await rpcFailure(clients[1], 'published_church_image_object', publishedPhotoObjectArgs);
  const publishedPhotoObject = await rpc(admin, 'published_church_image_object', publishedPhotoObjectArgs);
  assert.deepEqual(publishedPhotoObject, photoManifest.files.find((file) => file.role === '480'));
  assert.equal(await rpc(admin, 'published_church_image_object', {
    ...publishedPhotoObjectArgs, p_image_id: randomUUID(),
  }), null);
  assert.equal(await rpc(admin, 'published_church_image_object', {
    ...publishedPhotoObjectArgs, p_role: 'master',
  }), null);
  assert.equal(runSql(container, `select upload_sha256 is null from private.church_image_replacement
    where id = ${sqlLiteral(photoIntent.replacement_id)}::uuid;`), 't');

  const expiredPhotoIntent = await rpc(clients[1], 'prepare_church_image_replacement', {
    ...photoArgs, p_expected_version: 4, p_client_key: randomUUID(),
  });
  await rpc(admin, 'stage_church_image_replacement', {
    ...stagePhoto, p_replacement_id: expiredPhotoIntent.replacement_id, p_manifest: syntheticImageManifest(),
  });
  runSql(container, `update private.church_image_replacement set expires_at = clock_timestamp() - interval '1 minute'
    where id = ${sqlLiteral(expiredPhotoIntent.replacement_id)}::uuid;`);
  await rpcFailure(admin, 'stage_church_image_replacement', {
    ...stagePhoto, p_replacement_id: expiredPhotoIntent.replacement_id, p_manifest: syntheticImageManifest(),
  });
  await rpcFailure(admin, 'complete_church_image_replacement', {
    p_replacement_id: expiredPhotoIntent.replacement_id,
  });
  assert.equal(runSql(container, `select manifest is not null from private.church_image_replacement
    where id = ${sqlLiteral(expiredPhotoIntent.replacement_id)}::uuid;`), 't');
  const stalePhotoIntent = await rpc(clients[1], 'prepare_church_image_replacement', {
    ...photoArgs, p_expected_version: 4, p_client_key: randomUUID(),
  });
  await rpc(admin, 'stage_church_image_replacement', {
    ...stagePhoto, p_replacement_id: stalePhotoIntent.replacement_id, p_manifest: syntheticImageManifest(),
  });
  await rpc(clients[1], 'update_church_public_contacts', {
    ...contactArgs, p_public_contact_details: 'Synthetic public office', p_expected_version: 4, p_client_key: randomUUID(),
  });
  await rpcFailure(admin, 'complete_church_image_replacement', { p_replacement_id: stalePhotoIntent.replacement_id });
  assert.equal((await rpc(publicReader, 'published_church_image', { p_church_id: second.church_id })).image_id,
    photoManifest.imageId);
  const racingPhotos = [];
  for (let index = 0; index < 2; index += 1) {
    const intent = await rpc(clients[1], 'prepare_church_image_replacement', {
      ...photoArgs, p_expected_version: 5, p_client_key: randomUUID(),
    });
    await rpc(admin, 'stage_church_image_replacement', {
      ...stagePhoto, p_replacement_id: intent.replacement_id, p_manifest: syntheticImageManifest(),
    });
    racingPhotos.push(intent);
  }
  const racedPhotos = await Promise.all(racingPhotos.map((intent) => admin.schema('api')
    .rpc('complete_church_image_replacement', { p_replacement_id: intent.replacement_id })));
  assert.equal(racedPhotos.filter((result) => result.error === null).length, 1);
  const failedRacingPhoto = racedPhotos.find((result) => result.error !== null)?.error;
  assert.equal(racedPhotos.find((result) => result.error !== null)?.status, 409);
  assert.equal(failedRacingPhoto?.code, 'PT409', JSON.stringify({
    code: failedRacingPhoto?.code, details: failedRacingPhoto?.details,
    hint: failedRacingPhoto?.hint, message: failedRacingPhoto?.message,
  }));
  const winningPhoto = racedPhotos.find((result) => result.error === null).data;
  assert.equal(winningPhoto.content_version, 6);
  assert.deepEqual(await rpc(admin, 'complete_church_image_replacement', finishPhoto), photoSaved);
  assert.equal((await rpc(publicReader, 'published_church_image', { p_church_id: second.church_id })).image_id,
    winningPhoto.image_id);
  assert.equal(runSql(container, `select count(*) from app.church_image
    where church_id = (select id from app.church where public_id = ${sqlLiteral(second.church_id)}::uuid)
      and status = 'current';`), '1');
  for (const status of ['hidden', 'archived']) {
    runSql(container, `update app.church set status = ${sqlLiteral(status)}
      where public_id = ${sqlLiteral(second.church_id)}::uuid;`);
    assert.equal(await rpc(publicReader, 'published_church_image', { p_church_id: second.church_id }), null);
    assert.equal(await rpc(admin, 'published_church_image_object', {
      ...publishedPhotoObjectArgs, p_image_id: winningPhoto.image_id,
    }), null);
    if (status === 'archived') await rpcFailure(clients[1], 'prepare_church_image_replacement', {
      ...photoArgs, p_expected_version: 6, p_client_key: randomUUID(),
    });
  }
  runSql(container, `update app.church set status = 'published'
    where public_id = ${sqlLiteral(second.church_id)}::uuid;`);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    for (const table of ['app.church_image', 'private.church_image_replacement']) {
      runSql(container, `set role ${role}; select * from ${table};`, { expectFailure: true });
    }
  }
  assert.equal(runSql(container, `select count(*) from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where (namespace.nspname, relation.relname) in (
      ('app', 'church_image'), ('private', 'church_image_replacement'))
      and relation.relrowsecurity and relation.relforcerowsecurity;`), '2');
  assert.equal(runSql(container, `select count(*) from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated', 'service_role')
      and (table_schema, table_name) in (('app', 'church_image'), ('private', 'church_image_replacement'));`), '0');
  assert.equal(runSql(container, `select has_function_privilege(
    'service_role', 'api.published_church_image_object(uuid,uuid,text)', 'execute')::text;`), 'true');
  assert.equal(runSql(container, `select has_function_privilege(
    'authenticated', 'api.published_church_image_object(uuid,uuid,text)', 'execute')::text;`), 'false');

  const cleanupToken = randomUUID();
  const cleanupClaimArgs = { p_lease_token: cleanupToken, p_limit: 20 };
  await rpcFailure(publicReader, 'church_image_cleanup_claim', cleanupClaimArgs);
  await rpcFailure(clients[1], 'church_image_cleanup_claim', cleanupClaimArgs);
  await rpcFailure(admin, 'church_image_cleanup_claim', { ...cleanupClaimArgs, p_limit: 21 });
  await rpcFailure(admin, 'church_image_cleanup_claim', { ...cleanupClaimArgs, p_lease_token: null });
  // Even expired completed intents, including superseded images, must never be cleanup candidates.
  runSql(container, `update private.church_image_replacement set expires_at = clock_timestamp() - interval '1 minute'
    where church_id = (select id from app.church where public_id = ${sqlLiteral(second.church_id)}::uuid)
      and state = 'succeeded';`);
  const cleanupJobs = await rpc(admin, 'church_image_cleanup_claim', cleanupClaimArgs);
  assert.equal(cleanupJobs.length, 1);
  const cleanupJob = cleanupJobs[0];
  assert.equal(cleanupJob.replacement_id, expiredPhotoIntent.replacement_id);
  assert.deepEqual(Object.keys(cleanupJob).sort(), ['replacement_id', 'image_id', 'object_keys'].sort());
  assert.deepEqual(new Set(cleanupJob.object_keys), new Set(['master', '480', '960', '1600']
    .map((role) => `${cleanupJob.image_id}/${role}.webp`)));
  assert.deepEqual(await rpc(admin, 'church_image_cleanup_claim', {
    ...cleanupClaimArgs, p_lease_token: randomUUID(),
  }), []);
  const cleanupCompleteArgs = { p_replacement_id: cleanupJob.replacement_id,
    p_lease_token: cleanupToken, p_success: true };
  await rpcFailure(publicReader, 'church_image_cleanup_complete', cleanupCompleteArgs);
  await rpcFailure(clients[1], 'church_image_cleanup_complete', cleanupCompleteArgs);
  assert.equal(await rpc(admin, 'church_image_cleanup_complete', {
    ...cleanupCompleteArgs, p_lease_token: randomUUID(),
  }), false);
  runSql(container, `update private.church_image_replacement
    set cleanup_lease_expires_at = clock_timestamp() - interval '1 second'
    where id = ${sqlLiteral(cleanupJob.replacement_id)}::uuid;`);
  const reclaimedCleanupToken = randomUUID();
  const reclaimedCleanupJobs = await rpc(admin, 'church_image_cleanup_claim', {
    ...cleanupClaimArgs, p_lease_token: reclaimedCleanupToken,
  });
  assert.deepEqual(reclaimedCleanupJobs, cleanupJobs);
  assert.equal(await rpc(admin, 'church_image_cleanup_complete', cleanupCompleteArgs), false);
  assert.equal(await rpc(admin, 'church_image_cleanup_complete', {
    ...cleanupCompleteArgs, p_lease_token: reclaimedCleanupToken, p_success: false,
  }), true);
  assert.deepEqual(await rpc(admin, 'church_image_cleanup_claim', cleanupClaimArgs), []);
  runSql(container, `update private.church_image_replacement
    set cleanup_next_at = clock_timestamp() - interval '1 second'
    where id = ${sqlLiteral(cleanupJob.replacement_id)}::uuid;`);
  assert.deepEqual(await rpc(admin, 'church_image_cleanup_claim', cleanupClaimArgs), cleanupJobs);
  assert.equal(await rpc(admin, 'church_image_cleanup_complete', cleanupCompleteArgs), true);
  assert.equal(runSql(container, `select cleanup_checked_at is not null
    and cleanup_next_at > clock_timestamp() + interval '23 hours'
    and manifest is not null from private.church_image_replacement
    where id = ${sqlLiteral(cleanupJob.replacement_id)}::uuid;`), 't');
  assert.deepEqual(await rpc(admin, 'church_image_cleanup_claim', cleanupClaimArgs), []);
  // A later reconciliation retains the exact keys for uploads that finished after a timeout.
  runSql(container, `update private.church_image_replacement
    set cleanup_next_at = clock_timestamp() - interval '1 second'
    where id = ${sqlLiteral(cleanupJob.replacement_id)}::uuid;`);
  assert.deepEqual(await rpc(admin, 'church_image_cleanup_claim', cleanupClaimArgs), cleanupJobs);
  assert.equal(await rpc(admin, 'church_image_cleanup_complete', cleanupCompleteArgs), true);
  assert.equal((await rpc(publicReader, 'published_church_image', { p_church_id: second.church_id })).image_id,
    winningPhoto.image_id);

  const firstInternalId = runSql(container,
    `select id from app.church where public_id = ${sqlLiteral(created.church_id)}::uuid;`);
  runSql(container, `
    insert into app.church_admin_membership (church_id, account_id, access_source)
    values
      (${sqlLiteral(firstInternalId)}::uuid, ${sqlLiteral(identities[1].id)}::uuid, 'invite'),
      (${sqlLiteral(firstInternalId)}::uuid, ${sqlLiteral(identities[2].id)}::uuid, 'invite');
  `);
  runSql(container, `
    insert into app.church_admin_membership (church_id, account_id, access_source)
    values (${sqlLiteral(firstInternalId)}::uuid, ${sqlLiteral(identities[3].id)}::uuid, 'invite');
  `, { expectFailure: true });
  assert.equal(runSql(container, `select count(*) from app.church_admin_membership
    where church_id = ${sqlLiteral(firstInternalId)}::uuid and status = 'active';`), '3');

  const addressArgs = {
    p_church_id: created.church_id,
    p_address_display: 'Corso Synthetic 25, Torino',
    p_locality: 'Torino', p_country_code: 'IT',
    p_lat: 45.0712, p_lng: 7.6881,
    p_expected_version: 2, p_client_key: randomUUID(),
  };
  await rpcFailure(clients[3], 'update_church_address', addressArgs);
  await rpcFailure(clients[4], 'update_church_address', addressArgs);
  const duplicateAddress = await rpc(clients[0], 'update_church_address', {
    ...addressArgs, p_address_display: secondArgs.p_address_display,
    p_locality: secondArgs.p_locality, p_lat: secondArgs.p_lat, p_lng: secondArgs.p_lng,
    p_client_key: randomUUID(),
  });
  assert.equal(duplicateAddress.status, 'potential_duplicate');
  assert.equal(duplicateAddress.content_version, 2);
  runSql(container, `update app.church set status = 'hidden'
    where id = ${sqlLiteral(firstInternalId)}::uuid;`);
  runSql(container, `insert into app.route_measurement (
    church_id, origin_place_id, distance_m, duration_s, provider_name
  ) values (
    ${sqlLiteral(firstInternalId)}::uuid,
    (select id from private.user_place where owner_account_id = ${sqlLiteral(identities[2].id)}::uuid
      and exact_address = 'Synthetic departure' limit 1),
    12000, 1500, 'local-test'
  );
  insert into app.route_measurement (
    church_id, origin_place_id, distance_m, duration_s, provider_name
  ) values (
    (select id from app.church where public_id = ${sqlLiteral(second.church_id)}::uuid),
    (select id from private.user_place where owner_account_id = ${sqlLiteral(identities[2].id)}::uuid
      and exact_address = 'Synthetic departure' limit 1),
    9000, 1100, 'local-test'
  );`);
  const updatedAddress = await rpc(clients[1], 'update_church_address', addressArgs);
  assert.equal(updatedAddress.status, 'saved');
  assert.equal(updatedAddress.content_version, 3);
  assert.deepEqual(await rpc(clients[1], 'update_church_address', addressArgs), updatedAddress);
  await rpcFailure(clients[1], 'update_church_address', {
    ...addressArgs, p_address_display: 'Reused key with different address',
  });
  await rpcConflict(clients[2], 'update_church_address', {
    ...addressArgs, p_client_key: randomUUID(),
  });
  const addressNoOp = await rpc(clients[2], 'update_church_address', {
    ...addressArgs, p_expected_version: 3, p_client_key: randomUUID(),
  });
  assert.equal(addressNoOp.content_version, 3);
  runSql(container, `update app.church set status = 'published'
    where id = ${sqlLiteral(firstInternalId)}::uuid;`);
  const publicWithUpdatedAddress = await rpc(userClient(url, publicKey), 'transport_church_by_slug', {
    p_slug: firstArgs.p_slug,
  });
  assert.equal(publicWithUpdatedAddress.address, addressArgs.p_address_display);
  assert.equal(publicWithUpdatedAddress.locality, addressArgs.p_locality);
  assert.equal(publicWithUpdatedAddress.lat, addressArgs.p_lat);
  assert.equal(publicWithUpdatedAddress.lng, addressArgs.p_lng);
  const managedWithUpdatedAddress = (await rpc(clients[2], 'current_managed_churches'))
    .find((church) => church.church_id === created.church_id);
  assert.equal(managedWithUpdatedAddress.content_version, 3);
  assert.equal(managedWithUpdatedAddress.lat, addressArgs.p_lat);
  assert.equal(managedWithUpdatedAddress.lng, addressArgs.p_lng);
  const routeOriginPublicId = runSql(container, `select public_id from private.user_place
    where owner_account_id = ${sqlLiteral(identities[2].id)}::uuid
      and exact_address = 'Synthetic departure' limit 1;`);
  assert.deepEqual(await rpc(admin, 'route_worker_record_leg', {
    p_church_id: created.church_id, p_church_version: 2,
    p_origin_place_id: routeOriginPublicId, p_via_place_id: null,
    p_distance_m: 12000, p_duration_s: 1500, p_provider_name: 'local-test',
  }), { status: 'stale' });
  assert.equal(runSql(container, `select count(*) from app.route_measurement
    where church_id = ${sqlLiteral(firstInternalId)}::uuid;`), '0');
  assert.equal(runSql(container, `select count(*) from app.route_measurement
    where church_id = (select id from app.church where public_id = ${sqlLiteral(second.church_id)}::uuid);`), '1');
  assert.equal(runSql(container, `select count(*) from app.church_admin_event
    where church_id = ${sqlLiteral(firstInternalId)}::uuid
      and event_type = 'church.address_updated';`), '1');
  assert.equal(runSql(container, `select count(*) from app.notification
    where event_type = 'church.address.updated'
      and object_public_id = ${sqlLiteral(created.church_id)}::uuid
      and safe_route = '/trips';`), '3');

  const archiveArgs = { p_church_id: created.church_id, p_client_key: randomUUID() };
  await rpcFailure(clients[3], 'request_church_archival', archiveArgs);
  const archiveRequest = await rpc(clients[0], 'request_church_archival', archiveArgs);
  assert.equal(archiveRequest.status, 'requested');
  assert.deepEqual(await rpc(clients[0], 'request_church_archival', archiveArgs), archiveRequest);
  const alreadyRequested = await rpc(clients[1], 'request_church_archival', {
    p_church_id: created.church_id, p_client_key: randomUUID(),
  });
  assert.equal(alreadyRequested.status, 'already_requested');
  assert.equal(alreadyRequested.request_id, archiveRequest.request_id);
  const managedDuringArchive = (await rpc(clients[2], 'current_managed_churches'))
    .find((church) => church.church_id === created.church_id);
  assert.equal(managedDuringArchive.status, 'archive_requested');
  assert.equal(managedDuringArchive.archive_request.request_id, archiveRequest.request_id);
  assert.equal((await rpc(userClient(url, publicKey), 'transport_church_by_slug', {
    p_slug: firstArgs.p_slug,
  })).church_id, created.church_id);
  runSql(container, `update app.church set status = 'hidden'
    where id = ${sqlLiteral(firstInternalId)}::uuid;`);
  const managedWhileHidden = (await rpc(clients[2], 'current_managed_churches'))
    .find((church) => church.church_id === created.church_id);
  assert.equal(managedWhileHidden.status, 'hidden');
  assert.equal(managedWhileHidden.archive_request.request_id, archiveRequest.request_id);
  const cancelArchiveArgs = {
    p_church_id: created.church_id, p_request_id: archiveRequest.request_id,
    p_client_key: randomUUID(),
  };
  const cancelledArchive = await rpc(clients[1], 'cancel_church_archival_request', cancelArchiveArgs);
  assert.equal(cancelledArchive.status, 'cancelled');
  assert.deepEqual(await rpc(clients[1], 'cancel_church_archival_request', cancelArchiveArgs), cancelledArchive);
  await rpcFailure(clients[1], 'cancel_church_archival_request', {
    ...cancelArchiveArgs, p_client_key: randomUUID(),
  });
  runSql(container, `update app.church set status = 'published'
    where id = ${sqlLiteral(firstInternalId)}::uuid;`);
  const managedAfterWithdrawal = (await rpc(clients[0], 'current_managed_churches'))
    .find((church) => church.church_id === created.church_id);
  assert.equal(managedAfterWithdrawal.status, 'published');
  assert.equal(managedAfterWithdrawal.archive_request, null);
  const reopenedArchive = await rpc(clients[2], 'request_church_archival', {
    p_church_id: created.church_id, p_client_key: randomUUID(),
  });
  assert.equal(reopenedArchive.status, 'requested');
  assert.notEqual(reopenedArchive.request_id, archiveRequest.request_id);

  const inviteArgs = (email, transfer = false) => ({
    p_church_id: second.church_id, p_email: email,
    p_transfer_own_place: transfer, p_client_key: randomUUID(),
  });
  await rpcFailure(clients[0], 'invite_church_admin', inviteArgs(identities[2].email));
  const firstInviteArgs = inviteArgs(identities[2].email);
  const firstInvite = await rpc(clients[1], 'invite_church_admin', firstInviteArgs);
  assert.equal(firstInvite.status, 'pending');
  assert.deepEqual(await rpc(clients[1], 'invite_church_admin', firstInviteArgs), firstInvite);
  await rpcFailure(clients[1], 'invite_church_admin', { ...firstInviteArgs, p_email: identities[3].email });
  const firstToken = runSql(container, `select mail.token_value from private.church_invite_mail as mail
    join app.church_admin_invite as invite on invite.id = mail.invite_id
    where invite.public_id = ${sqlLiteral(firstInvite.invite_id)}::uuid;`);
  assert.equal(firstToken.length, 64);
  await rpcFailure(clients[0], 'church_invite_worker_claim', {
    p_lease_token: randomUUID(), p_limit: 10,
  });
  const leaseToken = randomUUID();
  const queuedMail = await rpc(admin, 'church_invite_worker_claim', {
    p_lease_token: leaseToken, p_limit: 10,
  });
  const claimedMail = queuedMail.find((item) => item.invite_id === firstInvite.invite_id);
  assert.ok(claimedMail);
  assert.equal(claimedMail.token, firstToken);
  assert.equal(claimedMail.destination_email, identities[2].email);
  assert.equal(await rpc(admin, 'church_invite_worker_complete', {
    p_job_id: claimedMail.job_id, p_lease_token: leaseToken,
    p_outcome: 'sent', p_provider_reference: randomUUID(),
  }), true);
  await rpcFailure(clients[3], 'accept_church_admin_invite', {
    p_invite_id: firstInvite.invite_id, p_token: firstToken,
  });
  await rpcFailure(clients[2], 'accept_church_admin_invite', {
    p_invite_id: firstInvite.invite_id, p_token: '0'.repeat(64),
  });
  assert.equal((await rpc(clients[2], 'accept_church_admin_invite', {
    p_invite_id: firstInvite.invite_id, p_token: firstToken,
  })).status, 'accepted');
  assert.equal((await rpc(clients[2], 'current_managed_churches'))[0].church_id, second.church_id);

  const reserved = await rpc(clients[1], 'invite_church_admin', inviteArgs(identities[0].email));
  await rpcFailure(clients[1], 'invite_church_admin', inviteArgs(identities[3].email));
  const transfer = await rpc(clients[1], 'invite_church_admin', inviteArgs(identities[3].email, true));
  const transferToken = runSql(container, `select mail.token_value from private.church_invite_mail as mail
    join app.church_admin_invite as invite on invite.id = mail.invite_id
    where invite.public_id = ${sqlLiteral(transfer.invite_id)}::uuid;`);
  assert.equal((await rpc(clients[3], 'accept_church_admin_invite', {
    p_invite_id: transfer.invite_id, p_token: transferToken,
  })).status, 'accepted');
  assert.equal((await rpc(clients[1], 'current_managed_churches'))
    .some((item) => item.church_id === second.church_id), false);
  assert.equal((await rpc(clients[3], 'current_managed_churches'))[0].administrator_count, 2);
  await rpcFailure(clients[1], 'cancel_church_admin_invite', { p_invite_id: reserved.invite_id });
  assert.equal(await rpc(clients[3], 'cancel_church_admin_invite', { p_invite_id: reserved.invite_id }), true);
  assert.equal(await rpc(clients[3], 'cancel_church_admin_invite', { p_invite_id: reserved.invite_id }), false);
  const declined = await rpc(clients[3], 'invite_church_admin', inviteArgs(identities[0].email));
  const declineToken = runSql(container, `select mail.token_value from private.church_invite_mail as mail
    join app.church_admin_invite as invite on invite.id = mail.invite_id
    where invite.public_id = ${sqlLiteral(declined.invite_id)}::uuid;`);
  assert.equal(await rpc(clients[0], 'decline_church_admin_invite', {
    p_invite_id: declined.invite_id, p_token: declineToken,
  }), true);
  assert.equal(await rpc(clients[2], 'leave_church_administration', { p_church_id: second.church_id }), true);
  await rpcFailure(clients[3], 'leave_church_administration', { p_church_id: second.church_id });
  assert.equal(runSql(container, `select count(*) from app.church_admin_membership
    where church_id = (select id from app.church where public_id = ${sqlLiteral(second.church_id)}::uuid)
      and status in ('active', 'transferring');`), '1');

  const retryInvite = await rpc(clients[3], 'invite_church_admin', inviteArgs(identities[0].email));
  await rpcFailure(clients[3], 'resend_church_admin_invite', { p_invite_id: retryInvite.invite_id });
  const originalRetryToken = runSql(container, `select mail.token_value
    from private.church_invite_mail as mail
    join app.church_admin_invite as invite on invite.id = mail.invite_id
    where invite.public_id = ${sqlLiteral(retryInvite.invite_id)}::uuid;`);
  runSql(container, `with timing as (select clock_timestamp() - interval '11 minutes' as moment)
    update app.church_admin_invite as invite
    set issued_at = timing.moment, expires_at = timing.moment + interval '7 days',
      last_sent_at = timing.moment
    from timing where invite.public_id = ${sqlLiteral(retryInvite.invite_id)}::uuid;
    update private.church_invite_mail as mail
    set state = 'dead', token_value = repeat('0', 64), attempt_count = 5
    where mail.invite_id = (select id from app.church_admin_invite
      where public_id = ${sqlLiteral(retryInvite.invite_id)}::uuid);`);
  assert.equal(await rpc(clients[3], 'resend_church_admin_invite', {
    p_invite_id: retryInvite.invite_id,
  }), true);
  const replacementToken = runSql(container, `select mail.token_value
    from private.church_invite_mail as mail
    join app.church_admin_invite as invite on invite.id = mail.invite_id
    where invite.public_id = ${sqlLiteral(retryInvite.invite_id)}::uuid;`);
  assert.notEqual(replacementToken, originalRetryToken);
  assert.notEqual(replacementToken, '0'.repeat(64));
  assert.equal(runSql(container, `select (
    invite.token_hash = encode(extensions.digest(convert_to(mail.token_value, 'UTF8'), 'sha256'), 'hex')
  )::text from app.church_admin_invite as invite
  join private.church_invite_mail as mail on mail.invite_id = invite.id
  where invite.public_id = ${sqlLiteral(retryInvite.invite_id)}::uuid;`), 'true');

  runSql(container, `update private.church_invite_mail set attempt_count = 4
    where invite_id = (select id from app.church_admin_invite
      where public_id = ${sqlLiteral(retryInvite.invite_id)}::uuid);`);
  const finalLease = randomUUID();
  const fifthAttempt = (await rpc(admin, 'church_invite_worker_claim', {
    p_lease_token: finalLease, p_limit: 10,
  })).find((item) => item.invite_id === retryInvite.invite_id);
  assert.ok(fifthAttempt);
  assert.equal(fifthAttempt.attempt_count, 5);
  assert.equal(await rpc(admin, 'church_invite_worker_complete', {
    p_job_id: fifthAttempt.job_id, p_lease_token: finalLease,
    p_outcome: 'sent', p_provider_reference: randomUUID(),
  }), true);
  assert.equal(runSql(container, `select mail.token_value from private.church_invite_mail as mail
    join app.church_admin_invite as invite on invite.id = mail.invite_id
    where invite.public_id = ${sqlLiteral(retryInvite.invite_id)}::uuid;`), replacementToken);
  runSql(container, `with timing as (select clock_timestamp() - interval '8 days' as moment)
    update app.church_admin_invite as invite
    set issued_at = timing.moment, expires_at = timing.moment + interval '7 days'
    from timing where invite.public_id = ${sqlLiteral(retryInvite.invite_id)}::uuid;`);
  await rpc(admin, 'church_invite_worker_claim', { p_lease_token: randomUUID(), p_limit: 10 });
  assert.equal(runSql(container, `select invite.state || ':' || mail.state || ':' || mail.token_value
    from app.church_admin_invite as invite
    join private.church_invite_mail as mail on mail.invite_id = invite.id
    where invite.public_id = ${sqlLiteral(retryInvite.invite_id)}::uuid;`),
  `expired:cancelled:${'0'.repeat(64)}`);

  const assertInvitationExpiryAudit = (inviteId) => assert.equal(runSql(container, `
    select count(*) from app.church_admin_invite as invite
    join ops.audit_event as audit on audit.event_key = 'church-invite-expired:' || invite.id::text
    where invite.public_id = ${sqlLiteral(inviteId)}::uuid
      and audit.action_type = 'invite.expired' and audit.actor_kind = 'system'
      and audit.actor_account_id is null and audit.occurred_at = invite.decided_at
      and audit.transaction_id = invite.xmin::text;`), '1');
  assertInvitationExpiryAudit(retryInvite.invite_id);
  const lazyExpiryInvite = await rpc(clients[3], 'invite_church_admin', inviteArgs(identities[0].email));
  runSql(container, `with timing as (select clock_timestamp() - interval '8 days' as moment)
    update app.church_admin_invite as invite
    set issued_at = timing.moment, expires_at = timing.moment + interval '7 days',
      last_sent_at = timing.moment
    from timing where invite.public_id = ${sqlLiteral(lazyExpiryInvite.invite_id)}::uuid;`);
  assert.equal(await rpc(clients[3], 'resend_church_admin_invite', {
    p_invite_id: lazyExpiryInvite.invite_id,
  }), false);
  assertInvitationExpiryAudit(lazyExpiryInvite.invite_id);
  assert.equal(await rpc(clients[3], 'resend_church_admin_invite', {
    p_invite_id: lazyExpiryInvite.invite_id,
  }), false);
  assertInvitationExpiryAudit(lazyExpiryInvite.invite_id);

  assert.equal(runSql(container, `select count(*) from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated', 'service_role')
      and table_schema in ('app', 'private')
      and table_name in ('church_slug_history', 'church_admin_membership', 'church_admin_event',
        'church_operation', 'church_admin_invite', 'church_invite_mail', 'church_archive_request')
      and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');`), '0');
  assert.equal(runSql(container, `select count(*) from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname in ('app', 'private')
      and relation.relname in ('church_slug_history', 'church_admin_membership', 'church_admin_event',
        'church_operation', 'church_admin_invite', 'church_invite_mail', 'church_archive_request')
      and relation.relrowsecurity and relation.relforcerowsecurity;`), '7');
  assert.equal(runSql(container, `select count(*) from app.church_admin_event
    where church_id = ${sqlLiteral(firstInternalId)}::uuid
       and event_type in ('church.created', 'membership.joined', 'church.content_updated');`), '3');

  assert.equal(runSql(container, `select count(*) from app.church_admin_event as event
    left join ops.audit_event as audit on audit.event_key = 'church-admin-event:' || event.id::text
    join app.church as church on church.id = event.church_id
    where audit.id is null or audit.target_type <> 'church' or audit.target_id <> church.public_id
      or audit.action_type <> event.event_type or audit.occurred_at <> event.occurred_at
      or audit.actor_account_id is distinct from event.actor_account_id
      or audit.transaction_id <> event.xmin::text;`), '0');
  const churchAudit = JSON.parse(runSql(container, `select coalesce(jsonb_agg(to_jsonb(audit)), '[]'::jsonb)
    from ops.audit_event as audit where target_type = 'church';`));
  assert.ok(churchAudit.length > 10);
  for (const event of churchAudit) {
    assert.deepEqual(Object.keys(event).sort(), ['id', 'event_key', 'occurred_at', 'actor_kind',
      'actor_account_id', 'action_type', 'target_type', 'target_id', 'result', 'changed_fields',
      'transaction_id', 'schema_version', 'operator_fingerprint', 'support_reference', 'reason_code'].sort());
    assert.equal(event.operator_fingerprint, null);
    assert.equal(event.support_reference, null);
    assert.equal(event.reason_code, null);
    assert.equal(event.result, 'success');
  }
  for (const forbidden of [...identities.map((identity) => identity.email),
    contactArgs.p_public_contact_details, firstToken, declineToken, editArgs.p_description_source,
    photoArgs.p_attribution, photoArgs.p_upload_sha256, photoManifest.files[0].objectKey]) {
    assert.equal(JSON.stringify(churchAudit).includes(forbidden), false);
  }
  const rolledBackAuditId = randomUUID();
  runSql(container, `begin;
    insert into app.church_admin_event (id, church_id, event_type)
    values (${sqlLiteral(rolledBackAuditId)}::uuid, ${sqlLiteral(firstInternalId)}::uuid, 'invite.expired');
    rollback;`);
  assert.equal(runSql(container, `select count(*) from ops.audit_event
    where event_key = 'church-admin-event:' || ${sqlLiteral(rolledBackAuditId)};`), '0');
  const historicalAuditId = randomUUID();
  const historicalTime = '2026-01-01T10:00:00Z';
  // Model a pre-capture installation, then apply the actual migration to its old event.
  runSql(container, `alter table app.church_admin_event disable trigger audit_church_admin_event;
    insert into app.church_admin_event (id, church_id, event_type, occurred_at)
    values (${sqlLiteral(historicalAuditId)}::uuid, ${sqlLiteral(firstInternalId)}::uuid,
      'invite.expired', ${sqlLiteral(historicalTime)}::timestamptz);
    alter table app.church_admin_event enable trigger audit_church_admin_event;`);
  const churchAuditMigration = readFileSync(new URL(
    '../supabase/migrations/20261015180000_church_administration_audit.sql', import.meta.url,
  ), 'utf8');
  // Reapply actual historical capture/backfill without downgrading any later audit shape.
  const replayChurchAudit = () => runSql(container, `begin;
    create temporary table current_audit_constraints on commit drop as
      select conname, pg_get_constraintdef(oid) as definition from pg_constraint
      where conrelid = 'ops.audit_event'::regclass and conname in (
        'audit_event_action_type_check', 'audit_event_target_type_check', 'audit_event_target_shape',
        'audit_event_changed_fields_check');
    ${churchAuditMigration}
    do $restore_constraint$
    declare current_constraint record;
    begin
      for current_constraint in select * from current_audit_constraints loop
        execute format('alter table ops.audit_event drop constraint %I', current_constraint.conname);
        execute format('alter table ops.audit_event add constraint %I %s',
          current_constraint.conname, current_constraint.definition);
      end loop;
    end;
    $restore_constraint$;
    commit;`);
  const expiredInviteAuditKey = runSql(container, `select 'church-invite-expired:' || id::text
    from app.church_admin_invite where public_id = ${sqlLiteral(lazyExpiryInvite.invite_id)}::uuid;`);
  const originalExpiryTime = runSql(container, `select decided_at from app.church_admin_invite
    where public_id = ${sqlLiteral(lazyExpiryInvite.invite_id)}::uuid;`);
  runSql(container, `delete from ops.audit_event where event_key = ${sqlLiteral(expiredInviteAuditKey)};`);
  replayChurchAudit();
  const historicalAudit = JSON.parse(runSql(container, `select to_jsonb(audit) from ops.audit_event as audit
    where event_key = 'church-admin-event:' || ${sqlLiteral(historicalAuditId)};`));
  assert.equal(new Date(historicalAudit.occurred_at).toISOString(), new Date(historicalTime).toISOString());
  assert.equal(historicalAudit.transaction_id, null);
  assert.equal(historicalAudit.actor_kind, 'system');
  const backfilledExpiry = JSON.parse(runSql(container, `select to_jsonb(audit) from ops.audit_event as audit
    where event_key = ${sqlLiteral(expiredInviteAuditKey)};`));
  assert.equal(new Date(backfilledExpiry.occurred_at).toISOString(), new Date(originalExpiryTime).toISOString());
  assert.equal(backfilledExpiry.transaction_id, null);
  replayChurchAudit();
  assert.deepEqual(JSON.parse(runSql(container, `select to_jsonb(audit) from ops.audit_event as audit
    where event_key = 'church-admin-event:' || ${sqlLiteral(historicalAuditId)};`)), historicalAudit);
  assert.deepEqual(JSON.parse(runSql(container, `select to_jsonb(audit) from ops.audit_event as audit
    where event_key = ${sqlLiteral(expiredInviteAuditKey)};`)), backfilledExpiry);

  assert.equal((await rpc(clients[0], 'current_notification_preferences')).ride_email_enabled, false);
  assert.equal((await rpc(clients[0], 'current_notification_preferences')).web_push_enabled, false);
  assert.equal(runSql(container, `select count(*) from pg_proc as function_row
    join pg_namespace as namespace on namespace.oid = function_row.pronamespace
    where namespace.nspname in ('app', 'api')
      and (function_row.proname like '%church%' or function_row.proname like '%service%'
        or function_row.proname = 'managed_translation_target')
      and function_row.prokind = 'f' and function_row.prosrc like '%app.require_transport_actor()%';`), '0');

  process.stdout.write([
    'Church administration foundation verification passed:',
    '- only fully eligible actors can publish a church page',
    '- creation is actor-derived, idempotent, and immediately creates the first equal administrator place',
    '- church source text edits are member-only, idempotent, version-checked, and public only through the deliberate projection',
    '- optional public church contacts are separate from private accounts, removable, member-only, and excluded from translation',
    '- church-photo metadata replacement requires rights acknowledgement, current eligibility/membership, versions, and trusted processing',
    '- selected-and-future recurring source edits reject stale previews, retain ride snapshots, and notify affected participants',
    '- future weekly time edits preserve ride generations and roll back all dates on a conflicting target',
    '- church/admin/schedule actions atomically produce minimized audit with rollback and historical-backfill safety',
    '- normalized-address and PostGIS proximity checks return the existing safe page instead of duplicating it',
    '- suspicious same-address geography fails closed for protected review',
    '- church address edits invalidate only that church route measurements and reject in-flight stale results',
    '- administrator membership and pending invitations share a three-place cap; own-place transfer is atomic',
    '- invite acceptance requires the matching confirmed email, a valid token, and eligibility',
    '- a member may leave while another active administrator remains',
    '- failed delivery can be resent with a fresh hashed token; fifth-attempt success retains it until expiry',
    '- expiring a delivered invitation scrubs the clear token',
    '- equal administrators may request or cancel owner-reviewed archival without hiding the church',
    '- administrator membership grants no visitor transport access',
    '- administrative tables remain behind forced RLS with no direct application-role grants',
  ].join('\n') + '\n');
} finally {
  if (createdUserIds.length > 0) {
    try {
      const accountList = createdUserIds.map((id) => `${sqlLiteral(id)}::uuid`).join(', ');
      runSql(container, `
        delete from private.church_image_replacement where church_id in (
          select id from app.church where created_by in (${accountList})
        );
        delete from app.church_image where church_id in (
          select id from app.church where created_by in (${accountList})
        );
        delete from private.church_invite_mail where invite_id in (
          select id from app.church_admin_invite where church_id in (
            select id from app.church where created_by in (${accountList})
          )
        );
        delete from app.church_admin_invite where church_id in (
          select id from app.church where created_by in (${accountList})
        );
        delete from app.church_archive_request where church_id in (
          select id from app.church where created_by in (${accountList})
        );
        delete from app.church_admin_event where church_id in (
          select id from app.church where created_by in (${accountList})
        );
        delete from app.church_admin_membership where church_id in (
          select id from app.church where created_by in (${accountList})
        );
        delete from app.ride_response where passenger_account_id in (${accountList});
        delete from app.ride_condition_snapshot where passenger_request_id in (
          select id from app.passenger_request where church_id in (
            select id from app.church where created_by in (${accountList})
          )
        );
        delete from app.driver_offer_occurrence where church_id in (
          select id from app.church where created_by in (${accountList})
        );
        delete from app.passenger_request where church_id in (
          select id from app.church where created_by in (${accountList})
        );
        delete from private.user_place where owner_account_id in (${accountList})
          and exact_address in ('Synthetic meeting', 'Synthetic departure', 'Synthetic custom departure');
        delete from ops.operational_alert where alert_type = 'church.schedule_conflict'
          and safe_reference in (select public_id from app.service_occurrence where church_id in (
            select id from app.church where created_by in (${accountList})
          ));
        delete from app.service_exception where source_series_id in (
          select id from app.service_series where church_id in (
            select id from app.church where created_by in (${accountList})
          )
        );
        delete from app.content_translation where content_source_id in (
          select source.id from app.content_source as source
          where (source.object_type = 'church' and source.object_id in (
            select id from app.church where created_by in (${accountList})
          )) or (source.object_type = 'service_occurrence' and source.object_id in (
            select id from app.service_occurrence where church_id in (
              select id from app.church where created_by in (${accountList})
            )
          ))
        );
        delete from app.content_source as source
        where (source.object_type = 'church' and source.object_id in (
          select id from app.church where created_by in (${accountList})
        )) or (source.object_type = 'service_occurrence' and source.object_id in (
          select id from app.service_occurrence where church_id in (
            select id from app.church where created_by in (${accountList})
          )
        ));
        delete from app.translation_glossary_version
        where provider_reference = ${sqlLiteral(translationGlossaryReference)};
        delete from app.service_occurrence where church_id in (
          select id from app.church where created_by in (${accountList})
        );
        delete from app.service_series where church_id in (
          select id from app.church where created_by in (${accountList})
        );
        delete from app.church_slug_history where church_id in (
          select id from app.church where created_by in (${accountList})
        );
        delete from private.church_operation where actor_account_id in (${accountList});
        delete from app.church where created_by in (${accountList});
        delete from app.account where id in (${accountList});
        delete from app.legal_document_version where version = ${sqlLiteral(`church-test-${suffix}`)};
      `);
    } catch {
      // The disposable local database is rebuilt before every CI integration run.
    }
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }
}
