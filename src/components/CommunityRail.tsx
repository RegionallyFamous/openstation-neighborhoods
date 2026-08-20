import { Plus } from 'lucide-react';
import { OpenStationMark } from './OpenStationMark';

interface CommunityRailProps {
  onConnect: () => void;
}

export function CommunityRail({ onConnect }: CommunityRailProps) {
  return (
    <nav className="community-rail" aria-label="Communities">
      <span
        className="community-badge community-badge--active"
        aria-label="OpenStation"
        aria-current="page"
        title="OpenStation"
      >
        <OpenStationMark compact />
        <span className="community-badge__active" />
      </span>
      <button
        className="community-badge community-badge--add"
        type="button"
        aria-label="Connect Beeper"
        title="Connect Beeper"
        onClick={onConnect}
      >
        <Plus size={23} />
      </button>
    </nav>
  );
}
