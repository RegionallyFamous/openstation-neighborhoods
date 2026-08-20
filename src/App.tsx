import { useCallback, useEffect, useRef, useState } from 'react';
import { ChannelSidebar } from './components/ChannelSidebar';
import { ConnectPanel } from './components/ConnectPanel';
import { MemberRail } from './components/MemberRail';
import { MessageTimeline } from './components/MessageTimeline';
import { useNeighborhoods } from './use-neighborhoods';

export default function App() {
  const neighborhoods = useNeighborhoods();
  const [connectOpen, setConnectOpen] = useState(true);
  const [channelsOpen, setChannelsOpen] = useState(false);
  const [channelsCompact, setChannelsCompact] = useState(
    () => window.matchMedia('(max-width: 800px)').matches,
  );
  const [membersCompact, setMembersCompact] = useState(
    () => window.matchMedia('(max-width: 1180px)').matches,
  );
  const [membersOpen, setMembersOpen] = useState(
    () => !window.matchMedia('(max-width: 1180px)').matches,
  );
  const appShellRef = useRef<HTMLDivElement>(null);
  const channelsTriggerRef = useRef<HTMLElement | null>(null);
  const membersTriggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const channelsLayout = window.matchMedia('(max-width: 800px)');
    const membersLayout = window.matchMedia('(max-width: 1180px)');
    const updateChannelsLayout = (event: MediaQueryListEvent) => {
      setChannelsCompact(event.matches);
      setChannelsOpen(false);
    };
    const updateMembersLayout = (event: MediaQueryListEvent) => {
      setMembersCompact(event.matches);
      if (event.matches) setMembersOpen(false);
    };
    channelsLayout.addEventListener('change', updateChannelsLayout);
    membersLayout.addEventListener('change', updateMembersLayout);
    return () => {
      channelsLayout.removeEventListener('change', updateChannelsLayout);
      membersLayout.removeEventListener('change', updateMembersLayout);
    };
  }, []);

  useEffect(() => {
    if (neighborhoods.connection.kind === 'connected') setConnectOpen(false);
  }, [neighborhoods.connection.kind]);

  const closeChannels = useCallback((restoreFocus = true) => {
    setChannelsOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => channelsTriggerRef.current?.focus());
    }
  }, []);

  const closeMembers = useCallback((restoreFocus = true) => {
    setMembersOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => membersTriggerRef.current?.focus());
    }
  }, []);

  const toggleChannels = useCallback(() => {
    setChannelsOpen((current) => {
      if (!current && document.activeElement instanceof HTMLElement) {
        channelsTriggerRef.current = document.activeElement;
      }
      return !current;
    });
  }, []);

  const toggleMembers = useCallback(() => {
    setMembersOpen((current) => {
      if (!current && document.activeElement instanceof HTMLElement) {
        membersTriggerRef.current = document.activeElement;
      }
      return !current;
    });
  }, []);

  useEffect(() => {
    const channelTrigger = appShellRef.current?.querySelector<HTMLButtonElement>(
      '.conversation-header__mobile',
    );
    if (channelTrigger) {
      channelTrigger.setAttribute('aria-controls', 'channel-drawer');
      channelTrigger.setAttribute('aria-expanded', String(channelsOpen));
      channelTrigger.setAttribute('aria-label', channelsOpen ? 'Close channels' : 'Open channels');
    }

    const memberTrigger = appShellRef.current?.querySelector<HTMLButtonElement>(
      '.conversation-header__tools > button:last-of-type',
    );
    if (memberTrigger) {
      memberTrigger.setAttribute('aria-controls', 'member-drawer');
      memberTrigger.setAttribute('aria-expanded', String(membersOpen));
      memberTrigger.setAttribute('aria-label', membersOpen ? 'Hide members' : 'Show members');
    }
  }, [channelsOpen, membersOpen]);

  useEffect(() => {
    if (!channelsCompact || !channelsOpen) return;
    const focusFrame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('#channel-drawer button:not([disabled])')?.focus();
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [channelsCompact, channelsOpen]);

  useEffect(() => {
    if (!membersCompact || !membersOpen) return;
    const focusFrame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('#member-drawer button:not([disabled])')?.focus();
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [membersCompact, membersOpen]);

  useEffect(() => {
    if (!channelsOpen && !(membersCompact && membersOpen)) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (channelsOpen) closeChannels();
      else closeMembers();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [channelsOpen, closeChannels, closeMembers, membersCompact, membersOpen]);

  const channelsHidden = channelsCompact && !channelsOpen;
  const membersHidden = !membersOpen;

  return (
    <div className="neighborhoods-app">
      <div
        className={`neighborhoods-shell${membersOpen ? ' members-open' : ' members-closed'}`}
        ref={appShellRef}
        inert={connectOpen}
        aria-hidden={connectOpen || undefined}
      >
        <div className="app-grain" aria-hidden="true" />
        <div
          className="drawer-shell"
          id="channel-drawer"
          inert={channelsHidden}
          aria-hidden={channelsHidden || undefined}
        >
          <ChannelSidebar
            manifest={neighborhoods.manifest}
            channels={neighborhoods.channels}
            selectedChannelId={neighborhoods.selectedChannel.id}
            connection={neighborhoods.connection}
            mode={neighborhoods.mode}
            onSelectChannel={(channelId) => {
              neighborhoods.selectChannel(channelId);
              closeChannels();
            }}
            onOpenConnect={() => setConnectOpen(true)}
            onDisconnect={neighborhoods.disconnect}
            mobileOpen={channelsOpen}
          />
        </div>
        <MessageTimeline
          manifest={neighborhoods.manifest}
          channel={neighborhoods.selectedChannel}
          messages={neighborhoods.messages}
          mode={neighborhoods.mode}
          isBusy={neighborhoods.isBusy}
          canLoadOlder={neighborhoods.canLoadOlder}
          isLoadingOlder={neighborhoods.isLoadingOlder}
          onSend={neighborhoods.sendMessage}
          onReact={neighborhoods.addReaction}
          onLoadOlder={neighborhoods.loadOlderMessages}
          onOpenChannels={toggleChannels}
          onToggleMembers={toggleMembers}
          onOpenConnect={() => setConnectOpen(true)}
        />
        <div
          className="drawer-shell"
          id="member-drawer"
          inert={membersHidden}
          aria-hidden={membersHidden || undefined}
        >
          <MemberRail
            members={neighborhoods.members}
            open={membersOpen}
            onClose={() => closeMembers()}
          />
        </div>

        {channelsOpen && (
          <button
            className="mobile-scrim"
            type="button"
            aria-label="Close channels"
            onClick={() => closeChannels()}
          />
        )}

        <button
          className={`connection-pill connection-pill--${neighborhoods.connection.kind}`}
          type="button"
          aria-haspopup="dialog"
          onClick={() => setConnectOpen(true)}
        >
          <i aria-hidden="true" />
          <span>{neighborhoods.connection.kind === 'connected' ? 'BEEPER LIVE' : neighborhoods.connection.kind === 'available' ? 'BEEPER READY' : 'CONNECT BEEPER'}</span>
        </button>

      </div>

      <ConnectPanel
        open={connectOpen}
        connection={neighborhoods.connection}
        mode={neighborhoods.mode}
        busy={neighborhoods.isBusy}
        onClose={() => setConnectOpen(false)}
        onProbe={neighborhoods.probeBeeper}
        onOAuth={neighborhoods.connectWithOAuth}
        onToken={neighborhoods.connectWithToken}
        onDisconnect={neighborhoods.disconnect}
      />
    </div>
  );
}
