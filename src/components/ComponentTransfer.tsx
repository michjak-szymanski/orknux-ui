import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  BindingChoice,
  ComponentBinding,
  ComponentKind,
  ExportDepth,
  ExternalKind,
  ImportEntry,
  ImportPlan,
} from '../api/transfer';
import {
  DISPOSITION_LABEL,
  EXTERNAL_LABEL,
  KIND_LABEL,
  bindingChoices,
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
import chevronDownIcon from '../assets/chevron-down-12.svg';
import downloadIcon from '../assets/download.svg';
import layersIcon from '../assets/layers.svg';
import dialogStyles from './Dialog.module.css';
import styles from './ComponentTransfer.module.css';

/**
 * Export and Import for a workspace's catalogue.
 *
 * Two controls, on every list that holds something a file can carry. The export
 * asks how much to take before it takes it, and the import says what it will do
 * before it does it — a button that silently creates nine things is worse than
 * one that lists them first, which is the whole reason the plan is a separate
 * round trip rather than a return value.
 *
 * Half the catalogue points at something no file can carry: a model, a
 * connection, an MCP server, each of them kept beside a credential. Those arrive
 * as questions rather than as failures, and answering one is asking for the same
 * plan again with the answer attached — which is why the dialog owns the plan
 * rather than being handed one.
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
      <ExportComponentDialog
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

export interface ExportComponentDialogProps extends ExportComponentButtonProps {
  open: boolean;
  onClose: () => void;
}

/**
 * The depth choice and the download, without the row action that opens it.
 *
 * Exported because a list row is not the only place somebody wants a copy of
 * something: the workflow editor offers the same thing from its toolbar, where
 * the control has to be one of that bar's icon buttons rather than this one's.
 * What opens the dialog differs; what the dialog asks must not, or two screens
 * would be offering two different exports under one word.
 */
export function ExportComponentDialog({ open, workspaceId, kind, id, name, onClose }: ExportComponentDialogProps) {
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
          handed is named in the file, and the workspace it lands in supplies its own value. So is a model,
          a connection or an MCP server it points at — each of those is kept beside a credential, and the
          workspace it lands in says which of its own the name means.
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
                The objects it is typed against, the functions it calls, the actions and agents a workflow
                runs — so it lands somewhere it can be opened.
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

  async function chosen(file: File | undefined) {
    if (file === undefined) return;
    setFileName(file.name);
    setEnvelope(await file.text());
  }

  function close() {
    setEnvelope(null);
    if (fileRef.current !== null) fileRef.current.value = '';
  }

  /*
   * Keyed on the file rather than rebuilt each render: the dialog asks for the
   * plan again whenever these change, which is what choosing a second file
   * should do and what re-rendering should not.
   */
  const planFor = useCallback(
    (bindings: ComponentBinding[]) => componentImportPlan(workspaceId, envelope ?? '', bindings),
    [workspaceId, envelope],
  );
  const commit = useCallback(
    (bindings: ComponentBinding[]) => importComponents(workspaceId, envelope ?? '', bindings),
    [workspaceId, envelope],
  );

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
        workspaceId={workspaceId}
        planFor={planFor}
        commit={commit}
        onClose={close}
        onImported={() => {
          close();
          onImported();
        }}
      />
    </>
  );
}

interface ImportDialogProps {
  open: boolean;
  /** "Import orders.orkx.json", or "Use Order handling". */
  title: string;
  workspaceId: string;
  /**
   * What this would do, given these answers.
   *
   * The same call for the first look and for every answer after it — asking what
   * needs binding is asking for the plan, and answering is asking again with the
   * answers attached. Must be stable while one file is open.
   */
  planFor: (bindings: ComponentBinding[]) => Promise<ImportPlan>;
  /** Does it, with the answers that were given. */
  commit: (bindings: ComponentBinding[]) => Promise<ImportPlan>;
  onClose: () => void;
  /** Called once something was actually created. */
  onImported: () => void;
  /** What the button says. "Import" for a file, "Use template" for a row. */
  confirmLabel?: string;
}

/**
 * What the file would do here, and the questions it cannot answer itself.
 *
 * The plan is asked for again after every answer rather than patched: the server
 * is the one reader of the file, and a dialog that worked out for itself what a
 * binding settled would be a second reader — the lenient one, offering Import
 * for a file the mutation then refuses.
 */
