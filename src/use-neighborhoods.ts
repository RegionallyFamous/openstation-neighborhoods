import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flattenChannels, mapBeeperChatsToChannels, openStationManifest } from './community';
import { BeeperApiError, BeeperClient } from './beeper/client';
import {
  beginBeeperOAuth,
  completeBeeperOAuthCallback,
  disconnectBeeper,
  getStoredAccessToken,
  invalidateBeeperAuthorization,
  introspectBeeperAccessToken,
  revokeBeeperAccessToken,
} from './beeper/oauth';
import type {
  BeeperAccount,
  BeeperCursorPage,
  BeeperMessage,
  BeeperUser,
} from './beeper/types';
import type {
  CommunityChannel,
  CommunityMessage,
  ConnectionState,
  Member,
  MessageAttachment,
  Reaction,
} from './types';

type Mode = 'disconnected' | 'beeper';

interface HydrateMessagesOptions {
  generation?: number;
  markRead?: boolean;
  signal?: AbortSignal;
}

interface MessagePageState {
  hasMore: boolean;
  oldestCursor: string | null;
  newestCursor: string | null;
  historyExhausted: boolean;
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
  canLoadOlder: boolean;
  isLoadingOlder: boolean;
  selectChannel: (channelId: string) => void;
  sendMessage: (body: string) => Promise<void>;
  addReaction: (messageId: string, key: string) => Promise<void>;
  loadOlderMessages: () => Promise<void>;
  probeBeeper: () => Promise<void>;
  connectWithOAuth: () => Promise<void>;
  disconnect: () => void;
  resetConnection: () => void;
}

