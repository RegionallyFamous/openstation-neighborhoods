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
  tagline: 'Make your corner of the web feel like yours.',
  description:
    'A neighborhood for people building playful, personal software on the open web.',
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
          topic: 'Start here, meet the neighbors, and learn how this place works.',
          kind: 'announcement',
        },
        {
          id: 'announcements',
          name: 'announcements',
          roomId: '!GsViuCUYarKZrSbEPw:beeper.com',
          topic: 'Releases, events, experiments, and things worth gathering around.',
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
          topic: 'The daily pulse of OpenStation.',
          kind: 'text',
        },
        {
          id: 'showcase',
          name: 'showcase',
          roomId: '!iXXipjdOmtOlNOBjFV:beeper.com',
          topic: 'Share the strange, useful, and delightful things you made.',
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
          topic: 'Themes, games, tools, half-working prototypes, and shop talk.',
          kind: 'text',
        },
        {
          id: 'help-desk',
          name: 'help-desk',
          roomId: '!xyMzRCglbiZDoNyjUH:beeper.com',
          topic: 'Ask for help. Leave behind an answer the next person can find.',
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