function ImportDialog({
  open,
  title,
  workspaceId,
  planFor,
  commit,
  onClose,
  onImported,
  confirmLabel = 'Import',
}: ImportDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [bindings, setBindings] = useState<ComponentBinding[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /*
   * Told apart from `busy` only so the button can say which of the two waits
   * this is: asking for the plan again is not importing, and a button that
   * says it is has somebody watching for a change that has not happened.
   */
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let current = true;
    setPlan(null);
    setBindings([]);
    setError(null);
    setImporting(false);
    setBusy(true);
    planFor([])
      .then((first) => {
        if (current) setPlan(first);
      })
      .catch((cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : 'Could not read that file.');
      })
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
    };
  }, [open, planFor]);

  /**
   * One answer, and the plan again with every answer so far.
   *
   * An empty choice takes the answer back rather than sending an empty one, so
   * the entry returns to the question it was.
   */
  async function answer(entry: ImportEntry, targetId: string) {
    if (entry.external === null) return;
    const external = entry.external;
    const next = bindings
      .filter((binding) => !(binding.kind === external && binding.name === entry.name))
      .concat(targetId === '' ? [] : [{ kind: external, name: entry.name, targetId }]);
    setBindings(next);
    setBusy(true);
    setError(null);
    try {
      setPlan(await planFor(next));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read that file.');
    }
    setBusy(false);
  }

  async function go() {
    setBusy(true);
    setImporting(true);
    setError(null);
    try {
      await commit(bindings);
      onImported();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not import it.');
      setImporting(false);
      setBusy(false);
    }
  }

  const creating = plan?.entries.filter((entry) => entry.disposition !== 'REUSE').length ?? 0;

  /*
   * Everything the file points outward at that this workspace did not match on
   * its own — the ones still unanswered, and the ones answered here, which stay
   * so an answer can be changed or taken back.
   */
  const questions = (plan?.entries ?? []).filter(
    (entry) =>
      entry.external !== null &&
      (entry.disposition === 'MISSING' || chosenFor(bindings, entry) !== ''),
  );

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

            {questions.length > 0 && (
              <BindingQuestions
                workspaceId={workspaceId}
                questions={questions}
                bindings={bindings}
                busy={busy}
                onAnswer={(entry, targetId) => void answer(entry, targetId)}
              />
            )}

            <ul className={styles.plan}>
              {plan.entries.map((entry) => (
                <li className={styles.entry} key={entryKey(entry)}>
                  <span className={styles.entryHead}>
                    <span className={styles.entryKind}>{entryKindLabel(entry)}</span>
                    <span className={styles.entryName}>
                      {entry.name === entry.targetName ? entry.name : `${entry.name} → ${entry.targetName}`}
                    </span>
                    <span className={`${styles.badge} ${badgeOf(entry)}`}>
                      {DISPOSITION_LABEL[entry.disposition]}
                    </span>
                  </span>
                  <p className={styles.entryDetail}>{entry.detail}</p>
                </li>
              ))}
            </ul>

            {plan.entries.some((entry) => entry.kind === 'WORKFLOW') && (
              <p className={styles.arrival}>
                A workflow arrives as a draft: publishing takes a copy of the graph to run from, and that
                first publish is yours to make once you have looked at what came. Its name belongs to the
                whole installation rather than to this workspace, so a copy landing beside the original is
                renamed rather than replacing it.
              </p>
            )}

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
            onClick={() => void go()}
            disabled={busy || plan === null || !plan.importable}
          >
            {importing ? 'Importing…' : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}

interface BindingQuestionsProps {
  workspaceId: string;
  questions: ImportEntry[];
  bindings: ComponentBinding[];
  busy: boolean;
  onAnswer: (entry: ImportEntry, targetId: string) => void;
}

/**
 * A row per thing the file could not carry, and this workspace's own to point it at.
 *
 * The name on the left is the file's, shown and sent back exactly as the plan
 * gave it — for a model it reads as a provider and a model, but nothing here
 * takes it apart, because what makes it unique is the server's business.
 */
