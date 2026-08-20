import { afterEach, describe, expect, it, vi } from 'vitest';
import { BeeperClient } from '../src/beeper/client';
import {
  beeperAccountsV5,
  beeperChatsV5,
  beeperInfoV5,
  beeperMessagesV5,
} from './fixtures/beeper-v5';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Beeper Desktop 4.3.34 / Client API v5 contract fixtures', () => {
  it('accepts the advertised info, account, paginated chat, and message shapes', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/v1/info') return json(beeperInfoV5);
      if (url.pathname === '/v1/accounts') return json(beeperAccountsV5);
      if (url.pathname === '/v1/chats') return json(beeperChatsV5);
      if (url.pathname.endsWith('/messages')) return json(beeperMessagesV5);
      throw new Error(`Unexpected fixture request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new BeeperClient({ token: 'synthetic-test-token' });
    const info = await client.getInfo();
    const accounts = await client.getAccounts();
    const chats = await client.getChats();
    const messages = await client.getMessages(beeperChatsV5.items[0].id);

    expect(info).toMatchObject({
      app: { name: 'Beeper', version: '4.3.34' },
      server: { remote_access: false, status: 'running' },
    });
    expect(accounts).toMatchObject([
      {
        accountID: 'matrix',
        bridge: { type: 'matrix', provider: 'cloud' },
        status: 'connected',
      },
    ]);
    expect(chats).toMatchObject([
      {
        id: beeperChatsV5.items[0].id,
        accountID: 'matrix',
        title: 'OpenStation · General',
        unreadCount: 2,
        unreadMentionsCount: 1,
        participants: [{ fullName: 'OpenStation Fixture', isSelf: true }],
      },
    ]);
    expect(messages).toMatchObject([
      {
        id: '$fixture-event',
        chatID: beeperChatsV5.items[0].id,
        senderID: '@neighbor-fixture:beeper.com',
        text: 'A synthetic message shaped like Beeper Client API v5.',
        attachments: [{ fileName: 'fixture.png', type: 'img' }],
        reactions: [{ key: '✨' }],
      },
    ]);
  });

  it('keeps the public info probe unauthenticated and authenticates protected calls', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/v1/info') return json(beeperInfoV5);
      if (url.pathname === '/v1/accounts') return json(beeperAccountsV5);
      throw new Error(`Unexpected fixture request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new BeeperClient({ token: 'synthetic-test-token' });
    await client.getInfo();
    await client.getAccounts();

    const infoHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    const accountHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Headers;
    expect(infoHeaders.get('Authorization')).toBeNull();
    expect(accountHeaders.get('Authorization')).toBe(
      'Bearer synthetic-test-token',
    );
  });
});

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Beeper-Desktop-Version': '4.3.34',
    },
  });
}
