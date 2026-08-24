import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { authTypeLabel, createMcpServer } from '../api/integrations';
import type { AuthType, HttpHeader, McpServer } from '../api/integrations';
import chevronDown12Icon from '../assets/chevron-down-12.svg';
import styles from './Dialog.module.css';
import { HeaderRowsEditor } from './HeaderRowsEditor';
import { SecretField, useSecretField } from './SecretField';
import { useWorkspaceVariables } from '../pages/workspace/workspaceVariables';

export interface McpServerDialogProps {
  open: boolean;
  workspaceId: string;
  onClose: () => void;
  onCreated: (server: McpServer) => void;
}

const AUTH_TYPES: AuthType[] = ['NONE', 'API_KEY', 'BEARER_TOKEN', 'BASIC'];

/**
 * Add Server. The connection modals frame has no MCP variant, so this follows
 * the Add Connection modal with the fields of the MCP server settings page.
 */
export function McpServerDialog({ open, workspaceId, onClose, onCreated }: McpServerDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [authType, setAuthType] = useState<AuthType>('API_KEY');
  /** The credential: typed here, or read from a workspace secret. Its own choice. */
  const secret = useSecretField();
  const { variables, refresh: refreshVariables } = useWorkspaceVariables(workspaceId);
  const [headers, setHeaders] = useState<HttpHeader[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    if (open && !dialog.open) {
      setName('');
      setAddress('');
      setAuthType('API_KEY');
      secret.clear();
      setHeaders([]);
      setError(null);
      setSubmitting(false);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const complete = name.trim() !== '' && address.trim() !== '' && !secret.unchosen;

  /**
   * The secrets this workspace keeps, and only those: a VALUE is read with the
   * variable listing, so the server refuses one as a credential and offering it
   * here would teach that at the cost of a save.
   */
  const secrets = useMemo(
    () =>
      variables
        .filter((variable) => variable.kind === 'SECRET')
        .map((variable) => ({ value: variable.id, label: variable.name, hint: variable.catalogName })),
    [variables],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!complete || submitting) return;

    const sending = secret.sending;

    setSubmitting(true);
    setError(null);
    try {
      const created = await createMcpServer({
        workspaceId,
        name: name.trim(),
        address: address.trim(),
        authType,
        // One of the two, never both: sending the pair is refused rather than
        // resolved by precedence, and sending neither adds a server with no
        // credential, which is a thing somebody may perfectly well want.
        ...(sending === null
          ? {}
          : 'variable' in sending
            ? { secretVariableId: sending.variable }
            : { secret: sending.value.trim() || undefined }),
        headers: headers.filter((header) => header.name.trim() !== ''),
      });
      onCreated(created);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add the server.');
      setSubmitting(false);
    }
  }

  return (
    <dialog ref={dialogRef} className={`${styles.dialog} ${styles.dialogWide}`} onCancel={onClose} onClose={onClose}>
      <form className={styles.body} onSubmit={handleSubmit}>
        <header className={styles.header}>
          <h2 className={styles.title}>Add MCP Server</h2>
        </header>

        <p className={styles.dialogMessage}>Add a server this workspace&rsquo;s agents may connect to</p>

        <div className={styles.fields}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="mcp-server-name">
              Name
            </label>
            <div className={styles.inputWrapper}>
              <input
                id="mcp-server-name"
                name="serverName"
                className={`${styles.input} ${styles.inputMono}`}
                type="text"
                placeholder="brave-search"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
                required
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="mcp-server-address">
              Address
            </label>
            <div className={styles.inputWrapper}>
              <input
                id="mcp-server-address"
                name="serverAddress"
                className={`${styles.input} ${styles.inputMono}`}
                type="text"
                placeholder="https://"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                required
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="mcp-server-auth">
              Auth Type
            </label>
            <div className={styles.inputWrapper}>
              <select
                id="mcp-server-auth"
                name="authType"
                className={`${styles.input} ${styles.select}`}
                value={authType}
                onChange={(event) => setAuthType(event.target.value as AuthType)}
              >
                {AUTH_TYPES.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {authTypeLabel(candidate)}
                  </option>
                ))}
              </select>
              <img src={chevronDown12Icon} alt="" width={12} height={12} />
            </div>
          </div>

          {authType !== 'NONE' && (
            /* One field, asked for one way at a time - and the choice stands
               beside this field's name rather than above the dialog, because a
               dialog-level switch would be a claim about every field in it. */
            <SecretField
              id="mcp-server-secret"
              label="Token / Key"
              field={secret}
              options={secrets}
              variablesPath={`/workspace/${workspaceId}/variables`}
              placeholder="Enter token or key..."
              hint="Whatever the server expects, sent the way the authentication method above says."
              onSource={(next) => {
                secret.choose(next);
                if (next === 'VARIABLE') refreshVariables();
                setError(null);
              }}
              onValue={() => setError(null)}
              onVariable={() => setError(null)}
            />
          )}

          <HeaderRowsEditor headers={headers} onChange={setHeaders} compact />
        </div>

        {error !== null && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <div className={styles.actions}>
          <button type="button" className={styles.ghost} onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className={styles.filled} disabled={!complete || submitting}>
            {submitting ? 'Adding…' : 'Add Server'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