function BindingQuestions({ workspaceId, questions, bindings, busy, onAnswer }: BindingQuestionsProps) {
  const [choices, setChoices] = useState<Partial<Record<ExternalKind, BindingChoice[]>>>({});
  const [error, setError] = useState<string | null>(null);

  // Only the kinds actually asked about: a file naming no model has no business
  // fetching the workspace's models.
  const wanted = [...new Set(questions.map((entry) => entry.external))].filter(
    (kind): kind is ExternalKind => kind !== null,
  );
  const key = wanted.join(',');

  useEffect(() => {
    let current = true;
    setError(null);
    Promise.all(
      key
        .split(',')
        .filter((kind) => kind !== '')
        .map(async (kind) => [kind, await bindingChoices(workspaceId, kind as ExternalKind)] as const),
    )
      .then((loaded) => {
        if (current) setChoices(Object.fromEntries(loaded));
      })
      .catch((cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : 'Could not load what is here.');
      });
    return () => {
      current = false;
    };
  }, [workspaceId, key]);

  return (
    <section className={styles.questions}>
      <p className={styles.questionsLead}>
        Some of what this file points at is kept beside a credential, so no export could carry it — the
        file has the name and nothing else. Say which of this workspace's own each name means.
      </p>

      {error !== null && (
        <p className={dialogStyles.error} role="alert">
          {error}
        </p>
      )}

      <ul className={styles.questionList}>
        {questions.map((entry) => {
          const kind = entry.external as ExternalKind;
          const offered = choices[kind];
          return (
            <li className={styles.question} key={entryKey(entry)}>
              <span className={styles.questionHead}>
                <span className={styles.entryKind}>{EXTERNAL_LABEL[kind]}</span>
                <span className={styles.entryName}>{entry.name}</span>
              </span>
              <div className={`${dialogStyles.inputWrapper} ${styles.picker}`}>
                <select
                  className={`${dialogStyles.input} ${dialogStyles.select}`}
                  value={chosenFor(bindings, entry)}
                  aria-label={`Which ${EXTERNAL_LABEL[kind].toLowerCase()} ${entry.name} means here`}
                  disabled={busy || offered === undefined}
                  onChange={(event) => onAnswer(entry, event.target.value)}
                >
                  <option value="">
                    {offered === undefined
                      ? 'Loading…'
                      : offered.length === 0
                        ? 'Nothing here to point it at — make one first'
                        : 'Choose one…'}
                  </option>
                  {(offered ?? []).map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.note === null ? choice.label : `${choice.label} — ${choice.note}`}
                    </option>
                  ))}
                </select>
                <img src={chevronDownIcon} alt="" width={12} height={12} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Which row was chosen for one question, or "" while none has been. */
function chosenFor(bindings: ComponentBinding[], entry: ImportEntry): string {
  return (
    bindings.find((binding) => binding.kind === entry.external && binding.name === entry.name)?.targetId ?? ''
  );
}

/** Unique across a plan: a name can be a component's, an external's and a variable's at once. */
function entryKey(entry: ImportEntry): string {
  return `${entry.kind ?? entry.external ?? 'VARIABLE'}:${entry.name}`;
}

/** "Function", "MCP server", "Variable" — the three things an entry can be about. */
function entryKindLabel(entry: ImportEntry): string {
  if (entry.kind !== null) return KIND_LABEL[entry.kind];
  if (entry.external !== null) return EXTERNAL_LABEL[entry.external];
  return 'Variable';
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
  const [error, setError] = useState<string | null>(null);

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

  const templateId = chosen?.id ?? '';
  const planFor = useCallback(
    (bindings: ComponentBinding[]) => componentTemplatePlan(workspaceId, templateId, bindings),
    [workspaceId, templateId],
  );
  const commit = useCallback(
    (bindings: ComponentBinding[]) => useComponentTemplate(workspaceId, templateId, bindings),
    [workspaceId, templateId],
  );

  return (
    <>
      <button type="button" className={styles.importButton} onClick={open}>
        {label}
      </button>
      <TemplatePicker
        open={picking}
        templates={templates}
        error={picking ? error : null}
        onChoose={(template) => {
          setChosen(template);
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
      <ImportDialog
        open={chosen !== null}
        title={chosen === null ? '' : `Use ${chosen.name}`}
        workspaceId={workspaceId}
        planFor={planFor}
        commit={commit}
        confirmLabel="Use template"
        onClose={() => setChosen(null)}
        onImported={() => {
          setChosen(null);
          onImported();
        }}
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
