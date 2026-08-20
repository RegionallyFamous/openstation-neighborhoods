import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flattenChannels, mapBeeperChatsToChannels, openStationManifest } from './community';
import { BeeperApiError, BeeperClient } from './beeper/client';
import {
  beginBeeperOAuth,
  completeBeeperOAuthCallback,
  disconnectBeeper,
  getStoredAccessToken,
  invalidateBeeperAuthorization,
  storeManualAccessToken,
} from './beeper/oauth';
import type { BeeperAccount, BeeperMessage, BeeperUser } from './beeper/types';
import type {
  CommunityChannel,
  CommunityMessage,
  ConnectionState,
  Member,
} from './types';

type Mode = 'disconnected' | 'beeper';

interface HydrateMessagesOptions {
  generation?: number;
  markRead?: boolean;
  signal?: AbortSignal;
}

const ACTIVE_POLL_INTERVAL_MS = 5_000;
const HIDDEN_POLL_INTERVAL_MS = 30_000;
const MAX_POLL_BACKOFF_MS = 60_000;

export interface NeighborhoodsController {
  manifest: typeof openStationManifest;
  mode: Mode;
  channels: CommunityChannel[];
  selectedChannel: CommunityChannel;
  messages: CommunityMessage[];
  members: Member[];
  connection: ConnectionState;
  isBusy: boolean;
  selectChannel: (channelId: string) => void;
  sendMessage: (body: string) => Promise<void>;
  addReaction: (messageId: string, key: string) => Promise<void>;
  probeBeeper: () => Promise<void>;
  connectWithOAuth: () => Promise<void>;
  connectWithToken: (token: string) => Promise<void>;
  disconnect: () => void;
  resetConnection: () => void;
}

