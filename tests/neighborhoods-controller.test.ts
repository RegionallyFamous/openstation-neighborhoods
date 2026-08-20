import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectPanel } from '../src/components/ConnectPanel';
import { MioCompanion } from '../src/components/MioCompanion';
import { shouldRestoreBeeperSession } from '../src/App';
import { flattenChannels } from '../src/community';
import {
  useNeighborhoods,
  fetchNewMessagePages,
  reconcileCommunityMessages,
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
  it('restores a saved tab without reopening onboarding', () => {
    expect(shouldRestoreBeeperSession('https://openstation.chat/', true)).toBe(true);
    expect(shouldRestoreBeeperSession('https://openstation.chat/?code=fresh', false)).toBe(true);
    expect(shouldRestoreBeeperSession('https://openstation.chat/', false)).toBe(false);
  });

  it('drains every newer cursor page without leaving a message gap', async () => {
    const message = (id: string, timestamp: string) => ({
      id,
      chatID: '!general:beeper.com',
      senderID: '@nick:beeper.com',
      timestamp,
      text: id,
      isEdited: false,
      removed: false,
      attachments: [],
    });
    const getMessagesPage = vi.fn()
      .mockResolvedValueOnce({
        items: [message('$third', '2026-08-20T00:00:03.000Z')],
        hasMore: true,
        oldestCursor: 'cursor-3',
        newestCursor: 'cursor-3',
      })
      .mockResolvedValueOnce({
        items: [message('$fourth', '2026-08-20T00:00:04.000Z')],
        hasMore: false,
        oldestCursor: 'cursor-4',
        newestCursor: 'cursor-4',
      });

    await expect(fetchNewMessagePages(
      { getMessagesPage },
      '!general:beeper.com',
      'cursor-2',
    )).resolves.toMatchObject({
      items: [{ id: '$third' }, { id: '$fourth' }],
      newestCursor: 'cursor-4',
    });
    expect(getMessagesPage).toHaveBeenNthCalledWith(1, '!general:beeper.com', {
      cursor: 'cursor-2',
      direction: 'after',
    });
    expect(getMessagesPage).toHaveBeenNthCalledWith(2, '!general:beeper.com', {
      cursor: 'cursor-3',
      direction: 'after',
    });
  });

  it('removes a displayed message when Beeper returns its deletion tombstone', () => {
    const displayed = {
      id: '$deleted-later',
      channelId: 'general',
      author: {
        id: '@nick:beeper.com',
        name: 'Nick',
        handle: '@nick',
        avatar: 'N',
        color: '#9f98ff',
        presence: 'unknown' as const,
        role: 'member' as const,
      },
      body: 'This will be deleted',
      sentAt: '2026-08-20T00:00:00.000Z',
      attachments: [],
    };

    expect(reconcileCommunityMessages([displayed], [], ['$deleted-later'])).toEqual([]);
  });

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

  it('restores from Beeper account data without waiting on a Matrix profile lookup', async () => {
    sessionStorage.setItem(ACCESS_TOKEN_KEY, 'valid-synthetic-token');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === '/v1/info') {
        return jsonResponse(beeperInfoV5);
      }
      if (url.pathname === '/oauth/introspect') {
        return jsonResponse({ active: true });
      }
      if (url.pathname === '/v1/accounts') {
        return jsonResponse([{
          accountID: 'matrix',
          bridge: { id: 'matrix', provider: 'cloud', type: 'matrix' },
          network: 'Beeper',
          status: 'connected',
          user: {
            id: '@teddy:beeper.com',
            username: 'teddy:beeper.com',
            fullName: 'Teddy',
            isSelf: true,
          },
        }]);
      }
      const chatMatch = url.pathname.match(/^\/v1\/chats\/([^/]+)$/);
      if (chatMatch) {
        const roomID = decodeURIComponent(chatMatch[1]);
        return jsonResponse({
          id: roomID,
          accountID: 'matrix',
          network: 'Beeper',
          title: 'OpenStation room',
          unreadCount: 0,
          unreadMentionsCount: 0,
          participants: { items: [], hasMore: false, total: 0 },
        });
      }
      if (/^\/v1\/chats\/[^/]+\/messages$/.test(url.pathname)) {
        return jsonResponse({
          items: [],
          hasMore: false,
          oldestCursor: null,
          newestCursor: null,
        });
      }
      throw new Error(`Unexpected Beeper request: ${url.pathname}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    let controller: NeighborhoodsController | null = null;
    function Harness() {
      controller = useNeighborhoods();
      return null;
    }

    await act(async () => root?.render(createElement(Harness)));
    await flushReactUntil(
      () => controller?.connection.kind === 'connected' && !controller.isBusy,
    );

    expect(controller?.connection).toMatchObject({
      kind: 'connected',
      accountName: 'Teddy',
      accountHandle: '@teddy',
    });
    expect(fetchMock.mock.calls.some(([input]) =>
      String(input).includes('/_matrix/client/v3/profile/'),
    )).toBe(false);
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

describe('Mio companion', () => {
  it('responds when a neighbor says hello', async () => {
    const general = flattenChannels().find((channel) => channel.id === 'general');
    expect(general).toBeDefined();

    await act(async () => {
      root?.render(createElement(MioCompanion, {
        channel: general!,
        mode: 'disconnected',
      }));
    });

    expect(container.textContent).toContain('Beeper first. Then snacks.');
    const mio = container.querySelector<HTMLButtonElement>('.mio-companion__button');
    expect(mio?.getAttribute('aria-expanded')).toBe('true');

    await act(async () => {
      mio?.click();
    });

    expect(container.textContent).toContain('I’ll hold the door.');
  });
});

describe('ConnectPanel recovery controls', () => {
  it('shows concrete progress while Beeper approval is opening', async () => {
    await act(async () => {
      root?.render(
        createElement(ConnectPanel, {
          open: true,
          connection: {
            kind: 'authorizing',
            message: 'Beeper has the invite. Waiting for your okay…',
          },
          mode: 'disconnected',
          busy: true,
          onClose: vi.fn(),
          onProbe: vi.fn().mockResolvedValue(true),
          onOAuth: vi.fn().mockResolvedValue(undefined),
          onDisconnect: vi.fn(),
        }),
      );
    });

    expect(container.querySelector('.connect-progress')).not.toBeNull();
    expect(container.textContent).toContain('Passing the invite to Beeper…');
    expect(container.textContent).toContain('Find Beeper');
    expect(container.textContent).toContain('Pass the invite');
    expect(container.textContent).toContain('Step inside');
    expect(container.querySelector<HTMLButtonElement>('.connect-primary')?.disabled).toBe(true);
  });

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
          onProbe: vi.fn().mockResolvedValue(true),
          onOAuth,
          onDisconnect: vi.fn(),
        }),
      );
    });

    const connectButton = container.querySelector<HTMLButtonElement>(
      'button.connect-primary',
    );
    const consent = container.querySelector<HTMLInputElement>('.join-consent input');
    expect(connectButton).not.toBeNull();
    expect(connectButton?.disabled).toBe(true);

    await act(async () => {
      consent?.click();
    });
    expect(connectButton?.disabled).toBe(false);

    await act(async () => {
      connectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onOAuth).toHaveBeenCalledOnce();
    expect(onOAuth).toHaveBeenCalledWith(true);
  });

  it('checks for Beeper and starts approval from one connect action', async () => {
    const onProbe = vi.fn().mockResolvedValue(true);
    const onOAuth = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root?.render(
        createElement(ConnectPanel, {
          open: true,
          connection: {
            kind: 'disconnected',
            message: 'Open Beeper on this computer to get started.',
          },
          mode: 'disconnected',
          busy: false,
          onClose: vi.fn(),
          onProbe,
          onOAuth,
          onDisconnect: vi.fn(),
        }),
      );
    });

    const connectButton = container.querySelector<HTMLButtonElement>(
      'button.connect-primary',
    );
    const consent = container.querySelector<HTMLInputElement>('.join-consent input');

    await act(async () => {
      consent?.click();
      connectButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onProbe).toHaveBeenCalledOnce();
    expect(onOAuth).toHaveBeenCalledOnce();
    expect(onOAuth).toHaveBeenCalledWith(true);
  });

  it('shows API troubleshooting only after Beeper cannot be found', async () => {
    await act(async () => {
      root?.render(
        createElement(ConnectPanel, {
          open: true,
          connection: {
            kind: 'disconnected',
            message: 'Open Beeper on this computer to get started.',
          },
          mode: 'disconnected',
          busy: false,
          onClose: vi.fn(),
          onProbe: vi.fn().mockResolvedValue(false),
          onOAuth: vi.fn().mockResolvedValue(undefined),
          onDisconnect: vi.fn(),
        }),
      );
    });

    expect(container.querySelector('.connect-troubleshooting')).toBeNull();
    expect(container.textContent).not.toContain('Desktop API is normally ready');

    await act(async () => {
      root?.render(
        createElement(ConnectPanel, {
          open: true,
          connection: {
            kind: 'unavailable',
            message: 'Beeper was not found on this computer',
          },
          mode: 'disconnected',
          busy: false,
          onClose: vi.fn(),
          onProbe: vi.fn().mockResolvedValue(false),
          onOAuth: vi.fn().mockResolvedValue(undefined),
          onDisconnect: vi.fn(),
        }),
      );
    });

    expect(container.querySelector('.connect-troubleshooting')).not.toBeNull();
    expect(container.textContent).toContain('Desktop API is normally ready');
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

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
