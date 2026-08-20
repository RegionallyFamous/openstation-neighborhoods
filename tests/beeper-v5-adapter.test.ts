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
