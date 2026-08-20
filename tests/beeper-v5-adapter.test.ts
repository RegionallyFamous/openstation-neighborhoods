import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BeeperClient,
  normalizeAccount,
  normalizeBeeperBaseUrl,
  normalizeChat,
  normalizeMessage,
  normalizeResourceURL,
} from '../src/beeper/client';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Beeper API v5 adapter', () => {
  it('normalizes participant pagination from the current chat shape', () => {
    expect(
      normalizeChat({
        id: '!general:beeper.com',
        accountID: 'matrix',
        network: 'Beeper',
        title: 'OpenStation · General',
        unreadCount: 3,
        participants: {
          items: [{ id: '@nick:beeper.com', fullName: 'Nick' }],
          hasMore: true,
          total: 12,
        },
      }),
    ).toMatchObject({
      accountID: 'matrix',
      participants: [{ id: '@nick:beeper.com', fullName: 'Nick' }],
      participantsHasMore: true,
      participantsTotal: 12,
    });
  });

  it('normalizes current sender, edit, attachment, and participant reaction fields', () => {
    expect(
      normalizeMessage(
        {
          id: '$event',
          chatID: '!general:beeper.com',
          accountID: 'matrix',
          senderID: '@june:beeper.com',
          senderName: 'June',
          timestamp: '2026-08-19T12:00:00Z',
          sortKey: '123',
          type: 'TEXT',
          text: 'Hello from Beeper',
          editedTimestamp: '2026-08-19T12:01:00Z',
          reactions: [
            {
              id: '@nick:beeper.com|✨',
              reactionKey: '✨',
              participantID: '@nick:beeper.com',
            },
            {
              id: '@june:beeper.com|✨',
              reactionKey: '✨',
              participantID: '@june:beeper.com',
            },
          ],
          attachments: [
            {
              id: 'mxc://beeper/image',
              type: 'img',
              fileName: 'demo.png',
              srcURL: 'https://cdn.example/demo.png',
            },
          ],
        },
        '@nick:beeper.com',
      ),
    ).toMatchObject({
      sender: { id: '@june:beeper.com', fullName: 'June' },
      isEdited: true,
      reactions: [
        {
          key: '✨',
          count: 2,
          mine: true,
          participantIDs: ['@nick:beeper.com', '@june:beeper.com'],
        },
      ],
      attachments: [
        { type: 'img', srcURL: 'https://cdn.example/demo.png' },
      ],
    });
  });

  it('omits hidden, deleted, and standalone reaction events', () => {
    const message = {
      id: '$event',
      chatID: '!general:beeper.com',
      senderID: '@june:beeper.com',
      timestamp: '2026-08-19T12:00:00Z',
      text: 'secret',
    };
    expect(normalizeMessage({ ...message, isHidden: true })).toBeNull();
    expect(normalizeMessage({ ...message, isDeleted: true })).toBeNull();
    expect(normalizeMessage({ ...message, type: 'REACTION' })).toBeNull();
  });

  it('normalizes current account bridge and status fields', () => {
    expect(
      normalizeAccount({
        accountID: 'matrix',
        bridge: { id: 'matrix', provider: 'cloud', type: 'matrix' },
        network: 'Beeper',
        status: 'connected',
        user: { id: '@nick:beeper.com', fullName: 'Nick' },
      }),
    ).toMatchObject({
      accountID: 'matrix',
      bridge: { provider: 'cloud', type: 'matrix' },
      status: 'connected',
      user: { id: '@nick:beeper.com', fullName: 'Nick' },
    });
  });

  it('scopes chat listing to Matrix and preserves cursor metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        items: [
          {
            id: '!general:beeper.com',
            accountID: 'matrix',
            network: 'Beeper',
            title: 'OpenStation · General',
            unreadCount: 0,
            participants: { items: [], hasMore: false, total: 0 },
          },
        ],
        hasMore: true,
        oldestCursor: 'older|cursor',
        newestCursor: 'newer|cursor',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const page = await new BeeperClient({ token: 'test-token' }).getChatsPage();
    expect(page).toMatchObject({
      hasMore: true,
      oldestCursor: 'older|cursor',
      newestCursor: 'newer|cursor',
    });
    expect(page.items).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:23373/v1/chats?accountIDs=matrix',
      expect.any(Object),
    );
  });

  it('preserves message cursors while dropping non-display events', async () => {
    const common = {
      chatID: '!general:beeper.com',
      senderID: '@june:beeper.com',
      timestamp: '2026-08-19T12:00:00Z',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          items: [
            { ...common, id: '$shown', text: 'Hello' },
            { ...common, id: '$hidden', text: 'Secret', isHidden: true },
          ],
          hasMore: false,
          oldestCursor: 'old',
          newestCursor: 'new',
        }),
      ),
    );

    const page = await new BeeperClient({ token: 'test-token' }).getMessagesPage(
      '!general:beeper.com',
      { cursor: 'next|page', direction: 'before' },
    );
    expect(page.items.map((message) => message.id)).toEqual(['$shown']);
    expect(page).toMatchObject({ oldestCursor: 'old', newestCursor: 'new' });
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:23373/v1/chats/!general%3Abeeper.com/messages?cursor=next%7Cpage&direction=before',
      expect.any(Object),
    );
  });

  it('retrieves complete room details with all participants', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: '!general:beeper.com',
        accountID: 'matrix',
        network: 'Beeper',
        title: 'OpenStation · General',
        isReadOnly: true,
        participants: {
          items: [
            {
              id: '@nick:beeper.com',
              fullName: 'Nick',
              imgURL: 'mxc://beeper.com/avatar',
            },
          ],
          hasMore: false,
          total: 1,
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      new BeeperClient({ token: 'test-token' }).getChat('!general:beeper.com'),
    ).resolves.toMatchObject({
      isReadOnly: true,
      participants: [{ imgURL: 'mxc://beeper.com/avatar' }],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:23373/v1/chats/!general%3Abeeper.com?maxParticipantCount=-1',
      expect.any(Object),
    );
  });

  it('retrieves send status and removes an existing reaction', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id: '$message',
          chatID: '!general:beeper.com',
          senderID: '@nick:beeper.com',
          timestamp: '2026-08-19T12:00:00Z',
          text: 'Delivered',
          sendStatus: {
            status: 'SUCCESS',
            timestamp: '2026-08-19T12:00:01Z',
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new BeeperClient({ token: 'test-token' });
    await expect(
      client.getMessage('!general:beeper.com', 'pending|message'),
    ).resolves.toMatchObject({ sendStatus: { status: 'SUCCESS' } });
    await client.deleteReaction('!general:beeper.com', '$message', '✨');

    expect(fetchMock.mock.calls[1][0]).toBe(
      'http://localhost:23373/v1/chats/!general%3Abeeper.com/messages/%24message/reactions/%E2%9C%A8',
    );
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'DELETE' });
  });

  it('streams Beeper-local assets once and reuses the blob URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Blob(['avatar'], { type: 'image/png' }), { status: 200 }),
    );
    const createObjectURL = vi.fn().mockReturnValue('blob:openstation-avatar');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(URL, 'createObjectURL').mockImplementation(createObjectURL);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeObjectURL);

    const client = new BeeperClient({ token: 'test-token' });
    await expect(client.resolveAssetURL('mxc://beeper.com/avatar')).resolves.toBe(
      'blob:openstation-avatar',
    );
    await expect(client.resolveAssetURL('mxc://beeper.com/avatar')).resolves.toBe(
      'blob:openstation-avatar',
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      '/v1/assets/serve?url=mxc%3A%2F%2Fbeeper.com%2Favatar',
    );

    client.dispose();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:openstation-avatar');
  });

  it('rejects active or oversized Beeper assets before creating a blob URL', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL');
    const client = new BeeperClient({ token: 'test-token' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('<script>alert(1)</script>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    ));
    await expect(client.resolveAssetURL('mxc://beeper.com/active')).rejects.toThrow(
      'unsafe asset type',
    );

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { 'Content-Length': String(13 * 1024 * 1024) },
      }),
    ));
    await expect(client.resolveAssetURL('mxc://beeper.com/oversized')).rejects.toThrow(
      'too large',
    );
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('fetches loopback image URLs with the bearer token instead of exposing them to img tags', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Blob(['avatar'], { type: 'image/png' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:authenticated-avatar');

    const client = new BeeperClient({ token: 'test-token' });
    await expect(
      client.resolveAssetURL('http://127.0.0.1:23373/v1/assets/serve?url=file%3A%2F%2Favatar'),
    ).resolves.toBe('blob:authenticated-avatar');
    const [, init] = fetchMock.mock.calls[0];
    expect((init?.headers as Headers).get('Authorization')).toBe('Bearer test-token');
  });

  it('uses the Matrix account identity to identify the user\'s own reactions', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse([
          {
            accountID: 'matrix',
            bridge: { id: 'matrix', provider: 'cloud', type: 'matrix' },
            status: 'connected',
            user: { id: '@nick:beeper.com', fullName: 'Nick' },
          },
        ]),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: '$message',
              chatID: '!general:beeper.com',
              senderID: '@june:beeper.com',
              timestamp: '2026-08-19T12:00:00Z',
              reactions: [
                {
                  id: '@nick:beeper.com|👍',
                  reactionKey: '👍',
                  participantID: '@nick:beeper.com',
                },
              ],
            },
          ],
          hasMore: false,
          oldestCursor: null,
          newestCursor: null,
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const client = new BeeperClient({ token: 'test-token' });
    await client.getAccounts();
    const messages = await client.getMessages('!general:beeper.com');
    expect(messages[0].reactions[0]).toMatchObject({ key: '👍', mine: true });
  });

  it('accepts only loopback API bases and browser-safe resource URLs', () => {
    expect(normalizeBeeperBaseUrl('http://127.0.0.1:23373/')).toBe(
      'http://127.0.0.1:23373',
    );
    expect(() => normalizeBeeperBaseUrl('https://desktop.example')).toThrow(
      'loopback HTTP address',
    );
    expect(normalizeResourceURL('https://cdn.example/file.png')).toBe(
      'https://cdn.example/file.png',
    );
    expect(normalizeResourceURL('javascript:alert(1)')).toBeUndefined();
    expect(normalizeResourceURL('file:///Users/nick/secret')).toBeUndefined();
  });

  it('preserves Matrix errcode values in adapter errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          { error: 'You are not invited.', errcode: 'M_FORBIDDEN' },
          403,
        ),
      ),
    );
    await expect(
      new BeeperClient({ token: 'test-token' }).joinRoom('!private:beeper.com'),
    ).rejects.toMatchObject({ status: 403, code: 'M_FORBIDDEN' });
  });
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
