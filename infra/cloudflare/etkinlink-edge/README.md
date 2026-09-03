# EtkinLink selective Cloudflare edge

This Worker is a narrow gateway for the existing public event catalog/list/detail and the internal ingestion trigger. Supabase remains the source of truth for Auth, PostgreSQL/RLS, Realtime, rooms, matching, messages, push, and private media. The mobile client must continue to use Supabase directly for those paths.

## Route boundary

| Worker route                   | Origin contract                        | Shared cache                                                   |
| ------------------------------ | -------------------------------------- | -------------------------------------------------------------- |
| `GET /v1/catalog`              | existing `etkinlik-api` catalog action | public, short-lived, bounded                                   |
| `GET/POST /v1/events`          | existing event list action             | only anonymous/public-safe GET variants                        |
| `GET /v1/events/:id`           | existing event detail action           | public-safe only                                               |
| `POST /internal/ingest-events` | existing ingestion trigger             | never; HMAC, timestamp, nonce, replay and rate-limit protected |

Unknown methods, paths, query keys, origins, oversized bodies, placeholder origins, missing bindings, rate-limit failures, and invalid/replayed internal signatures fail closed. Authorization/Cookie responses and personalized/joined/saved/room/match/message/profile/private-media data are never stored in shared cache.

## Local quality gates

```powershell
npm ci
npm run types:check
npm run check
npm run dry-run
```

On Windows filesystems where Wrangler/esbuild receives a host ACL `EACCES`, use the repository Docker contract runner; it executes the same commands on a read-only Linux filesystem:

```powershell
npm run docker:test
```

`worker-configuration.d.ts` is generated from the checked-in `wrangler.jsonc` with Wrangler `4.127.1`. Run `npm run types` only after a binding or compatibility change, then verify `npm run types:check`.

## Environment and secrets

Non-secret environment bindings are scoped independently for development, preview, and production. Placeholder `*.invalid` origin/JWKS values intentionally prevent an accidental deploy from becoming a working proxy.

The following are secrets and must be configured through the environment/provider, never `vars`, Git, `.dev.vars.example`, image layers, logs, or artifacts:

- `INTERNAL_TRIGGER_HMAC_SECRET`
- `ORIGIN_INGEST_SECRET`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Exact origin URLs, issuer, JWKS, allowed origins, project isolation, and preview-versus-production project mismatch are validated by `scripts/validate-deployment-environment.mjs` before deploy.

## Deployment and rollback

Preview deployment requires an immutable target SHA and a successful same-SHA full mobile CI run. Production remains intentionally fail-closed until an isolated preview Worker, stable DNS, runtime contract evidence, a known baseline version ID, and idempotent gradual-rollout/rollback handling exist for the same SHA.

See:

- `docs/cloudflare-architecture.md`
- `docs/cloudflare-route-matrix.md`
- `docs/cloudflare-threat-model.md`
- `docs/cache-and-rate-limit-policy.md`
- `docs/MANUAL_STEPS.md`

Rollback never changes Supabase data: route traffic back to the recorded baseline Worker version, verify public event responses and internal-trigger rejection cases, then widen only after runtime evidence is attached.