export function useNeighborhoods(): NeighborhoodsController {
  const [mode, setMode] = useState<Mode>('disconnected');
  const [channels, setChannels] = useState(flattenChannels);
  const [selectedChannelId, setSelectedChannelId] = useState('general');
  const [messageStore, setMessageStore] = useState<Record<string, CommunityMessage[]>>({});
  const [members, setMembers] = useState<Member[]>([]);
  const [connection, setConnection] = useState<ConnectionState>({
    kind: 'disconnected',
    message: 'Connect Beeper Desktop to load your real Matrix rooms',
  });
  const [isBusy, setIsBusy] = useState(false);
  const selectedChannelIdRef = useRef('general');
  const clientRef = useRef<BeeperClient | null>(null);
  const selfMemberRef = useRef<Member | null>(null);
  const pollRef = useRef<number | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);
  const syncGenerationRef = useRef(0);
  const messageRequestsRef = useRef(new Map<string, Promise<BeeperMessage[]>>());
  const readReceiptRequestsRef = useRef(new Set<string>());
  const lastReadMessageRef = useRef<Record<string, string>>({});

  const selectedChannel =
    channels.find((channel) => channel.id === selectedChannelId) ?? channels[0];
  const messages = messageStore[selectedChannel?.id] ?? [];

  const stopPolling = useCallback(() => {
    const hadActivePoll = pollAbortRef.current !== null || pollRef.current !== null;
    pollAbortRef.current?.abort();
    pollAbortRef.current = null;
    if (pollRef.current !== null) {
      window.clearTimeout(pollRef.current);
      pollRef.current = null;
    }
    if (hadActivePoll) syncGenerationRef.current += 1;
  }, []);

  const clearConnectedState = useCallback(() => {
    stopPolling();
    clientRef.current = null;
    selfMemberRef.current = null;
    setMode('disconnected');
    setChannels(flattenChannels());
    selectedChannelIdRef.current = 'general';
    setSelectedChannelId('general');
    setMessageStore({});
    setMembers([]);
  }, [stopPolling]);

  const recoverAuthorization = useCallback(
    (error: unknown): boolean => {
      if (!isAuthorizationFailure(error)) return false;

      invalidateBeeperAuthorization();
      clearConnectedState();
      setConnection({
        kind: 'available',
        message: 'Beeper restarted or the approval expired. Connect again for a fresh session.',
      });
      return true;
    },
    [clearConnectedState],
  );

  const hydrateMessages = useCallback(
    async (
      channel: CommunityChannel,
      client = clientRef.current,
      options: HydrateMessagesOptions = {},
    ) => {
      if (!client || !channel.beeperChatId) return;
      const generation = options.generation ?? syncGenerationRef.current;
      if (options.signal?.aborted || generation !== syncGenerationRef.current) return;

      try {
        const requestKey = `${generation}:${channel.beeperChatId}`;
        let request = messageRequestsRef.current.get(requestKey);
        if (!request) {
          request = client.getMessages(channel.beeperChatId);
          messageRequestsRef.current.set(requestKey, request);
          void request
            .finally(() => {
              if (messageRequestsRef.current.get(requestKey) === request) {
                messageRequestsRef.current.delete(requestKey);
              }
            })
            .catch(() => undefined);
        }

        const raw = await request;
        if (options.signal?.aborted || generation !== syncGenerationRef.current) return;
        setMessageStore((current) => ({
          ...current,
          [channel.id]: raw.map((message) => toCommunityMessage(message, channel.id)),
        }));

        if (
          !options.markRead ||
          selectedChannelIdRef.current !== channel.id ||
          !pageIsVisible() ||
          !pageHasFocus()
        ) {
          return;
        }
        const newest = raw.at(-1);
        if (!newest || lastReadMessageRef.current[channel.id] === newest.id) return;

        const receiptKey = `${generation}:${channel.id}:${newest.id}`;
        if (readReceiptRequestsRef.current.has(receiptKey)) return;
        readReceiptRequestsRef.current.add(receiptKey);
        try {
          await client.markRead(channel.beeperChatId, newest.id);
          if (
            options.signal?.aborted ||
            generation !== syncGenerationRef.current ||
            selectedChannelIdRef.current !== channel.id
          ) {
            return;
          }
          lastReadMessageRef.current[channel.id] = newest.id;
          setChannels((current) =>
            current.map((item) =>
              item.id === channel.id
                ? { ...item, unreadCount: 0, mentionCount: 0 }
                : item,
            ),
          );
        } catch (error) {
          if (isAuthorizationFailure(error)) throw error;
          // A failed read receipt should not hide otherwise valid messages.
        } finally {
          readReceiptRequestsRef.current.delete(receiptKey);
        }
      } catch (error) {
        recoverAuthorization(error);
        throw error;
      }
    },
    [recoverAuthorization],
  );

  const loadBeeper = useCallback(
    async (token: string) => {
      stopPolling();
      setIsBusy(true);
      setConnection({ kind: 'authorizing', message: 'Opening the local Beeper door…' });
      try {
        const client = new BeeperClient({ token });
        const info = await client.getInfo();
        if (info.app.bundle_id !== 'com.automattic.beeper.desktop' || info.server.remote_access) {
          throw new Error('This local service is not a supported Beeper Desktop connection.');
        }
        const [accounts, initialChats] = await Promise.all([
          client.getAccounts(),
          client.getChats(),
        ]);
        const matrixAccount = findMatrixAccount(accounts);
        if (!matrixAccount) {
          throw new Error('Beeper is running, but its Matrix account was not available.');
        }
        const initiallyMapped = mapBeeperChatsToChannels(
          flattenChannels(),
          initialChats,
        );
        const roomsToJoin = initiallyMapped.filter(
          (channel) => !channel.joined && Boolean(channel.roomId || channel.alias),
        );
        const [[spaceJoinResult], joinResults] = await Promise.all([
          Promise.allSettled([
            openStationManifest.spaceRoomId
              ? client.joinRoom(openStationManifest.spaceRoomId)
              : Promise.resolve(undefined),
          ]),
          Promise.allSettled(
            roomsToJoin.map(async (channel) => ({
              channelID: channel.id,
              roomID: await client.joinRoom((channel.roomId || channel.alias) as string),
            })),
          ),
        ]);
        const authorizationFailure = [spaceJoinResult, ...joinResults].find(
          (result): result is PromiseRejectedResult =>
            result.status === 'rejected' && isAuthorizationFailure(result.reason),
        );
        if (authorizationFailure) throw authorizationFailure.reason;
        const automaticallyJoined = new Map(
          joinResults.flatMap((result) =>
            result.status === 'fulfilled'
              ? [[result.value.channelID, result.value.roomID] as const]
              : [],
          ),
        );
        let chats = initialChats;
        if (automaticallyJoined.size) {
          try {
            chats = await client.getChats();
          } catch (error) {
            if (isAuthorizationFailure(error)) throw error;
          }
        }
        const mapped = mapBeeperChatsToChannels(flattenChannels(), chats).map(
          (channel) => ({
            ...channel,
            beeperChatId:
              channel.beeperChatId || automaticallyJoined.get(channel.id),
            joined: Boolean(
              channel.beeperChatId || automaticallyJoined.get(channel.id),
            ),
          }),
        );
        const joined = mapped.filter((channel) => channel.joined);
        const first =
          mapped.find(
            (channel) =>
              channel.id === selectedChannelIdRef.current && channel.joined,
          ) ??
          joined[0] ??
          mapped[0];

        clientRef.current = client;
        const self = memberFromMatrixAccount(matrixAccount);
        selfMemberRef.current = self;
        setMode('beeper');
        setChannels(mapped);
        selectedChannelIdRef.current = first.id;
        setSelectedChannelId(first.id);
        setMessageStore({});
        const joinedChatIDs = new Set(
          joined.flatMap((channel) => channel.beeperChatId ? [channel.beeperChatId] : []),
        );
        const discoveredMembers = membersFromChats(
          chats
            .filter((chat) => joinedChatIDs.has(chat.id))
            .flatMap((chat) => chat.participants),
        );
        setMembers([
          self,
          ...discoveredMembers.filter((member) => member.id !== self.id),
        ]);
        setConnection({
          kind: 'connected',
          message:
            joined.length === mapped.length
              ? `OpenStation is ready — the Space and ${joined.length} rooms connected automatically`
              : joined.length
                ? `${joined.length} of ${mapped.length} OpenStation rooms connected automatically`
                : 'Beeper is connected; the OpenStation rooms are not reachable yet',
          accountName:
            (matrixAccount.user?.username && shortMatrixIdentity(matrixAccount.user.username)) ||
            (matrixAccount.user?.id && shortMatrixIdentity(matrixAccount.user.id)) ||
            matrixAccount.user?.fullName ||
            'Beeper',
          avatarUrl: matrixAccount.user?.imgURL,
        });
        if (first.beeperChatId) await hydrateMessages(first, client);
        return true;
      } catch (error) {
        if (recoverAuthorization(error)) return false;
        setConnection({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Could not connect to Beeper.',
        });
        throw error;
      } finally {
        setIsBusy(false);
      }
    },
    [hydrateMessages, recoverAuthorization, stopPolling],
  );

  useEffect(() => {
    let active = true;
    completeBeeperOAuthCallback()
      .then((token) => {
        if (active && token) return loadBeeper(token);
        return undefined;
      })
      .catch((error) => {
        if (!active) return;
        setConnection({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Beeper authorization failed.',
        });
      });
    return () => {
      active = false;
    };
  }, [loadBeeper]);

  useEffect(() => {
    stopPolling();
    if (mode !== 'beeper' || !selectedChannel?.beeperChatId) return;
    const controller = new AbortController();
    const generation = syncGenerationRef.current;
    const channel = selectedChannel;
    let failureCount = 0;
    let running = false;
    let rerunRequested = false;
    pollAbortRef.current = controller;

    const schedule = (delay: number) => {
      if (controller.signal.aborted || generation !== syncGenerationRef.current) return;
      if (pollRef.current !== null) window.clearTimeout(pollRef.current);
      pollRef.current = window.setTimeout(() => {
        pollRef.current = null;
        void run();
      }, delay);
    };

    const run = async () => {
      if (controller.signal.aborted || generation !== syncGenerationRef.current) return;
      if (!pageIsVisible()) {
        schedule(HIDDEN_POLL_INTERVAL_MS);
        return;
      }
      if (running) {
        rerunRequested = true;
        return;
      }

      running = true;
      let nextDelay = ACTIVE_POLL_INTERVAL_MS;
      try {
        await hydrateMessages(channel, undefined, {
          generation,
          markRead: true,
          signal: controller.signal,
        });
        failureCount = 0;
      } catch {
        failureCount += 1;
        nextDelay = Math.min(
          ACTIVE_POLL_INTERVAL_MS * 2 ** failureCount,
          MAX_POLL_BACKOFF_MS,
        );
      } finally {
        running = false;
        if (controller.signal.aborted || generation !== syncGenerationRef.current) return;
        if (rerunRequested) {
          rerunRequested = false;
          schedule(0);
        } else {
          schedule(pageIsVisible() ? nextDelay : HIDDEN_POLL_INTERVAL_MS);
        }
      }
    };

    const refreshWhenVisible = () => {
      if (!pageIsVisible() || controller.signal.aborted) return;
      if (running) {
        rerunRequested = true;
      } else {
        schedule(0);
      }
    };

    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refreshWhenVisible);
    schedule(0);

    return () => {
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refreshWhenVisible);
      stopPolling();
    };
  }, [
    hydrateMessages,
    mode,
    selectedChannel?.beeperChatId,
    selectedChannel?.id,
    stopPolling,
  ]);

  const selectChannel = useCallback((channelId: string) => {
    selectedChannelIdRef.current = channelId;
    setSelectedChannelId(channelId);
  }, []);

  const sendMessage = useCallback(
    async (body: string) => {
      const cleanBody = body.trim();
      if (!cleanBody || !selectedChannel) return;

      if (mode !== 'beeper') {
        throw new Error('Connect Beeper before sending a message.');
      }

      const client = clientRef.current;
      const chatID = selectedChannel.beeperChatId;
      if (!client || !chatID) {
        throw new Error('Join this room in Beeper before sending a message.');
      }
      const self = selfMemberRef.current;
      if (!self) throw new Error('Beeper did not return your Matrix identity.');
      const channel = selectedChannel;
      const generation = syncGenerationRef.current;
      setIsBusy(true);
      try {
        const pendingID = await client.sendMessage(
          chatID,
          cleanBody,
        );
        if (
          generation !== syncGenerationRef.current ||
          clientRef.current !== client
        ) {
          return;
        }
        setMessageStore((current) => ({
          ...current,
          [channel.id]: [
            ...(current[channel.id] ?? []),
            {
              id: pendingID,
              channelId: channel.id,
              author: self,
              body: cleanBody,
              sentAt: new Date().toISOString(),
              pending: true,
              reactions: [],
              attachments: [],
            },
          ],
        }));
        window.setTimeout(() => {
          if (
            generation !== syncGenerationRef.current ||
            clientRef.current !== client
          ) {
            return;
          }
          void hydrateMessages(channel, client, { generation }).catch(() => undefined);
        }, 1_000);
      } catch (error) {
        recoverAuthorization(error);
        throw error;
      } finally {
        setIsBusy(false);
      }
    },
    [hydrateMessages, mode, recoverAuthorization, selectedChannel],
  );

  const addReaction = useCallback(
    async (messageId: string, key: string) => {
      if (mode === 'beeper' && clientRef.current && selectedChannel.beeperChatId) {
        const client = clientRef.current;
        const channel = selectedChannel;
        const chatID = selectedChannel.beeperChatId;
        const generation = syncGenerationRef.current;
        try {
          await client.addReaction(
            chatID,
            messageId,
            key,
          );
          if (
            generation !== syncGenerationRef.current ||
            clientRef.current !== client
          ) {
            return;
          }
          await hydrateMessages(channel, client, { generation });
          return;
        } catch (error) {
          recoverAuthorization(error);
          throw error;
        }
      }
    },
    [hydrateMessages, mode, recoverAuthorization, selectedChannel],
  );

  const probeBeeper = useCallback(async () => {
    setConnection({ kind: 'probing', message: 'Looking for Beeper Desktop…' });
    try {
      const client = new BeeperClient();
      const info = await client.getInfo();
      setConnection({
        kind: 'available',
        message: `${info.app.name} ${info.app.version} is ready on this computer`,
      });
    } catch {
      setConnection({
        kind: 'unavailable',
        message: 'Beeper Desktop API is not running on this computer',
      });
    }
  }, []);

  const connectWithOAuth = useCallback(async () => {
    setIsBusy(true);
    setConnection({ kind: 'authorizing', message: 'Waiting for Beeper approval…' });
    try {
      await beginBeeperOAuth();
    } catch (error) {
      setConnection({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not start Beeper OAuth.',
      });
      setIsBusy(false);
      throw error;
    }
  }, []);

  const connectWithToken = useCallback(
    async (token: string) => {
      const cleanToken = token.trim();
      if (!cleanToken) throw new Error('Enter a Beeper access token.');

      const connected = await loadBeeper(cleanToken);
      if (!connected) {
        throw new Error('That Beeper token is invalid or expired.');
      }
      storeManualAccessToken(cleanToken);
    },
    [loadBeeper],
  );

  const resetConnection = useCallback(() => {
    clearConnectedState();
    setConnection({
      kind: 'disconnected',
      message: 'Connect Beeper Desktop to load your real Matrix rooms',
    });
  }, [clearConnectedState]);

  const disconnect = useCallback(() => {
    disconnectBeeper();
    resetConnection();
  }, [resetConnection]);

  return useMemo(
    () => ({
      manifest: openStationManifest,
      mode,
      channels,
      selectedChannel,
      messages,
      members,
      connection,
      isBusy,
      selectChannel,
      sendMessage,
      addReaction,
      probeBeeper,
      connectWithOAuth,
      connectWithToken,
      disconnect,
      resetConnection,
    }),
    [
      addReaction,
      channels,
      connectWithOAuth,
      connectWithToken,
      connection,
      disconnect,
      isBusy,
      members,
      messages,
      mode,
      probeBeeper,
      resetConnection,
      selectChannel,
      selectedChannel,
      sendMessage,
    ],
  );
}

