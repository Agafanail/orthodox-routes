import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

export default function globalTeardown() {
  rmSync(resolve('test-results/core-e2e-fixture.json'), { force: true });
}
