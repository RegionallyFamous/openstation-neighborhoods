export type ChannelKind = 'announcement' | 'text';

export interface CommunityManifest {
  id: string;
  name: string;
  shortName: string;
  tagline: string;
  description: string;
  publicUrl: string;
  homeserver: string;
  spaceRoomId: string;
  accent: string;
  categories: ChannelCategory[];
}

export interface ChannelCategory {
  id: string;
  name: string;
  channels: ChannelDefinition[];
}

export interface ChannelDefinition {
  id: string;
  name: string;
  topic: string;
  kind: ChannelKind;
  roomId: string;
}

export interface CommunityChannel extends ChannelDefinition {
  categoryId: string;
  categoryName: string;
  unreadCount: number;
  mentionCount: number;
  beeperChatId?: string;
  joined: boolean;
  isReadOnly?: boolean;
}

export type Presence = 'online' | 'idle' | 'offline' | 'unknown';

export interface Member {
  id: string;
  name: string;
  handle: string;
  avatar: string;
  avatarUrl?: string;
  color: string;
  presence: Presence;
  role: 'host' | 'moderator' | 'builder' | 'member';
  note?: string;
}

export interface MessageAttachment {
  id: string;
  type: 'image' | 'file' | 'audio' | 'video';
  name: string;
  url?: string;
  sourceUrl?: string;
  size?: number;
}

export interface CommunityMessage {
  id: string;
  channelId: string;
  author: Member;
  body: string;
  sentAt: string;
  edited?: boolean;
  pending?: boolean;
  delivery?: 'pending' | 'sent' | 'failed' | 'unconfirmed';
  deliveryMessage?: string;
  attachments: MessageAttachment[];
}

export type ConnectionState =
  | { kind: 'disconnected'; message: string }
  | { kind: 'probing'; message: string }
  | { kind: 'available'; message: string }
  | { kind: 'authorizing'; message: string }
  | { kind: 'connected'; message: string; accountName?: string; accountHandle?: string; avatarUrl?: string }
  | { kind: 'unavailable'; message: string }
  | { kind: 'error'; message: string };
