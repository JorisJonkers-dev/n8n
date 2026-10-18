/**
 * External hooks that add OIDC login to the community n8n image.
 *
 * Based on the public cweagans/n8n-oidc project, adapted for this stack.
 * The built-in n8n OIDC endpoints are Enterprise-only, so this hook provides
 * the same auth-server integration. The image loads it through EXTERNAL_HOOK_FILES.
 */
const crypto = require('crypto')
const http = require('http')
const https = require('https')
const { URL, URLSearchParams } = require('url')

const N8N_DI_PATH = '/usr/local/lib/node_modules/n8n/node_modules/@n8n/di'
const N8N_AUTH_SERVICE_PATH = '/usr/local/lib/node_modules/n8n/dist/auth/auth.service.js'
const N8N_OWNERSHIP_SERVICE_PATH = '/usr/local/lib/node_modules/n8n/dist/services/ownership.service.js'

const config = {
  issuerUrl: process.env.OIDC_ISSUER_URL,
  clientId: process.env.OIDC_CLIENT_ID,
  clientSecret: process.env.OIDC_CLIENT_SECRET,
  redirectUri: process.env.OIDC_REDIRECT_URI,
  scopes: process.env.OIDC_SCOPES || 'openid email profile',
}

let discoveryCache = null
let discoveryCacheTime = 0
const DISCOVERY_CACHE_TTL_MS = 60 * 60 * 1000

function validateConfig() {
  const missing = []
  if (!config.issuerUrl) missing.push('OIDC_ISSUER_URL')
  if (!config.clientId) missing.push('OIDC_CLIENT_ID')
  if (!config.clientSecret) missing.push('OIDC_CLIENT_SECRET')
  if (!config.redirectUri) missing.push('OIDC_REDIRECT_URI')
  return missing
}

function makeRequest(requestUrl, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(requestUrl)
    const protocol = parsedUrl.protocol === 'https:' ? https : http
    const req = protocol.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || 'GET',
        headers: options.headers || {},
      },
      (res) => {
        let body = ''
        res.on('data', (chunk) => {
          body += chunk
        })
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body,
          })
        })
      },
    )

    req.on('error', reject)

    if (options.body) {
      req.write(options.body)
    }

    req.end()
  })
}

async function fetchDiscoveryDocument() {
  const now = Date.now()
  if (discoveryCache && now - discoveryCacheTime < DISCOVERY_CACHE_TTL_MS) {
    return discoveryCache
  }

  const discoveryUrl = `${config.issuerUrl.replace(/\/$/, '')}/.well-known/openid-configuration`
  const response = await makeRequest(discoveryUrl)

  if (response.statusCode !== 200) {
    throw new Error(`Failed to fetch OIDC discovery document: ${response.statusCode}`)
  }

  discoveryCache = JSON.parse(response.body)
  discoveryCacheTime = now
  return discoveryCache
}

function generateRandomString(length = 32) {
  return crypto.randomBytes(length).toString('hex')
}

function base64UrlEncode(input) {
  const base64 = Buffer.isBuffer(input) ? input.toString('base64') : Buffer.from(input).toString('base64')
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function base64UrlDecode(input) {
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4 !== 0) {
    base64 += '='
  }
  return Buffer.from(base64, 'base64')
}

function decodeJwt(token) {
  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format')
  }
  return JSON.parse(base64UrlDecode(parts[1]).toString('utf8'))
}

async function exchangeCodeForTokens(code, discovery) {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  })

  const response = await makeRequest(discovery.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })

  if (response.statusCode !== 200) {
    console.error(`[OIDC Hook] Token exchange failed: ${response.statusCode} ${response.body}`)
    throw new Error(`Token exchange failed: ${response.statusCode}`)
  }

  return JSON.parse(response.body)
}

