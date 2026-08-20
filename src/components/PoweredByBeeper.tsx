interface PoweredByBeeperProps {
  compact?: boolean;
}

export function PoweredByBeeper({ compact = false }: PoweredByBeeperProps) {
  return (
    <a
      className={`powered-by-beeper${compact ? ' powered-by-beeper--compact' : ''}`}
      href="https://www.beeper.com/"
      target="_blank"
      rel="noreferrer"
      aria-label="Powered by Beeper"
    >
      <span>POWERED BY</span>
      <img src="/brand/beeper-wordmark.svg" alt="Beeper" />
    </a>
  );
}
