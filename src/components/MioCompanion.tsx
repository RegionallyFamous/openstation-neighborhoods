import { useEffect, useMemo, useState } from 'react';
import type { CommunityChannel } from '../types';

interface MioCompanionProps {
  channel: CommunityChannel;
  mode: 'disconnected' | 'beeper';
}

export function MioCompanion({ channel, mode }: MioCompanionProps) {
  const lines = useMemo(() => mioLines(channel.id, mode), [channel.id, mode]);
  const [lineIndex, setLineIndex] = useState(0);
  const [interaction, setInteraction] = useState(0);
  const [speaking, setSpeaking] = useState(true);

  useEffect(() => {
    setLineIndex(0);
  }, [channel.id, mode]);

  useEffect(() => {
    setSpeaking(true);
    const timer = window.setTimeout(() => setSpeaking(false), 3_200);
    return () => window.clearTimeout(timer);
  }, [channel.id, interaction, mode]);

  function saySomething() {
    setLineIndex((current) => (current + 1) % lines.length);
    setInteraction((current) => current + 1);
  }

  return (
    <div className="mio-companion">
      <button
        className="mio-companion__button"
        type="button"
        aria-label={`Say hello to Mio in ${channel.name}`}
        aria-expanded={speaking}
        onClick={saySomething}
      >
        <span className="mio-companion__boop" key={interaction}>
          <img src="/brand/mio-orbita.webp" alt="" />
        </span>
      </button>
      {speaking && (
        <span className="mio-companion__bubble" role="status" aria-live="polite">
          <b>MIO</b>
          {lines[lineIndex]}
        </span>
      )}
    </div>
  );
}

function mioLines(channelID: string, mode: 'disconnected' | 'beeper'): string[] {
  if (mode === 'disconnected') {
    return [
      'Beeper first. Then snacks.',
      'I’ll hold the door.',
      'Tap Join when you’re ready.',
    ];
  }

  const linesByChannel: Record<string, string[]> = {
    welcome: ['I saved you a spot.', 'Start with a hello.', 'The porch is this way.'],
    announcements: ['I ring the tiny bell.', 'News lands here.', 'I’m listening.'],
    general: ['Porch mode: on.', 'Say something strange.', 'Tiny websites welcome.'],
    showcase: ['Put it on the fridge!', 'Ooh. Show me.', 'Weird wins here.'],
    builders: ['Half-built still counts.', 'Bugs fear teamwork.', 'What are we making?'],
    'help-desk': ['Bring me the weird bug.', 'No shame in asking.', 'We can untangle it.'],
  };

  return linesByChannel[channelID] ?? ['Hi, neighbor.', 'Nice room.', 'What did I miss?'];
}