async function fetchUserInfo(accessToken, discovery) {
  const response = await makeRequest(discovery.userinfo_endpoint, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (response.statusCode !== 200) {
    console.error(`[OIDC Hook] UserInfo fetch failed: ${response.statusCode} ${response.body}`)
    throw new Error(`UserInfo fetch failed: ${response.statusCode}`)
  }

  return JSON.parse(response.body)
}

function createSignedCookie(payload, secret, expiresInSeconds = 900) {
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds
  const body = JSON.stringify({ ...payload, exp })
  const signature = crypto.createHmac('sha256', secret).update(body).digest('hex')
  return `${base64UrlEncode(body)}.${signature}`
}

function verifySignedCookie(cookieValue, secret) {
  try {
    const [dataB64, signature] = cookieValue.split('.')
    const body = base64UrlDecode(dataB64).toString('utf8')
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex')
    if (signature !== expected) {
      return null
    }
    const payload = JSON.parse(body)
    if (payload.exp && payload.exp < Date.now() / 1000) {
      return null
    }
    return payload
  } catch {
    return null
  }
}

function getCookieSecret() {
  const seed = process.env.N8N_ENCRYPTION_KEY || process.env.OIDC_CLIENT_SECRET
  if (!seed) {
    console.warn(
      '[oidc-hook] WARNING: Neither N8N_ENCRYPTION_KEY nor OIDC_CLIENT_SECRET is set — using insecure fallback for cookie signing',
    )
  }
  return crypto
    .createHash('sha256')
    .update(`${seed || 'n8n-oidc'}:oidc-state`)
    .digest('hex')
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function getFrontendScript() {
  return `
    (function () {
      'use strict';
      var redirectingToOidc = false;

      function shouldShowNormalLogin() {
        return new URLSearchParams(window.location.search).get('showLogin') === 'true';
      }

      function isSigninPage() {
        return window.location.pathname === '/signin' || window.location.pathname === '/login';
      }

      function isOwnerSetupPage() {
        if (window.location.pathname === '/setup' || window.location.pathname === '/owner/setup') return true;

        var title = document.querySelector('h1, [data-test-id="owner-setup-heading"]');
        if (!title) return false;

        return /owner account|set up owner/i.test(title.textContent || '');
      }

      function redirectOwnerSetupToSso() {
        if (redirectingToOidc || shouldShowNormalLogin() || !isOwnerSetupPage()) return;
        redirectingToOidc = true;
        window.location.replace('/auth/oidc/login');
      }

      function showError(form) {
        var error = new URLSearchParams(window.location.search).get('error');
        if (!error || !form || form.querySelector('#oidc-error')) return;

        var errorDiv = document.createElement('div');
        errorDiv.id = 'oidc-error';
        errorDiv.style.cssText =
          'background:#fee;border:1px solid #fcc;color:#900;padding:12px;border-radius:4px;margin:16px 0;';
        errorDiv.textContent = decodeURIComponent(error);
        form.prepend(errorDiv);
      }

      function injectSsoButton() {
        if (shouldShowNormalLogin() || !isSigninPage()) return;

        var form = document.querySelector('[data-test-id="auth-form"]');
        if (!form || form.querySelector('#oidc-sso-button')) return;

        var submitButton = form.querySelector('[data-test-id="form-submit-button"]');
        var buttonClasses = submitButton ? submitButton.className : '';

        form
          .querySelectorAll('div[class*="_inputsContainer_"], div[class*="_buttonsContainer_"], div[class*="_actionContainer_"]')
          .forEach(function (el) {
            el.style.display = 'none';
          });

        var wrapper = document.createElement('div');
        wrapper.id = 'oidc-sso-container';
        wrapper.style.cssText = 'text-align:center;';

        var button = document.createElement('button');
        button.id = 'oidc-sso-button';
        button.type = 'button';
        button.textContent = 'Sign in with SSO';
        button.onclick = function () {
          window.location.href = '/auth/oidc/login';
        };

        if (buttonClasses) {
          button.className = buttonClasses;
          button.style.width = '100%';
        } else {
          button.style.cssText =
            'width:100%;padding:12px 24px;font-size:14px;font-weight:600;color:#fff;background:#ea4b30;border:none;border-radius:4px;cursor:pointer;';
        }

        var fallback = document.createElement('p');
        fallback.style.cssText = 'margin-top:16px;font-size:12px;color:#666;';
        fallback.innerHTML = 'Admin? <a href="/signin?showLogin=true">Sign in with email</a>';

        wrapper.appendChild(button);
        wrapper.appendChild(fallback);
        form.prepend(wrapper);
        showError(form);
      }

      function observe() {
        redirectOwnerSetupToSso();
        injectSsoButton();
        var observer = new MutationObserver(function () {
          redirectOwnerSetupToSso();
          injectSsoButton();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(function () {
          observer.disconnect();
        }, 10000);
      }

      function hookHistory() {
        var pushState = history.pushState;
        var replaceState = history.replaceState;

        history.pushState = function () {
          pushState.apply(this, arguments);
          setTimeout(observe, 100);
        };

        history.replaceState = function () {
          replaceState.apply(this, arguments);
          setTimeout(observe, 100);
        };

        window.addEventListener('popstate', function () {
          setTimeout(observe, 100);
        });
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
          observe();
          hookHistory();
        });
      } else {
        observe();
        hookHistory();
      }
    })();
  `
}

module.exports = {
  n8n: {
    ready: [
      async function ready(server) {
        const missing = validateConfig()
        if (missing.length > 0) {
          console.warn(`[OIDC Hook] Missing configuration: ${missing.join(', ')}. OIDC disabled.`)
          return
        }

        const { Container } = require(N8N_DI_PATH)
        const { AuthService } = require(N8N_AUTH_SERVICE_PATH)
        const { OwnershipService } = require(N8N_OWNERSHIP_SERVICE_PATH)
        const authService = Container.get(AuthService)
        const ownershipService = Container.get(OwnershipService)
        const cookieSecret = getCookieSecret()
        const { app } = server

        const cookieOptions = {
          httpOnly: true,
          secure: process.env.N8N_PROTOCOL === 'https',
          sameSite: 'lax',
          maxAge: 15 * 60 * 1000,
        }

        app.get('/auth/oidc/login', async (req, res) => {
          try {
            const discovery = await fetchDiscoveryDocument()
            const state = generateRandomString()
            const nonce = generateRandomString()

            res.cookie('n8n-oidc-state', createSignedCookie({ state }, cookieSecret), cookieOptions)
            res.cookie('n8n-oidc-nonce', createSignedCookie({ nonce }, cookieSecret), cookieOptions)

            const authUrl = new URL(discovery.authorization_endpoint)
            authUrl.searchParams.set('client_id', config.clientId)
            authUrl.searchParams.set('redirect_uri', config.redirectUri)
            authUrl.searchParams.set('response_type', 'code')
            authUrl.searchParams.set('scope', config.scopes)
            authUrl.searchParams.set('state', state)
            authUrl.searchParams.set('nonce', nonce)
            res.redirect(authUrl.toString())
          } catch (error) {
            console.error('[OIDC Hook] Login error', error)
            res.status(500).send('OIDC configuration error. Check n8n logs.')
          }
        })

        app.get('/auth/oidc/callback', async (req, res) => {
          try {
            const { code, state, error, error_description } = req.query

            if (error) {
              return res.redirect(`/signin?error=${encodeURIComponent(error_description || error)}`)
            }

            if (!code || !state) {
              return res.redirect('/signin?error=Missing%20authorization%20code%20or%20state')
            }

            const stateCookie = req.cookies['n8n-oidc-state']
            const nonceCookie = req.cookies['n8n-oidc-nonce']

            if (!stateCookie || !nonceCookie) {
              return res.redirect('/signin?error=Missing%20state%20cookies')
            }

            const statePayload = verifySignedCookie(stateCookie, cookieSecret)
            const noncePayload = verifySignedCookie(nonceCookie, cookieSecret)
            if (!statePayload || statePayload.state !== state) {
              return res.redirect('/signin?error=Invalid%20state')
            }

            res.clearCookie('n8n-oidc-state')
            res.clearCookie('n8n-oidc-nonce')

            const discovery = await fetchDiscoveryDocument()
            const tokens = await exchangeCodeForTokens(code, discovery)

            if (tokens.id_token && noncePayload) {
              const idToken = decodeJwt(tokens.id_token)
              if (idToken.nonce !== noncePayload.nonce) {
                return res.redirect('/signin?error=Invalid%20nonce')
              }
            }

            let userInfo
            try {
              userInfo = await fetchUserInfo(tokens.access_token, discovery)
            } catch (error) {
              if (!tokens.id_token) {
                throw error
              }
              userInfo = decodeJwt(tokens.id_token)
            }

            if (!userInfo.email || !isValidEmail(userInfo.email)) {
              return res.redirect('/signin?error=No%20valid%20email%20in%20OIDC%20response')
            }

            const { User } = this.dbCollections
            let user = await User.findOne({
              where: { email: userInfo.email },
              relations: ['role'],
            })

            if (!user) {
              const userPayload = {
                email: userInfo.email,
                firstName: userInfo.given_name || userInfo.name?.split(' ')[0] || 'User',
                lastName: userInfo.family_name || userInfo.name?.split(' ').slice(1).join(' ') || '',
                password: crypto.randomBytes(32).toString('hex'),
              }

              if (!(await ownershipService.hasInstanceOwner())) {
                user = await ownershipService.setupOwner(userPayload)
              } else {
                const result = await User.createUserWithProject({
                  ...userPayload,
                  role: { slug: 'global:member' },
                })
                user = result.user
              }
            }

            authService.issueCookie(res, user, true, req.browserId)
            res.redirect('/')
          } catch (error) {
            console.error('[OIDC Hook] Callback error', error)
            res.redirect(`/signin?error=${encodeURIComponent(`Authentication failed: ${error.message}`)}`)
          }
        })

        app.get('/assets/oidc-frontend-hook.js', (req, res) => {
          res.type('text/javascript; charset=utf-8')
          res.set('Cache-Control', 'public, max-age=3600')
          res.send(getFrontendScript())
        })
      },
    ],
  },
  frontend: {
    settings: [
      async function settings(frontendSettings) {
        if (validateConfig().length > 0) {
          return
        }

        frontendSettings.sso = frontendSettings.sso || {}
        frontendSettings.sso.oidc = {
          loginEnabled: true,
          loginUrl: '/auth/oidc/login',
          callbackUrl: config.redirectUri,
        }

        frontendSettings.userManagement = frontendSettings.userManagement || {}
        frontendSettings.userManagement.authenticationMethod = 'oidc'

        frontendSettings.enterprise = frontendSettings.enterprise || {}
        frontendSettings.enterprise.oidc = true
      },
    ],
  },
}
