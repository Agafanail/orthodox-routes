import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const supabaseCli = fileURLToPath(
  new URL('../node_modules/supabase/dist/supabase.js', import.meta.url),
);

const excludedServices = [
  'realtime',
  'storage-api',
  'imgproxy',
  'postgres-meta',
  'studio',
  'edge-runtime',
  'logflare',
  'vector',
  'supavisor',
].join(',');

function runSupabase(args, options = {}) {
  const result = spawnSync(process.execPath, [supabaseCli, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    ...options,
  });

  if (result.error) {
    throw new Error('The project Supabase CLI could not be started.');
  }

  return result;
}

function sanitizeCliFailure(value) {
  return value
    .split(/\r?\n/)
    .filter((line) => !/(SERVICE_ROLE|SECRET|ANON_KEY|PUBLISHABLE_KEY)=/i.test(line))
    .join('\n')
    .trim();
}

function parseStatusEnv(output) {
  const values = new Map();

  for (const line of output.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;

    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    values.set(match[1], value);
  }

  return values;
}

function updateLocalEnv(apiUrl, publicKey) {
  const path = '.env.local';
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const preserved = existing
    .split(/\r?\n/)
    .filter(
      (line) =>
        line &&
        !line.startsWith('NEXT_PUBLIC_SUPABASE_URL=') &&
        !line.startsWith('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=') &&
        !line.startsWith('ORTHODOX_ROUTES_APP_URL='),
    );

  const next = [
    ...preserved,
    `NEXT_PUBLIC_SUPABASE_URL=${apiUrl}`,
    `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${publicKey}`,
    'ORTHODOX_ROUTES_APP_URL=http://localhost:3000',
    '',
  ].join('\n');

  writeFileSync(path, next, { encoding: 'utf8', mode: 0o600 });
}

const start = runSupabase(['start', '--yes', '--exclude', excludedServices], {
  stdio: ['inherit', 'pipe', 'inherit'],
});

if (start.status !== 0) {
  const safeFailure = sanitizeCliFailure(start.stdout ?? '');
  if (safeFailure) process.stderr.write(`${safeFailure}\n`);
  process.exit(start.status ?? 1);
}

const status = runSupabase(['status', '--output', 'env']);
if (status.status !== 0) {
  process.stderr.write('Local Auth started, but its public connection values could not be read.\n');
  process.exit(status.status ?? 1);
}

const values = parseStatusEnv(status.stdout);
const apiUrl = values.get('API_URL');
const publicKey = values.get('PUBLISHABLE_KEY') ?? values.get('ANON_KEY');

if (!apiUrl || !publicKey) {
  process.stderr.write('Local Auth started, but the public URL or public key was missing.\n');
  process.exit(1);
}

updateLocalEnv(apiUrl, publicKey);

process.stdout.write(
  [
    'Local Auth is ready.',
    'Application environment: .env.local updated with public local values only.',
    'Mail catcher: http://127.0.0.1:54324',
  ].join('\n') + '\n',
);
