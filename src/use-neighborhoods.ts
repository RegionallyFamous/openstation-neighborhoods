import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flattenChannels, mapBeeperChatsToChannels, openStationManifest } from './community';
import { assertSupportedBeeperInfo, BeeperApiError, BeeperClient } from './beeper/client';
import {
  BeeperFlowError,
  classifyBeeperFailure,
} from './beeper/failures';
import {
  completeBeeperOAuthCallback,
  disconnectBeeper,
  getStoredAccessToken,
  invalidateBeeperAuthorization,
  storeBeeperAccessToken,
} from './beeper/oauth';
import type {
  BeeperAccount,
  BeeperChat,
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
  RoomSyncState,
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
const JOIN_CONSENT_KEY = 'openstation-neighborhoods:join-consent';
const JOIN_CONSENT_VERSION = '2026-08-20-v1';

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
  selectedSync: RoomSyncState;
  selectChannel: (channelId: string) => void;
  sendMessage: (body: string) => Promise<void>;
  loadOlderMessages: () => Promise<void>;
  retryRoom: (channelId: string) => Promise<void>;
  retrySync: () => void;
  retryConnection: (joinConsentAccepted: boolean, rememberOnComputer: boolean) => Promise<void>;
  resolveAttachment: (attachment: MessageAttachment) => Promise<string>;
  setReadEligible: (eligible: boolean) => void;
  probeBeeper: () => Promise<boolean>;
  connectWithToken: (
    token: string,
    joinConsentAccepted: boolean,
    rememberOnComputer: boolean,
  ) => Promise<void>;
  disconnect: () => void;
}

