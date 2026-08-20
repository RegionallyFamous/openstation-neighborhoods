import { describe, expect, it } from 'vitest';
import {
  flattenChannels,
  mapBeeperChatsToChannels,
  validateCanonicalRoomIDs,
} from '../src/community';
import type { BeeperChat } from '../src/beeper/types';

describe('canonical OpenStation room discovery', () => {
  it('does not map a non-Matrix chat even when it reuses a canonical room ID', () => {
    const channels = flattenChannels();
    const general = channels.find((channel) => channel.id === 'general');
    expect(general?.roomId).toBeDefined();

    const mapped = mapBeeperChatsToChannels(channels, [
      chat({
        id: general!.roomId!,
        accountID: 'discordgo',
        network: 'Beeper',
        title: 'OpenStation · General',
      }),
    ]);
    const mappedGeneral = mapped.find((channel) => channel.id === 'general');
    expect(mappedGeneral).toMatchObject({ joined: false });
    expect(mappedGeneral?.beeperChatId).toBeUndefined();
  });

  it('rejects aliases in canonical room ID fields', () => {
    expect(() =>
      validateCanonicalRoomIDs({
        id: 'test',
        name: 'Test',
        shortName: 'T',
        tagline: 'Test',
        description: 'Test',
        publicUrl: 'https://openstation.chat',
        homeserver: 'beeper.com',
        spaceRoomId: '#openstation:beeper.com',
        accent: '#000000',
        categories: [],
      }),
    ).toThrow('canonical Matrix room ID');
  });
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
