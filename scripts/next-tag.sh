#!/usr/bin/env bash
# Prints the tag the next release gets, or nothing when the image did not change.
# The tag is the n8n version the Dockerfile pins. A change to the image on an
# n8n version that already has a release gets the next -N revision.
set -euo pipefail

version="$(sed -n -E 's#^FROM docker\.io/n8nio/n8n:([0-9]+\.[0-9]+\.[0-9]+)@sha256:[0-9a-f]{64}.*#\1#p' Dockerfile | head -1)"
if [ -z "$version" ]; then
  echo "next-tag: the Dockerfile pins no n8n version by digest" >&2
  exit 1
fi

last="$(git describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null || true)"
if [ -n "$last" ] && git diff --quiet "$last" HEAD -- Dockerfile hooks; then
  exit 0
fi

if ! git rev-parse -q --verify "refs/tags/v${version}" >/dev/null; then
  echo "v${version}"
  exit 0
fi

revision="$(git tag --list "v${version}-*" | sed "s/^v${version}-//" | sort -n | tail -1)"
echo "v${version}-$((${revision:-0} + 1))"
