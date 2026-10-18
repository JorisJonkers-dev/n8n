// The release tag follows the n8n version in the Dockerfile. A change to the
// image between n8n bumps gets a -N revision. Each test builds a throwaway git
// repository and runs scripts/next-tag.sh in it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('../scripts/next-tag.sh', import.meta.url))

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'next-tag-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'test')
  mkdirSync(join(dir, 'hooks'))
  const commit = (files, message) => {
    for (const [path, body] of Object.entries(files)) writeFileSync(join(dir, path), body)
    git('add', '-A')
    git('commit', '-q', '-m', message)
  }
  const from = (version) => ({ Dockerfile: `FROM docker.io/n8nio/n8n:${version}@sha256:${'a'.repeat(64)}\n` })
  const next = () => execFileSync('bash', [SCRIPT], { cwd: dir, encoding: 'utf8' }).trim()
  return { git, commit, from, next }
}

test('the first release is tagged with the n8n version', () => {
  const r = repo()
  r.commit({ ...r.from('2.38.3'), 'hooks/oidc.js': 'a' }, 'first')
  assert.equal(r.next(), 'v2.38.3')
})

test('a hook change on the same n8n version gets the first revision', () => {
  const r = repo()
  r.commit({ ...r.from('2.38.3'), 'hooks/oidc.js': 'a' }, 'first')
  r.git('tag', 'v2.38.3')
  r.commit({ 'hooks/oidc.js': 'b' }, 'fix hook')
  assert.equal(r.next(), 'v2.38.3-1')
})

test('the next image change on that version counts the revision up', () => {
  const r = repo()
  r.commit({ ...r.from('2.38.3'), 'hooks/oidc.js': 'a' }, 'first')
  r.git('tag', 'v2.38.3')
  r.commit({ 'hooks/oidc.js': 'b' }, 'fix hook')
  r.git('tag', 'v2.38.3-1')
  r.commit({ 'hooks/oidc.js': 'c' }, 'fix hook again')
  assert.equal(r.next(), 'v2.38.3-2')
})

test('revisions count numerically, not as text', () => {
  const r = repo()
  r.commit({ ...r.from('2.38.3'), 'hooks/oidc.js': 'a' }, 'first')
  for (const tag of ['v2.38.3', 'v2.38.3-2', 'v2.38.3-10']) r.git('tag', tag)
  r.commit({ 'hooks/oidc.js': 'b' }, 'fix hook')
  assert.equal(r.next(), 'v2.38.3-11')
})

test('an n8n bump is tagged with the new n8n version, with no revision', () => {
  const r = repo()
  r.commit({ ...r.from('2.38.3'), 'hooks/oidc.js': 'a' }, 'first')
  r.git('tag', 'v2.38.3-1')
  r.commit(r.from('2.39.0'), 'bump n8n')
  assert.equal(r.next(), 'v2.39.0')
})

test('a change outside the image releases nothing', () => {
  const r = repo()
  r.commit({ ...r.from('2.38.3'), 'hooks/oidc.js': 'a' }, 'first')
  r.git('tag', 'v2.38.3')
  r.commit({ 'README.md': 'docs' }, 'docs')
  assert.equal(r.next(), '')
})

test('the release tag of a version is never reused', () => {
  const r = repo()
  r.commit({ ...r.from('2.38.3'), 'hooks/oidc.js': 'a' }, 'first')
  r.git('tag', 'v2.38.3')
  r.commit(r.from('2.39.0'), 'bump n8n')
  r.git('tag', 'v2.39.0')
  r.commit(r.from('2.38.3'), 'roll n8n back')
  assert.equal(r.next(), 'v2.38.3-1')
})

test('a Dockerfile that does not pin n8n by digest releases nothing and fails', () => {
  const r = repo()
  r.commit({ Dockerfile: 'FROM docker.io/n8nio/n8n:2.38.3\n', 'hooks/oidc.js': 'a' }, 'unpinned')
  assert.throws(() => r.next(), /pins no n8n version by digest/)
})
