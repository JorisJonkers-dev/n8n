# n8n with the OIDC sign-in hooks built in, so no deployment mounts executable code.
FROM docker.io/n8nio/n8n:2.48.4@sha256:63bdcfdea7e0d21152a7ad8f62e6622658c5eae3835e7515dbd9b610cdb76111

COPY hooks/oidc.js /opt/n8n-hooks/oidc.js

ENV EXTERNAL_HOOK_FILES=/opt/n8n-hooks/oidc.js \
    EXTERNAL_FRONTEND_HOOKS_URLS=/assets/oidc-frontend-hook.js \
    N8N_ADDITIONAL_NON_UI_ROUTES=auth

# The base image's node user, by number, so the images lock records its uid and gid.
USER 1000:1000