function findMatrixAccount(accounts: BeeperAccount[]): BeeperAccount | undefined {
  return accounts.find(
    (account) =>
      account.accountID === 'matrix' || account.bridge?.type?.toLowerCase() === 'matrix',
  );
}

function memberFromMatrixAccount(account: BeeperAccount): Member {
  const id = account.user?.id || account.user?.username || account.accountID;
  const name = account.user?.username
    ? shortMatrixIdentity(account.user.username)
    : account.user?.fullName || compactHandle(id);
  return {
    id,
    name,
    handle: shortMatrixIdentity(account.user?.id || account.user?.username || 'Matrix account'),
    avatar: initials(name),
    avatarUrl: account.user?.imgURL,
    color: colorForID(id),
    presence: 'unknown',
    role: 'member',
  };
}

function membersFromChats(users: BeeperUser[]): Member[] {
  const unique = new Map<string, Member>();
  users.forEach((user) => {
    if (!user.id || unique.has(user.id)) return;
    const name = user.username
      ? shortMatrixIdentity(user.username)
      : user.fullName || compactHandle(user.id);
    unique.set(user.id, {
      id: user.id,
      name,
      handle: user.id,
      avatar: initials(name),
      avatarUrl: user.imgURL,
      color: colorForID(user.id),
      presence: 'unknown',
      role: user.isAdmin ? 'moderator' : 'member',
    });
  });
  return [...unique.values()];
}

