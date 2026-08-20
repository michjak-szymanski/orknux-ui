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
import type { ComponentTemplate } from '../api/templates';
import {
  componentTemplatePlan,
  contentsSummary,
  fetchComponentTemplates,
  saveComponentAsTemplate,
  useComponentTemplate,
} from '../api/templates';
import downloadIcon from '../assets/download.svg';
import layersIcon from '../assets/layers.svg';
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
        title={`Import ${fileName}`}
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
  /** "Import orders.orkx.json", or "Use Order handling". */
  title: string;
  plan: ImportPlan | null;
  error: string | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** What the button says. "Import" for a file, "Use template" for a row. */
  confirmLabel?: string;
}

function ImportDialog({ open, title, plan, error, busy, onClose, onConfirm, confirmLabel = 'Import' }: ImportDialogProps) {
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
          <h2 className={dialogStyles.title}>{title}</h2>
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
            {busy ? 'Importing…' : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}

export interface UseTemplateButtonProps {
  workspaceId: string;
  /** The page's kind, so the picker offers only templates that hold one. */
  kind: ComponentKind;
  /** Called once something was created, so the list reloads. */
  onImported: () => void;
  label?: string;
}

/**
 * The header control beside Import: the same import, from a stored file.
 *
 * A template is an export the installation keeps, so this is the upload with the
 * file already chosen — same plan, same renaming on collision, same refusal for
 * a variable this workspace does not have. What it adds is the picker, and the
 * one sentence the picker exists to say: a template holds a copy taken when it
 * was published and does not follow what it was made from.
 */
export function UseTemplateButton({ workspaceId, kind, onImported, label = 'Use template' }: UseTemplateButtonProps) {
  const [picking, setPicking] = useState(false);
  const [templates, setTemplates] = useState<ComponentTemplate[] | null>(null);
  const [chosen, setChosen] = useState<ComponentTemplate | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function open() {
    setPicking(true);
    setTemplates(null);
    setError(null);
    fetchComponentTemplates(kind)
      .then(setTemplates)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'Could not load the templates.'),
      );
  }

  async function choose(template: ComponentTemplate) {
    setChosen(template);
    setPicking(false);
    setPlan(null);
    setError(null);
    setBusy(true);
    try {
      setPlan(await componentTemplatePlan(workspaceId, template.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read that template.');
    }
    setBusy(false);
  }

  function close() {
    setChosen(null);
    setPlan(null);
    setError(null);
    setBusy(false);
  }

  async function go() {
    if (chosen === null) return;
    setBusy(true);
    setError(null);
    try {
      await useComponentTemplate(workspaceId, chosen.id);
      close();
      onImported();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not use that template.');
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className={styles.importButton} onClick={open}>
        {label}
      </button>
      <TemplatePicker
        open={picking}
        templates={templates}
        error={picking ? error : null}
        onChoose={(template) => void choose(template)}
        onClose={() => setPicking(false)}
      />
      <ImportDialog
        open={chosen !== null}
        title={chosen === null ? '' : `Use ${chosen.name}`}
        plan={plan}
        error={chosen === null ? null : error}
        busy={busy}
        confirmLabel="Use template"
        onClose={close}
        onConfirm={() => void go()}
      />
    </>
  );
}

interface TemplatePickerProps {
  open: boolean;
  /** Null while they are still being fetched. */
  templates: ComponentTemplate[] | null;
  error: string | null;
  onChoose: (template: ComponentTemplate) => void;
  onClose: () => void;
}

/**
 * What is on offer, and what each one holds.
 *
 * A template this installation can no longer read is still listed, greyed, with
 * the reason on it — the envelope's own refusal, in the words it uses. Leaving it
 * out would have somebody hunting for a template an administrator can plainly
 * see on the Templates page.
 */
function TemplatePicker({ open, templates, error, onChoose, onClose }: TemplatePickerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className={`${dialogStyles.dialog} ${dialogStyles.dialogWide}`}
      onCancel={onClose}
      onClose={onClose}
    >
      <div className={dialogStyles.body}>
        <header className={dialogStyles.header}>
          <h2 className={dialogStyles.title}>Use a template</h2>
        </header>
        <p className={dialogStyles.dialogMessage}>
          Templates are published for the whole installation. Each holds a copy taken when it was
          published — it does not follow whatever it was made from, so what arrives is what was there
          that day. Nothing already here is changed: a name that is taken is renamed.
        </p>

        {templates === null && error === null && <p className={dialogStyles.dialogMessage}>Loading…</p>}

        {templates !== null && templates.length === 0 && (
          <p className={dialogStyles.dialogMessage}>
            There are no templates holding one of these yet. An administrator publishes them on the
            Templates page.
          </p>
        )}

        {templates !== null && templates.length > 0 && (
          <ul className={styles.templates}>
            {templates.map((template) => (
              <li className={styles.template} key={template.id}>
                <button
                  type="button"
                  className={styles.templateChoice}
                  onClick={() => onChoose(template)}
                  disabled={!template.usable}
                >
                  <span className={styles.templateName}>{template.name}</span>
                  {template.description !== null && (
                    <span className={styles.templateNote}>{template.description}</span>
                  )}
                  <span className={template.usable ? styles.templateMeta : styles.templateProblem}>
                    {template.usable ? contentsSummary(template) : template.problem}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {error !== null && (
          <p className={dialogStyles.error} role="alert">
            {error}
          </p>
        )}

        <div className={dialogStyles.actions}>
          <button type="button" className={dialogStyles.ghost} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
}

export interface SaveAsTemplateButtonProps extends ExportComponentButtonProps {
  /** Renders nothing when false: publishing is installation-wide. */
  canPublish: boolean;
}

/**
 * The row action that publishes this component for the whole installation.
 *
 * Export, download, upload reaches the same row and works — this exists because
 * somebody looking at a function they want to share should not have to leave the
 * page, and because a file that travels through a Downloads folder is a file
 * that can be edited on the way. The server exports it here, with the exporter
 * the download uses, so both routes store the same bytes.
 *
 * Administrators only, and it renders nothing for anybody else rather than
 * offering a button the server refuses.
 */
export function SaveAsTemplateButton({
  workspaceId,
  kind,
  id,
  name,
  className,
  canPublish,
}: SaveAsTemplateButtonProps) {
  const [open, setOpen] = useState(false);

  if (!canPublish) return null;

  return (
    <>
      <button
        type="button"
        className={className ?? styles.rowAction}
        onClick={() => setOpen(true)}
        aria-label={`Save ${name} as a template`}
        title={`Save ${name} as a template`}
      >
        <img src={layersIcon} alt="" width={14} height={14} />
      </button>
      <SaveAsTemplateDialog
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

interface SaveAsTemplateDialogProps extends ExportComponentButtonProps {
  open: boolean;
  onClose: () => void;
}

function SaveAsTemplateDialog({ open, workspaceId, kind, id, name, onClose }: SaveAsTemplateDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [templateName, setTemplateName] = useState(name);
  const [description, setDescription] = useState('');
  const [depth, setDepth] = useState<ExportDepth>('DEEP');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      setTemplateName(name);
      setDescription('');
      setDepth('DEEP');
      setBusy(false);
      setError(null);
      setDone(null);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, name]);

  async function publish() {
    setBusy(true);
    setError(null);
    try {
      const made = await saveComponentAsTemplate(workspaceId, kind, id, depth, {
        name: templateName.trim(),
        description: description.trim() === '' ? null : description.trim(),
      });
      setDone(made.name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not publish it.');
    }
    setBusy(false);
  }

  return (
    <dialog ref={dialogRef} className={dialogStyles.dialog} onCancel={onClose} onClose={onClose}>
      <div className={dialogStyles.body}>
        <header className={dialogStyles.header}>
          <h2 className={dialogStyles.title}>Save {name} as a template</h2>
        </header>
        <p className={dialogStyles.dialogMessage}>
          Every workspace on this installation is offered it. It stores a copy taken now: editing {name}{' '}
          afterwards does not change the template, and replacing its file on the Templates page is what
          brings it up to date.
        </p>

        {done !== null ? (
          <p className={dialogStyles.dialogMessage}>
            <strong>{done}</strong> is published. It is on the Templates page under Admin, and behind Use
            template in every workspace.
          </p>
        ) : (
          <>
            <div className={dialogStyles.field}>
              <label className={dialogStyles.label} htmlFor="template-name">
                Name
              </label>
              <input
                id="template-name"
                className={dialogStyles.input}
                value={templateName}
                onChange={(event) => setTemplateName(event.target.value)}
                maxLength={120}
              />
            </div>
            <div className={dialogStyles.field}>
              <label className={dialogStyles.label} htmlFor="template-description">
                Description
              </label>
              <textarea
                id="template-description"
                className={`${dialogStyles.input} ${dialogStyles.textarea}`}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={1000}
                rows={3}
                placeholder="What it is for, and when somebody would reach for it"
              />
            </div>

            <div className={styles.choices}>
              <label className={`${styles.choice} ${depth === 'DEEP' ? styles.choiceSelected : ''}`}>
                <input
                  type="radio"
                  name="template-depth"
                  checked={depth === 'DEEP'}
                  onChange={() => setDepth('DEEP')}
                />
                <span className={styles.choiceText}>
                  <span className={styles.choiceTitle}>Everything it uses</span>
                  <span className={styles.choiceNote}>
                    So it lands in a workspace that has none of this yet.
                  </span>
                </span>
              </label>
              <label className={`${styles.choice} ${depth === 'SHALLOW' ? styles.choiceSelected : ''}`}>
                <input
                  type="radio"
                  name="template-depth"
                  checked={depth === 'SHALLOW'}
                  onChange={() => setDepth('SHALLOW')}
                />
                <span className={styles.choiceText}>
                  <span className={styles.choiceTitle}>This one only</span>
                  <span className={styles.choiceNote}>
                    For workspaces that already have what it points at; using it refuses where they do not.
                  </span>
                </span>
              </label>
            </div>
          </>
        )}

        {error !== null && (
          <p className={dialogStyles.error} role="alert">
            {error}
          </p>
        )}

        <div className={dialogStyles.actions}>
          <button type="button" className={dialogStyles.ghost} onClick={onClose} disabled={busy}>
            {done === null ? 'Cancel' : 'Close'}
          </button>
          {done === null && (
            <button
              type="button"
              className={dialogStyles.filled}
              onClick={() => void publish()}
              disabled={busy || templateName.trim() === ''}
            >
              {busy ? 'Publishing…' : 'Publish template'}
            </button>
          )}
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
