// The published image is n8n with the OIDC sign-in hooks built in.
// These tests build the image, start it the way deploy/n8n.project.yml runs it
// (read-only root, only its writable paths and its volume writable), and talk to
// it over HTTP. IMAGE skips the build and tests an image that already exists.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const IMAGE = process.env.IMAGE || 'n8n-image-test:local'
const NAME = `n8n-image-test-${process.pid}`
const PROJECT = readFileSync(`${ROOT}/deploy/n8n.project.yml`, 'utf8')
const WRITABLE = PROJECT.match(/writablePaths: \[([^\]]*)\]/)[1].split(',').map((path) => path.trim())
const VOLUME = PROJECT.match(/mountAt: (\S+)/)[1]
const AUTHORIZE = 'http://issuer.test/authorize'
let base
let issuer

// A stub OIDC issuer: n8n only reads its discovery document before redirecting.
function startIssuer() {
  const server = createServer((req, res) => {
    if (req.url !== '/.well-known/openid-configuration') {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      issuer: `http://host.docker.internal:${server.address().port}`,
      authorization_endpoint: AUTHORIZE,
      token_endpoint: 'http://issuer.test/token',
      userinfo_endpoint: 'http://issuer.test/userinfo',
    }))
  })
  return new Promise((resolve) => server.listen(0, '0.0.0.0', () => resolve(server)))
}

function docker(...args) {
  return execFileSync('docker', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

async function waitForReady(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/healthz/readiness`)
      if (res.status === 200) return
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`n8n was not ready within ${timeoutMs} ms:\n${docker('logs', NAME)}`)
}

before(async () => {
  if (!process.env.IMAGE) docker('build', '-t', IMAGE, '.')
  issuer = await startIssuer()
  docker(
    'run', '-d', '--name', NAME, '-p', '127.0.0.1::5678',
    '--read-only', '--user', '1000:1000',
    ...WRITABLE.flatMap((path) => ['--tmpfs', `${path}:uid=1000,gid=1000`]),
    '--mount', `type=volume,dst=${VOLUME}`,
    '--add-host', 'host.docker.internal:host-gateway',
    '-e', `OIDC_ISSUER_URL=http://host.docker.internal:${issuer.address().port}`,
    '-e', 'OIDC_CLIENT_ID=n8n',
    '-e', 'OIDC_CLIENT_SECRET=image-test',
    '-e', 'OIDC_REDIRECT_URI=http://localhost:5678/auth/oidc/callback',
    '-e', 'N8N_ENCRYPTION_KEY=image-test',
    IMAGE,
  )
  const port = docker('port', NAME, '5678/tcp').split('\n')[0].split(':').pop()
  base = `http://127.0.0.1:${port}`
  await waitForReady(base, 180_000)
}, { timeout: 600_000 })

after(() => {
  issuer?.close()
  try {
    docker('rm', '-f', '-v', NAME)
  } catch {
    // already gone
  }
})

test('the image starts n8n and answers its health check', async () => {
  const res = await fetch(`${base}/healthz`)
  assert.equal(res.status, 200)
})

test('the image loads the OIDC hooks, which serve the sign-in script', async () => {
  const res = await fetch(`${base}/assets/oidc-frontend-hook.js`)
  assert.equal(res.status, 200)
  assert.match(await res.text(), /auth\/oidc\/login/)
})

test('the editor page loads the OIDC sign-in script', async () => {
  const res = await fetch(`${base}/`)
  assert.match(await res.text(), /\/assets\/oidc-frontend-hook\.js/)
})

test('signing in redirects to the issuer with the n8n client id', async () => {
  const res = await fetch(`${base}/auth/oidc/login`, { redirect: 'manual' })
  assert.equal(res.status, 302)
  const location = new URL(res.headers.get('location'))
  assert.equal(`${location.origin}${location.pathname}`, AUTHORIZE)
  assert.equal(location.searchParams.get('client_id'), 'n8n')
})

test('the frontend settings send sign-in to the OIDC login route', async () => {
  const res = await fetch(`${base}/rest/settings`)
  const { data } = await res.json()
  assert.deepEqual(
    { loginEnabled: data.sso.oidc?.loginEnabled, loginUrl: data.sso.oidc?.loginUrl },
    { loginEnabled: true, loginUrl: '/auth/oidc/login' },
  )
})

test('the image is built from n8n pinned by digest', () => {
  const from = readFileSync(`${ROOT}/Dockerfile`, 'utf8').match(/^FROM\s+(\S+)/m)[1]
  assert.match(from, /^docker\.io\/n8nio\/n8n:\d+\.\d+\.\d+@sha256:[0-9a-f]{64}$/)
})

test('the image runs as a numeric user, so the images lock can record its uid and gid', () => {
  assert.equal(docker('image', 'inspect', IMAGE, '--format', '{{.Config.User}}'), '1000:1000')
})

test('a community node installs on the read-only root', () => {
  const out = docker(
    'exec', NAME, 'sh', '-c',
    `mkdir -p ${VOLUME}/nodes && cd ${VOLUME}/nodes && npm install --no-save --no-audit --no-fund @apify/n8n-nodes-apify@0.6.5 >/dev/null && ls node_modules/@apify`,
  )
  assert.equal(out, 'n8n-nodes-apify')
})
