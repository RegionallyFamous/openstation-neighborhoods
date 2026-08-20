import { describe, expect, it } from 'vitest';
import {
  channelMatchesChat,
  flattenChannels,
  mapBeeperChatsToChannels,
} from '../src/community';
import type { BeeperChat } from '../src/beeper/types';

describe('community manifest matching', () => {
  it('keeps one stable Space and six unique supported production room IDs', () => {
    const channels = flattenChannels();
    const roomIDs = channels.map((channel) => channel.roomId);

    expect(channels).toHaveLength(6);
    expect(roomIDs.every(Boolean)).toBe(true);
    expect(new Set(roomIDs)).toHaveLength(6);
  });

  it('maps only the Matrix account and preserves unread state', () => {
    const mapped = mapBeeperChatsToChannels(flattenChannels(), [
      chat({
        id: '!pNVJVFkiQDmaHxpeeA:beeper.com',
        accountID: 'matrix',
        title: 'OpenStation · General',
        unreadCount: 7,
        unreadMentionsCount: 2,
      }),
      chat({
        id: '!discord-general:localhost',
        accountID: 'discordgo',
        network: 'Discord',
        title: 'OpenStation · General',
      }),
    ]);

    const general = mapped.find((channel) => channel.id === 'general');
    expect(general).toMatchObject({
      beeperChatId: '!pNVJVFkiQDmaHxpeeA:beeper.com',
      joined: true,
      unreadCount: 7,
      mentionCount: 2,
    });
  });

  it('matches the immutable canonical room ID even after its title changes', () => {
    const general = flattenChannels().find((channel) => channel.id === 'general');
    expect(general).toBeDefined();
    expect(
      channelMatchesChat(
        general!,
        chat({ id: general!.roomId, title: 'A renamed room' }),
      ),
    ).toBe(true);
  });

  it(
    'rejects a same-title Matrix decoy when a canonical room ID is configured',
    () => {
      const general = flattenChannels().find((channel) => channel.id === 'general');
      expect(general).toBeDefined();
      expect(
        channelMatchesChat(
          general!,
          chat({ id: '!decoy:beeper.com', title: 'OpenStation · General' }),
        ),
      ).toBe(false);
    },
  );
});

function chat(overrides: Partial<BeeperChat> = {}): BeeperChat {
  return {
    id: '!room:beeper.com',
    accountID: 'matrix',
    network: 'Beeper',
    title: 'Room',
    isReadOnly: false,
    isMuted: false,
    isPinned: false,
    unreadCount: 0,
    unreadMentionsCount: 0,
    participants: [],
    participantsHasMore: false,
    participantsTotal: 0,
    ...overrides,
  };
}
