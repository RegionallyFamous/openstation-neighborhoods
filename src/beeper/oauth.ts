import {
  BeeperClient,
  BeeperApiError,
  assertSupportedBeeperInfo,
  DEFAULT_BEEPER_API_BASE,
  normalizeBeeperBaseUrl,
} from './client';
import type {
  BeeperOAuthClientRegistration,
  BeeperOAuthMetadata,
  BeeperTokenResponse,
} from './types';

const OAUTH_STATE_KEY = 'openstation-neighborhoods:oauth-state';
const OAUTH_CLIENT_KEY = 'openstation-neighborhoods:oauth-client';
const ACCESS_TOKEN_KEY = 'openstation-neighborhoods:access-token';
const ACCESS_TOKEN_SOURCE_KEY = 'openstation-neighborhoods:access-token-source';
const ACCESS_TOKEN_EXPIRES_KEY = 'openstation-neighborhoods:access-token-expires';
const REMEMBER_BEEPER_KEY = 'openstation-neighborhoods:remember-beeper';

interface OAuthPendingState {
  state: string;
  verifier: string;
  clientID: string;
  tokenEndpoint: string;
  redirectURI: string;
}

// React StrictMode deliberately mounts effects twice in development. Keep the
// callback exchange shared so the authorization code is consumed only once and
// both effect instances observe the same result.
let oauthCallbackCompletion: Promise<string | null> | null = null;

export function getStoredAccessToken(): string | null {
  const storage = sessionStorage.getItem(ACCESS_TOKEN_KEY)
    ? sessionStorage
    : isBeeperRemembered()
      ? window.localStorage
      : null;
  if (!storage) return null;

  const token = storage.getItem(ACCESS_TOKEN_KEY);
  const expiresAt = Number(storage.getItem(ACCESS_TOKEN_EXPIRES_KEY));
  if (token && Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= Date.now()) {
    disconnectBeeper();
    return null;
  }
  return token;
}

export function hasStoredBeeperSession(): boolean {
  return Boolean(getStoredAccessToken());
}

export function isBeeperRemembered(): boolean {
  return window.localStorage.getItem(REMEMBER_BEEPER_KEY) === 'true';
}

export function disconnectBeeper(): void {
  oauthCallbackCompletion = null;
  clearAccessToken(sessionStorage);
  clearAccessToken(window.localStorage);
  sessionStorage.removeItem(OAUTH_STATE_KEY);
  window.localStorage.removeItem(REMEMBER_BEEPER_KEY);
}

export function invalidateBeeperAuthorization(): void {
  disconnectBeeper();
  window.localStorage.removeItem(OAUTH_CLIENT_KEY);
}

export async function beginBeeperOAuth(
  rememberOnComputer = false,
  baseUrl = DEFAULT_BEEPER_API_BASE,
): Promise<void> {
  setRememberBeeperPreference(rememberOnComputer);
  assertTrustedApplicationOrigin();
  const client = new BeeperClient({ baseUrl });
  const info = await client.getInfo();
  assertSupportedBeeperInfo(info);
  const metadata = await discoverOAuthMetadata(baseUrl);
  const redirectURI = `${window.location.origin}${window.location.pathname}`;
  const registrationEndpoint = validateLocalOAuthEndpoint(
    metadata.registration_endpoint || info.endpoints.oauth?.registration_endpoint,
    baseUrl,
    'registration',
  );

  if (!registrationEndpoint) {
    throw new Error('Beeper did not advertise an OAuth registration endpoint.');
  }

  const clientID = await registerClient(
    registrationEndpoint,
    redirectURI,
  );
  const verifier = randomUrlSafeString(64);
  const challenge = await createCodeChallenge(verifier);
  const state = randomUrlSafeString(32);
  const pending: OAuthPendingState = {
    state,
    verifier,
    clientID,
    tokenEndpoint: validateLocalOAuthEndpoint(
      metadata.token_endpoint,
      baseUrl,
      'token',
    ),
    redirectURI,
  };
  sessionStorage.setItem(OAUTH_STATE_KEY, JSON.stringify(pending));

  const authorizationURL = new URL(
    validateLocalOAuthEndpoint(
      metadata.authorization_endpoint,
      baseUrl,
      'authorization',
    ),
  );
  authorizationURL.searchParams.set('response_type', 'code');
  authorizationURL.searchParams.set('client_id', clientID);
  authorizationURL.searchParams.set('redirect_uri', redirectURI);
  authorizationURL.searchParams.set('code_challenge', challenge);
  authorizationURL.searchParams.set('code_challenge_method', 'S256');
  authorizationURL.searchParams.set('state', state);

  const configuredScope = import.meta.env.VITE_BEEPER_OAUTH_SCOPE?.trim();
  const defaultScope = metadata.scopes_supported
    ?.filter((scope) => scope === 'read' || scope === 'write')
    .join(' ');
  const requestedScope = configuredScope || defaultScope || 'read write';
  if (requestedScope) authorizationURL.searchParams.set('scope', requestedScope);

  window.location.assign(authorizationURL);
}

