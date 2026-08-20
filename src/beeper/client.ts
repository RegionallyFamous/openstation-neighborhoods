import type {
  BeeperAccount,
  BeeperAttachment,
  BeeperChat,
  BeeperChatListOptions,
  BeeperCursorPage,
  BeeperInfo,
  BeeperMessage,
  BeeperMessageListOptions,
  BeeperReaction,
  BeeperSendStatus,
  BeeperUser,
} from './types';

export const DEFAULT_BEEPER_API_BASE =
  import.meta.env.VITE_BEEPER_API_BASE?.replace(/\/$/, '') ||
  'http://localhost:23373';

const MAX_ASSET_BYTES = 12 * 1024 * 1024;
const UNSAFE_ASSET_TYPES = new Set([
  'application/javascript',
  'application/xhtml+xml',
  'application/xml',
  'image/svg+xml',
  'text/html',
  'text/javascript',
  'text/xml',
]);

export class BeeperApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'BeeperApiError';
    this.status = status;
    this.code = code;
  }
}

export class BeeperClient {
  readonly baseUrl: string;
  private readonly token?: string;
  private selfUserID?: string;
  private readonly assetURLCache = new Map<string, Promise<string | undefined>>();
  private readonly blobURLs = new Set<string>();

  constructor(options: { baseUrl?: string; token?: string } = {}) {
    this.baseUrl = normalizeBeeperBaseUrl(options.baseUrl || DEFAULT_BEEPER_API_BASE);
    this.token = options.token;
  }

  async getInfo(): Promise<BeeperInfo> {
    return this.request<BeeperInfo>('/v1/info', { authenticated: false });
  }

  async getAccounts(): Promise<BeeperAccount[]> {
    const raw = await this.request<unknown>('/v1/accounts');
    const accounts = extractItems(raw)
      .map(normalizeAccount)
      .filter((account): account is BeeperAccount => account !== null);
    this.selfUserID = accounts.find((account) => account.accountID === 'matrix')?.user?.id;
    return accounts;
  }

  async getUserProfile(userID: string): Promise<{ avatarURL?: string; displayName?: string }> {
    const raw = asRecord(
      await this.request<unknown>(`/_matrix/client/v3/profile/${encodeURIComponent(userID)}`),
    );
    return {
      avatarURL: normalizeAvatarURL(readString(raw.avatar_url)),
      displayName: readString(raw.displayname) || undefined,
    };
  }

  async getChats(options: BeeperChatListOptions = {}): Promise<BeeperChat[]> {
    return (await this.getChatsPage(options)).items;
  }

  async getChat(chatID: string, maxParticipantCount = -1): Promise<BeeperChat> {
    const params = new URLSearchParams({
      maxParticipantCount: String(maxParticipantCount),
    });
    const raw = await this.request<unknown>(
      withQuery(`/v1/chats/${encodeURIComponent(chatID)}`, params),
    );
    const record = asRecord(raw);
    const chat = normalizeChat(record.chat ?? record);
    if (!chat) {
      throw new BeeperApiError('Beeper returned incomplete room details.', 502);
    }
    return chat;
  }

  async getChatsPage(
    options: BeeperChatListOptions = {},
  ): Promise<BeeperCursorPage<BeeperChat>> {
    const params = new URLSearchParams();
    const accountIDs = options.accountIDs ?? ['matrix'];
    accountIDs.forEach((accountID) => {
      const cleanAccountID = accountID.trim();
      if (cleanAccountID) params.append('accountIDs', cleanAccountID);
    });
    appendCursorOptions(params, options);
    const raw = await this.request<unknown>(withQuery('/v1/chats', params));
    return normalizeCursorPage(raw, (item) => {
      const record = asRecord(item);
      return normalizeChat(record.chat ?? record);
    });
  }

  async getMessages(
    chatID: string,
    options: BeeperMessageListOptions = {},
  ): Promise<BeeperMessage[]> {
    return (await this.getMessagesPage(chatID, options)).items;
  }

