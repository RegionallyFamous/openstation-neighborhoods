import { useCallback, useEffect, useRef, useState } from 'react';
import { ChannelSidebar } from './components/ChannelSidebar';
import { ConnectPanel } from './components/ConnectPanel';
import { MemberRail } from './components/MemberRail';
import { MessageTimeline } from './components/MessageTimeline';
import { useNeighborhoods } from './use-neighborhoods';

export default function App() {
  const neighborhoods = useNeighborhoods();
  const [connectOpen, setConnectOpen] = useState(true);
  const [membersCompact, setMembersCompact] = useState(
    () => window.matchMedia('(max-width: 1180px)').matches,
  );
  const [membersOpen, setMembersOpen] = useState(
    () => !window.matchMedia('(max-width: 1180px)').matches,
  );
  const appShellRef = useRef<HTMLDivElement>(null);
  const membersTriggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const membersLayout = window.matchMedia('(max-width: 1180px)');
    const updateMembersLayout = (event: MediaQueryListEvent) => {
      setMembersCompact(event.matches);
      if (event.matches) setMembersOpen(false);
    };
    membersLayout.addEventListener('change', updateMembersLayout);
    return () => {
      membersLayout.removeEventListener('change', updateMembersLayout);
    };
  }, []);

  useEffect(() => {
    if (neighborhoods.connection.kind === 'connected') setConnectOpen(false);
  }, [neighborhoods.connection.kind]);

  const closeMembers = useCallback((restoreFocus = true) => {
    setMembersOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => membersTriggerRef.current?.focus());
    }
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
    const memberTrigger = appShellRef.current?.querySelector<HTMLButtonElement>(
      '.conversation-header__tools > button:last-of-type',
    );
    if (memberTrigger) {
      memberTrigger.setAttribute('aria-controls', 'member-drawer');
      memberTrigger.setAttribute('aria-expanded', String(membersOpen));
      memberTrigger.setAttribute('aria-label', membersOpen ? 'Hide members' : 'Show members');
    }
  }, [membersOpen]);

  useEffect(() => {
    if (!membersCompact || !membersOpen) return;
    const focusFrame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('#member-drawer button:not([disabled])')?.focus();
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [membersCompact, membersOpen]);

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
        >
          <ChannelSidebar
            manifest={neighborhoods.manifest}
            channels={neighborhoods.channels}
            selectedChannelId={neighborhoods.selectedChannel.id}
            connection={neighborhoods.connection}
            mode={neighborhoods.mode}
            onSelectChannel={neighborhoods.selectChannel}
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
          onReact={neighborhoods.addReaction}
          onLoadOlder={neighborhoods.loadOlderMessages}
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
    </div>
  );
}
