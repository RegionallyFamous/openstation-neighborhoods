import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  completeBeeperOAuthCallback,
  createCodeChallenge,
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
  });

  it('creates the RFC 7636 S256 challenge', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    await expect(createCodeChallenge(verifier)).resolves.toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('keeps Beeper cancellation details while cleaning the callback URL', async () => {
    window.history.replaceState(
      {},
      '',
      '/?error=access_denied&error_description=The+neighbor+said+no',
    );

    await expect(completeBeeperOAuthCallback()).rejects.toThrow(
      'The neighbor said no',
    );
    expect(window.location.search).toBe('');
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
    expect(String(init?.body)).toContain('token=approved-token');
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