function toCommunityMessage(message: BeeperMessage, channelId: string): CommunityMessage {
  const name =
    message.sender?.fullName ||
    message.sender?.username ||
    compactHandle(message.senderID);
  return {
    id: message.id,
    channelId,
    author: {
      id: message.senderID,
      name,
      handle: message.senderID,
      avatar: initials(name),
      avatarUrl: message.sender?.imgURL,
      color: colorForID(message.senderID),
      presence: 'unknown',
      role: message.sender?.isAdmin ? 'moderator' : 'member',
    },
    body: message.text,
    sentAt: message.timestamp,
    edited: message.isEdited,
    reactions: message.reactions,
    attachments: message.attachments.map((attachment, index) => ({
      id: attachment.id || `${message.id}-attachment-${index}`,
      type: attachment.type === 'img' ? 'image' : 'file',
      name: attachment.fileName || 'Attachment',
      size: attachment.fileSize,
      url: attachment.srcURL,
    })),
  };
}

function compactHandle(value: string): string {
  return value.replace(/^@/, '').split(':')[0] || 'Neighbor';
}

function shortMatrixIdentity(value: string): string {
  return value.replace(/:[^:]+$/, '');
}

function initials(value: string): string {
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function colorForID(value: string): string {
  const colors = ['#ff876e', '#65d8c8', '#9b8cff', '#77b8ff', '#ef88bd', '#b6df73'];
  const hash = [...value].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

function pageIsVisible(): boolean {
  return document.visibilityState === 'visible';
}

function pageHasFocus(): boolean {
  return typeof document.hasFocus !== 'function' || document.hasFocus();
}

export function getExistingBeeperToken(): string | null {
  return getStoredAccessToken();
}

function isAuthorizationFailure(error: unknown): error is BeeperApiError {
  return (
    error instanceof BeeperApiError &&
    (error.status === 401 ||
      error.code?.toLowerCase() === 'unauthorized' ||
      /invalid token/i.test(error.message))
  );
}
