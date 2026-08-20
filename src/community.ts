import type {
  ChannelDefinition,
  CommunityChannel,
  CommunityManifest,
} from './types';
import type { BeeperChat } from './beeper/types';
import { isCanonicalMatrixRoomID } from './beeper/client';

export const openStationManifest: CommunityManifest = {
  id: 'openstation',
  name: 'OpenStation',
  shortName: 'OS',
  tagline: 'Make the web weirder, warmer, and yours.',
  description:
    'The front porch for people making playful, personal software.',
  publicUrl: 'https://openstation.chat',
  homeserver: 'beeper.com',
  spaceRoomId: '!jYEavbUBVrpqbFoOOc:beeper.com',
  accent: '#8d7dff',
  categories: [
    {
      id: 'front-porch',
      name: 'Front Porch',
      channels: [
        {
          id: 'welcome',
          name: 'welcome',
          roomId: '!UuSyQQEmGsqUSLAaAZ:beeper.com',
          topic: 'Start here. Meet the neighbors. Find the good snacks.',
          kind: 'announcement',
        },
        {
          id: 'announcements',
          name: 'announcements',
          roomId: '!GsViuCUYarKZrSbEPw:beeper.com',
          topic: 'Fresh drops, gatherings, and other things worth ringing a bell about.',
          kind: 'announcement',
        },
      ],
    },
    {
      id: 'town-square',
      name: 'Town Square',
      channels: [
        {
          id: 'general',
          name: 'general',
          roomId: '!pNVJVFkiQDmaHxpeeA:beeper.com',
          topic: 'The front porch. Say hi, share a thought, stay awhile.',
          kind: 'text',
        },
        {
          id: 'showcase',
          name: 'showcase',
          roomId: '!iXXipjdOmtOlNOBjFV:beeper.com',
          topic: 'Made something strange, useful, or delightful? Put it on the fridge.',
          kind: 'text',
        },
      ],
    },
    {
      id: 'workshop',
      name: 'Workshop',
      channels: [
        {
          id: 'builders',
          name: 'builders',
          roomId: '!VjKgltGsprslucAaLp:beeper.com',
          topic: 'Half-built ideas, clever tools, stubborn bugs, and shop talk.',
          kind: 'text',
        },
        {
          id: 'help-desk',
          name: 'help-desk',
          roomId: '!xyMzRCglbiZDoNyjUH:beeper.com',
          topic: 'Bring a snag. Leave a trail for the next person.',
          kind: 'text',
        },
      ],
    },
  ],
};

validateCanonicalRoomIDs(openStationManifest);

export function flattenChannels(
  manifest: CommunityManifest = openStationManifest,
): CommunityChannel[] {
  return manifest.categories.flatMap((category) =>
    category.channels.map((channel) => ({
      ...channel,
      categoryId: category.id,
      categoryName: category.name,
      unreadCount: 0,
      mentionCount: 0,
      joined: false,
    })),
  );
}

export function channelMatchesChat(
  channel: ChannelDefinition,
  chat: BeeperChat,
): boolean {
  return isCanonicalMatrixRoomID(channel.roomId) && channel.roomId === chat.id;
}

export function mapBeeperChatsToChannels(
  channels: CommunityChannel[],
  chats: BeeperChat[],
): CommunityChannel[] {
  const matrixChats = chats.filter(
    (chat) => chat.accountID === 'matrix',
  );

  return channels.map((channel) => {
    const match = matrixChats.find((chat) => channelMatchesChat(channel, chat));
    if (!match) return channel;
    return {
      ...channel,
      beeperChatId: match.id,
      unreadCount: match.unreadCount,
      mentionCount: match.unreadMentionsCount,
      joined: true,
      isReadOnly: match.isReadOnly,
    };
  });
}

export function validateCanonicalRoomIDs(manifest: CommunityManifest): void {
  if (!isCanonicalMatrixRoomID(manifest.spaceRoomId)) {
    throw new Error('The OpenStation Space must use a canonical Matrix room ID.');
  }
  manifest.categories.forEach((category) => {
    category.channels.forEach((channel) => {
      if (!isCanonicalMatrixRoomID(channel.roomId)) {
        throw new Error(`#${channel.name} must use a canonical Matrix room ID.`);
      }
    });
  });
}
