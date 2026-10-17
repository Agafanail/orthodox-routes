import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isSafePublicSupabaseKey, isSafeServerSupabaseKey } from '../src/lib/supabase/config';

// Non-secret allowlist for the existing synthetic-only project; never follow an arbitrary linked project.
export const IMAGE_STAGING_REF = 'jaxcbpzhzxuoszlfohbe';
const PROJECT_NAME = 'orthodox-routes-staging';
type Dependencies = { readLinkedRef(): string; runCli(args: string[]): string };
const unavailable = () => new Error('The pinned isolated staging image project is unavailable or misconfigured.');
function records(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) throw unavailable();
  return value as Array<Record<string, unknown>>;
}
function key(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\s\u0000-\u001f\u007f]/.test(value);
}
export function readStagingImageConfig(dependencies: Dependencies = {
  readLinkedRef: () => readFileSync(new URL('../supabase/.temp/project-ref', import.meta.url), 'utf8'),
  runCli: (args) => {
    const cli = fileURLToPath(new URL('../node_modules/supabase/dist/supabase.js', import.meta.url));
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', windowsHide: true,
      timeout: 15_000, maxBuffer: 2 * 1024 * 1024 });
    if (result.status !== 0) throw unavailable();
    return result.stdout;
  },
}) {
  try {
    if (dependencies.readLinkedRef().trim() !== IMAGE_STAGING_REF) throw unavailable();
    const projects = records(JSON.parse(dependencies.runCli(['projects', 'list', '--output', 'json'])));
    const project = projects.find((item) => (item.id ?? item.ref) === IMAGE_STAGING_REF);
    if (!project || project.name !== PROJECT_NAME || project.status !== 'ACTIVE_HEALTHY') throw unavailable();
    // Retrieve keys only after both the immutable reference and current project metadata match.
    const keys = records(JSON.parse(dependencies.runCli(['projects', 'api-keys', '--project-ref', IMAGE_STAGING_REF,
      '--reveal', '--output', 'json'])));
    const publicKey = keys.find((item) => item.type === 'publishable')?.api_key
      ?? keys.find((item) => item.name === 'anon')?.api_key;
    const secretKey = keys.find((item) => item.type === 'secret')?.api_key
      ?? keys.find((item) => item.name === 'service_role')?.api_key;
    if (!key(publicKey) || !key(secretKey) || !isSafePublicSupabaseKey(publicKey) || !isSafeServerSupabaseKey(secretKey)) throw unavailable();
    return { publicKey, secretKey, url: `https://${IMAGE_STAGING_REF}.supabase.co` };
  } catch { throw unavailable(); } // Never echo CLI output, provider bodies, keys, or authentication errors.
}
