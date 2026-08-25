import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

export default function globalSetup() {
  const fixturePath = resolve('test-results/core-e2e-fixture.json');
  const prepared = spawnSync(process.execPath, ['scripts/prepare-core-browser-e2e.mjs'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      CORE_E2E_APP_ORIGIN: 'http://127.0.0.1:3000',
      CORE_E2E_FIXTURE_PATH: fixturePath,
    },
  });

  if (prepared.status !== 0) {
    const detail = prepared.stderr.trim();
    throw new Error(detail || 'Core browser fixture preparation failed. Run npm run auth:start and npm run db:reset first.');
  }
}
