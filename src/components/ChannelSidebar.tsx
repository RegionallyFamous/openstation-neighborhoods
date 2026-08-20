import {
  ChevronDown,
  Hash,
  Headphones,
  LogOut,
  Megaphone,
  Settings2,
  Volume2,
} from 'lucide-react';
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
  mobileOpen: boolean;
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
  mobileOpen,
}: ChannelSidebarProps) {
  return (
    <aside className={`channel-sidebar${mobileOpen ? ' is-mobile-open' : ''}`}>
      <header className="channel-sidebar__header">
        <div>
          <span className="eyebrow">MATRIX NEIGHBORHOOD</span>
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
                const ChannelIcon =
                  channel.kind === 'announcement'
                    ? Megaphone
                    : channel.kind === 'voice'
                      ? Volume2
                      : Hash;
                return (
                  <button
                    className={`channel-link${
                      channel.id === selectedChannelId ? ' is-selected' : ''
                    }${!channel.joined && mode === 'beeper' ? ' is-unjoined' : ''}`}
                    type="button"
                    key={channel.id}
                    disabled={channel.kind === 'voice'}
                    onClick={() => onSelectChannel(channel.id)}
                    aria-label={channel.kind === 'voice' ? `${channel.name} — voice support coming later` : undefined}
                    title={channel.kind === 'voice' ? 'Voice support is not available in Neighborhoods yet' : !channel.joined && mode === 'beeper' ? `${channel.name} is not connected in Beeper` : channel.topic}
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

      <div className="voice-card">
        <div className="voice-card__signal"><i /><i /><i /></div>
        <div>
          <strong>Workbench radio</strong>
          <small>Voice support coming later</small>
        </div>
        <button type="button" aria-label="Voice support is not available yet" disabled><Headphones size={17} /></button>
      </div>

      <footer className="account-dock">
        <span className="account-dock__avatar">
          {connection.kind === 'connected' ? connection.accountName?.slice(0, 1).toUpperCase() || 'B' : 'OS'}
          {connection.kind === 'connected' && <i />}
        </span>
        <span className="account-dock__identity">
          <strong>{connection.kind === 'connected' ? connection.accountName || 'Beeper neighbor' : 'Not connected'}</strong>
          <small>{mode === 'beeper' ? 'local Beeper session' : 'No local data loaded'}</small>
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
