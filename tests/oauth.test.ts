import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  completeBeeperOAuthCallback,
  createCodeChallenge,
  disconnectBeeper,
  getStoredAccessToken,
  hasStoredBeeperSession,
  introspectBeeperAccessToken,
  invalidateBeeperAuthorization,
  revokeBeeperAccessToken,
} from '../src/beeper/oauth';

describe('Beeper OAuth PKCE', () => {
  beforeEach(() => {
    sessionStorage.clear();
    const entries = new Map<string, string>();
    const storage: Storage = {
      get length() {
        return entries.size;
      },
      clear: () => entries.clear(),
      getItem: (key) => entries.get(key) ?? null,
      key: (index) => [...entries.keys()][index] ?? null,
      removeItem: (key) => {
        entries.delete(key);
      },
      setItem: (key, value) => {
        entries.set(key, value);
      },
    };
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: storage,
    });
    vi.stubGlobal('localStorage', storage);
    disconnectBeeper();
    window.history.replaceState({}, '', '/');
  });

  it('creates the RFC 7636 S256 challenge', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    await expect(createCodeChallenge(verifier)).resolves.toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('verifies Beeper cancellation state, uses safe copy, and cleans the callback URL', async () => {
    sessionStorage.setItem(
      'openstation-neighborhoods:oauth-state',
      JSON.stringify({
        state: 'verified-state',
        verifier: 'test-verifier',
        clientID: 'test-client',
        tokenEndpoint: 'http://127.0.0.1:23373/oauth/token',
        redirectURI: `${window.location.origin}/`,
      }),
    );
    window.history.replaceState(
      {},
      '',
      '/?error=access_denied&error_description=Untrusted+callback+copy&state=verified-state',
    );

    await expect(completeBeeperOAuthCallback()).rejects.toThrow(
      'cancelled or declined',
    );
    expect(window.location.search).toBe('');
    expect(sessionStorage.getItem('openstation-neighborhoods:oauth-state')).toBeNull();
  });

  it('clears stale tokens and client registration after Beeper restarts', () => {
    sessionStorage.setItem('openstation-neighborhoods:access-token', 'stale-token');
    sessionStorage.setItem('openstation-neighborhoods:oauth-state', 'stale-state');
    window.localStorage.setItem('openstation-neighborhoods:oauth-client', 'stale-client');

    invalidateBeeperAuthorization();

    expect(sessionStorage.getItem('openstation-neighborhoods:access-token')).toBeNull();
    expect(sessionStorage.getItem('openstation-neighborhoods:oauth-state')).toBeNull();
    expect(window.localStorage.getItem('openstation-neighborhoods:oauth-client')).toBeNull();
  });

  it('clears an access token after its stored expiry time', () => {
    sessionStorage.setItem('openstation-neighborhoods:access-token', 'expired-token');
    sessionStorage.setItem(
      'openstation-neighborhoods:access-token-expires',
      String(Date.now() - 1_000),
    );

    expect(getStoredAccessToken()).toBeNull();
    expect(sessionStorage.getItem('openstation-neighborhoods:access-token')).toBeNull();
  });

  it('recognizes a saved token for a same-tab refresh', () => {
    sessionStorage.setItem('openstation-neighborhoods:access-token', 'still-active-token');

    expect(hasStoredBeeperSession()).toBe(true);
    expect(getStoredAccessToken()).toBe('still-active-token');
  });

  it('keeps OAuth approval session-only by default', async () => {
    storePendingOAuthState();
    window.history.replaceState({}, '', '/?code=approved-code&state=verified-state');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(tokenResponse('session-token')));

    await expect(completeBeeperOAuthCallback()).resolves.toBe('session-token');

    expect(sessionStorage.getItem('openstation-neighborhoods:access-token')).toBe('session-token');
    expect(localStorage.getItem('openstation-neighborhoods:access-token')).toBeNull();
    expect(localStorage.getItem('openstation-neighborhoods:remember-beeper')).toBeNull();
  });

  it('restores an explicitly remembered approval after tab storage is cleared', async () => {
    localStorage.setItem('openstation-neighborhoods:remember-beeper', 'true');
    storePendingOAuthState();
    window.history.replaceState({}, '', '/?code=approved-code&state=verified-state');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(tokenResponse('remembered-token')));

    await expect(completeBeeperOAuthCallback()).resolves.toBe('remembered-token');
    expect(sessionStorage.getItem('openstation-neighborhoods:access-token')).toBeNull();
    expect(localStorage.getItem('openstation-neighborhoods:access-token')).toBe('remembered-token');

    sessionStorage.clear();
    expect(hasStoredBeeperSession()).toBe(true);
    expect(getStoredAccessToken()).toBe('remembered-token');
  });

  it('clears an expired remembered approval and its remember setting', () => {
    localStorage.setItem('openstation-neighborhoods:remember-beeper', 'true');
    localStorage.setItem('openstation-neighborhoods:access-token', 'expired-remembered-token');
    localStorage.setItem(
      'openstation-neighborhoods:access-token-expires',
      String(Date.now() - 1_000),
    );

    expect(getStoredAccessToken()).toBeNull();
    expect(localStorage.getItem('openstation-neighborhoods:access-token')).toBeNull();
    expect(localStorage.getItem('openstation-neighborhoods:remember-beeper')).toBeNull();
  });

  it('disconnects and forgets both session and persistent approvals', () => {
    sessionStorage.setItem('openstation-neighborhoods:access-token', 'session-token');
    localStorage.setItem('openstation-neighborhoods:remember-beeper', 'true');
    localStorage.setItem('openstation-neighborhoods:access-token', 'remembered-token');

    disconnectBeeper();

    expect(sessionStorage.getItem('openstation-neighborhoods:access-token')).toBeNull();
    expect(localStorage.getItem('openstation-neighborhoods:access-token')).toBeNull();
    expect(localStorage.getItem('openstation-neighborhoods:remember-beeper')).toBeNull();
  });

  it('introspects an access token using Beeper OAuth metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ active: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      introspectBeeperAccessToken(
        'approved-token',
        'http://127.0.0.1:23373/oauth/introspect',
      ),
    ).resolves.toBe(true);
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('error');
    expect(String(init?.body)).toContain('token=approved-token');
  });

  it('classifies a failed local OAuth request without exposing the token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('synthetic network failure')));

    await expect(
      introspectBeeperAccessToken(
        'secret-approved-token',
        'http://127.0.0.1:23373/oauth/introspect',
      ),
    ).rejects.toMatchObject({
      name: 'BeeperApiError',
      status: 0,
      code: 'network_error',
      message: expect.not.stringContaining('secret-approved-token'),
    });
  });

  it('rejects an OAuth endpoint on a different loopback origin', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      introspectBeeperAccessToken(
        'approved-token',
        'http://localhost:23373/oauth/introspect',
      ),
    ).rejects.toThrow('127.0.0.1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('revokes an OAuth token through the advertised local endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await revokeBeeperAccessToken(
      'approved-token',
      'http://127.0.0.1:23373/oauth/revoke',
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:23373/oauth/revoke',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

function storePendingOAuthState(): void {
  sessionStorage.setItem(
    'openstation-neighborhoods:oauth-state',
    JSON.stringify({
      state: 'verified-state',
      verifier: 'test-verifier',
      clientID: 'test-client',
      tokenEndpoint: 'http://127.0.0.1:23373/oauth/token',
      redirectURI: `${window.location.origin}/`,
    }),
  );
}

function tokenResponse(accessToken: string): Response {
  return new Response(JSON.stringify({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 3_600,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
