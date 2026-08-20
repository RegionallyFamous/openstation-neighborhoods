import {
  AtSign,
  FileText,
  Hash,
  LoaderCircle,
  MessageCircle,
  Send,
  Users,
} from 'lucide-react';
import { FormEvent, Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CommunityChannel,
  CommunityMessage,
  MessageAttachment,
  RoomSyncState,
} from '../types';
import { MioCompanion } from './MioCompanion';

interface MessageTimelineProps {
  channel: CommunityChannel;
  messages: CommunityMessage[];
  mode: 'disconnected' | 'beeper';
  isBusy: boolean;
  canLoadOlder: boolean;
  isLoadingOlder: boolean;
  sync: RoomSyncState;
  onSend: (body: string) => Promise<void>;
  onLoadOlder: () => Promise<void>;
  onRetryRoom: (channelId: string) => Promise<void>;
  onRetrySync: () => void;
  onResolveAttachment: (attachment: MessageAttachment) => Promise<string>;
  onReadEligibilityChange: (eligible: boolean) => void;
  onToggleChannels: () => void;
  onToggleMembers: () => void;
  onOpenConnect: () => void;
  channelsOpen: boolean;
  membersOpen: boolean;
  blockedByDrawer: boolean;
  readingBlocked: boolean;
}

export function MessageTimeline({
  channel,
  messages,
  mode,
  isBusy,
  canLoadOlder,
  isLoadingOlder,
  sync,
  onSend,
  onLoadOlder,
  onRetryRoom,
  onRetrySync,
  onResolveAttachment,
  onReadEligibilityChange,
  onToggleChannels,
  onToggleMembers,
  onOpenConnect,
  channelsOpen,
  membersOpen,
  blockedByDrawer,
  readingBlocked,
}: MessageTimelineProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const previousChannel = useRef(channel.id);
  const draft = drafts[channel.id] ?? '';
  const readOnly = channel.kind === 'announcement' || channel.isReadOnly === true;
  const canCompose = mode === 'beeper' && channel.joined && !readOnly;

  useEffect(() => {
    const changedChannel = previousChannel.current !== channel.id;
    if (changedChannel || nearBottomRef.current) {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const behavior = !changedChannel && !reduceMotion ? 'smooth' : 'auto';
      endRef.current?.scrollIntoView({ behavior, block: 'end' });
    }
    previousChannel.current = channel.id;
  }, [channel.id, messages.at(-1)?.id]);

  useEffect(() => {
    onReadEligibilityChange(!readingBlocked && nearBottomRef.current);
    return () => onReadEligibilityChange(false);
  }, [channel.id, onReadEligibilityChange, readingBlocked]);

  useEffect(() => {
    setActionError('');
  }, [channel.id]);

  const grouped = useMemo(() => groupMessages(messages), [messages]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || !canCompose) return;
    const targetChannelId = channel.id;
    setActionError('');
    setDrafts((current) => ({ ...current, [targetChannelId]: '' }));
    try {
      await onSend(body);
    } catch (error) {
      setDrafts((current) => ({ ...current, [targetChannelId]: body }));
      setActionError(error instanceof Error ? error.message : 'That message missed the train. Your draft is safe.');
    }
  }

  return (
    <main
      className="conversation"
      inert={blockedByDrawer}
      aria-hidden={blockedByDrawer || undefined}
    >
      <header className="conversation-header">
        <button
          className="conversation-header__rooms"
          type="button"
          aria-label={channelsOpen ? 'Hide rooms' : 'Show rooms'}
          aria-controls="channel-drawer"
          aria-expanded={channelsOpen}
          onClick={onToggleChannels}
        >
          <Hash size={17} aria-hidden="true" />
          <span>ROOMS</span>
        </button>
        <span className="conversation-header__hash"><Hash size={21} /></span>
        <div className="conversation-header__title">
          <strong>{channel.name}</strong>
          <span>{channel.topic}</span>
        </div>
        <div className="conversation-header__tools">
          <button
            type="button"
            aria-label={membersOpen ? 'Hide members' : 'Show members'}
            aria-controls="member-drawer"
            aria-expanded={membersOpen}
            onClick={onToggleMembers}
          >
            <Users size={20} />
          </button>
        </div>
      </header>

      <div
        className="message-scroll"
        role="region"
        aria-label={`#${channel.name} conversation`}
        tabIndex={0}
        ref={scrollRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          nearBottomRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 120;
          onReadEligibilityChange(!readingBlocked && nearBottomRef.current);
        }}
      >
        <section className="channel-welcome" key={channel.id}>
          <div className="channel-welcome__copy">
            <span className="channel-welcome__eyebrow">
              OPENSTATION <i aria-hidden="true" /> {channel.categoryName}
            </span>
            <div className="channel-welcome__title">
              <span className="channel-welcome__icon"><Hash size={23} /></span>
              <h1>#{channel.name}</h1>
            </div>
            <p>{channel.topic}</p>
          </div>
          <div className="channel-welcome__signal">
            <span className="channel-welcome__orbit channel-welcome__orbit--outer" aria-hidden="true" />
            <span className="channel-welcome__orbit channel-welcome__orbit--inner" aria-hidden="true" />
            <span className="channel-welcome__beacon" aria-hidden="true" />
            <MioCompanion channel={channel} mode={mode} />
          </div>
        </section>

        {mode === 'beeper' && channel.joined && ['retrying', 'error'].includes(sync.kind) && (
          <section className={`sync-status-card sync-status-card--${sync.kind}`} role="status">
            <LoaderCircle className={sync.kind === 'retrying' ? 'spin' : ''} size={18} aria-hidden="true" />
            <div>
              <strong>{sync.kind === 'retrying' ? 'Catching Beeper again…' : 'This room needs a nudge'}</strong>
              <small>{sync.message}</small>
            </div>
            <button type="button" onClick={onRetrySync}>TRY NOW</button>
          </section>
        )}

        {mode === 'beeper' && channel.joined && canLoadOlder && (
          <button
            className="load-older-messages"
            type="button"
            disabled={isLoadingOlder}
            aria-busy={isLoadingOlder}
            onClick={() => {
              const scrollElement = scrollRef.current;
              const previousHeight = scrollElement?.scrollHeight ?? 0;
              void onLoadOlder()
                .then(() => {
                  window.requestAnimationFrame(() => {
                    if (!scrollElement) return;
                    scrollElement.scrollTop += scrollElement.scrollHeight - previousHeight;
                  });
                })
                .catch((error) => {
                  setActionError(
                    error instanceof Error ? error.message : 'The archives are being stubborn. Try again.',
                  );
                });
            }}
          >
            {isLoadingOlder && <LoaderCircle className="spin" size={15} aria-hidden="true" />}
            {isLoadingOlder ? 'DIGGING THROUGH THE ARCHIVES…' : 'DIG UP EARLIER MESSAGES'}
          </button>
        )}

        {mode === 'disconnected' ? (
          <section className="join-room-card">
            <span className="join-room-card__icon"><AtSign size={24} /></span>
            <div>
              <span className="eyebrow">BEEPER NEEDED</span>
              <h2>Open Beeper and come on in</h2>
              <p>We’ll bring over the real rooms, messages, neighbors, and unread counts from Beeper on this computer.</p>
            </div>
            <button type="button" onClick={onOpenConnect}>JOIN WITH BEEPER</button>
          </section>
        ) : !channel.joined ? (
          <section className="join-room-card">
            <span className="join-room-card__icon"><AtSign size={24} /></span>
            <div>
              <span className="eyebrow">DOOR STUCK</span>
              <h2>#{channel.name} didn’t make it through</h2>
              <p>{channel.connectionMessage || 'Beeper couldn’t open this room. Try this room again without reconnecting everything else.'}</p>
            </div>
            <button
              type="button"
              disabled={channel.connectionStatus === 'joining'}
              onClick={() => {
                setActionError('');
                void onRetryRoom(channel.id).catch((error) => {
                  setActionError(error instanceof Error ? error.message : 'This room is still stuck. Try again in a moment.');
                });
              }}
            >
              {channel.connectionStatus === 'joining' ? 'KNOCKING…' : 'TRY THIS ROOM'}
            </button>
          </section>
        ) : sync.kind === 'loading' && !grouped.length ? (
          <section className="empty-channel empty-channel--loading" role="status">
            <LoaderCircle className="spin" size={25} aria-hidden="true" />
            <h2>Opening #{channel.name}…</h2>
            <p>Fetching the latest messages from Beeper.</p>
          </section>
        ) : grouped.length ? (
          <div role="log" aria-live="polite" aria-relevant="additions text" aria-busy={isBusy}>
            {grouped.map((group, index) => {
              const previousGroup = grouped[index - 1];
              const showDate = !previousGroup || dayKey(previousGroup[0].sentAt) !== dayKey(group[0].sentAt);
              return (
                <Fragment key={group[0].id}>
                  {showDate && <div className="date-divider"><span>{formatDate(group[0].sentAt)}</span></div>}
                  <MessageGroup
                    messages={group}
                    onResolveAttachment={onResolveAttachment}
                    onError={setActionError}
                  />
                </Fragment>
              );
            })}
          </div>
        ) : (
          <section className="empty-channel">
            <MessageCircle size={30} />
            <h2>{readOnly ? 'Nothing pinned here yet.' : 'Suspiciously quiet in here.'}</h2>
            <p>{readOnly ? 'When the hosts have news, it’ll land right here.' : 'Break the silence. Say hi, share a link, or start a tiny argument about fonts.'}</p>
          </section>
        )}
        {actionError && <p className="connect-error" role="alert">{actionError}</p>}
        <div ref={endRef} />
      </div>

      <form className="composer" onSubmit={submit}>
        <textarea
          value={draft}
          onChange={(event) => {
            const value = event.target.value;
            setDrafts((current) => ({ ...current, [channel.id]: value }));
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={composerPlaceholder(mode, channel, readOnly)}
          aria-label={`Message ${channel.name}`}
          disabled={!canCompose || isBusy}
          rows={1}
        />
        <button className="composer__send" type="submit" aria-label="Send message" disabled={!canCompose || !draft.trim() || isBusy}>
          <Send size={17} />
        </button>
      </form>
    </main>
  );
}

