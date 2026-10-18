# n8n

n8n for the JorisJonkers-dev estate: `ghcr.io/jorisjonkers-dev/n8n`, built from a pinned `n8nio/n8n` with the OIDC sign-in hooks in the image.

## The image

- `Dockerfile` pins the n8n base by tag and digest. Renovate bumps both.
- `hooks/oidc.js` adds sign-in through the estate's OIDC issuer, because n8n's own OIDC is Enterprise-only. The image loads it through `EXTERNAL_HOOK_FILES`, so no deployment mounts executable code.
- The hooks read `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI` and, optionally, `OIDC_SCOPES`. If any of the first four is missing, the hooks log `OIDC disabled` and n8n keeps its own login.

## Tests

```bash
npm test                                   # builds the image, starts it, checks the hooks
IMAGE=ghcr.io/jorisjonkers-dev/n8n@sha256:<digest> npm test   # tests an existing image
```

The tests need Docker. They start n8n next to a stub OIDC issuer and check that n8n becomes ready, that the hooks serve the sign-in script and send sign-in to the issuer, and that the base is pinned by digest.

## Releases

release-please keeps a release PR open. Merging it tags `vX.Y.Z`. The tag publishes a multi-arch image, reads it back by digest, and runs the image tests against the published image.
