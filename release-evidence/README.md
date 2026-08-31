# Release evidence contract

This directory contains the schema/template for immutable release evidence. Generated artifacts belong under the ignored `artifacts/release-evidence/` directory and are uploaded by `release-evidence.yml`; generated runtime evidence is never committed as source.

Rules:

- Every `verified` gate must name the exact 40-character commit SHA and at least one artifact that is included and SHA-256 hashed by the manifest.
- A URL, operator statement, old build or test file alone is not verification.
- `attached` means an artifact exists but has not passed its documented review criteria.
- `missing` is the default for provider, store and real-device evidence.
- A dirty checkout or any required gate below `verified` makes the generated decision `NO-GO`.

Generate locally (the result remains `NO-GO` while the tree or claims are incomplete):

```powershell
$sha = git rev-parse HEAD
node scripts/release/generate-evidence-manifest.mjs `
  --expected-sha $sha `
  --claims release-evidence/evidence-status.json `
  --artifact-dir artifacts/evidence-input `
  --output artifacts/release-evidence/manifest.json
```
