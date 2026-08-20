import { Check, ExternalLink, Laptop, LoaderCircle, PlugZap, Radio, ShieldCheck, X } from 'lucide-react';
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
  onProbe: () => Promise<void>;
  onOAuth: () => Promise<void>;
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
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (open && connection.kind === 'disconnected') void onProbe();
  }, [connection.kind, onProbe, open]);

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

  if (!open) return null;

  async function connectOAuth() {
    setLocalError('');
    try {
      await onOAuth();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Could not connect.');
    }
  }

  const available = ['available', 'connected', 'error'].includes(connection.kind);
  const errorMessage = localError || (connection.kind === 'error' ? connection.message : '');

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
            <span className="eyebrow">LOCAL CONNECTION</span>
            <h1 id="connect-title">Join OpenStation with Beeper.</h1>
            <PoweredByBeeper compact />
          </div>
          <button type="button" onClick={onClose} aria-label="Close connection panel"><X size={20} /></button>
        </header>

        <div className="connect-panel__art" aria-hidden="true">
          <img src="/assets/openstation-onboarding-hero-v2.png" alt="" />
          <span>BEEPER IDENTITY</span>
          <i />
          <span>BEEPER NEIGHBORHOOD</span>
        </div>

        <p className="connect-panel__intro">Open Beeper Desktop, approve OpenStation once, and you’ll be inside the neighborhood.</p>

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
          {connection.kind === 'probing' && <LoaderCircle className="spin" size={20} aria-hidden="true" />}
          {connection.kind === 'connected' && <Check size={20} aria-hidden="true" />}
          {['unavailable', 'error'].includes(connection.kind) && (
            <button type="button" onClick={() => void onProbe()}>TRY AGAIN</button>
          )}
        </div>

        {mode === 'beeper' ? (
          <div className="connected-card">
            <span><Radio size={23} /></span>
            <div>
              <h2>You are connected.</h2>
              <p>OpenStation automatically adds its neighborhood rooms through your local Beeper app, then loads their real messages and members.</p>
            </div>
            <button type="button" onClick={onDisconnect}>DISCONNECT</button>
          </div>
        ) : (
          <>
            <ol className="connection-steps">
              <li>
                <span><Laptop size={20} /></span>
                <div><strong>1. Keep Beeper Desktop open</strong><small>Use Beeper on this computer, version 4.2.936 or newer.</small></div>
              </li>
              <li>
                <span><PlugZap size={20} /></span>
                <div><strong>2. Turn on the Desktop API</strong><small>In Beeper, open Settings → Integrations and enable Desktop API.</small></div>
              </li>
              <li>
                <span><ShieldCheck size={20} /></span>
                <div><strong>3. Approve OpenStation</strong><small>Beeper will show a permission screen. Approve it to join the six OpenStation rooms automatically.</small></div>
              </li>
            </ol>

            <button
              className="connect-primary"
              type="button"
              disabled={!available || busy}
              aria-busy={busy}
              onClick={() => void connectOAuth()}
            >
              {busy ? <LoaderCircle className="spin" size={19} /> : <PlugZap size={19} />}
              {connection.kind === 'error' ? 'REAUTHORIZE WITH BEEPER' : 'JOIN OPENSTATION'}
              <ExternalLink size={16} />
            </button>

            <div className="privacy-note">
              <ShieldCheck size={18} />
              <p><strong>Local means local.</strong> The access token stays in this browser session and the API remains bound to your computer. Neighborhoods never asks you to expose Beeper to the internet.</p>
            </div>

          </>
        )}

        {errorMessage && (
          <p className="connect-error" id="connect-error" role="alert">{errorMessage}</p>
        )}

        <footer className="connect-panel__footer">
          <span>OPENSTATION.CHAT · REQUIRES BEEPER DESKTOP</span>
          <a href="https://developers.beeper.com/desktop-api" target="_blank" rel="noreferrer">BEEPER API DOCS <ExternalLink size={13} /></a>
        </footer>
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
  if (connection.kind === 'connected') return 'Signal locked';
  if (connection.kind === 'available') return 'Beeper detected';
  if (connection.kind === 'probing') return 'Listening on localhost:23373';
  if (connection.kind === 'unavailable') return 'No local signal yet';
  if (connection.kind === 'error') return 'Connection needs attention';
  return 'Ready to connect';
}
