import { Check, LoaderCircle, PlugZap, ShieldCheck, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ConnectionState } from '../types';
import { OpenStationMark } from './OpenStationMark';
import { PoweredByBeeper } from './PoweredByBeeper';

interface ConnectPanelProps {
  open: boolean;
  connection: ConnectionState;
  mode: 'disconnected' | 'beeper';
  busy: boolean;
  onClose: () => void;
  onProbe: () => Promise<boolean>;
  onOAuth: (joinConsentAccepted: boolean) => Promise<void>;
  onDisconnect: () => void;
}

export function ConnectPanel({
  open,
  connection,
  mode,
  busy,
  onClose,
  onProbe,
  onOAuth,
  onDisconnect,
}: ConnectPanelProps) {
  const [localError, setLocalError] = useState('');
  const [joinConsent, setJoinConsent] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const dialog = dialogRef.current;
    if (!dialog) return;
    const dialogElement: HTMLElement = dialog;

    const previouslyFocused = document.activeElement;
    previousFocusRef.current =
      previouslyFocused instanceof HTMLElement ? previouslyFocused : null;
    const focusFrame = window.requestAnimationFrame(() => dialogElement.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = getFocusableElements(dialogElement);
      if (!focusable.length) {
        event.preventDefault();
        dialogElement.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable.at(-1)!;
      const active = document.activeElement;

      if (event.shiftKey && (active === first || active === dialogElement)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialogElement.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
      const previousFocus = previousFocusRef.current;
      if (previousFocus?.isConnected) previousFocus.focus();
      previousFocusRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (connection.kind !== 'error') setLocalError('');
  }, [connection.kind]);

  if (!open) return null;

  async function connectBeeper() {
    setLocalError('');
    try {
      if (shouldProbe && !(await onProbe())) return;
      await onOAuth(joinConsent);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'The door did not open. Try once more.');
    }
  }

  const shouldProbe = ['disconnected', 'unavailable'].includes(connection.kind);
  const errorMessage = localError || (connection.kind === 'error' ? connection.message : '');
  const showReadout = mode !== 'beeper' && connection.kind !== 'disconnected';

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.currentTarget === event.target && onClose()}>
      <section
        className="connect-panel"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-title"
        tabIndex={-1}
      >
        <header className="connect-panel__header">
          <span className="connect-panel__mark"><OpenStationMark /></span>
          <div className="connect-panel__title">
            <span className="eyebrow">YOUR OPENSTATION INVITE</span>
            <h1 id="connect-title">
              {mode === 'beeper' ? 'Welcome to the neighborhood.' : 'Your seat is saved.'}
            </h1>
            <PoweredByBeeper compact />
          </div>
          <button type="button" onClick={onClose} aria-label="Close connection panel"><X size={20} /></button>
        </header>

        {mode !== 'beeper' && (
          <>
            <div className="connect-panel__art" aria-hidden="true">
              <img src="/assets/openstation-onboarding-hero-v2-ui.webp" alt="" />
            </div>
            <p className="connect-panel__intro">
              Open Beeper on this computer and tap below. One quick approval, then you’re in.
            </p>
          </>
        )}

        {showReadout && (
          <div
            className={`connection-readout connection-readout--${connection.kind}`}
            role={connection.kind === 'error' ? undefined : 'status'}
            aria-live={connection.kind === 'error' ? undefined : 'polite'}
            aria-atomic="true"
          >
            <span className="connection-readout__light" aria-hidden="true" />
            <div>
              <strong>{readoutTitle(connection)}</strong>
              <small>{connection.message}</small>
            </div>
            {connection.kind === 'probing' && <LoaderCircle className="spin" size={18} aria-hidden="true" />}
            {connection.kind === 'available' && <Check size={18} aria-hidden="true" />}
          </div>
        )}

        {mode === 'beeper' ? (
          <div className="connected-card">
            <span><Check size={23} /></span>
            <div>
              <h2>You made it.</h2>
              <p>Beeper has the door open on this computer.</p>
            </div>
            <button type="button" onClick={onDisconnect}>DISCONNECT</button>
          </div>
        ) : (
          <>
            <label className="join-consent">
              <input
                type="checkbox"
                checked={joinConsent}
                onChange={(event) => setJoinConsent(event.target.checked)}
              />
              <span>
                <strong>Count me in — join six public rooms</strong>
                <small>Shared history is visible. Rooms are not end-to-end encrypted, and copies may remain with participating services.</small>
              </span>
            </label>

            <button
              className="connect-primary"
              type="button"
              disabled={connection.kind === 'probing' || busy || !joinConsent}
              aria-busy={connection.kind === 'probing' || busy}
              onClick={() => void connectBeeper()}
            >
              {connection.kind === 'probing' || busy ? <LoaderCircle className="spin" size={19} /> : <PlugZap size={19} />}
              {connection.kind === 'probing' || busy
                ? 'OPENING THE DOOR…'
                : connection.kind === 'unavailable'
                  ? 'KNOCK AGAIN'
                  : connection.kind === 'error'
                    ? 'START FRESH WITH BEEPER'
                    : 'LET’S GO — CONNECT BEEPER'}
            </button>

            <p className="connection-local-note">
              <ShieldCheck size={15} aria-hidden="true" />
              Your Beeper key stays right here on this computer.
            </p>

            {connection.kind === 'unavailable' && (
              <details className="connect-troubleshooting">
                <summary>Beeper still playing hard to get?</summary>
                <p>
                  The Desktop API is normally ready automatically. In Beeper, open Settings → Integrations and confirm Desktop API is enabled. OpenStation requires Beeper 4.2.936 or newer.
                </p>
              </details>
            )}

          </>
        )}

        {errorMessage && (
          <p className="connect-error" id="connect-error" role="alert">{errorMessage}</p>
        )}

      </section>
    </div>
  );
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => {
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
}

function readoutTitle(connection: ConnectionState): string {
  if (connection.kind === 'connected') return 'Beeper brought you in';
  if (connection.kind === 'available') return 'Beeper found. Nice.';
  if (connection.kind === 'probing') return 'Knocking on Beeper’s door…';
  if (connection.kind === 'unavailable') return 'No answer from Beeper yet';
  if (connection.kind === 'error') return 'Beeper needs a do-over';
  return 'Open Beeper and we’ll take it from there';
}
