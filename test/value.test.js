import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { summarize, validateReceipt, receiptIdentity } from '../src/index.js';

const fixture = () => JSON.parse(readFileSync(new URL('../examples/run.json', import.meta.url)));
test('summarizes a receipt with signed expansion and no causal savings', () => {
  const report = summarize(fixture());
  assert.equal(report.totals[0].delta, 10);
  assert.equal(report.rows[0].measurement.class, 'EXACT');
  assert.ok(report.limitations.some(s => s.includes('causality')));
});
test('enforces evidence trust, deltas, identity, and claim ceilings', () => {
  for (const mutate of [
    r => r.measurements[0].delta = 999,
    r => r.evidence[0].trust = 'UNVERIFIED',
    r => r.measurements[0].id = 'failures_prevented',
    r => r.measurements[0].evidence_refs = ['missing'],
    r => r.measurements[0].result = -1,
    r => r.measurements[0].aggregation.method = null,
    r => r.measurements[0].class = 'MODELED',
    r => r.measurements[0].class = 'EXPERIMENTAL',
    r => r.measurements[0].result = Infinity,
  ]) {
    const r = fixture().receipts[0]; mutate(r);
    assert.throws(() => validateReceipt(r));
  }
});
test('clock is outside identity and duplicate operations fail closed', () => {
  const input = fixture(); const r = structuredClone(input.receipts[0]);
  r.observed_at = '2026-09-06T12:00:00Z';
  assert.equal(receiptIdentity(r), receiptIdentity(input.receipts[0]));
  input.receipts.push(r);
  assert.throws(() => summarize(input), /Duplicate receipt/);
  r.measurements[0].result += 1; r.measurements[0].delta += 1;
  assert.throws(() => summarize(input), /Duplicate operation/);
});
test('compatible runs sum and different revisions and trust partition totals', () => {
  const input = fixture(); const r = structuredClone(input.receipts[0]);
  r.run.id = 'run-002'; input.receipts.push(r);
  assert.equal(summarize(input).totals[0].result, 60);
  r.mechanism.revision = 'revision-b';
  assert.equal(summarize(input).totals.length, 2);
  r.mechanism.revision = input.receipts[0].mechanism.revision;
  r.measurements[0].class = 'OBSERVED'; r.evidence[0].trust = 'OBSERVED';
  r.measurements[0].source_verification = 'OBSERVED';
  assert.equal(summarize(input).totals.length, 2);
});
test('unknown identities remain unknown and excluded, missing is not zero', () => {
  const input = fixture(); input.receipts[0].run.id = null;
  const report = summarize(input);
  assert.equal(report.totals.length, 0);
  assert.match(report.excluded_from_aggregation[0].reason, /Missing run/);
  const m = input.receipts[0].measurements[0];
  m.result = null; m.baseline = null; m.delta = null;
  m.aggregation = { safe: false, method: null };
  assert.equal(summarize(input).rows[0].measurement.result, null);
});
test('ratios cannot sum; mixed baselines and overflow fail', () => {
  const input = fixture(); const r = structuredClone(input.receipts[0]);
  r.run.id = 'run-002'; input.receipts.push(r);
  r.measurements[0].baseline = null; r.measurements[0].delta = null;
  assert.throws(() => summarize(input), /Mixed result-only/);
  r.measurements[0].unit = 'ratio';
  assert.throws(() => summarize(input), /Unsafe aggregation/);
});
test('CLI channels are separate and failures never print success', () => {
  const cli = new URL('../bin/visible-value.js', import.meta.url).pathname;
  const result = spawnSync(process.execPath, [cli, 'summarize'], { input: JSON.stringify(fixture()), encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).schema, 'opsle.visible-value.report.v1');
  assert.match(result.stderr, /^\[Visible Value\]/);
  const quiet = spawnSync(process.execPath, [cli, 'summarize', '--quiet'], { input: JSON.stringify(fixture()), encoding: 'utf8' });
  assert.equal(quiet.stdout, result.stdout); assert.equal(quiet.stderr, '');
  for (const input of ['{bad', JSON.stringify({ schema: 'opsle.visible-value.input.v1', receipts: [] })]) {
    const fail = spawnSync(process.execPath, [cli, 'summarize'], { input, encoding: 'utf8' });
    assert.equal(fail.status, 1); assert.equal(fail.stdout, '');
    assert.equal(JSON.parse(fail.stderr).error, 'VISIBLE_VALUE_FAILED');
  }
});
