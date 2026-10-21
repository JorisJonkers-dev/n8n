# n8n

n8n for the JorisJonkers-dev estate: `ghcr.io/jorisjonkers-dev/n8n`, built from a pinned `n8nio/n8n` with the OIDC sign-in hooks in the image.

## The image

- `Dockerfile` pins the n8n base by tag and digest. Renovate bumps both.
- `hooks/oidc.js` adds sign-in through the estate's OIDC issuer, because n8n's own OIDC is Enterprise-only. The image loads it through `EXTERNAL_HOOK_FILES`, so no deployment mounts executable code.
- The hooks read `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI` and, optionally, `OIDC_SCOPES`. If any of the first four is missing, the hooks log `OIDC disabled` and n8n keeps its own login.

## Deployment

`deploy/n8n.project.yml` is the deploy-kit Project Intent: Project `n8n` in `n8n-system` at `n8n.jorisjonkers.dev`, with its environment in `deploy/env/n8n/base.env`. CI validates both with the deploy-kit release `tools/deploy-kit` pins:

```bash
cd tools/deploy-kit && NODE_AUTH_TOKEN="$(gh auth token)" npm ci --ignore-scripts
npx --no-install deploy-kit validate ../../deploy/n8n.project.yml ../../deploy/env
```

The image tests start n8n as the project file runs it: a read-only root, with only its `writablePaths` and its volume writable.

## Tests

```bash
npm test                                   # builds the image, starts it, checks the hooks
IMAGE=ghcr.io/jorisjonkers-dev/n8n@sha256:<digest> npm test   # tests an existing image
```

The tests need Docker. They start n8n next to a stub OIDC issuer and check that n8n becomes ready, that the hooks serve the sign-in script and send sign-in to the issuer, and that the base is pinned by digest.

## Releases

A release's version counts this repository's own changes. The n8n version the image ships is recorded separately, as the images lock's `version` (JorisJonkers-dev/workspace#140), so a configuration fix no longer waits for an n8n release.

- release-please keeps a release PR from conventional commits, continuing from `v2.44.4`, the last tag named after n8n. Merging it tags `vX.Y.Z`.
- The shared image build labels the image `org.opencontainers.image.version` with the n8n version the Dockerfile pins, and the shared lock step reads it back into the images lock.
- The tag publishes a multi-arch image, reads it back by digest, and runs the image tests against the published image.
