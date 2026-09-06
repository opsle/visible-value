import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export const VERSION = '0.1.0';
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const structure = ajv.compile(JSON.parse(readFileSync(new URL('../schema/value-receipt-v1.schema.json', import.meta.url))));
const numeric = value => typeof value === 'number' && Number.isFinite(value);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const clean = text => String(text).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').slice(0, 500);

export function canonicalJson(value) {
  return JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}

export function validateReceipt(receipt) {
  assert(structure(receipt), `Invalid receipt: ${ajv.errorsText(structure.errors)}`);
  const evidence = new Map(receipt.evidence.map(item => [item.id, item]));
  const measurements = new Map(receipt.measurements.map(item => [item.id, item]));
  assert(evidence.size === receipt.evidence.length, 'Duplicate evidence identity');
  assert(measurements.size === receipt.measurements.length, 'Duplicate measurement identity');
  for (const e of receipt.evidence) {
    assert(e.kind !== 'CONTENT_HASH' || /^sha256:[a-f0-9]{64}$/.test(e.locator), 'Invalid content hash');
  }
  for (const m of receipt.measurements) {
    const fail = message => `${m.id}: ${message}`;
    assert(m.evidence_refs.every(ref => evidence.has(ref)), fail('Unresolved evidence reference'));
    for (const field of ['baseline', 'result', 'delta']) {
      assert(typeof m[field] !== 'number' || numeric(m[field]), fail('Non-finite measurement'));
    }
    if (numeric(m.baseline) && numeric(m.result)) {
      assert(numeric(m.delta) && Math.abs(m.delta - (m.result - m.baseline)) <= 1e-12, fail('Delta must equal result minus baseline'));
    } else assert(m.delta === null, fail('Delta requires numeric baseline and result'));
    if (['byte', 'event', 'count', 'token', 'millisecond'].includes(m.unit)) {
      assert([m.baseline, m.result].every(v => v === null || (Number.isSafeInteger(v) && v >= 0)), fail('Nonnegative safe integer required'));
    }
    if (['boolean', 'state'].includes(m.unit)) {
      assert([m.baseline, m.result].every(v => v === null || typeof v === (m.unit === 'state' ? 'string' : 'boolean')), fail('Wrong value type for unit'));
    }
    if (m.class === 'EXACT') {
      assert(m.source_verification === 'VERIFIED' && m.evidence_refs.every(ref => evidence.get(ref).trust === 'VERIFIED'), fail('EXACT requires verified evidence'));
    }
    if (['EXACT', 'OBSERVED'].includes(m.class)) {
      assert(!m.derivation?.assumptions.length, fail('Exact or observed values cannot depend on assumptions'));
      assert(!/failures?_prevented/.test(m.id), fail('Prevented failure is a counterfactual claim'));
    }
    if (['ESTIMATED', 'MODELED'].includes(m.class)) {
      assert(m.derivation?.method && m.derivation.assumptions.length, fail('Method and assumptions required'));
      if (m.unit === 'usd') {
        assert(m.derivation.input_measurement_ids.some(id => measurements.get(id)?.unit === 'token'
          && ['EXACT', 'OBSERVED'].includes(measurements.get(id).class) && numeric(measurements.get(id).result)), fail('Monetary estimate requires measured tokens'));
      }
    }
    if (m.derivation) assert(m.derivation.input_measurement_ids.every(id => measurements.has(id)), fail('Unresolved derivation input'));
    if (m.class === 'EXPERIMENTAL') assert(m.derivation?.experiment_id && m.derivation.comparability === 'CONTROLLED', fail('Controlled experiment identity required'));
    assert(!m.aggregation.safe || (['EXACT', 'OBSERVED'].includes(m.class) && numeric(m.result)
      && !['ratio', 'percent', 'boolean', 'state'].includes(m.unit) && m.aggregation.method === 'SUM'), fail('Unsafe aggregation'));
    assert(m.aggregation.safe || m.aggregation.method === null, fail('Unsafe measurement must have null aggregation method'));
  }
  return receipt;
}

// observed_at is display-only. Never derive identities from time, random data or Git.
export function receiptIdentity(receipt) {
  validateReceipt(receipt);
  const { observed_at, ...semantic } = receipt;
  return `sha256:${createHash('sha256').update(canonicalJson(semantic)).digest('hex')}`;
}

