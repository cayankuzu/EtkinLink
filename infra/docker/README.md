# EtkinLink deterministic Docker validation

This directory is a test/CI boundary, not a production runtime. React Native, Android/iOS tooling, EAS, signing, real-device push, hosted Supabase, and the production Cloudflare Worker remain outside Docker.

## Architecture and safety boundary

- The pinned Supabase CLI starts its canonical local Docker stack from an isolated copied workdir and synthetic seed. Compose does not recreate Postgres, Auth, Storage, Realtime, or Mailpit.
- `upstream-mock` serves deterministic RSS, Etkinlik.io JSON, Expo ticket/receipt, and existing product-path contracts. It contains no user or production data.
- `contract-tests` runs the mock matrix, the actual `supabase/functions/ingest-events/upstreamHttp.ts` transport, and the Cloudflare Worker checks from an immutable build context. The Edge transport keeps its production URL allowlist intact; a dependency-injected fetch adapter rewrites only an already-validated request to the internal fixture endpoint.
- `toxiproxy` injects timeout and latency failures into the synthetic upstream mock; `resilience-tests` proves only that mock contract's recovery and duplicate-free replay.
- `k6` is fail-closed to `TARGET_ENV=docker-test` and exact `http://upstream-mock:8080`. It cannot target staging or production.
- Services are non-root, read-only, capability-free, resource-bounded, and attached to an internal network. No service mounts the Docker socket or the repository.
- Images and tool versions are pinned. The Dockerfile-specific ignore file prevents credentials, native outputs, `.env` files, and local artifacts from entering the build context.

Supabase local endpoints use isolated loopback ports `55320-55329`, avoiding the normal development ports. The mock and Toxiproxy API have no host-published port; only other services on the internal Compose network can reach them.

## Commands

From the repository root:

```powershell
npm run docker:config
npm run docker:up:test
npm run docker:down

npm run docker:test
npm run docker:resilience
npm run docker:load -- --vus 10 --duration 20s
```

`docker:test` performs isolated migration replay, strict DB lint, all pgTAP files, a Supabase schema dump, and an application schema/data restore into a temporary database in the same canonical Postgres instance, followed by Edge Function, Worker, and upstream contracts. The restore compares public/private, Auth, Storage, and Realtime metrics. Provider-managed `pg_cron` is deliberately excluded because it is bound to the canonical `postgres` database; scheduler recreation remains a migration/deployment step and is recorded in the evidence. The command always removes its ephemeral Supabase test volumes after completion.

`docker:down` stops only the exact `etkinlink-docker-test` project and does not request volume deletion. Destructive cleanup is intentionally separate and requires the exact confirmation:

```powershell
npm run docker:clean -- --confirm=etkinlink-docker-test
```

Never add a production URL, provider credential, service-role key, real push token, signing key, or user fixture to `env/.env.example`, Compose, image layers, logs, or artifacts.

## Profiles

| Profile | Services | Proof produced |
| --- | --- | --- |
| `test` | canonical Supabase CLI stack + mock + contract runner | migration/RLS/IDOR, dump/restore, actual Edge HTTP transport against fixtures, Worker/upstream contract |
| `rss-mock` | mock only | fixture development and bounded transport inspection |
| `resilience` | mock + Toxiproxy + fault runner | synthetic mock timeout/latency recovery and duplicate-free replay |
| `load` | mock + bounded k6 runner | synthetic public event list/detail, room, matching, message, push, scheduler and cache contracts |

The local load profile is a deterministic mock contract smoke test. The resilience profile does not inject faults into local Supabase, Realtime, push workers, or a deployed Worker. RSS endpoint fixtures are inspected here, but `mobile/src/features/events/rssEventService.ts` is not executed in the Docker runner; its actual parser/transport remains covered by the mobile Jest suite. Metadata records this distinction as `rssActualCodeIntegration: false` and `rssFixtureContractOnly: true`. Neither profile is staging capacity, hosted-provider, real-device, APNs/FCM, or production SLO evidence.

## Evidence and rollback

Each completed profile writes `artifacts/docker/<profile>/metadata.json`, sanitized logs, and `SHA256SUMS`. Metadata records the current HEAD plus `gitTreeClean` and `sameShaEligible`; a dirty local tree can never be presented as same-SHA evidence, and CI fails closed if its source tree is dirty. Before upload, a second artifact scanner rejects raw Supabase keys, JWTs, database passwords, bearer tokens, symlinks, and unscannably large text evidence; unsafe evidence is never uploaded. The directory is ignored by Git and is uploaded only by the Docker validation workflow.

Rollback/stop:

```powershell
npm run docker:down
```

If test-only volumes must also be discarded, use the explicit `docker:clean` confirmation above. The cleanup script targets only exact Compose labels and the isolated Supabase project name; it refuses broad filesystem cleanup.
