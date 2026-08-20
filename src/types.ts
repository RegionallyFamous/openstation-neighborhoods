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
  connectionStatus?: 'not-joined' | 'joining' | 'joined' | 'failed';
  connectionMessage?: string;
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

export interface RoomSyncState {
  kind: 'idle' | 'loading' | 'live' | 'retrying' | 'error';
  message: string;
  lastUpdatedAt?: number;
}

export interface ConnectionProblem {
  code: string;
  title: string;
  message: string;
  action: 'retry-probe' | 'reauthorize' | 'update-beeper' | 'fix-account' | 'retry-room' | 'retry-sync';
  actionLabel: string;
  troubleshooting?: string;
}

export type ConnectionState =
  | { kind: 'disconnected'; message: string }
  | { kind: 'probing'; message: string }
  | { kind: 'available'; message: string }
  | { kind: 'authorizing'; message: string }
  | { kind: 'connected'; message: string; health?: 'live' | 'partial' | 'reconnecting'; accountName?: string; accountHandle?: string; avatarUrl?: string }
  | { kind: 'unavailable'; message: string; problem?: ConnectionProblem }
  | { kind: 'error'; message: string; problem?: ConnectionProblem };
