import { Hash, LogOut, Megaphone, Settings2 } from 'lucide-react';
import type { CommunityChannel, CommunityManifest, ConnectionState } from '../types';
import { OpenStationMark } from './OpenStationMark';

interface ChannelSidebarProps {
  manifest: CommunityManifest;
  channels: CommunityChannel[];
  selectedChannelId: string;
  connection: ConnectionState;
  mode: 'disconnected' | 'beeper';
  onSelectChannel: (channelId: string) => void;
  onOpenConnect: () => void;
  onDisconnect: () => void;
}

export function ChannelSidebar({
  manifest,
  channels,
  selectedChannelId,
  connection,
  mode,
  onSelectChannel,
  onOpenConnect,
  onDisconnect,
}: ChannelSidebarProps) {
  return (
    <aside className="channel-sidebar">
      <header className="channel-sidebar__header">
        <div>
          <span className="eyebrow">BEEPER NEIGHBORHOOD</span>
          <strong>{manifest.name}</strong>
        </div>
      </header>

      <button className="neighborhood-card" type="button" onClick={onOpenConnect}>
          <span className="neighborhood-card__mark"><OpenStationMark compact /></span>
        <span>
          <strong>{mode === 'beeper' ? 'Beeper is carrying this' : 'Connect your Beeper'}</strong>
          <small>{connection.message}</small>
        </span>
      </button>

      <div className="channel-sidebar__scroll">
        {manifest.categories.map((category) => (
          <section className="channel-group" key={category.id}>
            <div className="eyebrow" role="heading" aria-level={2}>
              {category.name}
            </div>
            {channels
              .filter((channel) => channel.categoryId === category.id)
              .map((channel) => {
                const ChannelIcon = channel.kind === 'announcement' ? Megaphone : Hash;
                return (
                  <button
                    className={`channel-link${
                      channel.id === selectedChannelId ? ' is-selected' : ''
                    }${!channel.joined && mode === 'beeper' ? ' is-unjoined' : ''}`}
                    type="button"
                    key={channel.id}
                    onClick={() => onSelectChannel(channel.id)}
                    title={!channel.joined && mode === 'beeper' ? `${channel.name} is not connected in Beeper` : channel.topic}
                  >
                    <ChannelIcon size={18} strokeWidth={2.1} />
                    <span>{channel.name}</span>
                    {channel.mentionCount > 0 ? (
                      <b className="channel-link__mention">{channel.mentionCount}</b>
                    ) : channel.unreadCount > 0 ? (
                      <b className="channel-link__unread">{channel.unreadCount}</b>
                    ) : !channel.joined && mode === 'beeper' ? (
                      <small className="channel-link__join">NOT JOINED</small>
                    ) : null}
                  </button>
                );
              })}
          </section>
        ))}
      </div>

      <footer className="account-dock">
        <span className="account-dock__avatar">
          {connection.kind === 'connected' && connection.avatarUrl ? <img src={connection.avatarUrl} alt="" /> : connection.kind === 'connected' ? connection.accountName?.slice(0, 1).toUpperCase() || 'B' : 'OS'}
          {connection.kind === 'connected' && <i />}
        </span>
        <span className="account-dock__identity">
          <strong>{connection.kind === 'connected' ? connection.accountName || 'Beeper neighbor' : 'Not connected'}</strong>
          <small>{connection.kind === 'connected' ? connection.accountHandle || 'Beeper account' : 'No Beeper account connected'}</small>
        </span>
        <button type="button" aria-label="Connection settings" onClick={onOpenConnect}>
          <Settings2 size={16} />
        </button>
        {mode === 'beeper' && (
          <button type="button" aria-label="Disconnect Beeper" onClick={onDisconnect}>
            <LogOut size={16} />
          </button>
        )}
      </footer>
    </aside>
  );
}
