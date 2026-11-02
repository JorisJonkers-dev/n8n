# n8n with the OIDC sign-in hooks built in, so no deployment mounts executable code.
FROM docker.io/n8nio/n8n:2.45.3@sha256:bf88c3783fc4b2a90a007bb99b04ad2f6a9627f41499baf72ca67559c51c7f4c

COPY hooks/oidc.js /opt/n8n-hooks/oidc.js

ENV EXTERNAL_HOOK_FILES=/opt/n8n-hooks/oidc.js \
    EXTERNAL_FRONTEND_HOOKS_URLS=/assets/oidc-frontend-hook.js \
    N8N_ADDITIONAL_NON_UI_ROUTES=auth

# The base image's node user, by number, so the images lock records its uid and gid.
USER 1000:1000