function MessageGroup({
  messages,
  onResolveAttachment,
  onError,
}: {
  messages: CommunityMessage[];
  onResolveAttachment: (attachment: MessageAttachment) => Promise<string>;
  onError: (message: string) => void;
}) {
  const first = messages[0];
  const [downloadingAttachmentId, setDownloadingAttachmentId] = useState<string | null>(null);
  return (
    <article className="message-group">
      <span className="message-avatar" style={{ '--avatar-color': first.author.color } as React.CSSProperties}>
        {first.author.avatarUrl ? <img src={first.author.avatarUrl} alt="" /> : first.author.avatar}
      </span>
      <div className="message-group__content">
        <header>
          <strong>{first.author.name}</strong>
          <span className={`role-dot role-dot--${first.author.role}`}>{roleLabel(first.author.role)}</span>
          <time dateTime={first.sentAt}>{formatTime(first.sentAt)}</time>
        </header>
        {messages.map((message) => (
          <div
            className={`message${message.pending ? ' is-pending' : ''}${message.delivery === 'failed' ? ' is-failed' : ''}`}
            key={message.id}
          >
            <p>{renderText(message.body)}</p>
            {message.edited && <small className="message__edited">edited</small>}
            {message.delivery && message.delivery !== 'sent' && (
              <small className={`message__delivery message__delivery--${message.delivery}`}>
                {message.deliveryMessage || message.delivery}
              </small>
            )}
            {message.attachments.map((attachment) => (
              <button
                className="message-attachment"
                type="button"
                key={attachment.id}
                disabled={downloadingAttachmentId === attachment.id}
                aria-busy={downloadingAttachmentId === attachment.id}
                onClick={() => {
                  setDownloadingAttachmentId(attachment.id);
                  onError('');
                  void onResolveAttachment(attachment)
                    .then((url) => {
                      const download = document.createElement('a');
                      download.href = url;
                      download.download = attachment.name;
                      download.rel = 'noopener';
                      download.click();
                    })
                    .catch((error) => {
                      onError(error instanceof Error ? error.message : 'Beeper couldn’t crack this file open.');
                    })
                    .finally(() => setDownloadingAttachmentId(null));
                }}
              >
                <FileText size={19} />
                <span>
                  <strong>{attachment.name}</strong>
                  <small>
                    {downloadingAttachmentId === attachment.id
                      ? 'Fetching from Beeper…'
                      : attachment.size
                        ? `${Math.ceil(attachment.size / 1024)} KB · Fetch it`
                        : 'Fetch from Beeper'}
                  </small>
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </article>
  );
}

function groupMessages(messages: CommunityMessage[]): CommunityMessage[][] {
  return messages.reduce<CommunityMessage[][]>((groups, message) => {
    const latest = groups.at(-1);
    const previous = latest?.at(-1);
    const closeInTime = previous
      ? Math.abs(Date.parse(message.sentAt) - Date.parse(previous.sentAt)) < 5 * 60_000
      : false;
    const sameDay = previous ? dayKey(message.sentAt) === dayKey(previous.sentAt) : false;
    if (latest && previous?.author.id === message.author.id && closeInTime && sameDay) {
      latest.push(message);
    } else {
      groups.push([message]);
    }
    return groups;
  }, []);
}

function composerPlaceholder(
  mode: 'disconnected' | 'beeper',
  channel: CommunityChannel,
  readOnly: boolean,
): string {
  if (mode === 'disconnected') return 'Open Beeper to join the chat';
  if (!channel.joined) return 'This room needs reconnecting';
  if (readOnly) return 'Announcements land here';
  if (channel.id === 'showcase') return 'Show us what you made…';
  if (channel.id === 'builders') return 'What are you building?';
  if (channel.id === 'help-desk') return 'What’s got you stuck?';
  return `Drop a thought into #${channel.name}`;
}

function dayKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Earlier';
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(value) === dayKey(today.toISOString())) return 'Today';
  if (dayKey(value) === dayKey(yesterday.toISOString())) return 'Yesterday';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  }).format(date);
}

function roleLabel(role: CommunityMessage['author']['role']): string {
  if (role === 'host') return 'HOST';
  if (role === 'moderator') return 'MOD';
  if (role === 'builder') return 'BUILDER';
  return '';
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function renderText(value: string) {
  const pieces = value.split(/(@[a-zA-Z0-9._-]+)/g);
  return pieces.map((piece, index) =>
    piece.startsWith('@') ? <mark key={`${piece}-${index}`}>{piece}</mark> : piece,
  );
}
