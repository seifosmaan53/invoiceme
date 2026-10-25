#!/usr/bin/env node
/*
 * Lint gate against a recorded baseline of existing findings.
 *
 *   node scripts/lint-baseline.js            check (CI: npm run lint:ci)
 *   node scripts/lint-baseline.js --update   rewrite the baseline
 *
 * Lints src/ and test/ with the repository's .eslintrc.js and compares the
 * number of findings per file and rule with scripts/lint-baseline.json. It
 * fails (exit 1) when any file has more findings for a rule than recorded, so
 * new files must be clean and changed files may not add findings. It does not
 * mean the recorded files are clean: the baseline lists the existing debt.
 * When a count drops it says so; run --update to lock in the improvement.
 * Exit 2: ESLint could not run.
 */
const fs = require('fs');
const path = require('path');
const { ESLint } = require('eslint');

const root = path.resolve(__dirname, '..');
const baselineFile = path.join(__dirname, 'lint-baseline.json');
const update = process.argv.includes('--update');

async function main() {
  const eslint = new ESLint({ cwd: root });
  const results = await eslint.lintFiles(['src/**/*.ts', 'test/**/*.ts']);

  const counts = {};
  let fatal = 0;
  for (const r of results) {
    const file = path.relative(root, r.filePath).split(path.sep).join('/');
    for (const m of r.messages) {
      if (m.fatal) fatal++;
      const rule = m.ruleId || 'parse-error';
      counts[file] = counts[file] || {};
      counts[file][rule] = (counts[file][rule] || 0) + 1;
    }
  }

  if (update) {
    const sorted = {};
    for (const f of Object.keys(counts).sort()) sorted[f] = counts[f];
    fs.writeFileSync(baselineFile, JSON.stringify(sorted, null, 2) + '\n');
    console.log(`Baseline written: ${total(sorted)} findings in ${Object.keys(sorted).length} files.`);
    return 0;
  }

  const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
  const increased = [];
  const decreased = [];
  for (const file of new Set([...Object.keys(counts), ...Object.keys(baseline)])) {
    const now = counts[file] || {};
    const before = baseline[file] || {};
    for (const rule of new Set([...Object.keys(now), ...Object.keys(before)])) {
      const a = before[rule] || 0;
      const b = now[rule] || 0;
      if (b > a) increased.push({ file, rule, a, b });
      else if (b < a) decreased.push({ file, rule, a, b });
    }
  }

  console.log(`${results.length} files linted: ${total(counts)} findings, baseline ${total(baseline)}.`);
  for (const d of decreased) console.log(`  improved: ${d.file} ${d.rule} ${d.a} -> ${d.b}`);
  if (decreased.length) console.log('  Run `npm run lint:baseline` to lower the baseline.');
  if (increased.length) {
    console.error('New lint findings (above the recorded baseline):');
    for (const i of increased) console.error(`  ${i.file} ${i.rule}: ${i.a} -> ${i.b}`);
    const formatter = await eslint.loadFormatter('stylish');
    const files = new Set(increased.map((i) => i.file));
    console.error(formatter.format(results.filter((r) => files.has(path.relative(root, r.filePath).split(path.sep).join('/')))));
    return 1;
  }
  if (fatal) {
    console.error(`${fatal} parse error(s); see npm run lint.`);
    return 1;
  }
  console.log('No findings above the baseline.');
  return 0;
}

function total(counts) {
  return Object.values(counts).reduce((s, rules) => s + Object.values(rules).reduce((x, y) => x + y, 0), 0);
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(2);
  },
);
