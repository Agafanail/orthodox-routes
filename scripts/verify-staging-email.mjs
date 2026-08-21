import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

const supabaseCli = fileURLToPath(
  new URL('../node_modules/supabase/dist/supabase.js', import.meta.url),
);
const projectRefPath = fileURLToPath(new URL('../supabase/.temp/project-ref', import.meta.url));
const expectedProjectName = 'orthodox-routes-staging';
const stagingAppOrigin = 'https://orthodox-routes-staging.onrender.com';

function fail(message) {
  throw new Error(message);
}

function runCli(args) {
  const result = spawnSync(process.execPath, [supabaseCli, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
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
  const publicKey = keys.find((key) => key.type === 'publishable')?.api_key
    ?? keys.find((key) => key.name === 'anon')?.api_key;
  const secretKey = keys.find((key) => key.type === 'secret')?.api_key
    ?? keys.find((key) => key.name === 'service_role')?.api_key;
  if (!publicKey || !secretKey) fail('Required staging API keys are unavailable.');

  return { publicKey, secretKey, url: `https://${projectRef}.supabase.co` };
}

function createCookieClient(url, key, jar) {
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return [...jar.entries()].map(([name, entry]) => ({ name, value: entry.value }));
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          if (value === '' || options?.maxAge === 0) jar.delete(name);
          else jar.set(name, { options, value });
        }
      },
    },
  });
}

async function findUserByEmail(admin, email) {
  let page = 1;
  while (true) {
    const listed = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (listed.error) fail('Staging Auth users could not be inspected safely.');
    const match = listed.data.users.find((user) => user.email === email);
    if (match || listed.data.users.length < 1000) return match ?? null;
    page += 1;
  }
}

function parseConfirmationLink(rawLink) {
  let link;
  try {
    link = new URL(rawLink);
  } catch {
    fail('The supplied email confirmation link is invalid.');
  }

  if (link.origin !== stagingAppOrigin || link.pathname !== '/auth/confirm' || link.search) {
    fail('The email link does not target the safe staging confirmation route.');
  }

  const parameters = new URLSearchParams(link.hash.slice(1));
  if (
    parameters.get('flow') !== 'login'
    || parameters.get('type') !== 'email'
    || parameters.has('next')
  ) {
    fail('The confirmation link fragment has unsafe or unexpected parameters.');
  }

  const tokenHash = parameters.get('token_hash');
  if (!/^[A-Za-z0-9_-]{32,1024}$/.test(tokenHash ?? '')) {
    fail('The confirmation link is missing a valid one-time token hash.');
  }
  return { link, tokenHash };
}

const input = createInterface({ input: process.stdin, terminal: false });
const { publicKey, secretKey, url } = readStagingConfiguration();
const recipient = (await input.question('')).trim();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient) || recipient.length > 254) {
  fail('A valid staging recipient must be supplied through standard input.');
}

const admin = createClient(url, secretKey, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});
const requestClient = createClient(url, publicKey, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});

const existingUser = await findUserByEmail(admin, recipient);

let cleanupUserId = null;
try {
  const requestResult = await requestClient.auth.signInWithOtp({
    email: recipient,
    options: {
      emailRedirectTo: `${stagingAppOrigin}/auth/confirm#flow=login`,
      shouldCreateUser: true,
    },
  });
  if (requestResult.error) fail('The staging passwordless email request failed.');
  if (requestResult.data.session) fail('Requesting the staging link unexpectedly created a session.');
  if (!existingUser) {
    for (let attempt = 0; attempt < 10 && !cleanupUserId; attempt += 1) {
      cleanupUserId = (await findUserByEmail(admin, recipient))?.id ?? null;
      if (!cleanupUserId) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!cleanupUserId) fail('The new staging Auth identity could not be tracked for cleanup.');
  }

  process.stdout.write('STAGING_EMAIL_REQUESTED\n');
  const rawLink = (await input.question('')).trim();
  input.close();
  const { link, tokenHash } = parseConfirmationLink(rawLink);

  const callbackResponse = await fetch(`${link.origin}${link.pathname}`, {
    headers: { 'cache-control': 'no-cache' },
    redirect: 'manual',
  });
  assert.equal(callbackResponse.status, 200);
  const callbackHtml = await callbackResponse.text();
  assert.equal(callbackHtml.includes('Проверяем ссылку'), true);

  const preConfirmationIdentity = await requestClient.auth.getClaims();
  assert.equal(Boolean(preConfirmationIdentity.data?.claims), false);

  const cookies = new Map();
  const confirmationClient = createCookieClient(url, publicKey, cookies);
  const confirmationResult = await confirmationClient.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'email',
  });
  if (confirmationResult.error || !confirmationResult.data.user) {
    fail('Explicit staging token verification failed.');
  }
  if (cleanupUserId && confirmationResult.data.user.id !== cleanupUserId) {
    fail('The verified staging identity does not match the tracked synthetic identity.');
  }
  if (cookies.size === 0) fail('Explicit staging verification did not establish cookie storage.');

  const reloadClient = createCookieClient(url, publicKey, cookies);
  const reloadIdentity = await reloadClient.auth.getClaims();
  if (reloadIdentity.error || reloadIdentity.data?.claims?.email !== recipient) {
    fail('A new server client could not verify the staging cookie-backed identity.');
  }

  const signOutResult = await reloadClient.auth.signOut({ scope: 'local' });
  if (signOutResult.error) fail('Staging current-session sign-out failed.');
  const signedOutClient = createCookieClient(url, publicKey, cookies);
  const signedOutIdentity = await signedOutClient.auth.getClaims();
  if (!signedOutIdentity.error && signedOutIdentity.data?.claims) {
    fail('Signed-out staging cookie storage still resolves an authenticated identity.');
  }

  process.stdout.write(
    [
      'Staging passwordless email verification passed:',
      '- the configured external SMTP provider delivered a real sign-in email',
      '- the email link targets the staging application confirmation route',
      '- a callback GET does not establish or consume the session token',
      '- explicit token verification establishes cookie-backed server identity',
      '- current-session sign-out removes authenticated identity',
    ].join('\n') + '\n',
  );
} finally {
  input.close();
  if (cleanupUserId) {
    const deleted = await admin.auth.admin.deleteUser(cleanupUserId);
    if (deleted.error) fail('The synthetic staging Auth identity could not be removed.');
    process.stdout.write('- the synthetic staging Auth identity was removed\n');
  }
}
