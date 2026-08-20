import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

const supabaseCli = fileURLToPath(
  new URL('../node_modules/supabase/dist/supabase.js', import.meta.url),
);

function fail(message) {
  throw new Error(message);
}

function readLocalPublicConfig() {
  const status = spawnSync(process.execPath, [supabaseCli, 'status', '--output', 'env'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });

  if (status.status !== 0) fail('Local Auth is not running.');

  const values = new Map();
  for (const line of status.stdout.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    const value = match[2].replace(/^"|"$/g, '');
    values.set(match[1], value);
  }

  const url = values.get('API_URL');
  const key = values.get('PUBLISHABLE_KEY') ?? values.get('ANON_KEY');
  const mailpitUrl = values.get('MAILPIT_URL') ?? 'http://127.0.0.1:54324';

  if (!url || !key) fail('Local public Auth configuration is unavailable.');
  return { key, mailpitUrl, url };
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

async function readLatestEmail(mailpitUrl, email) {
  const deadline = Date.now() + 15_000;
  const query = encodeURIComponent(`to:${email}`);

  while (Date.now() < deadline) {
    const response = await fetch(`${mailpitUrl}/view/latest.html?query=${query}`);
    if (response.ok) return response.text();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  fail('The local email catcher did not receive the synthetic sign-in email.');
}

function extractConfirmationLink(html) {
  const href = /href=["']([^"']*\/auth\/confirm#[^"']+)["']/i.exec(html)?.[1];
  if (!href) fail('The captured email does not contain the application confirmation link.');
  return href.replaceAll('&amp;', '&');
}

const { key, mailpitUrl, url } = readLocalPublicConfig();
const email = `codex-auth-${Date.now()}@example.test`;
const requestClient = createClient(url, key, {
  auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
});

const requestResult = await requestClient.auth.signInWithOtp({
  email,
  options: {
    emailRedirectTo: 'http://localhost:3000/auth/confirm#flow=login',
    shouldCreateUser: true,
  },
});
if (requestResult.error) fail('The local passwordless email request failed.');
if (requestResult.data.session) fail('Requesting a link unexpectedly created a session.');

const repeatedRequestResult = await requestClient.auth.signInWithOtp({
  email,
  options: {
    emailRedirectTo: 'http://localhost:3000/auth/confirm#flow=login',
    shouldCreateUser: true,
  },
});
if (
  repeatedRequestResult.error?.status !== 429 ||
  repeatedRequestResult.error?.code !== 'over_email_send_rate_limit'
) {
  fail('The local repeated-email request did not return the expected structured throttle signal.');
}

const emailHtml = await readLatestEmail(mailpitUrl, email);
const link = new URL(extractConfirmationLink(emailHtml));

if (link.origin !== 'http://localhost:3000' || link.pathname !== '/auth/confirm') {
  fail('The email link does not target the Orthodox Routes confirmation page.');
}
if (link.search) {
  fail('The confirmation link has unsafe or unexpected parameters.');
}

const confirmationParameters = new URLSearchParams(link.hash.slice(1));
if (
  confirmationParameters.get('flow') !== 'login'
  || confirmationParameters.get('type') !== 'email'
  || confirmationParameters.has('next')
) {
  fail('The confirmation link fragment has unsafe or unexpected parameters.');
}

const tokenHash = confirmationParameters.get('token_hash');
if (!tokenHash) fail('The confirmation link is missing its one-time token hash.');

const cookies = new Map();
const confirmationClient = createCookieClient(url, key, cookies);
const confirmationResult = await confirmationClient.auth.verifyOtp({
  token_hash: tokenHash,
  type: 'email',
});
if (confirmationResult.error) fail('Explicit token verification failed.');
if (cookies.size === 0) fail('Explicit verification did not establish cookie storage.');

const reloadClient = createCookieClient(url, key, cookies);
const reloadIdentity = await reloadClient.auth.getClaims();
if (reloadIdentity.error || reloadIdentity.data?.claims?.email !== email) {
  fail('A new server request could not verify the cookie-backed identity.');
}

const signOutResult = await reloadClient.auth.signOut({ scope: 'local' });
if (signOutResult.error) fail('Local-session sign-out failed.');

const signedOutClient = createCookieClient(url, key, cookies);
const signedOutIdentity = await signedOutClient.auth.getClaims();
if (!signedOutIdentity.error && signedOutIdentity.data?.claims) {
  fail('The signed-out cookie storage still resolves an authenticated identity.');
}

process.stdout.write(
  [
    'Local Auth integration verification passed:',
    '- synthetic passwordless email captured locally',
    '- repeated email request returns the structured local throttle signal',
    '- application confirmation link uses a token hash',
    '- no session exists before explicit verification',
    '- cookie-backed identity survives a new server client request',
    '- current-session sign-out removes authenticated identity',
  ].join('\n') + '\n',
);
