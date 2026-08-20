import {
  AtSign,
  FileText,
  Hash,
  LoaderCircle,
  Menu,
  MessageCircle,
  Send,
  Smile,
  Users,
} from 'lucide-react';
import { FormEvent, Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { CommunityChannel, CommunityMessage, CommunityManifest } from '../types';
import { OpenStationMark } from './OpenStationMark';

interface MessageTimelineProps {
  manifest: CommunityManifest;
  channel: CommunityChannel;
  messages: CommunityMessage[];
  mode: 'disconnected' | 'beeper';
  isBusy: boolean;
  canLoadOlder: boolean;
  isLoadingOlder: boolean;
  onSend: (body: string) => Promise<void>;
  onReact: (messageId: string, key: string) => Promise<void>;
  onLoadOlder: () => Promise<void>;
  onOpenChannels: () => void;
  onToggleMembers: () => void;
  onOpenConnect: () => void;
}

export function MessageTimeline({
  manifest,
  channel,
  messages,
  mode,
  isBusy,
  canLoadOlder,
  isLoadingOlder,
  onSend,
  onReact,
  onLoadOlder,
  onOpenChannels,
  onToggleMembers,
  onOpenConnect,
}: MessageTimelineProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState('');
  const [reactionPendingMessageId, setReactionPendingMessageId] = useState<string | null>(null);
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
      setActionError(error instanceof Error ? error.message : 'The message could not be sent.');
    }
  }

  async function react(messageId: string, key: string) {
    if (reactionPendingMessageId) return;
    setActionError('');
    setReactionPendingMessageId(messageId);
    try {
      await onReact(messageId, key);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The reaction could not be updated.');
    } finally {
      setReactionPendingMessageId(null);
    }
  }

  return (
    <main className="conversation">
      <header className="conversation-header">
        <button className="conversation-header__mobile" type="button" onClick={onOpenChannels} aria-label="Open channels">
          <Menu size={20} />
        </button>
        <span className="conversation-header__hash"><Hash size={21} /></span>
        <div className="conversation-header__title">
          <strong>{channel.name}</strong>
          <span>{channel.topic}</span>
        </div>
        <div className="conversation-header__tools">
          <button type="button" aria-label="Show members" onClick={onToggleMembers}><Users size={20} /></button>
        </div>
      </header>

      <div
        className="message-scroll"
        ref={scrollRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          nearBottomRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 120;
        }}
      >
        <section className="channel-welcome">
          <div className="channel-welcome__art">
            <span className="channel-welcome__sun" />
            <span className="channel-welcome__station"><OpenStationMark /></span>
            <span className="channel-welcome__wire channel-welcome__wire--one" />
            <span className="channel-welcome__wire channel-welcome__wire--two" />
          </div>
          <span className="channel-welcome__icon"><Hash size={27} /></span>
          <h1>Welcome to #{channel.name}</h1>
          <p>{channel.topic}</p>
          <div className="channel-welcome__meta">
            <span>OpenStation Beeper community</span>
            <span>{mode === 'beeper' ? 'Your Beeper account' : 'Connect your Beeper account'}</span>
          </div>
        </section>

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
                    error instanceof Error ? error.message : 'Older messages could not be loaded.',
                  );
                });
            }}
          >
            {isLoadingOlder && <LoaderCircle className="spin" size={15} aria-hidden="true" />}
            {isLoadingOlder ? 'LOADING EARLIER MESSAGES' : 'LOAD EARLIER MESSAGES'}
          </button>
        )}

        {mode === 'disconnected' ? (
          <section className="join-room-card">
            <span className="join-room-card__icon"><AtSign size={24} /></span>
            <div>
              <span className="eyebrow">LIVE DATA ONLY</span>
              <h2>Connect Beeper to enter the neighborhood</h2>
              <p>OpenStation will show only the rooms, messages, members, and unread state returned by your local Beeper app.</p>
            </div>
            <button type="button" onClick={onOpenConnect}>CONNECT BEEPER</button>
          </section>
        ) : !channel.joined ? (
          <section className="join-room-card">
            <span className="join-room-card__icon"><AtSign size={24} /></span>
            <div>
              <span className="eyebrow">ROOM NOT CONNECTED</span>
              <h2>#{channel.name} is not available in Beeper</h2>
              <p>Automatic setup did not confirm this room. Open the connection details to reconnect Beeper and try setup again.</p>
            </div>
            <button type="button" onClick={onOpenConnect}>CONNECTION DETAILS</button>
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
                    onReact={react}
                    reactionPendingMessageId={reactionPendingMessageId}
                  />
                </Fragment>
              );
            })}
          </div>
        ) : (
          <section className="empty-channel">
            <MessageCircle size={30} />
            <h2>No messages are available from Beeper yet.</h2>
            <p>{readOnly ? 'This announcement room may not have published anything yet.' : 'OpenStation will keep checking this joined room for messages.'}</p>
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
  onReact,
  reactionPendingMessageId,
}: {
  messages: CommunityMessage[];
  onReact: (messageId: string, key: string) => Promise<void>;
  reactionPendingMessageId: string | null;
}) {
  const first = messages[0];
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
            {message.attachments.map((attachment) => attachment.url ? (
              <a className="message-attachment" href={attachment.url} key={attachment.id} target="_blank" rel="noreferrer">
                <FileText size={19} />
                <span><strong>{attachment.name}</strong><small>{attachment.size ? `${Math.ceil(attachment.size / 1024)} KB` : 'Attachment'}</small></span>
              </a>
            ) : (
              <span className="message-attachment" key={attachment.id} aria-label={`${attachment.name} attachment is unavailable`}>
                <FileText size={19} />
                <span><strong>{attachment.name}</strong><small>Attachment unavailable</small></span>
              </span>
            ))}
            <div className="message-reactions">
              {message.reactions.map((reaction, reactionIndex) => (
                <button
                  className={reaction.mine ? 'is-mine' : ''}
                  type="button"
                  key={`${reaction.key}-${reactionIndex}`}
                  disabled={reactionPendingMessageId === message.id || message.pending || message.delivery === 'failed'}
                  aria-pressed={Boolean(reaction.mine)}
                  aria-label={`${reaction.mine ? 'Remove' : 'Add'} ${reaction.key} reaction`}
                  onClick={() => void onReact(message.id, reaction.key)}
                >
                  <span>{reaction.key}</span>{reaction.count}
                </button>
              ))}
              <button type="button" disabled={reactionPendingMessageId === message.id || message.pending || message.delivery === 'failed'} onClick={() => void onReact(message.id, '✨')} aria-label="Add sparkle reaction">
                <Smile size={14} />+
              </button>
            </div>
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
  if (mode === 'disconnected') return 'Connect Beeper to talk';
  if (!channel.joined) return `${channel.name} is not connected`;
  if (readOnly) return `${channel.name} is read-only`;
  return `Message #${channel.name}`;
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
