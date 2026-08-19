import { useEffect, useRef, useState } from 'react';

import type { ComponentKind, ExportDepth, ImportEntry, ImportPlan } from '../api/transfer';
import {
  DISPOSITION_LABEL,
  KIND_LABEL,
  componentImportPlan,
  exportComponent,
  importComponents,
  saveJson,
} from '../api/transfer';
import downloadIcon from '../assets/download.svg';
import dialogStyles from './Dialog.module.css';
import styles from './ComponentTransfer.module.css';

/**
 * Export and Import for a workspace's catalogue.
 *
 * Two controls, on five lists. The export asks how much to take before it takes
 * it, and the import says what it will do before it does it — a button that
 * silently creates nine things is worse than one that lists them first, which is
 * the whole reason the plan is a separate round trip rather than a return value.
 */

export interface ExportComponentButtonProps {
  workspaceId: string;
  kind: ComponentKind;
  id: string;
  /** Shown in the dialog, so somebody knows which one they clicked. */
  name: string;
  /**
   * The page's own icon-button class, where it has one.
   *
   * Skills are cards rather than rows and style their actions differently; the
   * control is the same control, so it takes the surrounding style rather than
   * bringing a second one onto the page.
   */
  className?: string;
}

/** The row action: a download icon that opens the depth choice. */
export function ExportComponentButton({ workspaceId, kind, id, name, className }: ExportComponentButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={className ?? styles.rowAction}
        onClick={() => setOpen(true)}
        aria-label={`Export ${name}`}
        title={`Export ${name}`}
      >
        <img src={downloadIcon} alt="" width={14} height={14} />
      </button>
      <ExportDialog
        open={open}
        workspaceId={workspaceId}
        kind={kind}
        id={id}
        name={name}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

interface ExportDialogProps extends ExportComponentButtonProps {
  open: boolean;
  onClose: () => void;
}

function ExportDialog({ open, workspaceId, kind, id, name, onClose }: ExportDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [depth, setDepth] = useState<ExportDepth>('DEEP');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      setDepth('DEEP');
      setBusy(false);
      setError(null);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const made = await exportComponent(workspaceId, kind, id, depth);
      saveJson(made.fileName, made.json);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not export it.');
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialogRef} className={dialogStyles.dialog} onCancel={onClose} onClose={onClose}>
      <div className={dialogStyles.body}>
        <header className={dialogStyles.header}>
          <h2 className={dialogStyles.title}>Export {name}</h2>
        </header>
        <p className={dialogStyles.dialogMessage}>
          A JSON file you can import into another workspace. Nothing secret travels: a variable this is
          handed is named in the file, and the workspace it lands in supplies its own value.
        </p>

        <div className={styles.choices}>
          <label className={`${styles.choice} ${depth === 'DEEP' ? styles.choiceSelected : ''}`}>
            <input
              type="radio"
              name="export-depth"
              checked={depth === 'DEEP'}
              onChange={() => setDepth('DEEP')}
            />
            <span className={styles.choiceText}>
              <span className={styles.choiceTitle}>Everything it uses</span>
              <span className={styles.choiceNote}>
                The objects it is typed against, the functions it calls, the conditions it combines — so it
                lands somewhere it can be opened.
              </span>
            </span>
          </label>
          <label className={`${styles.choice} ${depth === 'SHALLOW' ? styles.choiceSelected : ''}`}>
            <input
              type="radio"
              name="export-depth"
              checked={depth === 'SHALLOW'}
              onChange={() => setDepth('SHALLOW')}
            />
            <span className={styles.choiceText}>
              <span className={styles.choiceTitle}>This one only</span>
              <span className={styles.choiceNote}>
                For a workspace that already has what it points at. The import will match those by name and
                refuse if it cannot.
              </span>
            </span>
          </label>
        </div>

        {error !== null && (
          <p className={dialogStyles.error} role="alert">
            {error}
          </p>
        )}

        <div className={dialogStyles.actions}>
          <button type="button" className={dialogStyles.ghost} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={dialogStyles.filled} onClick={() => void download()} disabled={busy}>
            {busy ? 'Exporting…' : 'Download'}
          </button>
        </div>
      </div>
    </dialog>
  );
}

export interface ImportComponentsButtonProps {
  workspaceId: string;
  /** Called once something was actually created, so the list reloads. */
  onImported: () => void;
  /** "Import Function", so the button says what this page holds. */
  label?: string;
}

