import { X } from 'lucide-react';
import type { Member } from '../types';

interface MemberRailProps {
  members: Member[];
  open: boolean;
  onClose: () => void;
}

export function MemberRail({ members, open, onClose }: MemberRailProps) {
  const groups = [
    { key: 'host', label: 'Hosts' },
    { key: 'moderator', label: 'Neighborhood keepers' },
    { key: 'builder', label: 'Builders' },
    { key: 'member', label: 'Neighbors' },
  ] as const;

  return (
    <aside className={`member-rail${open ? ' is-open' : ''}`}>
      <header className="member-rail__header">
        <div>
          <span className="eyebrow">WHO’S AROUND</span>
          <strong>{members.length ? `${members.length} neighbors on the map` : 'The porch is quiet'}</strong>
        </div>
        <button type="button" aria-label="Close members" onClick={onClose}><X size={18} /></button>
      </header>
      <div className="member-rail__scroll">
        {!members.length && (
          <section className="empty-channel">
            <h2>No neighbors on the map yet.</h2>
            <p>Connect Beeper and open a room. The guest list will fill itself.</p>
          </section>
        )}
        {groups.map((group) => {
          const groupMembers = members.filter((member) => member.role === group.key);
          if (!groupMembers.length) return null;
          return (
            <section className="member-group" key={group.key}>
              <h2>{group.label} — {groupMembers.length}</h2>
              {groupMembers.map((member) => (
                <div className="member-row" key={member.id} aria-label={`${member.name}, ${member.note || member.handle}`}>
                  <span className="member-row__avatar" style={{ '--avatar-color': member.color } as React.CSSProperties}>
                    {member.avatarUrl ? <img src={member.avatarUrl} alt="" /> : member.avatar}
                  </span>
                  <span>
                    <strong>{member.name}</strong>
                    <small>{member.note || member.handle}</small>
                  </span>
                </div>
              ))}
            </section>
          );
        })}
      </div>
      <footer className="member-rail__footer">
        <span className="member-rail__source">
          <i aria-hidden="true" />
          <span><strong>Beeper guest list</strong><small>Real room members · presence stays private</small></span>
        </span>
        <a
          className="member-rail__beeper"
          href="https://www.beeper.com/"
          target="_blank"
          rel="noreferrer"
          aria-label="Powered by Beeper"
        >
          <span>POWERED BY</span>
          <img src="/brand/beeper-wordmark.svg" alt="Beeper" />
        </a>
      </footer>
    </aside>
  );
}
