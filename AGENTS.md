# Agents

Guidance for any coding agent working in this repository.

Read the [estate contract](https://github.com/JorisJonkers-dev/workspace/blob/main/CLAUDE.md) before anything non-trivial.

## Build and test

```sh
npm test   # builds the image, starts it, checks the hooks; needs Docker
```

The Project Intent is `deploy/n8n.project.yml`; the image is `Dockerfile` plus `hooks/oidc.js`. See `README.md` for validating the Intent with deploy-kit.