export function useNeighborhoods(): NeighborhoodsController {
  const [mode, setMode] = useState<Mode>('disconnected');
  const [channels, setChannels] = useState(flattenChannels);
  const [selectedChannelId, setSelectedChannelId] = useState('general');
  const [messageStore, setMessageStore] = useState<Record<string, CommunityMessage[]>>({});
  const [messagePages, setMessagePages] = useState<Record<string, MessagePageState>>({});
  const [loadingOlderChannelId, setLoadingOlderChannelId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [connection, setConnection] = useState<ConnectionState>({
    kind: 'disconnected',
    message: 'Connect Beeper Desktop to load your real Matrix rooms',
  });
  const [isBusy, setIsBusy] = useState(false);
  const selectedChannelIdRef = useRef('general');
  const clientRef = useRef<BeeperClient | null>(null);
  const selfMemberRef = useRef<Member | null>(null);
  const memberStoreRef = useRef<Record<string, Member[]>>({});
  const oauthEndpointsRef = useRef<{
    introspection?: string;
    revocation?: string;
  }>({});
  const pollRef = useRef<number | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);
  const syncGenerationRef = useRef(0);
  const messageRequestsRef = useRef(
    new Map<string, Promise<BeeperCursorPage<BeeperMessage>>>(),
  );
  const readReceiptRequestsRef = useRef(new Set<string>());
  const lastReadMessageRef = useRef<Record<string, string>>({});

  const selectedChannel =
    channels.find((channel) => channel.id === selectedChannelId) ?? channels[0];
  const messages = messageStore[selectedChannel?.id] ?? [];
  const selectedMessagePage = messagePages[selectedChannel?.id];
  const canLoadOlder = Boolean(
    mode === 'beeper' &&
      selectedChannel?.joined &&
      selectedMessagePage?.hasMore &&
      selectedMessagePage.oldestCursor,
  );
  const isLoadingOlder = loadingOlderChannelId === selectedChannel?.id;

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
    clientRef.current?.dispose();
    clientRef.current = null;
    selfMemberRef.current = null;
    memberStoreRef.current = {};
    oauthEndpointsRef.current = {};
    setMode('disconnected');
    setChannels(flattenChannels());
    selectedChannelIdRef.current = 'general';
    setSelectedChannelId('general');
    setMessageStore({});
    setMessagePages({});
    setLoadingOlderChannelId(null);
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

  const hydrateRoomDetails = useCallback(
    async (
      channel: CommunityChannel,
      client = clientRef.current,
      generation = syncGenerationRef.current,
    ) => {
      if (!client || !channel.beeperChatId) return;
      try {
        const detail = await client.getChat(channel.beeperChatId, -1);
        if (generation !== syncGenerationRef.current || clientRef.current !== client) return;

        const roomMembers = await membersFromBeeperUsers(client, detail.participants);
        if (generation !== syncGenerationRef.current || clientRef.current !== client) return;
        let self = selfMemberRef.current;
        const roomSelfUser = detail.participants.find((participant) =>
          participant.isSelf || participant.id === self?.id,
        );
        const roomSelf = roomSelfUser
          ? roomMembers.find((member) => member.id === roomSelfUser.id)
          : undefined;
        if (roomSelf) {
          self = {
            ...roomSelf,
            role: self?.role ?? roomSelf.role,
            avatarUrl: roomSelf.avatarUrl || self?.avatarUrl,
          };
          selfMemberRef.current = self;
          setConnection((current) => current.kind === 'connected'
            ? {
                ...current,
                accountName: self?.name,
                accountHandle: self?.handle,
                avatarUrl: self?.avatarUrl || current.avatarUrl,
              }
            : current);
        }
        const completeMembers = self && !roomMembers.some((member) => member.id === self.id)
          ? [self, ...roomMembers]
          : roomMembers;
        memberStoreRef.current[channel.id] = completeMembers;

        if (selectedChannelIdRef.current === channel.id) setMembers(completeMembers);
        setChannels((current) =>
          current.map((item) =>
            item.id === channel.id
              ? {
                  ...item,
                  isReadOnly: detail.isReadOnly,
                  unreadCount: detail.unreadCount,
                  mentionCount: detail.unreadMentionsCount,
                }
              : item,
          ),
        );
        setMessageStore((current) => ({
          ...current,
          [channel.id]: (current[channel.id] ?? []).map((message) =>
            enrichMessageAuthor(message, completeMembers),
          ),
        }));
      } catch (error) {
        recoverAuthorization(error);
        throw error;
      }
    },
    [recoverAuthorization],
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
          request = client.getMessagesPage(channel.beeperChatId);
          messageRequestsRef.current.set(requestKey, request);
          void request
            .finally(() => {
              if (messageRequestsRef.current.get(requestKey) === request) {
                messageRequestsRef.current.delete(requestKey);
              }
            })
            .catch(() => undefined);
        }

        const page = await request;
        if (options.signal?.aborted || generation !== syncGenerationRef.current) return;
        const knownMembers = memberStoreRef.current[channel.id] ?? [];
        const hydrated = await Promise.all(
          page.items.map((message) =>
            toCommunityMessage(message, channel.id, client, knownMembers),
          ),
        );
        if (options.signal?.aborted || generation !== syncGenerationRef.current) return;
        setMessageStore((current) => ({
          ...current,
          [channel.id]: mergeCommunityMessages(current[channel.id] ?? [], hydrated),
        }));
        setMessagePages((current) => {
          const existing = current[channel.id];
          return {
            ...current,
            [channel.id]: {
              hasMore: existing?.historyExhausted ? false : page.hasMore,
              oldestCursor: existing?.oldestCursor ?? page.oldestCursor,
              newestCursor: page.newestCursor,
              historyExhausted: existing?.historyExhausted ?? !page.hasMore,
            },
          };
        });

        if (
          !options.markRead ||
          selectedChannelIdRef.current !== channel.id ||
          !pageIsVisible() ||
          !pageHasFocus()
        ) {
          return;
        }
        const newest = page.items.at(-1);
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
      const client = new BeeperClient({ token });
      try {
        const info = await client.getInfo();
        if (info.app.bundle_id !== 'com.automattic.beeper.desktop' || info.server.remote_access) {
          throw new Error('This local service is not a supported Beeper Desktop connection.');
        }
        oauthEndpointsRef.current = {
          introspection: info.endpoints.oauth?.introspection_endpoint,
          revocation: info.endpoints.oauth?.revocation_endpoint,
        };
        const tokenActive = await introspectBeeperAccessToken(
          token,
          info.endpoints.oauth?.introspection_endpoint,
        );
        if (!tokenActive) {
          throw new BeeperApiError('Beeper authorization is invalid or expired.', 401, 'unauthorized');
        }
        const [accounts, initialChats] = await Promise.all([
          client.getAccounts(),
          client.getChats(),
        ]);
        const matrixAccount = findMatrixAccount(accounts);
        if (!matrixAccount) {
          throw new Error('Beeper is running, but its Matrix account was not available.');
        }
        const profile: { avatarURL?: string; displayName?: string } = matrixAccount.user?.id
          ? await client.getUserProfile(matrixAccount.user.id).catch(() => ({}))
          : {};
        const matrixIdentity: BeeperAccount = {
          ...matrixAccount,
          user: {
            ...matrixAccount.user,
            fullName: preferSpecificBeeperName(matrixAccount.user?.fullName, profile.displayName),
            imgURL: profile.avatarURL || matrixAccount.user?.imgURL,
          },
        };
        const matrixAvatarURL = await client
          .resolveAssetURL(matrixIdentity.user?.imgURL)
          .catch(() => undefined);
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
        const self = memberFromMatrixAccount(matrixIdentity, matrixAvatarURL);
        selfMemberRef.current = self;
        setMode('beeper');
        setChannels(mapped);
        selectedChannelIdRef.current = first.id;
        setSelectedChannelId(first.id);
        setMessageStore({});
        setMembers([self]);
        setConnection({
          kind: 'connected',
          message:
            joined.length === mapped.length
              ? `OpenStation is ready — the Space and ${joined.length} rooms connected automatically`
              : joined.length
                ? `${joined.length} of ${mapped.length} OpenStation rooms connected automatically`
                : 'Beeper is connected; the OpenStation rooms are not reachable yet',
          accountName:
            self.name,
          accountHandle: self.handle,
          avatarUrl: matrixAvatarURL,
        });
        if (first.beeperChatId) {
          await hydrateRoomDetails(first, client);
          await hydrateMessages(first, client);
        }
        return true;
      } catch (error) {
        client.dispose();
        if (recoverAuthorization(error)) return false;
        clearConnectedState();
        setConnection({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Could not connect to Beeper.',
        });
        throw error;
      } finally {
        setIsBusy(false);
      }
    },
    [clearConnectedState, hydrateMessages, hydrateRoomDetails, recoverAuthorization, stopPolling],
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
    const cachedMembers = memberStoreRef.current[channel.id];
    setMembers(cachedMembers ?? (selfMemberRef.current ? [selfMemberRef.current] : []));
    void hydrateRoomDetails(channel, clientRef.current, generation).catch(() => undefined);
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
    hydrateRoomDetails,
    mode,
    selectedChannel?.beeperChatId,
    selectedChannel?.id,
    stopPolling,
  ]);

  const loadOlderMessages = useCallback(async () => {
    const client = clientRef.current;
    const channel = selectedChannel;
    const pageState = messagePages[channel.id];
    if (
      !client ||
      !channel.beeperChatId ||
      !pageState?.hasMore ||
      !pageState.oldestCursor ||
      loadingOlderChannelId
    ) {
      return;
    }

    const generation = syncGenerationRef.current;
    setLoadingOlderChannelId(channel.id);
    try {
      const page = await client.getMessagesPage(channel.beeperChatId, {
        cursor: pageState.oldestCursor,
        direction: 'before',
      });
      if (generation !== syncGenerationRef.current || clientRef.current !== client) return;
      const knownMembers = memberStoreRef.current[channel.id] ?? [];
      const older = await Promise.all(
        page.items.map((message) =>
          toCommunityMessage(message, channel.id, client, knownMembers),
        ),
      );
      if (generation !== syncGenerationRef.current || clientRef.current !== client) return;
      setMessageStore((current) => ({
        ...current,
        [channel.id]: mergeCommunityMessages(current[channel.id] ?? [], older),
      }));
      setMessagePages((current) => ({
        ...current,
        [channel.id]: {
          hasMore: page.hasMore,
          oldestCursor: page.oldestCursor,
          newestCursor: current[channel.id]?.newestCursor ?? page.newestCursor,
          historyExhausted: !page.hasMore,
        },
      }));
    } catch (error) {
      recoverAuthorization(error);
      throw error;
    } finally {
      setLoadingOlderChannelId((current) => current === channel.id ? null : current);
    }
  }, [
    loadingOlderChannelId,
    messagePages,
    recoverAuthorization,
    selectedChannel,
  ]);

  const selectChannel = useCallback((channelId: string) => {
    selectedChannelIdRef.current = channelId;
    setSelectedChannelId(channelId);
  }, []);

  const reconcilePendingMessage = useCallback(
    async (
      channel: CommunityChannel,
      client: BeeperClient,
      pendingID: string,
      generation: number,
    ) => {
      const retryDelays = [300, 700, 1_500, 3_000, 5_000];
      for (const delayMs of retryDelays) {
        await delay(delayMs);
        if (generation !== syncGenerationRef.current || clientRef.current !== client) return;
        try {
          const message = await client.getMessage(channel.beeperChatId as string, pendingID);
          const knownMembers = memberStoreRef.current[channel.id] ?? [];
          const hydrated = await toCommunityMessage(
            message,
            channel.id,
            client,
            knownMembers,
          );
          if (generation !== syncGenerationRef.current || clientRef.current !== client) return;
          setMessageStore((current) => ({
            ...current,
            [channel.id]: replacePendingMessage(
              current[channel.id] ?? [],
              pendingID,
              hydrated,
            ),
          }));
          if (message.sendStatus?.status !== 'PENDING') return;
        } catch (error) {
          if (recoverAuthorization(error)) return;
          if (!(error instanceof BeeperApiError) || ![404, 502].includes(error.status)) {
            setMessageStore((current) => ({
              ...current,
              [channel.id]: updatePendingDelivery(
                current[channel.id] ?? [],
                pendingID,
                'failed',
                error instanceof Error ? error.message : 'Beeper could not confirm this message.',
              ),
            }));
            return;
          }
        }
      }

      setMessageStore((current) => ({
        ...current,
        [channel.id]: updatePendingDelivery(
          current[channel.id] ?? [],
          pendingID,
          'unconfirmed',
          'Sent to Beeper; confirmation is still pending.',
        ),
      }));
    },
    [recoverAuthorization],
  );

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
              delivery: 'pending',
              deliveryMessage: 'Waiting for Beeper to confirm delivery.',
              reactions: [],
              attachments: [],
            },
          ],
        }));
        void reconcilePendingMessage(channel, client, pendingID, generation);
      } catch (error) {
        recoverAuthorization(error);
        throw error;
      } finally {
        setIsBusy(false);
      }
    },
    [mode, reconcilePendingMessage, recoverAuthorization, selectedChannel],
  );

  const addReaction = useCallback(
    async (messageId: string, key: string) => {
      if (mode === 'beeper' && clientRef.current && selectedChannel.beeperChatId) {
        const client = clientRef.current;
        const channel = selectedChannel;
        const chatID = selectedChannel.beeperChatId;
        const generation = syncGenerationRef.current;
        try {
          const existingMessage = (messageStore[channel.id] ?? []).find(
            (message) => message.id === messageId,
          );
          const existingReaction = existingMessage?.reactions.find(
            (reaction) => reaction.key === key,
          );
          if (existingReaction?.mine) {
            await client.deleteReaction(chatID, messageId, key);
          } else {
            await client.addReaction(chatID, messageId, key);
          }
          if (
            generation !== syncGenerationRef.current ||
            clientRef.current !== client
          ) {
            return;
          }
          setMessageStore((current) => ({
            ...current,
            [channel.id]: (current[channel.id] ?? []).map((message) =>
              message.id === messageId
                ? {
                    ...message,
                    reactions: toggleCommunityReaction(
                      message.reactions,
                      key,
                      !existingReaction?.mine,
                    ),
                  }
                : message,
            ),
          }));
          return;
        } catch (error) {
          recoverAuthorization(error);
          throw error;
        }
      }
    },
    [messageStore, mode, recoverAuthorization, selectedChannel],
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

  const resetConnection = useCallback(() => {
    clearConnectedState();
    setConnection({
      kind: 'disconnected',
      message: 'Connect Beeper Desktop to load your real Matrix rooms',
    });
  }, [clearConnectedState]);

  const disconnect = useCallback(() => {
    const token = getStoredAccessToken();
    const revocationEndpoint = oauthEndpointsRef.current.revocation;
    disconnectBeeper();
    resetConnection();
    if (token) {
      void revokeBeeperAccessToken(token, revocationEndpoint).catch(() => {
        setConnection({
          kind: 'disconnected',
          message: 'Disconnected locally. Beeper could not confirm revocation because it was unavailable.',
        });
      });
    }
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
      canLoadOlder,
      isLoadingOlder,
      selectChannel,
      sendMessage,
      addReaction,
      loadOlderMessages,
      probeBeeper,
      connectWithOAuth,
      disconnect,
      resetConnection,
    }),
    [
      addReaction,
      canLoadOlder,
      channels,
      connectWithOAuth,
      connection,
      disconnect,
      isBusy,
      isLoadingOlder,
      loadOlderMessages,
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

function memberFromMatrixAccount(account: BeeperAccount, avatarUrl?: string): Member {
  const id = account.user?.id || account.user?.username || account.accountID;
  const name = resolveBeeperIdentityName(account.user, id);
  return {
    id,
    name,
    handle: shortMatrixIdentity(account.user?.id || account.user?.username || 'Matrix account'),
    avatar: initials(name),
    avatarUrl,
    color: colorForID(id),
    presence: 'unknown',
    role: 'member',
  };
}

async function membersFromBeeperUsers(
  client: BeeperClient,
  users: BeeperUser[],
): Promise<Member[]> {
  const unique = new Map<string, Member>();
  const distinctUsers = users.filter((user, index) =>
    Boolean(user.id) && users.findIndex((candidate) => candidate.id === user.id) === index,
  );
  const resolved = await mapWithConcurrency(distinctUsers, 6, async (user) => {
    const name = resolveBeeperIdentityName(user, user.id);
    const avatarUrl = await client.resolveAssetURL(user.imgURL).catch(() => undefined);
    return {
      id: user.id,
      name,
      handle: shortMatrixIdentity(user.id),
      avatar: initials(name),
      avatarUrl,
      color: colorForID(user.id),
      presence: 'unknown',
      role: user.isAdmin ? 'moderator' : 'member',
    } satisfies Member;
  });
  resolved.forEach((member) => unique.set(member.id, member));
  return [...unique.values()];
}

async function toCommunityMessage(
  message: BeeperMessage,
  channelId: string,
  client: BeeperClient,
  knownMembers: Member[],
): Promise<CommunityMessage> {
  const knownAuthor = knownMembers.find((member) => member.id === message.senderID);
  const name =
    knownAuthor?.name ||
    resolveBeeperIdentityName(message.sender, message.senderID);
  const avatarUrl = knownAuthor?.avatarUrl || await client
    .resolveAssetURL(message.sender?.imgURL)
    .catch(() => undefined);
  const attachments = await Promise.all(
    message.attachments.map(async (attachment, index) => ({
      id: attachment.id || `${message.id}-attachment-${index}`,
      type: attachmentType(attachment.type),
      name: attachment.fileName || 'Attachment',
      size: attachment.fileSize,
      url: await client.resolveAssetURL(attachment.srcURL).catch(() => undefined),
    })),
  );
  const failed = message.sendStatus?.status === 'FAIL_RETRIABLE' ||
    message.sendStatus?.status === 'FAIL_PERMANENT';
  const pending = message.sendStatus?.status === 'PENDING';
  return {
    id: message.id,
    channelId,
    author: knownAuthor ?? {
      id: message.senderID,
      name,
      handle: shortMatrixIdentity(message.senderID),
      avatar: initials(name),
      avatarUrl,
      color: colorForID(message.senderID),
      presence: 'unknown',
      role: message.sender?.isAdmin ? 'moderator' : 'member',
    },
    body: message.text,
    sentAt: message.timestamp,
    edited: message.isEdited,
    pending,
    delivery: failed ? 'failed' : pending ? 'pending' : 'sent',
    deliveryMessage: failed
      ? message.sendStatus?.message || 'Beeper could not deliver this message.'
      : pending
        ? 'Waiting for Beeper to confirm delivery.'
        : undefined,
    reactions: message.reactions,
    attachments,
  };
}

function mergeCommunityMessages(
  current: CommunityMessage[],
  incoming: CommunityMessage[],
): CommunityMessage[] {
  const merged = new Map(current.map((message) => [message.id, message]));
  incoming.forEach((message) => {
    if (message.delivery !== 'pending') {
      const optimistic = [...merged.values()].find((candidate) =>
        candidate.id !== message.id &&
        ['pending', 'unconfirmed'].includes(candidate.delivery ?? '') &&
        candidate.author.id === message.author.id &&
        candidate.body === message.body &&
        Math.abs(Date.parse(candidate.sentAt) - Date.parse(message.sentAt)) < 120_000,
      );
      if (optimistic) merged.delete(optimistic.id);
    }
    merged.set(message.id, message);
  });
  return [...merged.values()].sort(
    (a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt),
  );
}

export function toggleCommunityReaction(
  reactions: Reaction[],
  key: string,
  adding: boolean,
): Reaction[] {
  const existing = reactions.find((reaction) => reaction.key === key);

  if (adding) {
    if (!existing) return [...reactions, { key, count: 1, mine: true }];
    if (existing.mine) return reactions;
    return reactions.map((reaction) =>
      reaction.key === key
        ? { ...reaction, count: reaction.count + 1, mine: true }
        : reaction,
    );
  }

  if (!existing?.mine) return reactions;
  if (existing.count <= 1) {
    return reactions.filter((reaction) => reaction.key !== key);
  }
  return reactions.map((reaction) =>
    reaction.key === key
      ? { ...reaction, count: reaction.count - 1, mine: false }
      : reaction,
  );
}

function replacePendingMessage(
  messages: CommunityMessage[],
  pendingID: string,
  resolved: CommunityMessage,
): CommunityMessage[] {
  const withoutPending = messages.filter(
    (message) => message.id !== pendingID && message.id !== resolved.id,
  );
  return mergeCommunityMessages(withoutPending, [resolved]);
}

function updatePendingDelivery(
  messages: CommunityMessage[],
  pendingID: string,
  delivery: CommunityMessage['delivery'],
  deliveryMessage: string,
): CommunityMessage[] {
  return messages.map((message) =>
    message.id === pendingID
      ? {
          ...message,
          pending: delivery === 'pending',
          delivery,
          deliveryMessage,
        }
      : message,
  );
}

function enrichMessageAuthor(
  message: CommunityMessage,
  members: Member[],
): CommunityMessage {
  const member = members.find((candidate) => candidate.id === message.author.id);
  return member ? { ...message, author: member } : message;
}

function attachmentType(value?: string): MessageAttachment['type'] {
  if (value === 'img') return 'image';
  if (value === 'audio') return 'audio';
  if (value === 'video') return 'video';
  return 'file';
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function compactHandle(value: string): string {
  return value.replace(/^@/, '').split(':')[0] || 'Neighbor';
}

export function resolveBeeperIdentityName(
  user: { fullName?: string; username?: string; id?: string } | undefined,
  fallbackID: string,
): string {
  const preferred = preferSpecificBeeperName(user?.fullName);
  if (preferred) return preferred;
  if (user?.username) return compactHandle(shortMatrixIdentity(user.username));
  if (user?.id) return compactHandle(shortMatrixIdentity(user.id));
  return compactHandle(fallbackID);
}

function preferSpecificBeeperName(...values: Array<string | undefined>): string | undefined {
  const names = values.map((value) => value?.trim()).filter((value): value is string => Boolean(value));
  return names.find((value) => !isGenericBeeperName(value));
}

function isGenericBeeperName(value: string): boolean {
  return /^(?:beeper(?: user| account)?|matrix(?: user| account)?)$/i.test(value.trim());
}

function shortMatrixIdentity(value: string): string {
  return value.replace(/:[^:]+$/, '');
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
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
