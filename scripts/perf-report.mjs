// Compares build/reports/perf.json with perf-budget.json. Exit 1 if a value exceeds its budget by > 10 %.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const perfPath = `${root}build/reports/perf.json`;
const budgetPath = `${root}perf-budget.json`;
const tolerance = 1.1;

if (!existsSync(perfPath)) {
  console.log(`perf-report: ${perfPath} not found, nothing to compare.`);
  process.exit(0);
}

/*
 * perf.json format: { "<metric key>": <number>, ... } with the keys and units of
 * perf-budget.json. Unknown keys are reported but do not fail the check.
 */
const perf = JSON.parse(readFileSync(perfPath, 'utf8'));
const budget = JSON.parse(readFileSync(budgetPath, 'utf8')).metrics;

let failed = 0;
for (const [key, value] of Object.entries(perf)) {
  const entry = budget[key];
  if (!entry) {
    console.log(`?    ${key} = ${value} (not in perf-budget.json)`);
    continue;
  }
  if (typeof value !== 'number') {
    console.log(`FAIL ${key} = ${JSON.stringify(value)} (not a number)`);
    failed++;
    continue;
  }
  if (entry.budget === null) {
    console.log(`-    ${key} = ${value} ${entry.unit} (no target)`);
  } else if (value > entry.budget * tolerance) {
    console.log(`FAIL ${key} = ${value} ${entry.unit} > ${entry.budget} ${entry.unit} + 10 %`);
    failed++;
  } else {
    console.log(`ok   ${key} = ${value} ${entry.unit} (budget ${entry.budget})`);
  }
}

if (failed > 0) {
  console.log(`perf-report: ${failed} metric(s) over budget.`);
  process.exit(1);
}
console.log('perf-report: all measured metrics within budget.');
