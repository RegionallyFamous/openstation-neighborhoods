import { Check, Copy, LoaderCircle, RadioTower } from 'lucide-react';
import { useState } from 'react';
import type { ConnectionState, ProvisionedCommunity } from '../types';

interface ProvisionPanelProps {
  connection: ConnectionState;
  busy: boolean;
  result: ProvisionedCommunity | null;
  onConnect: () => void;
  onProvision: () => Promise<ProvisionedCommunity>;
}

export function ProvisionPanel({
  connection,
  busy,
  result,
  onConnect,
  onProvision,
}: ProvisionPanelProps) {
  const [error, setError] = useState('');
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const connected = connection.kind === 'connected';
  const manifest = result ? JSON.stringify(result, null, 2) : '';

  async function provision() {
    setError('');
    setProvisioning(true);
    try {
      await onProvision();
    } catch (provisionError) {
      setError(
        provisionError instanceof Error
          ? provisionError.message
          : 'The community could not be provisioned.',
      );
    } finally {
      setProvisioning(false);
    }
  }

  async function copyManifest() {
    setCopyStatus('');
    try {
      await navigator.clipboard.writeText(manifest);
      setCopyStatus('Room manifest copied.');
    } catch {
      setCopyStatus('The room manifest could not be copied. Select the text above and copy it manually.');
    }
  }

  return (
    <aside className="provision-panel" aria-label="OpenStation provisioning">
      <header>
        <span><RadioTower size={20} /></span>
        <div>
          <small>ADMIN SETUP</small>
          <strong>Beeper community provisioner</strong>
        </div>
      </header>
      {result ? (
        <>
          <p className="provision-panel__success"><Check size={16} /> Space and six supported rooms created.</p>
          <pre data-testid="provision-result">{manifest}</pre>
          <button type="button" onClick={() => void copyManifest()}>
            <Copy size={15} /> COPY ROOM MANIFEST
          </button>
          {copyStatus && <p className={copyStatus.startsWith('Room') ? 'provision-panel__success' : 'provision-panel__error'} role="status">{copyStatus}</p>}
        </>
      ) : (
        <>
          <p>This administrator tool can create one public Matrix Space and seven public rooms. Browser-local recovery cannot prevent duplicates from another browser.</p>
          {connected ? (
            <>
              <p>Connected identity: <strong>{connection.accountName || 'Unnamed Beeper Matrix account'}</strong></p>
              {confirmationOpen && (
                <p className="provision-panel__error" role="alert">Confirm that this is the intended long-term administrator. The next action creates public Matrix rooms.</p>
              )}
              <button
                type="button"
                disabled={busy || provisioning}
                onClick={() => confirmationOpen ? void provision() : setConfirmationOpen(true)}
              >
                {provisioning ? <LoaderCircle className="spin" size={16} /> : <RadioTower size={16} />}
                {provisioning
                  ? 'CREATING COMMUNITY…'
                  : busy
                    ? 'ANOTHER OPENSTATION ACTION IS RUNNING'
                    : confirmationOpen
                      ? 'CONFIRM PUBLIC ROOM CREATION'
                      : 'REVIEW PUBLIC ROOM CREATION'}
              </button>
            </>
          ) : (
            <button type="button" onClick={onConnect}>CONNECT ADMIN BEEPER</button>
          )}
        </>
      )}
      {error && <p className="provision-panel__error" role="alert">{error}</p>}
    </aside>
  );
}
