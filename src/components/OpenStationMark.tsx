interface OpenStationMarkProps {
  compact?: boolean;
  label?: string;
}

export function OpenStationMark({
  compact = false,
  label = 'OpenStation',
}: OpenStationMarkProps) {
  return (
    <img
      className={`openstation-mark${compact ? ' openstation-mark--compact' : ''}`}
      src="/brand/openstation-app-icon.svg"
      alt={label}
    />
  );
}
