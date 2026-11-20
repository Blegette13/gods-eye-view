import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Land-development-only fast regression gate. Does NOT weaken the complete
 * npm test release gate, which also checks the inherited God’s Eye overlays.
 *
 * This discovers every .test.mjs in src/bdp (including this runner’s tests),
 * rather than hand-picking a few passing cases. The full suite is still
 * mandatory before a release, especially memory/performance tests.
 */
export function discoverLandTestFiles(root = process.cwd()) {
  const base = path.join(root, 'src', 'bdp');
  const tests = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        visit(path.join(dir, entry.name));
      } else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
        tests.push(path.relative(root, path.join(dir, entry.name)).split(path.sep).join('/'));
      }
    }
  };
  visit(base);
  return tests.sort();
}

export function landTestArgs(files) {
  if (!Array.isArray(files) || files.length === 0 || files.some((item) =>
    typeof item !== 'string' || !/^src\/bdp\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.test\.mjs$/.test(item))) {
    throw new TypeError('Expected discovered land-development test paths only');
  }
  return ['--test', '--test-concurrency=2', ...files];
}

export function runLandTests(root = process.cwd()) {
  const tests = discoverLandTestFiles(root);
  const result = spawnSync(process.execPath, landTestArgs(tests), {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const cli = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === cli) process.exitCode = runLandTests();