export function completeBeeperOAuthCallback(): Promise<string | null> {
  const currentURL = new URL(window.location.href);
  const code = currentURL.searchParams.get('code');
  const oauthError = currentURL.searchParams.get('error');
  if (!code && !oauthError) {
    return oauthCallbackCompletion ?? Promise.resolve(getStoredAccessToken());
  }

  oauthCallbackCompletion ??= exchangeOAuthCallback(currentURL);
  return oauthCallbackCompletion;
}

async function exchangeOAuthCallback(currentURL: URL): Promise<string> {
  const code = currentURL.searchParams.get('code');
  const returnedState = currentURL.searchParams.get('state');
  const oauthError = currentURL.searchParams.get('error');
  clearOAuthQuery(currentURL);
  assertTrustedApplicationOrigin();
  const stored = sessionStorage.getItem(OAUTH_STATE_KEY);
  const pending = parseOAuthPendingState(stored);
  if (!returnedState || returnedState !== pending.state) {
    sessionStorage.removeItem(OAUTH_STATE_KEY);
    throw new Error('The Beeper authorization response could not be verified.');
  }
  const expectedCallback = new URL(pending.redirectURI);
  if (
    expectedCallback.origin !== window.location.origin ||
    expectedCallback.pathname !== window.location.pathname
  ) {
    sessionStorage.removeItem(OAUTH_STATE_KEY);
    throw new Error('The Beeper authorization callback does not match this OpenStation page.');
  }
  if (oauthError) {
    sessionStorage.removeItem(OAUTH_STATE_KEY);
    throw new Error('Beeper authorization was cancelled or declined.');
  }
  if (!code) {
    sessionStorage.removeItem(OAUTH_STATE_KEY);
    throw new Error('Beeper did not return an authorization code.');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: pending.clientID,
    redirect_uri: pending.redirectURI,
    code_verifier: pending.verifier,
  });
  const tokenEndpoint = validateLocalOAuthEndpoint(
    pending.tokenEndpoint,
    DEFAULT_BEEPER_API_BASE,
    'token',
  );
  const response = await fetchLocalOAuth(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new BeeperApiError(
      'Beeper could not finish the local authorization.',
      response.status,
      response.status === 401 ? 'unauthorized' : 'oauth_unavailable',
    );
  }
  const token = (await response.json()) as BeeperTokenResponse;
  if (!token.access_token || token.token_type?.toLowerCase() !== 'bearer') {
    throw new Error('Beeper did not return a valid bearer access token.');
  }
  if (token.expires_in !== undefined && (!Number.isFinite(token.expires_in) || token.expires_in <= 0)) {
    throw new Error('Beeper returned an invalid access-token lifetime.');
  }

  storeAccessToken(
    token.access_token,
    token.expires_in ? Date.now() + token.expires_in * 1_000 : null,
  );
  sessionStorage.removeItem(OAUTH_STATE_KEY);
  return token.access_token;
}

function setRememberBeeperPreference(rememberOnComputer: boolean): void {
  if (rememberOnComputer) {
    window.localStorage.setItem(REMEMBER_BEEPER_KEY, 'true');
    return;
  }
  window.localStorage.removeItem(REMEMBER_BEEPER_KEY);
  clearAccessToken(window.localStorage);
}

function storeAccessToken(token: string, expiresAt: number | null): void {
  const storage = isBeeperRemembered() ? window.localStorage : sessionStorage;
  const otherStorage = storage === sessionStorage ? window.localStorage : sessionStorage;
  clearAccessToken(otherStorage);
  storage.setItem(ACCESS_TOKEN_KEY, token);
  if (expiresAt) {
    storage.setItem(ACCESS_TOKEN_EXPIRES_KEY, String(expiresAt));
  } else {
    storage.removeItem(ACCESS_TOKEN_EXPIRES_KEY);
  }
}

function clearAccessToken(storage: Storage): void {
  storage.removeItem(ACCESS_TOKEN_KEY);
  storage.removeItem(ACCESS_TOKEN_SOURCE_KEY);
  storage.removeItem(ACCESS_TOKEN_EXPIRES_KEY);
}

export async function introspectBeeperAccessToken(
  token: string,
  advertisedEndpoint?: string,
  baseUrl = DEFAULT_BEEPER_API_BASE,
): Promise<boolean> {
  const endpoint = advertisedEndpoint
    ? validateLocalOAuthEndpoint(advertisedEndpoint, baseUrl, 'introspection')
    : validateLocalOAuthEndpoint(
        (await discoverOAuthMetadata(baseUrl)).introspection_endpoint,
        baseUrl,
        'introspection',
      );
  const response = await fetchLocalOAuth(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      token,
      token_type_hint: 'access_token',
    }),
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new BeeperApiError('Beeper authorization is invalid or expired.', 401, 'unauthorized');
    }
    throw new BeeperApiError(
      'Beeper could not validate the saved authorization.',
      response.status,
      'oauth_unavailable',
    );
  }
  const result = (await response.json()) as { active?: unknown };
  return result.active === true;
}

