# Isolated staging church-image probe

## Safety contract

`src/lib/church-images/storage.staging.test.ts` is an opt-in remote probe, disabled in normal tests and CI. It is separate from the disposable local Storage integration. It never runs database migrations, creates identities/churches, changes upload activation, creates/updates/deletes a bucket, empties storage, or resumes a paused provider project.

Configuration must match both the linked non-secret reference and the pinned existing synthetic-only project `jaxcbpzhzxuoszlfohbe`, current name `orthodox-routes-staging`, and provider status `ACTIVE_HEALTHY`. A missing/mismatched/inactive project stops before credentials are retrieved. Project keys are read through the existing authenticated CLI into memory only; CLI failures/output, credentials, and provider bodies are not printed or written. The remote URL is derived only from the fixed reference, never an environment-provided arbitrary backend. The live project was observed `INACTIVE` on 17 October 2026; no remote Storage success is claimed.

The probe requires an **existing private** `church-images` bucket. It refuses a public/missing bucket without changing it. All network operations have deadlines and reject redirects. A freshly generated synthetic 640×360 image is normalized through the real processor into exactly four opaque-key WebP objects. Every key must be absent before writes, and all four are tracked before the first upload, including a committed upload whose acknowledgement is lost.

The real storage adapter verifies immutable writes, checksum read-back, identical upload retries, anonymous authenticated-API denial and public-object-URL denial. Removal is idempotent and uses only the four exact generated keys; it is independently repeated in `finally`. No listing-wide delete or bucket delete is allowed. Any post-write or cleanup failure preserves a failing test and reports only the synthetic image UUID so an operator can recheck/remove precisely `master.webp`, `480.webp`, `960.webp`, and `1600.webp` under that UUID. A timed-out upload can commit after an acknowledged removal; the failed run is not cleanup proof and its exact keys must be rechecked before retrying. Successful output contains only scope, object count, processed byte total, and elapsed milliseconds.

## Running after owner-controlled readiness

The owner must resume the same isolated project through the provider console and ensure the existing bucket is private before this opt-in probe can run. Do not supply keys in chat, commit them, or point this command at production. The local authenticated CLI must already have staging access.

From the primary checkout containing the linked project file, in PowerShell:

```powershell
$env:CHURCH_IMAGE_STORAGE_STAGING_INTEGRATION = '1'
try {
  npm.cmd test -- --run src/lib/church-images/storage.staging.test.ts --maxWorkers=1
  if ($LASTEXITCODE -ne 0) { throw 'The staging Storage probe did not pass.' }
} finally {
  Remove-Item Env:CHURCH_IMAGE_STORAGE_STAGING_INTEGRATION -ErrorAction SilentlyContinue
}
```

Run `scripts/staging-image-config.test.ts` normally to verify pinning, inactive-project refusal before key retrieval, malformed metadata/key refusal, and sanitized errors without network access. No new package, provider, or production setting is introduced.

## Evidence boundary

A skipped test or the expected inactive-project refusal is not a successful Storage probe. The explicit opt-in attempt on 17 October 2026 failed at configuration preflight while the pinned project was inactive, before credentials/object operations. Record an actual opt-in pass and exact cleanup before claiming remote storage verification. This small synthetic smoke is not upload-limit approval, capacity/load measurement, public application upload/delivery verification, superseded-image retention, backup restoration, or production readiness. Those remain separate campaign work/gates.
