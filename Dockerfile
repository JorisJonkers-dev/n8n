# n8n with the OIDC sign-in hooks built in, so no deployment mounts executable code.
FROM docker.io/n8nio/n8n:2.43.8@sha256:a18edcf018198b33b5488fb47ededafe11e0b10d28f65b9535b7c447c9ce3b2c

COPY hooks/oidc.js /opt/n8n-hooks/oidc.js

ENV EXTERNAL_HOOK_FILES=/opt/n8n-hooks/oidc.js \
    EXTERNAL_FRONTEND_HOOKS_URLS=/assets/oidc-frontend-hook.js \
    N8N_ADDITIONAL_NON_UI_ROUTES=auth

# The base image's node user, by number, so the images lock records its uid and gid.
USER 1000:1000
