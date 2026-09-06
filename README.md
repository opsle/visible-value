# Visible Value

Deterministic validation and operator summaries for the Opsle Visible Value
Contract (`opsle.value-receipt.v1`). This is a small installable library and CLI,
not a task runner, profiler, service, or marketing score. It makes existing
mechanism receipts inspectable without inventing benefit.

Requires Node 22+. Install an immutable Git commit (the consuming application's
lockfile pins all transitive dependencies):

```sh
npm install @opsle/visible-value@github:opsle/visible-value#v0.1.0
npx visible-value summarize node_modules/@opsle/visible-value/examples/run.json
```

For standalone development: clone this repository, run `npm ci`, `npm test`, and
`npm run example`. For a global CLI use `npm install -g github:opsle/visible-value#v0.1.0`.
Tags name releases; pin a full commit SHA instead when enforcing immutability.

## Public interface

```js
import { summarize, formatSummary, formatIndicator } from '@opsle/visible-value';
const report = summarize({ schema: 'opsle.visible-value.input.v1', receipts });
console.log(formatSummary(report));
```

`validateReceipt(receipt)` returns a valid receipt or throws. `receiptIdentity`
returns its SHA-256 semantic identity, excluding `observed_at`. `canonicalJson`
sorts object keys. `summarize`, `formatSummary`, `formatIndicator`, and `VERSION`
are exported. Functions do not read Git, clocks, remote evidence, or environment
configuration. Input receipt order is retained and determines row order.

The CLI reads JSON from a file or stdin:

```sh
visible-value summarize run.json > report.json
visible-value validate receipt.json
cat run.json | visible-value summarize --quiet
```

Successful stdout is canonical newline-terminated JSON. One concise
`[Visible Value]` indicator goes to stderr; `--quiet` suppresses only that line.
Errors exit 1, emit `{ "error": "VISIBLE_VALUE_FAILED", "message": "..." }`
on stderr, and leave stdout empty. File, JSON, schema, identity, unsafe claim,
and unusable-output failures are explicit. CLI JSON input is limited to 10 MB
after reading; this is not a streaming or adversarial-input service.

## Inputs and outputs

Input has exactly `schema` and a nonempty `receipts` array. Receipts conform to
the included [canonical schema](schema/value-receipt-v1.schema.json), plus the
contract's semantic checks. Measurement classes, evidence trust, derivations,
limitations, and null identities remain intact. Exact claims must reference
evidence marked verified. Duplicate receipts or known operation identities are
rejected rather than double-counted. At least one displayable measurement is
required. Display strings have control characters stripped.

`opsle.visible-value.report.v1` contains the tool version, receipt identities,
unchanged source receipts, display rows, compatible totals, explicit aggregation
exclusions, and limitations. Save the report as the durable per-run artifact.
For cumulative summaries, combine receipts from distinct runs in one input.
Only declared SUM numeric EXACT/OBSERVED values can enter totals. Totals partition
by mechanism/version/revision, configuration/policy, operation name, measurement,
unit, class, direction, and trust. Unknown run/operation/revision/configuration
identities are displayed but excluded from totals. Mixed baseline forms fail.
Ratios, booleans, states, modeled and experimental values are never summed.

Missing measurements stay missing; numeric zero is never synthesized for them.
Signed expansion is valid. Estimates need methods and assumptions; monetary
estimates need measured token inputs. Experimental values need controlled
experiment identity and remain outside ordinary totals. This report is not
itself a claim of controlled evidence. Byte measurements cannot establish token,
cost, latency, causal savings, correctness, or failures prevented.

## Trust and scope

This validates receipt claims and summarizes producer-supplied evidence. It does
not independently authenticate artifacts, verify hashes against external files,
or prove that a caller labeled a measurement honestly. Relative JSON pointers
refer to the producer's canonical artifact. Keep those artifacts beside the
receipt. A receipt marked VERIFIED is not an attestation from Visible Value.
No telemetry is sent anywhere and no models are called.

The normative definition comes from `opsle/research`'s
`program/VISIBLE_VALUE_CONTRACT.md` (introduced at `84c5529`). This repository
implements its reusable receipt validation and reporting layer; mechanism
execution and evidence production remain with each mechanism. Consumers decide
whether reporting failure blocks their work; Opsle Tasks blocks completion.
