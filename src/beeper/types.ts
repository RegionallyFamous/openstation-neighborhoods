export interface BeeperInfo {
  app: {
    bundle_id: string;
    name: string;
    version: string;
  };
  endpoints: {
    mcp?: string;
    oauth?: {
      authorization_endpoint: string;
      introspection_endpoint?: string;
      registration_endpoint: string;
      revocation_endpoint?: string;
      token_endpoint: string;
      userinfo_endpoint?: string;
    };
    spec?: string;
    ws_events?: string;
  };
  platform?: {
    arch?: string;
    os?: string;
    release?: string;
  };
  server: {
    base_url: string;
    hostname: string;
    mcp_enabled?: boolean;
    port: number;
    remote_access: boolean;
    status: string;
  };
}

export interface BeeperAccount {
  accountID: string;
  network?: string;
  user?: {
    id?: string;
    username?: string;
    fullName?: string;
    imgURL?: string;
  };
  bridge?: {
    id?: string;
    provider?: 'cloud' | 'self-hosted' | 'local' | 'platform-sdk';
    type?: string;
  };
  status?:
    | 'connected'
    | 'connecting'
    | 'backfilling'
    | 'connection_required'
    | 'reconnect_required'
    | 'attention_required'
    | 'disconnected'
    | 'disabled';
  statusText?: string;
}

export interface BeeperUser {
  id: string;
  username?: string;
  fullName?: string;
  imgURL?: string;
  isSelf?: boolean;
  isAdmin?: boolean;
  isPending?: boolean;
}

export interface BeeperChat {
  id: string;
  accountID: string;
  network: string;
  title: string;
  description?: string;
  imgURL?: string;
  isReadOnly: boolean;
  isMuted: boolean;
  isPinned: boolean;
  unreadCount: number;
  unreadMentionsCount: number;
  lastActivity?: string;
  participants: BeeperUser[];
  participantsHasMore: boolean;
  participantsTotal: number;
}

export interface BeeperAttachment {
  id?: string;
  type?: string;
  fileName?: string;
  fileSize?: number;
  srcURL?: string;
}

export interface BeeperReaction {
  key: string;
  count: number;
  mine?: boolean;
  participantIDs: string[];
}

export type BeeperSendStatusKind =
  | 'SUCCESS'
  | 'PENDING'
  | 'FAIL_RETRIABLE'
  | 'FAIL_PERMANENT';

export interface BeeperSendStatus {
  status: BeeperSendStatusKind;
  timestamp?: string;
  message?: string;
  reason?: string;
}

export interface BeeperMessage {
  id: string;
  chatID: string;
  senderID: string;
  sender?: BeeperUser;
  timestamp: string;
  text: string;
  isEdited: boolean;
  linkedMessageID?: string;
  sendStatus?: BeeperSendStatus;
  attachments: BeeperAttachment[];
  reactions: BeeperReaction[];
}

export interface BeeperCursorPage<T> {
  items: T[];
  hasMore: boolean;
  oldestCursor: string | null;
  newestCursor: string | null;
}

export interface BeeperCursorOptions {
  cursor?: string;
  direction?: 'before' | 'after';
}

export interface BeeperChatListOptions extends BeeperCursorOptions {
  accountIDs?: string[];
}

export interface BeeperMessageListOptions extends BeeperCursorOptions {
  selfUserID?: string;
}

export interface BeeperOAuthMetadata {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  introspection_endpoint?: string;
  revocation_endpoint?: string;
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
}

export interface BeeperOAuthClientRegistration {
  client_id: string;
  client_secret?: string;
  client_id_issued_at?: number;
  client_secret_expires_at?: number;
}

export interface BeeperTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}
