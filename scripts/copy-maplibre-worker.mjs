// Publishes the MapLibre worker, and the module it imports, as a matched pair.
//
// MapLibre runs tile parsing in a module worker. The bundler emits that worker as a plain
// static asset, but the worker's own `import './maplibre-gl-shared.mjs'` is left as a relative
// specifier, and nothing emits a sibling by that name. The browser then fetches an address that
// does not exist, refuses the reply because it is not JavaScript, and the worker never starts.
// Everything else still works, which is why the result is a map that draws its container, its
// controls, and its credit line, and then stays completely empty.
//
// Copying both files into one public directory makes the relative import resolve. They are
// copied from the installed package at build time rather than committed, so the pair can never
// drift from the version the application actually bundles.

import { copyFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const source = join(root, 'node_modules', 'maplibre-gl', 'dist');
const destination = join(root, 'public', 'maplibre');

/** The worker plus every module it imports relatively, which must land beside it. */
const WORKER = 'maplibre-gl-worker.mjs';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const workerPath = join(source, WORKER);
try {
  statSync(workerPath);
} catch {
  fail(`The MapLibre worker is missing from ${source}. Run npm ci first.`);
}

// Read the relative specifiers out of the worker rather than hard-coding a list, so that an
// upgrade which splits the worker differently fails loudly here instead of silently at runtime.
const workerSource = readFileSync(workerPath, 'utf8');
const siblings = [...workerSource.matchAll(/from\s*["']\.\/([\w.-]+\.mjs)["']/g)].map((match) => match[1]);

mkdirSync(destination, { recursive: true });
for (const file of [WORKER, ...new Set(siblings)]) {
  try {
    copyFileSync(join(source, file), join(destination, file));
  } catch {
    fail(`MapLibre worker dependency ${file} could not be copied from ${source}.`);
  }
}

process.stdout.write(`MapLibre worker published with ${siblings.length} sibling module(s).\n`);
