# n8n with the OIDC sign-in hooks built in, so no deployment mounts executable code.
FROM docker.io/n8nio/n8n:2.46.2@sha256:7835b0b05cb0a13133c7b9751c203b5b5d206ce3eb1b5f7fc0e5b01e8c6acdde

COPY hooks/oidc.js /opt/n8n-hooks/oidc.js

ENV EXTERNAL_HOOK_FILES=/opt/n8n-hooks/oidc.js \
    EXTERNAL_FRONTEND_HOOKS_URLS=/assets/oidc-frontend-hook.js \
    N8N_ADDITIONAL_NON_UI_ROUTES=auth

# The base image's node user, by number, so the images lock records its uid and gid.
USER 1000:1000
