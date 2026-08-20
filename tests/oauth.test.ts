import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  completeBeeperOAuthCallback,
  createCodeChallenge,
  invalidateBeeperAuthorization,
} from '../src/beeper/oauth';

describe('Beeper OAuth PKCE', () => {
  beforeEach(() => {
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
});