export function summarize(input) {
  assert(input && input.schema === 'opsle.visible-value.input.v1', 'Unsupported input schema');
  assert(Array.isArray(input.receipts) && input.receipts.length > 0, 'At least one receipt is required');
  assert(Object.keys(input).every(k => ['schema', 'receipts'].includes(k)), 'Unknown input field');
  const identities = new Set(); const operations = new Set(); const totals = new Map();
  const rows = []; const excluded = [];
  for (const receipt of input.receipts) {
    const identity = receiptIdentity(receipt);
    assert(!identities.has(identity), 'Duplicate receipt'); identities.add(identity);
    const operationKey = canonicalJson([receipt.mechanism.id, receipt.run.id, receipt.operation.id]);
    if (receipt.run.id !== null && receipt.operation.id !== null) {
      assert(!operations.has(operationKey), 'Duplicate operation identity'); operations.add(operationKey);
    }
    for (const m of receipt.measurements) {
      const row = { receipt_id: identity, mechanism: receipt.mechanism, run: receipt.run,
        operation: receipt.operation, measurement: m,
        evidence: receipt.evidence.filter(e => m.evidence_refs.includes(e.id)), limitations: receipt.limitations };
      if (m.operator_display) rows.push(row);
      let reason = null;
      if (!m.aggregation.safe) reason = 'Not declared safely summable';
      else if (receipt.run.id === null || receipt.operation.id === null) reason = 'Missing run or operation identity; cannot deduplicate';
      else if (!receipt.mechanism.revision || !receipt.operation.configuration_id) reason = 'Unknown revision or configuration; compatibility unproven';
      if (reason) { excluded.push({ ...row, reason }); continue; }
      const group = { mechanism: receipt.mechanism, configuration_id: receipt.operation.configuration_id,
        policy_id: receipt.operation.policy_id, operation: receipt.operation.name,
        measurement_id: m.id, unit: m.unit, class: m.class, direction: m.direction,
        source_verification: m.source_verification,
        evidence_trust: [...new Set(row.evidence.map(e => e.trust))].sort() };
      const key = canonicalJson(group);
      const deltaBearing = numeric(m.baseline) && numeric(m.delta);
      assert(m.baseline === null || deltaBearing, 'Cannot aggregate nonnumeric baseline');
      if (!totals.has(key)) totals.set(key, { ...group, baseline: deltaBearing ? 0 : null,
        result: 0, delta: deltaBearing ? 0 : null, receipt_ids: [] });
      const total = totals.get(key);
      assert((total.baseline !== null) === deltaBearing, 'Mixed result-only and delta-bearing measurements');
      for (const field of ['baseline', 'result', 'delta']) {
        if (total[field] !== null) {
          total[field] += m[field];
          assert(Number.isFinite(total[field]) && Math.abs(total[field]) <= Number.MAX_SAFE_INTEGER, 'Aggregate overflow');
        }
      }
      total.receipt_ids.push(identity);
    }
  }
  assert(rows.length > 0, 'No operator-displayable measurements');
  return { schema: 'opsle.visible-value.report.v1', tool: { name: '@opsle/visible-value', version: VERSION },
    receipt_ids: [...identities], receipts: input.receipts, rows,
    totals: [...totals.values()], excluded_from_aggregation: excluded,
    limitations: ['Receipt evidence trust is asserted by its producer; external artifacts are not fetched or authenticated.',
      'Summaries do not establish causality, savings, correctness, or task success. Missing observations remain unavailable.'] };
}

export function formatSummary(report) {
  assert(report?.schema === 'opsle.visible-value.report.v1' && report.rows?.length, 'Unusable value report');
  return ['Opsle Value', ...report.rows.map(row => {
    const m = row.measurement;
    const delta = m.delta === null ? '' : `; delta ${m.delta}`;
    return `${clean(row.mechanism.name)} ran (${clean(row.operation.name)}): ${clean(m.id)} = ${m.result === null ? 'unavailable' : clean(m.result)} ${m.unit}${delta} [${m.class}].`;
  })].join('\n');
}

export function formatIndicator(report) {
  assert(report?.schema === 'opsle.visible-value.report.v1' && report.rows?.length, 'Unusable value report');
  return `[Visible Value] ${report.receipts.length} receipts validated | ${report.rows.length} visible measurements | ${report.totals.length} safe totals`;
}
