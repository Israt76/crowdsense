// Runs the full test suite and writes results/test-summary.json (shown on the demo's results card).
import { spawnSync } from 'node:child_process';
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';

const files = readdirSync('test').filter((f) => f.endsWith('.test.js')).map((f) => `test/${f}`);
const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...files], { encoding: 'utf8' });
process.stdout.write(r.stdout);
process.stderr.write(r.stderr);
const num = (k) => Number((new RegExp(`ℹ ${k} (\\d+)`).exec(r.stdout) || [])[1] || 0);
const summary = { tests: num('tests'), pass: num('pass'), fail: num('fail'), files: files.length, node: process.version };
mkdirSync('results', { recursive: true });
writeFileSync('results/test-summary.json', JSON.stringify(summary, null, 2));
console.log(`\nSummary: ${summary.pass}/${summary.tests} passed, ${summary.fail} failed (written to results/test-summary.json)`);
process.exit(r.status ?? 1);