export async function revokeBeeperAccessToken(
  token: string,
  advertisedEndpoint?: string,
  baseUrl = DEFAULT_BEEPER_API_BASE,
): Promise<void> {
  const endpoint = advertisedEndpoint
    ? validateLocalOAuthEndpoint(advertisedEndpoint, baseUrl, 'revocation')
    : validateLocalOAuthEndpoint(
        (await discoverOAuthMetadata(baseUrl)).revocation_endpoint,
        baseUrl,
        'revocation',
      );
  const response = await fetchLocalOAuth(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      token,
      token_type_hint: 'access_token',
    }),
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new BeeperApiError(
      'Beeper could not revoke the local authorization.',
      response.status,
      'oauth_unavailable',
    );
  }
}

export async function createCodeChallenge(verifier: string): Promise<string> {
  const encoded = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return base64Url(new Uint8Array(digest));
}

async function discoverOAuthMetadata(baseUrl: string): Promise<BeeperOAuthMetadata> {
  const response = await fetchLocalOAuth(
    `${baseUrl.replace(/\/$/, '')}/.well-known/oauth-authorization-server`,
    {
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!response.ok) {
    throw new BeeperApiError(
      'Beeper did not provide its local authorization settings.',
      response.status,
      'oauth_unavailable',
    );
  }
  return (await response.json()) as BeeperOAuthMetadata;
}

function validateLocalOAuthEndpoint(
  value: string | undefined,
  baseUrl: string,
  label: string,
): string {
  if (!value) throw new Error(`Beeper did not advertise an OAuth ${label} endpoint.`);
  normalizeBeeperBaseUrl(baseUrl);
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new Error(`Beeper advertised an invalid OAuth ${label} endpoint.`);
  }
  const trustedOrigin = normalizeBeeperBaseUrl(baseUrl);
  if (
    normalizeBeeperBaseUrl(endpoint.origin) !== trustedOrigin ||
    endpoint.username ||
    endpoint.password
  ) {
    throw new Error(`Beeper advertised an unsafe OAuth ${label} endpoint.`);
  }
  return endpoint.href;
}

function parseOAuthPendingState(value: string | null): OAuthPendingState {
  if (!value) throw new Error('The Beeper authorization session expired.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    sessionStorage.removeItem(OAUTH_STATE_KEY);
    throw new Error('The Beeper authorization session is invalid.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    sessionStorage.removeItem(OAUTH_STATE_KEY);
    throw new Error('The Beeper authorization session is invalid.');
  }
  const pending = parsed as Record<string, unknown>;
  const fields = ['state', 'verifier', 'clientID', 'tokenEndpoint', 'redirectURI'] as const;
  if (fields.some((field) => typeof pending[field] !== 'string' || !pending[field])) {
    sessionStorage.removeItem(OAUTH_STATE_KEY);
    throw new Error('The Beeper authorization session is invalid.');
  }
  return pending as unknown as OAuthPendingState;
}

function assertTrustedApplicationOrigin(): void {
  if (!import.meta.env.DEV && window.location.origin !== 'https://openstation.chat') {
    throw new Error('Beeper connection is available only at https://openstation.chat.');
  }
}

async function registerClient(
  registrationEndpoint: string,
  redirectURI: string,
): Promise<string> {
  // Desktop API restarts can invalidate registered client IDs independently of
  // the browser's storage. Registration is local and side-effect free, so a
  // fresh public client is safer than reusing an unverifiable cached ID.
  const response = await fetchLocalOAuth(registrationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'OpenStation Neighborhoods',
      redirect_uris: [redirectURI],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new BeeperApiError(
      'Beeper could not register OpenStation as a local client.',
      response.status,
      'oauth_unavailable',
    );
  }
  const registration = (await response.json()) as BeeperOAuthClientRegistration;
  if (!registration.client_id?.trim()) {
    throw new Error('Beeper did not return a valid OAuth client ID.');
  }
  return registration.client_id;
}

async function fetchLocalOAuth(
  input: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    throw new BeeperApiError(
      timedOut
        ? 'Beeper Desktop did not answer before the authorization request timed out.'
        : aborted
          ? 'The Beeper authorization request was cancelled.'
          : 'Could not reach Beeper Desktop for local authorization.',
      0,
      timedOut ? 'timeout' : aborted ? 'aborted' : 'network_error',
    );
  }
}

function randomUrlSafeString(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return base64Url(bytes);
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function clearOAuthQuery(url: URL): void {
  ['code', 'state', 'error', 'error_description'].forEach((key) =>
    url.searchParams.delete(key),
  );
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}