  async getMessagesPage(
    chatID: string,
    options: BeeperMessageListOptions = {},
  ): Promise<BeeperCursorPage<BeeperMessage>> {
    const params = new URLSearchParams();
    appendCursorOptions(params, options);
    const raw = await this.request<unknown>(
      withQuery(`/v1/chats/${encodeURIComponent(chatID)}/messages`, params),
    );
    const page = normalizeCursorPage(raw, (item) =>
      normalizeMessage(item, options.selfUserID ?? this.selfUserID),
    );
    page.items.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    return page;
  }

  async getMessage(chatID: string, messageID: string): Promise<BeeperMessage> {
    const raw = await this.request<unknown>(
      `/v1/chats/${encodeURIComponent(chatID)}/messages/${encodeURIComponent(messageID)}`,
    );
    const record = asRecord(raw);
    const message = normalizeMessage(
      record.message ?? record,
      this.selfUserID,
    );
    if (!message) {
      throw new BeeperApiError('Beeper returned an incomplete message.', 502);
    }
    return message;
  }

  async joinRoom(roomIDOrAlias: string): Promise<string> {
    const response = await this.request<unknown>(
      `/_matrix/client/v3/join/${encodeURIComponent(roomIDOrAlias)}`,
      {
        method: 'POST',
        body: JSON.stringify({}),
      },
    );
    const roomID = readString(asRecord(response).room_id, asRecord(response).roomID);
    if (!isCanonicalMatrixRoomID(roomID)) {
      throw new BeeperApiError(
        'Beeper joined the room but returned no canonical Matrix room ID.',
        502,
      );
    }
    return roomID;
  }

