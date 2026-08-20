import { BeeperClient, DEFAULT_BEEPER_API_BASE } from './client';
import type {
  BeeperOAuthClientRegistration,
  BeeperOAuthMetadata,
  BeeperTokenResponse,
} from './types';

const OAUTH_STATE_KEY = 'openstation-neighborhoods:oauth-state';
const OAUTH_CLIENT_KEY = 'openstation-neighborhoods:oauth-client';
const ACCESS_TOKEN_KEY = 'openstation-neighborhoods:access-token';

interface OAuthPendingState {
  state: string;
  verifier: string;
  clientID: string;
  tokenEndpoint: string;
  redirectURI: string;
}

interface StoredClient {
  clientID: string;
  registrationEndpoint: string;
  redirectURI: string;
}

// React StrictMode deliberately mounts effects twice in development. Keep the
// callback exchange shared so the authorization code is consumed only once and
// both effect instances observe the same result.
let oauthCallbackCompletion: Promise<string | null> | null = null;

export function getStoredAccessToken(): string | null {
  return sessionStorage.getItem(ACCESS_TOKEN_KEY);
}

export function storeManualAccessToken(token: string): void {
  sessionStorage.setItem(ACCESS_TOKEN_KEY, token.trim());
}

export function disconnectBeeper(): void {
  oauthCallbackCompletion = null;
  sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  sessionStorage.removeItem(OAUTH_STATE_KEY);
}

export function invalidateBeeperAuthorization(): void {
  disconnectBeeper();
  window.localStorage.removeItem(OAUTH_CLIENT_KEY);
}

export async function beginBeeperOAuth(
  baseUrl = DEFAULT_BEEPER_API_BASE,
): Promise<void> {
  const client = new BeeperClient({ baseUrl });
  const info = await client.getInfo();
  const metadata = await discoverOAuthMetadata(baseUrl);
  const redirectURI = `${window.location.origin}${window.location.pathname}`;
  const registrationEndpoint =
    metadata.registration_endpoint || info.endpoints.oauth?.registration_endpoint;

  if (!registrationEndpoint) {
    throw new Error('Beeper did not advertise an OAuth registration endpoint.');
  }

  const registeredClient = await registerClient(
    registrationEndpoint,
    redirectURI,
  );
  const verifier = randomUrlSafeString(64);
  const challenge = await createCodeChallenge(verifier);
  const state = randomUrlSafeString(32);
  const pending: OAuthPendingState = {
    state,
    verifier,
    clientID: registeredClient.clientID,
    tokenEndpoint: metadata.token_endpoint,
    redirectURI,
  };
  sessionStorage.setItem(OAUTH_STATE_KEY, JSON.stringify(pending));

  const authorizationURL = new URL(metadata.authorization_endpoint);
  authorizationURL.searchParams.set('response_type', 'code');
  authorizationURL.searchParams.set('client_id', registeredClient.clientID);
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
  const oauthErrorDescription = currentURL.searchParams.get('error_description');

  clearOAuthQuery(currentURL);
  if (oauthError) {
    throw new Error(
      oauthErrorDescription || `Beeper authorization failed: ${oauthError}`,
    );
  }

  const stored = sessionStorage.getItem(OAUTH_STATE_KEY);
  if (!stored) throw new Error('The Beeper authorization session expired.');
  const pending = JSON.parse(stored) as OAuthPendingState;
  if (!returnedState || returnedState !== pending.state) {
    throw new Error('The Beeper authorization response could not be verified.');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: code as string,
    client_id: pending.clientID,
    redirect_uri: pending.redirectURI,
    code_verifier: pending.verifier,
  });
  const response = await fetch(pending.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error(`Beeper could not finish authorization (${response.status}).`);
  }
  const token = (await response.json()) as BeeperTokenResponse;
  if (!token.access_token) throw new Error('Beeper did not return an access token.');

  sessionStorage.setItem(ACCESS_TOKEN_KEY, token.access_token);
  sessionStorage.removeItem(OAUTH_STATE_KEY);
  return token.access_token;
}

export async function createCodeChallenge(verifier: string): Promise<string> {
  const encoded = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return base64Url(new Uint8Array(digest));
}

async function discoverOAuthMetadata(baseUrl: string): Promise<BeeperOAuthMetadata> {
  const response = await fetch(
    `${baseUrl.replace(/\/$/, '')}/.well-known/oauth-authorization-server`,
    { signal: AbortSignal.timeout(8_000) },
  );
  if (!response.ok) {
    throw new Error(`Beeper OAuth discovery failed (${response.status}).`);
  }
  return (await response.json()) as BeeperOAuthMetadata;
}

async function registerClient(
  registrationEndpoint: string,
  redirectURI: string,
): Promise<StoredClient> {
  // Desktop API restarts can invalidate registered client IDs independently of
  // the browser's storage. Registration is local and side-effect free, so a
  // fresh public client is safer than reusing an unverifiable cached ID.
  const response = await fetch(registrationEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'OpenStation Neighborhoods',
      redirect_uris: [redirectURI],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error(`Beeper rejected the local OAuth client (${response.status}).`);
  }
  const registration = (await response.json()) as BeeperOAuthClientRegistration;
  const stored: StoredClient = {
    clientID: registration.client_id,
    registrationEndpoint,
    redirectURI,
  };
  return stored;
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
