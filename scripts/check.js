// "Build" step for a project with no compiler: syntax-check every source file.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const roots = ['server', 'public/js', 'tests', 'scripts'];
const files = roots.flatMap((dir) =>
  readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => path.join(dir, f)));

let failed = 0;
for (const file of files) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed += 1;
    console.error(r.stderr);
  }
}
console.log(`${files.length - failed}/${files.length} files OK`);
process.exit(failed ? 1 : 0);
