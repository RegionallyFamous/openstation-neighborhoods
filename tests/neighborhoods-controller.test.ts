import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectPanel } from '../src/components/ConnectPanel';
import {
  useNeighborhoods,
  resolveBeeperIdentityName,
  type NeighborhoodsController,
} from '../src/use-neighborhoods';
import { invalidTokenV5 } from './fixtures/beeper-v5';
import { beeperInfoV5 } from './fixtures/beeper-v5';

const ACCESS_TOKEN_KEY = 'openstation-neighborhoods:access-token';
const OAUTH_STATE_KEY = 'openstation-neighborhoods:oauth-state';
const OAUTH_CLIENT_KEY = 'openstation-neighborhoods:oauth-client';

let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  const testSessionStorage = memoryStorage();
  const testLocalStorage = memoryStorage();
  Object.defineProperty(window, 'sessionStorage', {
    configurable: true,
    value: testSessionStorage,
  });
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: testLocalStorage,
  });
  vi.stubGlobal('sessionStorage', testSessionStorage);
  vi.stubGlobal('localStorage', testLocalStorage);
  window.history.replaceState({}, '', '/');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Neighborhoods connection controller', () => {
  it('uses a real Beeper handle instead of the generic account placeholder', () => {
    expect(resolveBeeperIdentityName({
      id: '@nick:beeper.com',
      username: '@nick:beeper.com',
      fullName: 'Beeper User',
    }, '@nick:beeper.com')).toBe('nick');

    expect(resolveBeeperIdentityName({
      id: '@nick:beeper.com',
      username: '@nick:beeper.com',
      fullName: 'Teddy',
    }, '@nick:beeper.com')).toBe('Teddy');
  });

  it('clears a stale 401 token and returns to a reconnectable state', async () => {
    sessionStorage.setItem(ACCESS_TOKEN_KEY, 'stale-synthetic-token');
    sessionStorage.setItem(OAUTH_STATE_KEY, 'stale-synthetic-state');
    localStorage.setItem(OAUTH_CLIENT_KEY, 'stale-synthetic-client');

    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/v1/info') {
        return new Response(JSON.stringify(beeperInfoV5), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(invalidTokenV5), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    let controller: NeighborhoodsController | null = null;
    function Harness() {
      controller = useNeighborhoods();
      return null;
    }

    await act(async () => root?.render(createElement(Harness)));
    await flushReactUntil(
      () => controller?.connection.kind === 'available' && !controller.isBusy,
    );

    expect(controller).toMatchObject({
      mode: 'disconnected',
      connection: {
        kind: 'available',
        message: expect.stringContaining('Connect again'),
      },
      isBusy: false,
      messages: [],
      members: [],
    });
    expect(sessionStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
    expect(sessionStorage.getItem(OAUTH_STATE_KEY)).toBeNull();
    expect(localStorage.getItem(OAUTH_CLIENT_KEY)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [introspectionInput, introspectionInit] = fetchMock.mock.calls[1];
    expect(String(introspectionInput)).toContain('/oauth/introspect');
    expect(String(introspectionInit?.body)).toContain('token=stale-synthetic-token');
  });
});

describe('ConnectPanel recovery controls', () => {
  it('keeps the primary OAuth action usable after a connection error', async () => {
    const onOAuth = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root?.render(
        createElement(ConnectPanel, {
          open: true,
          connection: {
            kind: 'error',
            message: 'The previous authorization needs attention.',
          },
          mode: 'disconnected',
          busy: false,
          onClose: vi.fn(),
          onProbe: vi.fn().mockResolvedValue(undefined),
          onOAuth,
          onToken: vi.fn().mockResolvedValue(undefined),
          onDisconnect: vi.fn(),
        }),
      );
    });

    const connectButton = container.querySelector<HTMLButtonElement>(
      'button.connect-primary',
    );
    expect(connectButton).not.toBeNull();
    expect(connectButton?.disabled).toBe(false);

    await act(async () => {
      connectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onOAuth).toHaveBeenCalledOnce();
  });
});

async function flushReactUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  }
  throw new Error('React state did not settle before the test deadline.');
}

function memoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
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
}
