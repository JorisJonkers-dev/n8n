# n8n with the OIDC sign-in hooks built in, so no deployment mounts executable code.
FROM docker.io/n8nio/n8n:2.45.2@sha256:fd7f4dc4617e9113c499ba62a6c58f17df2dce3dd82028e357485947af383041

COPY hooks/oidc.js /opt/n8n-hooks/oidc.js

ENV EXTERNAL_HOOK_FILES=/opt/n8n-hooks/oidc.js \
    EXTERNAL_FRONTEND_HOOKS_URLS=/assets/oidc-frontend-hook.js \
    N8N_ADDITIONAL_NON_UI_ROUTES=auth

# The base image's node user, by number, so the images lock records its uid and gid.
USER 1000:1000