  async sendMessage(chatID: string, text: string): Promise<string> {
    const response = await this.request<{ pendingMessageID: string }>(
      `/v1/chats/${encodeURIComponent(chatID)}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({ text }),
      },
    );
    const pendingMessageID = readString(response.pendingMessageID);
    if (!pendingMessageID) {
      throw new BeeperApiError('Beeper accepted the message but returned no pending ID.', 502);
    }
    return pendingMessageID;
  }

  async markRead(chatID: string, messageID?: string): Promise<void> {
    await this.request(`/v1/chats/${encodeURIComponent(chatID)}/read`, {
      method: 'POST',
      body: JSON.stringify(messageID ? { messageID } : {}),
    });
  }

  async addReaction(
    chatID: string,
    messageID: string,
    reactionKey: string,
  ): Promise<void> {
    await this.request(
      `/v1/chats/${encodeURIComponent(chatID)}/messages/${encodeURIComponent(messageID)}/reactions`,
      {
        method: 'POST',
        body: JSON.stringify({
          reactionKey,
          transactionID: crypto.randomUUID(),
        }),
      },
    );
  }

  async deleteReaction(
    chatID: string,
    messageID: string,
    reactionKey: string,
  ): Promise<void> {
    await this.request(
      `/v1/chats/${encodeURIComponent(chatID)}/messages/${encodeURIComponent(messageID)}/reactions/${encodeURIComponent(reactionKey)}`,
      { method: 'DELETE' },
    );
  }

  resolveAssetURL(value: string | undefined): Promise<string | undefined> {
    const assetURL = value?.trim();
    if (!assetURL) return Promise.resolve(undefined);

    const cached = this.assetURLCache.get(assetURL);
    if (cached) return cached;

    const request = this.resolveAssetURLUncached(assetURL).catch((error) => {
      this.assetURLCache.delete(assetURL);
      throw error;
    });
    this.assetURLCache.set(assetURL, request);
    return request;
  }

  async getAssetBlobURL(value: string): Promise<string> {
    const assetURL = value.trim();
    if (!/^(?:mxc|localmxc|file):\/\//i.test(assetURL)) {
      throw new BeeperApiError('Beeper returned an unsupported avatar URL.', 400);
    }
    const response = await this.request<Response>(
      `/v1/assets/serve?url=${encodeURIComponent(assetURL)}`,
      { responseType: 'raw' },
    );
    return this.responseToBlobURL(response);
  }

  dispose(): void {
    this.blobURLs.forEach((url) => URL.revokeObjectURL(url));
    this.blobURLs.clear();
    this.assetURLCache.clear();
  }

  private async resolveAssetURLUncached(value: string): Promise<string | undefined> {
    if (/^(?:mxc|localmxc|file):\/\//i.test(value)) {
      return this.getAssetBlobURL(value);
    }
    const resourceURL = normalizeResourceURL(value);
    if (!resourceURL) return undefined;
    const parsed = new URL(resourceURL);
    if (parsed.protocol === 'http:') {
      normalizeBeeperBaseUrl(parsed.origin);
      const response = await this.request<Response>(`${parsed.pathname}${parsed.search}`, {
        responseType: 'raw',
      });
      return this.responseToBlobURL(response);
    }
    return resourceURL;
  }

  private async responseToBlobURL(response: Response): Promise<string> {
    const contentLength = Number(response.headers.get('Content-Length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_ASSET_BYTES) {
      throw new BeeperApiError('This Beeper asset is too large to display safely.', 413);
    }
    const contentType = response.headers
      .get('Content-Type')
      ?.split(';', 1)[0]
      .trim()
      .toLowerCase();
    if (contentType && (UNSAFE_ASSET_TYPES.has(contentType) || contentType.endsWith('+xml'))) {
      throw new BeeperApiError('Beeper returned an unsafe asset type.', 415);
    }
    const blob = await response.blob();
    if (blob.size > MAX_ASSET_BYTES) {
      throw new BeeperApiError('This Beeper asset is too large to display safely.', 413);
    }
    const blobURL = URL.createObjectURL(blob);
    this.blobURLs.add(blobURL);
    return blobURL;
  }

  private async request<T = unknown>(
    path: string,
    options: RequestInit & { authenticated?: boolean; responseType?: string } = {},
  ): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set('Accept', 'application/json');
    if (options.body) headers.set('Content-Type', 'application/json');

    if (options.authenticated !== false) {
      if (!this.token) {
        throw new BeeperApiError('Beeper authorization is required.', 401);
      }
      headers.set('Authorization', `Bearer ${this.token}`);
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal: options.signal ?? AbortSignal.timeout(8_000),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Unknown connection error';
      throw new BeeperApiError(
        `Could not reach Beeper Desktop at ${this.baseUrl}. ${detail}`,
        0,
      );
    }

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const record = asRecord(payload);
      throw new BeeperApiError(
        String(record.error ?? record.message ?? `Beeper returned ${response.status}.`),
        response.status,
        readString(record.code, record.errcode) || undefined,
      );
    }

    if (response.status === 204) return undefined as T;
    if (options.responseType === 'raw') return response as T;
    return (await response.json()) as T;
  }
}

export function normalizeChat(value: unknown): BeeperChat | null {
  const raw = asRecord(value);
  const id = readString(raw.id, raw.chatID);
  const accountID = readString(raw.accountID);
  if (!id || !accountID) return null;

  const participantContainer = asRecord(raw.participants);
  const participants = extractItems(participantContainer)
    .map(normalizeUser)
    .filter((user): user is BeeperUser => user !== null);

  return {
    id,
    accountID,
    network: readString(raw.network) || 'Beeper',
    title: readString(raw.title) || 'Untitled chat',
    description: readString(raw.description) || undefined,
    imgURL: normalizeBeeperResourceURL(readString(raw.imgURL)),
    isReadOnly: Boolean(raw.isReadOnly),
    isMuted: Boolean(raw.isMuted),
    isPinned: Boolean(raw.isPinned),
    unreadCount: readNumber(raw.unreadCount),
    unreadMentionsCount: readNumber(raw.unreadMentionsCount),
    lastActivity: readString(raw.lastActivity) || undefined,
    participants,
    participantsHasMore: Boolean(participantContainer.hasMore),
    participantsTotal: Math.max(participants.length, readNumber(participantContainer.total)),
  };
}

export function normalizeMessage(
  value: unknown,
  selfUserID?: string,
): BeeperMessage | null {
  const raw = asRecord(value);
  const id = readString(raw.id, raw.messageID);
  const chatID = readString(raw.chatID);
  const senderRecord = asRecord(raw.sender);
  const senderID = readString(raw.senderID, senderRecord.id);
  const timestamp = readString(raw.timestamp);
  if (
    !id ||
    !chatID ||
    !senderID ||
    !timestamp ||
    Boolean(raw.isHidden) ||
    Boolean(raw.isDeleted) ||
    readString(raw.type).toUpperCase() === 'REACTION'
  ) {
    return null;
  }

  const attachments = Array.isArray(raw.attachments)
    ? raw.attachments.map(normalizeAttachment)
    : [];
  const reactions = normalizeReactions(raw.reactions, selfUserID);
  const senderName = readString(raw.senderName, senderRecord.fullName, senderRecord.name);
  const sender = normalizeUser({
    ...senderRecord,
    id: senderID,
    fullName: senderName || undefined,
    isSelf: raw.isSender ?? senderRecord.isSelf,
  });

  return {
    id,
    chatID,
    senderID,
    sender: sender ?? undefined,
    timestamp,
    text: readString(raw.text, asRecord(raw.content).body) || '',
    isEdited: Boolean(raw.editedTimestamp ?? raw.isEdited ?? raw.edited),
    linkedMessageID: readString(raw.linkedMessageID) || undefined,
    sendStatus: normalizeSendStatus(raw.sendStatus),
    attachments,
    reactions,
  };
}

export function normalizeAccount(value: unknown): BeeperAccount | null {
  const raw = asRecord(value);
  const accountID = readString(raw.accountID);
  if (!accountID) return null;

  const bridgeRaw = asRecord(raw.bridge);
  const user = normalizeUser(raw.user);
  const provider = readString(bridgeRaw.provider);
  const status = readString(raw.status);
  const knownProviders = ['cloud', 'self-hosted', 'local', 'platform-sdk'] as const;
  const knownStatuses = [
    'connected',
    'connecting',
    'backfilling',
    'connection_required',
    'reconnect_required',
    'attention_required',
    'disconnected',
    'disabled',
  ] as const;

  return {
    accountID,
    network: readString(raw.network) || undefined,
    user: user ?? undefined,
    bridge: Object.keys(bridgeRaw).length
      ? {
          id: readString(bridgeRaw.id) || undefined,
          provider: knownProviders.find((candidate) => candidate === provider),
          type: readString(bridgeRaw.type) || undefined,
        }
      : undefined,
    status: knownStatuses.find((candidate) => candidate === status),
    statusText: readString(raw.statusText) || undefined,
  };
}

function normalizeUser(value: unknown): BeeperUser | null {
  const raw = asRecord(value);
  const id = readString(raw.id, raw.userID, raw.username);
  if (!id) return null;
  return {
    id,
    username: readString(raw.username) || undefined,
    fullName: readString(raw.fullName, raw.name) || undefined,
    imgURL: normalizeAvatarURL(readString(raw.imgURL, raw.avatarURL)),
    isSelf: Boolean(raw.isSelf),
    isAdmin: Boolean(raw.isAdmin),
    isPending: Boolean(raw.isPending),
  };
}

function normalizeAttachment(value: unknown): BeeperAttachment {
  const raw = asRecord(value);
  return {
    id: readString(raw.id) || undefined,
    type: readString(raw.type) || undefined,
    fileName: readString(raw.fileName, raw.name) || undefined,
    fileSize: readNumber(raw.fileSize) || undefined,
    srcURL: normalizeBeeperResourceURL(readString(raw.srcURL, raw.url)),
  };
}

function normalizeSendStatus(value: unknown): BeeperSendStatus | undefined {
  const raw = asRecord(value);
  const status = readString(raw.status);
  const knownStatuses = [
    'SUCCESS',
    'PENDING',
    'FAIL_RETRIABLE',
    'FAIL_PERMANENT',
  ] as const;
  const normalized = knownStatuses.find((candidate) => candidate === status);
  if (!normalized) return undefined;
  return {
    status: normalized,
    timestamp: readString(raw.timestamp) || undefined,
    message: readString(raw.message) || undefined,
    reason: readString(raw.reason) || undefined,
  };
}

function normalizeReactions(value: unknown, selfUserID?: string): BeeperReaction[] {
  if (!Array.isArray(value)) return [];

  const grouped = new Map<string, BeeperReaction>();
  value.forEach((item) => {
    const raw = asRecord(item);
    const key = readString(raw.reactionKey, raw.key);
    if (!key) return;

    const participantID = readString(raw.participantID);
    const existing = grouped.get(key) ?? {
      key,
      count: 0,
      participantIDs: [],
    };
    if (participantID && !existing.participantIDs.includes(participantID)) {
      existing.participantIDs.push(participantID);
    }
    const legacyCount = readNumber(raw.count);
    existing.count += legacyCount > 0 ? legacyCount : 1;
    if (
      Boolean(raw.mine ?? raw.isSelf) ||
      Boolean(selfUserID && participantID === selfUserID)
    ) {
      existing.mine = true;
    }
    grouped.set(key, existing);
  });

  return [...grouped.values()];
}

function extractItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (Array.isArray(record.items)) return record.items;
  if (Array.isArray(record.chats)) return record.chats;
  if (Array.isArray(record.messages)) return record.messages;
  return [];
}

function normalizeCursorPage<T>(
  value: unknown,
  normalizeItem: (item: unknown) => T | null,
): BeeperCursorPage<T> {
  const raw = asRecord(value);
  const items = extractItems(value)
    .map(normalizeItem)
    .filter((item): item is T => item !== null);
  return {
    items,
    hasMore: Boolean(raw.hasMore),
    oldestCursor: readString(raw.oldestCursor) || null,
    newestCursor: readString(raw.newestCursor) || null,
  };
}

function appendCursorOptions(
  params: URLSearchParams,
  options: { cursor?: string; direction?: 'before' | 'after' },
): void {
  const cursor = options.cursor?.trim();
  if (cursor) params.set('cursor', cursor);
  if (options.direction) params.set('direction', options.direction);
}

function withQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function normalizeBeeperBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BeeperApiError('The Beeper Desktop API address is invalid.', 0);
  }

  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  if (
    url.protocol !== 'http:' ||
    !loopbackHosts.has(url.hostname.toLowerCase()) ||
    url.port !== '23373' ||
    url.username ||
    url.password ||
    (url.pathname !== '/' && url.pathname !== '') ||
    url.search ||
    url.hash
  ) {
    throw new BeeperApiError(
      'The Beeper Desktop API must use a loopback HTTP address without credentials or a path.',
      0,
    );
  }
  return url.origin;
}

export function normalizeResourceURL(value: string): string | undefined {
  const candidate = value.trim();
  if (!candidate) return undefined;
  if (/^data:image\/(?:avif|gif|jpeg|png|webp);base64,/i.test(candidate)) {
    return candidate;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  if (url.username || url.password) return undefined;
  if (url.protocol === 'https:' || url.protocol === 'blob:') return url.href;
  if (
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase())
  ) {
    return url.href;
  }
  return undefined;
}

function normalizeAvatarURL(value: string): string | undefined {
  return normalizeBeeperResourceURL(value);
}

export function normalizeBeeperResourceURL(value: string): string | undefined {
  const candidate = value.trim();
  if (!candidate) return undefined;
  if (/^(?:mxc|localmxc|file):\/\//i.test(candidate)) return candidate;
  return normalizeResourceURL(candidate);
}

export function isCanonicalMatrixRoomID(value: string): boolean {
  return /^![^:\s]+:\S+$/.test(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(...values: unknown[]): string {
  const value = values.find((candidate) => typeof candidate === 'string');
  return typeof value === 'string' ? value : '';
}

function readNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}
