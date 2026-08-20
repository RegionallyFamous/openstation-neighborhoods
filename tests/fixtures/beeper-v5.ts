/**
 * Synthetic fixtures matching the OpenAPI 5.0.0 document advertised by
 * Beeper Desktop 4.3.34. They intentionally contain no real account data,
 * access tokens, or exported chat content.
 */
export const beeperInfoV5 = {
  app: {
    name: 'Beeper',
    version: '4.3.34',
    bundle_id: 'com.automattic.beeper.desktop',
  },
  platform: {
    os: 'darwin',
    arch: 'arm64',
    release: 'fixture',
  },
  server: {
    status: 'running',
    base_url: 'http://127.0.0.1:23373',
    port: 23373,
    hostname: '127.0.0.1',
    remote_access: false,
    mcp_enabled: true,
  },
  endpoints: {
    oauth: {
      authorization_endpoint: 'http://127.0.0.1:23373/oauth/authorize',
      token_endpoint: 'http://127.0.0.1:23373/oauth/token',
      introspection_endpoint: 'http://127.0.0.1:23373/oauth/introspect',
      userinfo_endpoint: 'http://127.0.0.1:23373/oauth/userinfo',
      revocation_endpoint: 'http://127.0.0.1:23373/oauth/revoke',
      registration_endpoint: 'http://127.0.0.1:23373/oauth/register',
    },
    spec: 'http://127.0.0.1:23373/v1/spec',
    mcp: 'http://127.0.0.1:23373/v0/mcp',
    ws_events: 'http://127.0.0.1:23373/v1/ws',
  },
} as const;

export const beeperAccountsV5 = [
  {
    accountID: 'matrix',
    loginID: 'matrix',
    bridge: {
      id: 'matrix',
      type: 'matrix',
      provider: 'cloud',
    },
    network: 'Beeper',
    user: {
      id: '@openstation-fixture:beeper.com',
      username: 'openstation-fixture:beeper.com',
      fullName: 'OpenStation Fixture',
      isSelf: true,
    },
    status: 'connected',
  },
] as const;

export const beeperChatsV5 = {
  items: [
    {
      id: '!pNVJVFkiQDmaHxpeeA:beeper.com',
      localChatID: 'fixture-general',
      accountID: 'matrix',
      network: 'Beeper',
      title: 'OpenStation · General',
      description: 'The daily pulse of OpenStation.',
      imgURL: null,
      type: 'group',
      isReadOnly: false,
      participants: {
        items: [
          {
            id: '@openstation-fixture:beeper.com',
            username: 'openstation-fixture:beeper.com',
            fullName: 'OpenStation Fixture',
            isSelf: true,
            isAdmin: false,
            isPending: false,
          },
        ],
        hasMore: false,
        total: 1,
      },
      lastActivity: '2026-08-19T18:05:00.000Z',
      unreadCount: 2,
      unreadMentionsCount: 1,
      lastReadMessageSortKey: '0000000001',
      draft: null,
      reminder: null,
      snooze: null,
      isArchived: false,
      isMarkedUnread: false,
      isMuted: false,
      isPinned: true,
      isLowPriority: false,
      messageExpirySeconds: null,
    },
  ],
  hasMore: false,
  oldestCursor: null,
  newestCursor: null,
} as const;

export const beeperMessagesV5 = {
  items: [
    {
      id: '$fixture-event',
      chatID: '!pNVJVFkiQDmaHxpeeA:beeper.com',
      accountID: 'matrix',
      senderID: '@neighbor-fixture:beeper.com',
      senderName: 'Neighbor Fixture',
      timestamp: '2026-08-19T18:05:00.000Z',
      sortKey: '0000000002',
      type: 'TEXT',
      text: 'A synthetic message shaped like Beeper Client API v5.',
      editedTimestamp: '2026-08-19T18:06:00.000Z',
      isSender: false,
      isHidden: false,
      isDeleted: false,
      attachments: [
        {
          id: 'mxc://beeper.com/fixture',
          type: 'img',
          srcURL: 'localmxc://beeper.com/fixture',
          mimeType: 'image/png',
          fileName: 'fixture.png',
          fileSize: 1024,
          isGif: false,
          isSticker: false,
          isVoiceNote: false,
          size: { width: 64, height: 64 },
        },
      ],
      mentions: [],
      seen: {
        '@openstation-fixture:beeper.com': '2026-08-19T18:07:00.000Z',
      },
    },
  ],
  hasMore: false,
  oldestCursor: null,
  newestCursor: null,
} as const;

export const invalidTokenV5 = {
  message: 'Invalid token',
  code: 'unauthorized',
} as const;