export function useNeighborhoods(): NeighborhoodsController {
  const [mode, setMode] = useState<Mode>('disconnected');
  const [channels, setChannels] = useState(flattenChannels);
  const [selectedChannelId, setSelectedChannelId] = useState('general');
  const [messageStore, setMessageStore] = useState<Record<string, CommunityMessage[]>>({});
  const [messagePages, setMessagePages] = useState<Record<string, MessagePageState>>({});
  const [loadingOlderChannelId, setLoadingOlderChannelId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [roomSyncStore, setRoomSyncStore] = useState<Record<string, RoomSyncState>>({});
  const [syncRetryNonce, setSyncRetryNonce] = useState(0);
  const [connection, setConnection] = useState<ConnectionState>({
    kind: 'disconnected',
    message: 'Open Beeper on this computer, then let’s go.',
  });
  const [isBusy, setIsBusy] = useState(false);
  const selectedChannelIdRef = useRef('general');
  const clientRef = useRef<BeeperClient | null>(null);
  const channelsRef = useRef(channels);
  const selfMemberRef = useRef<Member | null>(null);
  const memberStoreRef = useRef<Record<string, Member[]>>({});
  const messagePageStoreRef = useRef<Record<string, MessagePageState>>({});
  const pollRef = useRef<number | null>(null);
  const pollAbortRef = useRef<AbortController | null>(null);
  const syncGenerationRef = useRef(0);
  const messageRequestsRef = useRef(
    new Map<string, Promise<BeeperCursorPage<BeeperMessage>>>(),
  );
  const readReceiptRequestsRef = useRef(new Set<string>());
  const roomRetryRequestsRef = useRef(new Set<string>());
  const lastReadMessageRef = useRef<Record<string, string>>({});
  const readEligibleRef = useRef(false);
  const busyOperationRef = useRef(0);

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
  const selectedSync = roomSyncStore[selectedChannel?.id] ?? {
    kind: mode === 'beeper' && selectedChannel?.joined ? 'loading' : 'idle',
    message: mode === 'beeper' && selectedChannel?.joined
      ? 'Opening this room…'
      : 'Waiting for Beeper.',
  };

  useEffect(() => {
    channelsRef.current = channels;
  }, [channels]);

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
    busyOperationRef.current += 1;
    setIsBusy(false);
    stopPolling();
    clientRef.current?.dispose();
    clientRef.current = null;
    selfMemberRef.current = null;
    memberStoreRef.current = {};
    messagePageStoreRef.current = {};
    setMode('disconnected');
    const disconnectedChannels = flattenChannels();
    channelsRef.current = disconnectedChannels;
    setChannels(disconnectedChannels);
    selectedChannelIdRef.current = 'general';
    setSelectedChannelId('general');
    setMessageStore({});
    setMessagePages({});
    setLoadingOlderChannelId(null);
    setMembers([]);
    setRoomSyncStore({});
    roomRetryRequestsRef.current.clear();
  }, [stopPolling]);

  const recoverAuthorization = useCallback(
    (error: unknown): boolean => {
      if (!isAuthorizationFailure(error)) return false;

      invalidateBeeperAuthorization();
      clearConnectedState();
      const problem = classifyBeeperFailure(error);
      setConnection({
        kind: 'error',
        message: problem.message,
        problem,
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
        if (generation !== syncGenerationRef.current || clientRef.current !== client) return;
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
        const existingPageState = messagePageStoreRef.current[channel.id];
        const newestCursor = existingPageState?.newestCursor;
        const requestKey = `${generation}:${channel.beeperChatId}:${newestCursor ?? 'latest'}`;
        let request = messageRequestsRef.current.get(requestKey);
        if (!request) {
          request = fetchNewMessagePages(client, channel.beeperChatId, newestCursor);
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
        const removedMessageIDs = new Set(
          page.items.filter((message) => message.removed).map((message) => message.id),
        );
        const hydrated = await Promise.all(
          page.items.filter((message) => !message.removed).map((message) =>
            toCommunityMessage(message, channel.id, client, knownMembers),
          ),
        );
        if (options.signal?.aborted || generation !== syncGenerationRef.current) return;
        setMessageStore((current) => ({
          ...current,
          [channel.id]: reconcileCommunityMessages(
            current[channel.id] ?? [],
            hydrated,
            removedMessageIDs,
          ),
        }));
        const nextPageState: MessagePageState = {
          hasMore: existingPageState?.historyExhausted
            ? false
            : existingPageState?.hasMore ?? page.hasMore,
          oldestCursor: existingPageState?.oldestCursor ?? page.oldestCursor,
          newestCursor: page.newestCursor ?? existingPageState?.newestCursor ?? null,
          historyExhausted: existingPageState?.historyExhausted ?? !page.hasMore,
        };
        messagePageStoreRef.current[channel.id] = nextPageState;
        setMessagePages((current) => ({
          ...current,
          [channel.id]: nextPageState,
        }));

        if (
          !options.markRead ||
          selectedChannelIdRef.current !== channel.id ||
          !pageIsVisible() ||
          !pageHasFocus() ||
          !readEligibleRef.current
        ) {
          return;
        }
        const newest = [...page.items].reverse().find((message) => !message.removed);
        if (!newest || lastReadMessageRef.current[channel.id] === newest.id) return;

        const receiptKey = `${generation}:${channel.id}:${newest.id}`;
        if (readReceiptRequestsRef.current.has(receiptKey)) return;
        readReceiptRequestsRef.current.add(receiptKey);
        void client.markRead(channel.beeperChatId, newest.id, options.signal)
          .then(() => {
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
          })
          .catch((error) => {
            if (
              options.signal?.aborted ||
              generation !== syncGenerationRef.current ||
              clientRef.current !== client
            ) {
              return;
            }
            recoverAuthorization(error);
            // A failed read receipt should not hide or delay otherwise valid messages.
          })
          .finally(() => {
            readReceiptRequestsRef.current.delete(receiptKey);
          });
      } catch (error) {
        if (
          options.signal?.aborted ||
          generation !== syncGenerationRef.current ||
          clientRef.current !== client
        ) {
          return;
        }
        recoverAuthorization(error);
        throw error;
      }
    },
    [recoverAuthorization],
  );

  const loadBeeper = useCallback(
    async (token: string, allowAutomaticJoin = false) => {
      const busyOperation = ++busyOperationRef.current;
      stopPolling();
      setIsBusy(true);
      setConnection({ kind: 'authorizing', message: 'Beeper is checking your saved pass…' });
      const client = new BeeperClient({ token });
      try {
        const info = await client.getInfo();
        assertSupportedBeeperInfo(info);
        setConnection({ kind: 'authorizing', message: 'Checking your pass and gathering your rooms…' });
        const accounts = await client.getAccounts();
        const matrixAccount = findMatrixAccount(accounts);
        if (!matrixAccount) {
          throw new BeeperFlowError('matrix-account-missing');
        }
        if (
          matrixAccount.status &&
          !['connected', 'backfilling'].includes(matrixAccount.status)
        ) {
          throw new BeeperFlowError(
            'matrix-account-attention',
            matrixAccount.statusText || 'Open Beeper and resolve the account notice shown there, then check again.',
          );
        }
        const chatsPromise = getOpenStationChats(client);
        const initialChats = await chatsPromise;
        setConnection({ kind: 'authorizing', message: 'Rooms found. Fluffing the cushions…' });
        const matrixIdentity: BeeperAccount = matrixAccount;
        const initiallyMapped = mapBeeperChatsToChannels(
          flattenChannels(),
          initialChats,
        );
        const roomsToJoin = initiallyMapped.filter(
          (channel) => !channel.joined,
        );
        const [spaceJoinResults, joinResults] = allowAutomaticJoin
          ? await Promise.all([
              Promise.allSettled([client.joinRoom(openStationManifest.spaceRoomId).then((roomID) => {
                if (roomID !== openStationManifest.spaceRoomId) {
                  throw new BeeperFlowError('room-mismatch');
                }
                return roomID;
              })]),
              Promise.allSettled(
                roomsToJoin.map(async (channel) => {
                  const roomID = await client.joinRoom(channel.roomId);
                  if (roomID !== channel.roomId) {
                    throw new BeeperFlowError('room-mismatch');
                  }
                  return { channelID: channel.id, roomID };
                }),
              ),
            ])
          : [[], []] as [
              PromiseSettledResult<string>[],
              PromiseSettledResult<{ channelID: string; roomID: string }>[],
            ];
        const authorizationFailure = [...spaceJoinResults, ...joinResults].find(
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
        const joinProblems = new Map(
          joinResults.flatMap((result, index) =>
            result.status === 'rejected'
              ? [[roomsToJoin[index].id, classifyBeeperFailure(result.reason)] as const]
              : [],
          ),
        );
        let chats = initialChats;
        if (automaticallyJoined.size) {
          try {
            chats = await getOpenStationChats(client);
          } catch (error) {
            if (isAuthorizationFailure(error)) throw error;
          }
        }
        const mapped: CommunityChannel[] = mapBeeperChatsToChannels(flattenChannels(), chats).map(
          (channel): CommunityChannel => {
            const joinedRoomID = channel.beeperChatId || automaticallyJoined.get(channel.id);
            const joinProblem = joinProblems.get(channel.id);
            return {
            ...channel,
              beeperChatId: joinedRoomID,
              joined: Boolean(joinedRoomID),
              connectionStatus: joinedRoomID
                ? 'joined'
                : joinProblem
                  ? 'failed'
                  : 'not-joined',
              connectionMessage: joinProblem?.message,
            };
          },
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
        const self = memberFromMatrixAccount(matrixIdentity);
        selfMemberRef.current = self;
        setMode('beeper');
        channelsRef.current = mapped;
        setChannels(mapped);
        selectedChannelIdRef.current = first.id;
        setSelectedChannelId(first.id);
        setMessageStore({});
        setMembers([self]);
        setConnection({
          kind: 'connected',
          health: joined.length === mapped.length ? 'live' : 'partial',
          message:
            joined.length === mapped.length
              ? `All ${joined.length} rooms are open. Come on in.`
              : joined.length
                ? `${joined.length} of ${mapped.length} rooms opened. The others need another knock.`
                : 'Beeper is connected, but the rooms did not open yet.',
          accountName:
            self.name,
          accountHandle: self.handle,
        });
        if (matrixIdentity.user?.imgURL) {
          void client.resolveAssetURL(matrixIdentity.user.imgURL)
            .then((avatarUrl) => {
              if (!avatarUrl || clientRef.current !== client) return;
              const updatedSelf = memberFromMatrixAccount(matrixIdentity, avatarUrl);
              selfMemberRef.current = updatedSelf;
              memberStoreRef.current = Object.fromEntries(
                Object.entries(memberStoreRef.current).map(([channelID, roomMembers]) => [
                  channelID,
                  roomMembers.map((member) =>
                    member.id === updatedSelf.id ? { ...member, ...updatedSelf } : member,
                  ),
                ]),
              );
              setMembers((current) => current.map((member) =>
                member.id === updatedSelf.id ? { ...member, ...updatedSelf } : member,
              ));
              setConnection((current) => current.kind === 'connected'
                ? { ...current, avatarUrl }
                : current);
            })
            .catch(() => undefined);
        }
        return true;
      } catch (error) {
        client.dispose();
        if (recoverAuthorization(error)) return false;
        clearConnectedState();
        const problem = classifyBeeperFailure(error);
        setConnection({
          kind: 'error',
          message: problem.message,
          problem,
        });
        return false;
      } finally {
        if (busyOperationRef.current === busyOperation) setIsBusy(false);
      }
    },
    [clearConnectedState, recoverAuthorization, stopPolling],
  );

  useEffect(() => {
    let active = true;
    const callbackURL = new URL(window.location.href);
    const completesFreshAuthorization = callbackURL.searchParams.has('code');
    const joinConsentIsCurrent =
      window.localStorage.getItem(JOIN_CONSENT_KEY) === JOIN_CONSENT_VERSION;
    completeBeeperOAuthCallback()
      .then((token) => {
        if (active && token) {
          return loadBeeper(
            token,
            completesFreshAuthorization && joinConsentIsCurrent,
          );
        }
        return undefined;
      })
      .catch((error) => {
        if (!active) return;
        const problem = classifyBeeperFailure(error);
        setConnection({
          kind: 'error',
          message: problem.message,
          problem,
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
    setRoomSyncStore((current) => ({
      ...current,
      [channel.id]: current[channel.id]?.kind === 'live'
        ? current[channel.id]
        : { kind: 'loading', message: `Opening #${channel.name}…` },
    }));
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
        setRoomSyncStore((current) => ({
          ...current,
          [channel.id]: {
            kind: 'live',
            message: 'Up to date with Beeper.',
            lastUpdatedAt: Date.now(),
          },
        }));
        setConnection((current) => {
          if (current.kind !== 'connected' || current.health !== 'reconnecting') return current;
          const joinedCount = channelsRef.current.filter((item) => item.joined).length;
          const allJoined = joinedCount === channelsRef.current.length;
          return {
            ...current,
            health: allJoined ? 'live' : 'partial',
            message: allJoined
              ? `All ${joinedCount} rooms are open. Come on in.`
              : `${joinedCount} of ${channelsRef.current.length} rooms are open.`,
          };
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        failureCount += 1;
        const problem = classifyBeeperFailure(error);
        setRoomSyncStore((current) => ({
          ...current,
          [channel.id]: {
            kind: failureCount >= 3 ? 'error' : 'retrying',
            message: failureCount >= 3
              ? problem.message
              : `${problem.message} Retrying automatically…`,
            lastUpdatedAt: current[channel.id]?.lastUpdatedAt,
          },
        }));
        if (!isAuthorizationFailure(error)) {
          setConnection((current) => current.kind === 'connected'
            ? {
                ...current,
                health: 'reconnecting',
                message: 'The Beeper connection is wobbling. OpenStation is retrying automatically.',
              }
            : current);
        }
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
    syncRetryNonce,
    stopPolling,
  ]);

  const retrySync = useCallback(() => {
    setSyncRetryNonce((current) => current + 1);
  }, []);

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
        page.items.filter((message) => !message.removed).map((message) =>
          toCommunityMessage(message, channel.id, client, knownMembers),
        ),
      );
      const removedMessageIDs = new Set(
        page.items.filter((message) => message.removed).map((message) => message.id),
      );
      if (generation !== syncGenerationRef.current || clientRef.current !== client) return;
      setMessageStore((current) => ({
        ...current,
        [channel.id]: reconcileCommunityMessages(
          current[channel.id] ?? [],
          older,
          removedMessageIDs,
        ),
      }));
      const nextPageState: MessagePageState = {
        hasMore: page.hasMore,
        oldestCursor: page.oldestCursor,
        newestCursor: messagePageStoreRef.current[channel.id]?.newestCursor ?? page.newestCursor,
        historyExhausted: !page.hasMore,
      };
      messagePageStoreRef.current[channel.id] = nextPageState;
      setMessagePages((current) => ({
        ...current,
        [channel.id]: nextPageState,
      }));
    } catch (error) {
      if (generation !== syncGenerationRef.current || clientRef.current !== client) return;
      if (recoverAuthorization(error)) {
        throw new Error(classifyBeeperFailure(error).message);
      }
      throw new Error(classifyBeeperFailure(error).message);
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

  const retryRoom = useCallback(async (channelId: string) => {
    const client = clientRef.current;
    const generation = syncGenerationRef.current;
    const channel = channelsRef.current.find((item) => item.id === channelId);
    if (!client || !channel) {
      throw new Error('Connect Beeper before retrying this room.');
    }
    if (roomRetryRequestsRef.current.has(channelId)) return;
    if (channel.joined && channel.beeperChatId) {
      setSyncRetryNonce((current) => current + 1);
      return;
    }

    roomRetryRequestsRef.current.add(channelId);
    setChannels((current) => current.map((item) => item.id === channelId
      ? { ...item, connectionStatus: 'joining', connectionMessage: 'Knocking on this room’s door…' }
      : item));
    try {
      const joinedRoomID = await client.joinRoom(channel.roomId);
      if (generation !== syncGenerationRef.current || clientRef.current !== client) return;
      if (joinedRoomID !== channel.roomId) {
        throw new BeeperFlowError('room-mismatch');
      }
      const detail = await client.getChat(channel.roomId, 0);
      if (generation !== syncGenerationRef.current || clientRef.current !== client) return;
      if (detail.id !== channel.roomId) {
        throw new BeeperFlowError('room-mismatch');
      }
      const refreshed = mapBeeperChatsToChannels([channel], [detail])[0];
      setChannels((current) => {
        const next = current.map((item) => item.id === channelId
          ? {
              ...refreshed,
              connectionStatus: 'joined' as const,
              connectionMessage: undefined,
            }
          : item);
        channelsRef.current = next;
        const joinedCount = next.filter((item) => item.joined).length;
        setConnection((connection) => connection.kind === 'connected'
          ? {
              ...connection,
              health: joinedCount === next.length ? 'live' : 'partial',
              message: joinedCount === next.length
                ? `All ${joinedCount} rooms are open. Come on in.`
                : `${joinedCount} of ${next.length} rooms are open.`,
            }
          : connection);
        return next;
      });
      setRoomSyncStore((current) => ({
        ...current,
        [channelId]: { kind: 'loading', message: `Opening #${channel.name}…` },
      }));
      setSyncRetryNonce((current) => current + 1);
    } catch (error) {
      if (generation !== syncGenerationRef.current || clientRef.current !== client) return;
      if (recoverAuthorization(error)) {
        throw new Error(classifyBeeperFailure(error).message);
      }
      const problem = classifyBeeperFailure(error);
      setChannels((current) => current.map((item) => item.id === channelId
        ? {
            ...item,
            joined: false,
            beeperChatId: undefined,
            connectionStatus: 'failed',
            connectionMessage: problem.message,
          }
        : item));
      throw new Error(problem.message);
    } finally {
      roomRetryRequestsRef.current.delete(channelId);
    }
  }, [recoverAuthorization]);

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
          if (generation !== syncGenerationRef.current || clientRef.current !== client) return;
          if (recoverAuthorization(error)) return;
          if (!(error instanceof BeeperApiError) || ![404, 502].includes(error.status)) {
            const problem = classifyBeeperFailure(error);
            setMessageStore((current) => ({
              ...current,
              [channel.id]: updatePendingDelivery(
                current[channel.id] ?? [],
                pendingID,
                'failed',
                problem.message,
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
              'Beeper has it. We’re still waiting for the delivery stamp.',
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
      if (selectedChannel.kind === 'announcement' || selectedChannel.isReadOnly) {
        throw new Error('This Beeper Neighborhood room is read-only.');
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
      const busyOperation = ++busyOperationRef.current;
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
              deliveryMessage: 'Handed to Beeper. Waiting for the delivery stamp.',
              attachments: [],
            },
          ],
        }));
        void reconcilePendingMessage(channel, client, pendingID, generation);
      } catch (error) {
        if (generation !== syncGenerationRef.current || clientRef.current !== client) return;
        if (recoverAuthorization(error)) {
          throw new Error(classifyBeeperFailure(error).message);
        }
        throw new Error(classifyBeeperFailure(error).message);
      } finally {
        if (busyOperationRef.current === busyOperation) setIsBusy(false);
      }
    },
    [mode, reconcilePendingMessage, recoverAuthorization, selectedChannel],
  );

  const resolveAttachment = useCallback(async (attachment: MessageAttachment) => {
    if (attachment.url) return attachment.url;
    const client = clientRef.current;
    const sourceUrl = attachment.sourceUrl?.trim();
    if (!client || !sourceUrl || !/^(?:mxc|localmxc):\/\//i.test(sourceUrl)) {
      throw new Error('This attachment is not available through Beeper.');
    }
    const url = await client.resolveAssetURL(sourceUrl);
    if (!url) throw new Error('Beeper could not open this attachment.');
    return url;
  }, []);

  const setReadEligible = useCallback((eligible: boolean) => {
    readEligibleRef.current = eligible;
  }, []);

  const probeBeeper = useCallback(async () => {
    setConnection({ kind: 'probing', message: 'Looking for Beeper on this computer…' });
    try {
      const client = new BeeperClient();
      const info = await client.getInfo();
      assertSupportedBeeperInfo(info);
      setConnection({
        kind: 'available',
        message: `${info.app.name} ${info.app.version} found. Perfect.`,
      });
      return true;
    } catch (error) {
      const problem = classifyBeeperFailure(error);
      const unavailable = [
        'desktop-unreachable',
        'desktop-timeout',
        'local-access-blocked',
      ].includes(problem.code);
      setConnection({
        kind: unavailable ? 'unavailable' : 'error',
        message: problem.message,
        problem,
      });
      return false;
    }
  }, []);

  const connectWithToken = useCallback(async (
    token: string,
    joinConsentAccepted: boolean,
    rememberOnComputer: boolean,
  ) => {
    if (!joinConsentAccepted) {
      throw new Error('Tick the public-room box first, then we can open the door.');
    }
    window.localStorage.setItem(JOIN_CONSENT_KEY, JOIN_CONSENT_VERSION);
    const normalizedToken = token.trim();
    if (!normalizedToken) {
      throw new Error('Create an access token in Beeper, then paste it here.');
    }
    const connected = await loadBeeper(normalizedToken, true);
    if (connected) storeBeeperAccessToken(normalizedToken, rememberOnComputer);
  }, [loadBeeper]);

  const retryConnection = useCallback(async (
    _joinConsentAccepted: boolean,
    _rememberOnComputer: boolean,
  ) => {
    const token = getStoredAccessToken();
    if (token) {
      await loadBeeper(token, false);
      return;
    }
    if (!(await probeBeeper())) return;
    throw new Error('Create an access token in Beeper, then paste it here.');
  }, [loadBeeper, probeBeeper]);

  const resetConnection = useCallback(() => {
    clearConnectedState();
    setConnection({
      kind: 'disconnected',
      message: 'Open Beeper on this computer, then let’s go.',
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
      canLoadOlder,
      isLoadingOlder,
      selectedSync,
      selectChannel,
      sendMessage,
      loadOlderMessages,
      retryRoom,
      retrySync,
      retryConnection,
      resolveAttachment,
      setReadEligible,
      probeBeeper,
      connectWithToken,
      disconnect,
    }),
    [
      canLoadOlder,
      channels,
      connectWithToken,
      connection,
      disconnect,
      isBusy,
      isLoadingOlder,
      loadOlderMessages,
      retryRoom,
      retryConnection,
      retrySync,
      resolveAttachment,
      setReadEligible,
      members,
      messages,
      mode,
      probeBeeper,
      selectChannel,
      selectedChannel,
      selectedSync,
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

async function getOpenStationChats(client: BeeperClient): Promise<BeeperChat[]> {
  const canonicalRoomIDs = flattenChannels()
    .map((channel) => channel.roomId)
    .filter((roomID): roomID is string => Boolean(roomID));
  const chats = await mapWithConcurrency(canonicalRoomIDs, 3, async (roomID) => {
    try {
      return await client.getChat(roomID, 0);
    } catch (error) {
      if (error instanceof BeeperApiError && [403, 404].includes(error.status)) return undefined;
      throw error;
    }
  });
  return chats.filter((chat): chat is BeeperChat => Boolean(chat));
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
  const distinctUsers = [...new Map(
    users.filter((user) => Boolean(user.id)).map((user) => [user.id, user]),
  ).values()];
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
  return resolved;
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
  const attachments = message.attachments.map((attachment, index) => ({
      id: attachment.id || `${message.id}-attachment-${index}`,
      type: attachmentType(attachment.type),
      name: attachment.fileName || 'Attachment',
      size: attachment.fileSize,
      sourceUrl: attachment.srcURL || attachment.id,
    }));
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

export function reconcileCommunityMessages(
  current: CommunityMessage[],
  incoming: CommunityMessage[],
  removedMessageIDs: Iterable<string>,
): CommunityMessage[] {
  const removed = new Set(removedMessageIDs);
  return mergeCommunityMessages(
    current.filter((message) => !removed.has(message.id)),
    incoming,
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

export async function fetchNewMessagePages(
  client: Pick<BeeperClient, 'getMessagesPage'>,
  chatID: string,
  newestCursor?: string | null,
): Promise<BeeperCursorPage<BeeperMessage>> {
  if (!newestCursor) return client.getMessagesPage(chatID);

  const items: BeeperMessage[] = [];
  let cursor = newestCursor;
  let oldestCursor: string | null = null;
  let latestCursor: string | null = newestCursor;
  let hasMore = false;

  for (let pageCount = 0; pageCount < 20; pageCount += 1) {
    const page = await client.getMessagesPage(chatID, {
      cursor,
      direction: 'after',
    });
    items.push(...page.items);
    oldestCursor ??= page.oldestCursor;
    latestCursor = page.newestCursor ?? latestCursor;
    hasMore = page.hasMore;

    if (!page.hasMore || !page.newestCursor || page.newestCursor === cursor) break;
    cursor = page.newestCursor;
  }

  return {
    items,
    hasMore,
    oldestCursor,
    newestCursor: latestCursor,
  };
}

function isAuthorizationFailure(error: unknown): error is BeeperApiError {
  return (
    error instanceof BeeperApiError &&
    (error.status === 401 ||
      error.code?.toLowerCase() === 'unauthorized' ||
      /invalid token/i.test(error.message))
  );
}
