import { useCallback, useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { hasStoredBeeperSession } from './beeper/oauth';
import { ChannelSidebar } from './components/ChannelSidebar';
import { ConnectPanel } from './components/ConnectPanel';
import { MemberRail } from './components/MemberRail';
import { MessageTimeline } from './components/MessageTimeline';
import type { ConnectionState } from './types';
import { useNeighborhoods } from './use-neighborhoods';

export default function App() {
  const neighborhoods = useNeighborhoods();
  const [restoreOnStart] = useState(() => shouldRestoreBeeperSession(
    window.location.href,
    hasStoredBeeperSession(),
  ));
  const [connectOpen, setConnectOpen] = useState(() => !restoreOnStart);
  const [restoringSession, setRestoringSession] = useState(restoreOnStart);
  const [channelsCompact, setChannelsCompact] = useState(
    () => window.matchMedia('(max-width: 620px)').matches,
  );
  const [channelsOpen, setChannelsOpen] = useState(false);
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
    const channelsLayout = window.matchMedia('(max-width: 620px)');
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
    if (neighborhoods.connection.kind === 'connected') {
      setRestoringSession(false);
      setConnectOpen(false);
      return;
    }
    if (
      neighborhoods.connection.kind === 'error' ||
      neighborhoods.connection.kind === 'available' ||
      neighborhoods.connection.kind === 'unavailable'
    ) {
      setRestoringSession(false);
      setConnectOpen(true);
    }
  }, [neighborhoods.connection.kind]);

  useEffect(() => {
    if (!restoringSession) return;
    const timer = window.setTimeout(() => {
      setRestoringSession(false);
      setConnectOpen(true);
    }, 10_000);
    return () => window.clearTimeout(timer);
  }, [restoringSession]);

  const closeMembers = useCallback((restoreFocus = true) => {
    setMembersOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => membersTriggerRef.current?.focus());
    }
  }, []);

  const closeChannels = useCallback((restoreFocus = true) => {
    setChannelsOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => channelsTriggerRef.current?.focus());
    }
  }, []);

  const toggleChannels = useCallback(() => {
    setChannelsOpen((current) => {
      if (!current && document.activeElement instanceof HTMLElement) {
        channelsTriggerRef.current = document.activeElement;
        setMembersOpen(false);
      }
      return !current;
    });
  }, []);

  const toggleMembers = useCallback(() => {
    setMembersOpen((current) => {
      if (!current && document.activeElement instanceof HTMLElement) {
        membersTriggerRef.current = document.activeElement;
        setChannelsOpen(false);
      }
      return !current;
    });
  }, []);

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
    if (!(channelsCompact && channelsOpen)) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeChannels();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [channelsCompact, channelsOpen, closeChannels]);

  useEffect(() => {
    if (!(membersCompact && membersOpen)) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeMembers();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [closeMembers, membersCompact, membersOpen]);

  const channelsHidden = (channelsCompact && !channelsOpen) || (membersCompact && membersOpen);
  const membersHidden = !membersOpen || (channelsCompact && channelsOpen);
  const contentBlocked = (channelsCompact && channelsOpen) || (membersCompact && membersOpen);
  const compactDrawerOpen = contentBlocked;

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
          className={`drawer-shell channel-drawer${channelsOpen ? ' is-open' : ''}`}
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
              if (channelsCompact) closeChannels(false);
            }}
            onOpenConnect={() => setConnectOpen(true)}
            onDisconnect={neighborhoods.disconnect}
          />
        </div>
        <MessageTimeline
          channel={neighborhoods.selectedChannel}
          messages={neighborhoods.messages}
          mode={neighborhoods.mode}
          isBusy={neighborhoods.isBusy}
          canLoadOlder={neighborhoods.canLoadOlder}
          isLoadingOlder={neighborhoods.isLoadingOlder}
          onSend={neighborhoods.sendMessage}
          onLoadOlder={neighborhoods.loadOlderMessages}
          onResolveAttachment={neighborhoods.resolveAttachment}
          onReadEligibilityChange={neighborhoods.setReadEligible}
          onToggleChannels={toggleChannels}
          onToggleMembers={toggleMembers}
          onOpenConnect={() => setConnectOpen(true)}
          channelsOpen={channelsOpen}
          membersOpen={membersOpen}
          blockedByDrawer={contentBlocked}
          readingBlocked={contentBlocked || connectOpen}
        />
        {compactDrawerOpen && (
          <button
            className="drawer-scrim"
            type="button"
            tabIndex={-1}
            aria-label="Close the open drawer"
            onClick={() => {
              if (channelsCompact && channelsOpen) closeChannels();
              if (membersCompact && membersOpen) closeMembers();
            }}
          />
        )}
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

      </div>

      <ConnectPanel
        open={connectOpen}
        connection={neighborhoods.connection}
        mode={neighborhoods.mode}
        busy={neighborhoods.isBusy}
        onClose={() => setConnectOpen(false)}
        onProbe={neighborhoods.probeBeeper}
        onOAuth={neighborhoods.connectWithOAuth}
        onDisconnect={neighborhoods.disconnect}
      />
      {restoringSession && (
        <div className="session-restore" role="status" aria-live="polite">
          <LoaderCircle className="spin" size={17} aria-hidden="true" />
          <span>
            <strong>Welcome back.</strong>
            <small>{restoreMessage(neighborhoods.connection)}</small>
          </span>
        </div>
      )}
    </div>
  );
}

export function shouldRestoreBeeperSession(href: string, hasStoredSession: boolean): boolean {
  if (hasStoredSession) return true;
  const url = new URL(href);
  return url.searchParams.has('code') || url.searchParams.has('error');
}

function restoreMessage(connection: ConnectionState): string {
  if (connection.kind === 'authorizing' || connection.kind === 'probing') {
    return connection.message;
  }
  return 'Waking up your neighborhood…';
}
