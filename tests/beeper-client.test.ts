import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BeeperClient,
  normalizeChat,
  normalizeMessage,
} from '../src/beeper/client';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Beeper response normalization', () => {
  it('accepts the current v1 chat shape', () => {
    expect(
      normalizeChat({
        id: '!general:beeper.com',
        accountID: 'matrix',
        network: 'Beeper',
        title: 'OpenStation · General',
        unreadCount: 3,
        unreadMentionsCount: 1,
        participants: {
          items: [{ id: '@nick:beeper.com', fullName: 'Nick', isAdmin: true }],
        },
      }),
    ).toMatchObject({
      id: '!general:beeper.com',
      accountID: 'matrix',
      title: 'OpenStation · General',
      unreadCount: 3,
      unreadMentionsCount: 1,
      participants: [{ id: '@nick:beeper.com', fullName: 'Nick', isAdmin: true }],
    });
  });

  it('retains compatibility with the legacy nested-sender message shape', () => {
    expect(
      normalizeMessage({
        id: '$event',
        chatID: '!general:beeper.com',
        senderID: '@june:beeper.com',
        sender: { id: '@june:beeper.com', fullName: 'June' },
        timestamp: '2026-08-19T12:00:00Z',
        text: 'Hello from Beeper',
        attachments: [{ id: 'mxc://beeper/image', type: 'img', fileName: 'demo.png' }],
      }),
    ).toMatchObject({
      id: '$event',
      text: 'Hello from Beeper',
      sender: { fullName: 'June' },
      attachments: [{ type: 'img', fileName: 'demo.png' }],
    });
  });

  it('joins a Matrix room through Beeper Desktop', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ room_id: '!welcome:openstation.chat' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new BeeperClient({ token: 'test-token' });
    await expect(client.joinRoom('#welcome:openstation.chat')).resolves.toBe(
      '!welcome:openstation.chat',
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:23373/_matrix/client/v3/join/%23welcome%3Aopenstation.chat',
      expect.objectContaining({
        method: 'POST',
        body: '{}',
      }),
    );
  });

  it('preserves a 401 status so the UI can recover from an invalid token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Invalid token', code: 'unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const client = new BeeperClient({ token: 'expired-token' });
    await expect(client.getAccounts()).rejects.toMatchObject({
      name: 'BeeperApiError',
      status: 401,
      message: 'Invalid token',
    });
  });
});