/**
 * The header control: pick a file, read what it would do, then say go.
 *
 * The file is never sent twice by accident — the preview and the import take the
 * same text, and the import re-plans server-side, so what is confirmed is what
 * happens even if somebody left the dialog open while the workspace changed.
 */
export function ImportComponentsButton({ workspaceId, onImported, label = 'Import' }: ImportComponentsButtonProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [envelope, setEnvelope] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function chosen(file: File | undefined) {
    if (file === undefined) return;
    setFileName(file.name);
    setError(null);
    setPlan(null);
    setBusy(true);
    const text = await file.text();
    setEnvelope(text);
    try {
      setPlan(await componentImportPlan(workspaceId, text));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read that file.');
    }
    setBusy(false);
  }

  function close() {
    setEnvelope(null);
    setPlan(null);
    setError(null);
    setBusy(false);
    if (fileRef.current !== null) fileRef.current.value = '';
  }

  async function go() {
    if (envelope === null) return;
    setBusy(true);
    setError(null);
    try {
      await importComponents(workspaceId, envelope);
      close();
      onImported();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not import it.');
      setBusy(false);
    }
  }

  return (
    <>
      <input
        ref={fileRef}
        className={styles.hidden}
        type="file"
        accept="application/json,.json"
        onChange={(event) => void chosen(event.target.files?.[0])}
      />
      <button type="button" className={styles.importButton} onClick={() => fileRef.current?.click()}>
        {label}
      </button>
      <ImportDialog
        open={envelope !== null}
        fileName={fileName}
        plan={plan}
        error={error}
        busy={busy}
        onClose={close}
        onConfirm={() => void go()}
      />
    </>
  );
}

interface ImportDialogProps {
  open: boolean;
  fileName: string;
  plan: ImportPlan | null;
  error: string | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

function ImportDialog({ open, fileName, plan, error, busy, onClose, onConfirm }: ImportDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  const creating = plan?.entries.filter((entry) => entry.disposition !== 'REUSE').length ?? 0;

  return (
    <dialog ref={dialogRef} className={`${dialogStyles.dialog} ${dialogStyles.dialogWide}`} onCancel={onClose} onClose={onClose}>
      <div className={dialogStyles.body}>
        <header className={dialogStyles.header}>
          <h2 className={dialogStyles.title}>Import {fileName}</h2>
        </header>

        {plan === null && error === null && <p className={dialogStyles.dialogMessage}>Reading the file…</p>}

        {plan !== null && (
          <>
            <p className={dialogStyles.dialogMessage}>
              {plan.importable
                ? `This will create ${creating} ${creating === 1 ? 'thing' : 'things'} in this workspace. Nothing that is already here is changed.`
                : 'This cannot be imported yet. What it points at has to exist here first.'}
            </p>

            <ul className={styles.plan}>
              {plan.entries.map((entry) => (
                <li className={styles.entry} key={`${entry.kind ?? 'VARIABLE'}:${entry.name}`}>
                  <span className={styles.entryHead}>
                    <span className={styles.entryKind}>{entry.kind === null ? 'Variable' : KIND_LABEL[entry.kind]}</span>
                    <span className={styles.entryName}>
                      {entry.disposition === 'RENAME' ? `${entry.name} → ${entry.targetName}` : entry.name}
                    </span>
                    <span className={`${styles.badge} ${badgeOf(entry)}`}>
                      {DISPOSITION_LABEL[entry.disposition]}
                    </span>
                  </span>
                  <p className={styles.entryDetail}>{entry.detail}</p>
                </li>
              ))}
            </ul>

            <p className={styles.summary}>
              Format version {plan.formatVersion}
              {plan.producedBy === null ? '' : `, from ${plan.producedBy}`}.
            </p>
          </>
        )}

        {error !== null && (
          <p className={dialogStyles.error} role="alert">
            {error}
          </p>
        )}

        <div className={dialogStyles.actions}>
          <button type="button" className={dialogStyles.ghost} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={dialogStyles.filled}
            onClick={onConfirm}
            disabled={busy || plan === null || !plan.importable}
          >
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
      </div>
    </dialog>
  );
}

function badgeOf(entry: ImportEntry): string {
  switch (entry.disposition) {
    case 'CREATE':
      return styles.badgeCreate;
    case 'RENAME':
      return styles.badgeRename;
    case 'REUSE':
      return styles.badgeReuse;
    case 'MISSING':
      return styles.badgeMissing;
  }
}

export const transferStyles = styles;
