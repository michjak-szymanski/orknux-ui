import { useEffect, useRef, useState } from 'react';

import { argumentJson, runFunction, valueTypeLabel } from '../api/functions';
import type { FunctionParam, FunctionRun } from '../api/functions';
import type { VariableType } from '../api/variables';
import chevronDown12Icon from '../assets/chevron-down-12.svg';
import { FieldHint } from './FieldHint';
import styles from './Dialog.module.css';
/*
 * The verdict and the answer keep the look they were given in the panel, and
 * their class names with it: this is the same result, said in a window instead
 * of a column, and a second stylesheet describing it would be a second look to
 * keep in step.
 */
import runStyles from '../pages/workspace/FunctionEditorPage.module.css';
import { t } from '../i18n';

export interface TestRunDialogProps {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  /** Empty while the function is being written, which is what `creating` means. */
  functionId: string;
  /** The parameters it declares, already filtered to the named ones. */
  params: FunctionParam[];
  /**
   * The workspace's variables it is handed, by name and type.
   *
   * Offered as fields, blank, each meaning "what the workspace holds". See the
   * note on the window itself for why this reversed an earlier decision.
   */
  handed: { name: string; type: VariableType }[];
  /** Whether the column has moved on from what is stored. */
  unsaved: boolean;
  /** True on `/functions/new`: there is nothing stored to run yet. */
  creating: boolean;
}

/**
 * Running a function, in a window opened from the mark in the corner.
 *
 * Issue #266, twice. The first answer was a section in the editor's side panel,
 * and it was the seventh of nine - 1,364px down a thousand-pixel column, which
 * is a feature nobody found. Moving it second was a stopgap and moving it here
 * is the answer: a run mark where the page's other actions are, and a window
 * with room for the fields and for what came back.
 *
 * What was already right about it is carried across whole:
 *
 * **Every field is a parameter with a type, offered as that type**, rather than
 * one JSON box. A number field is where somebody types a number, and asking
 * them to remember that a string needs quotes is asking them to do the editor's
 * job. The shapes that have no spelling as a plain word - map, array, an object
 * - are the exception and are typed as JSON, because that is what they are.
 *
 * **The externals are here, blank, and each one left blank is the workspace's
 * own value.** This reverses what it said first, which was that a grant belongs
 * to the function and a field for one would let a test be given a value the real
 * run would never see. That is true and it was not the whole picture: the
 * commonest thing anybody writes here is a check against a secret, the secret is
 * one nobody may read back, and a window that could only ever run it against the
 * stored value could not test the failing half at all - nor could it test
 * anything on a workspace where the variable has not been set yet. The person
 * doing it has the function's source open in the next column; withholding the
 * input to it was protecting nothing.
 *
 * What that costs is answered where it lands rather than by refusing: nothing
 * but this window can pass one - a node, a trigger and a workflow have no such
 * field - and the workspace's audit names the ones given by hand, so a run that
 * behaved differently from the real one cannot be read later as the real one.
 *
 * **It runs what is stored, not what is in the column.** The server is handed
 * an id and arguments and no source, so what runs is the saved function, in the
 * sandbox a workflow runs it in, with the workspace's variables it is granted
 * resolved the same way. This says so, and says so again when there is unsaved
 * work - otherwise a run that disagreed with the code on screen would read as
 * the run being wrong rather than as the code not having been saved. Every run
 * is recorded in the workspace's audit, because it leaves no run of its own.
 *
 * **A function nobody has saved yet says so here rather than being refused by a
 * mark that will not press.** The mark is drawn from the first moment, because
 * a control that appears only after the first save is a control somebody
 * writing their first function never learns exists - and the one place with
 * room to explain why it cannot run yet is this window, not a tooltip on a
 * button that browsers will not always show.
 */
export function TestRunDialog({
  open,
  onClose,
  workspaceId,
  functionId,
  params,
  handed,
  unsaved,
  creating,
}: TestRunDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  /** What each parameter is being handed, as typed. Keyed by the parameter's name. */
  const [values, setValues] = useState<Record<string, string>>({});
  /**
   * What a grant is being given instead, as typed. Keyed by the variable's name.
   *
   * Kept apart from [values] rather than in one map, because a parameter and a
   * variable can share a name and the two go to the server as different fields.
   * Blank means the workspace's own value and is not sent at all.
   */
  const [instead, setInstead] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [ran, setRan] = useState<FunctionRun | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const held = dialogRef.current;
    if (held === null) return;
    if (open && !held.open) {
      held.showModal();
      /*
       * Into the first field, by hand.
       *
       * `showModal` puts the focus on the first focusable thing it finds, and
       * here that is the (?) beside the heading - which opens on focus, so the
       * window arrived with its own explanation hanging over the fields it was
       * opened to fill in. React's `autoFocus` does not help: it fires when the
       * element mounts, which is long before the window is shown.
       */
      const first = held.querySelector('input, select, textarea') ?? held.querySelector('[data-close]');
      if (first instanceof HTMLElement) first.focus();
    }
    if (!open && held.open) held.close();
  }, [open]);

  /*
   * What was typed survives the window being shut and opened again, because
   * running the same function twice with the same arguments is most of what
   * anybody does with this - but the *answer* does not, since an answer left
   * over from before reads as this run's until somebody notices the timing.
   */
  useEffect(() => {
    if (!open) {
      setRan(null);
      setFailed(null);
    }
  }, [open]);

  async function handleRun() {
    if (running || creating || functionId === '') return;
    setRunning(true);
    setRan(null);
    setFailed(null);
    try {
      const answer = await runFunction({
        workspaceId,
        functionId,
        arguments: params.map((param) => ({
          name: param.name,
          json: argumentJson(param.type, values[param.name] ?? ''),
        })),
        /*
         * Only the ones somebody actually typed into. A blank field is not "give
         * it nothing" - it is "give it what the workspace holds", which is what
         * leaving the name out of this list means to the server.
         */
        externals: handed
          .filter((one) => (instead[one.name] ?? '').trim() !== '')
          .map((one) => ({ name: one.name, json: argumentJson(one.type, instead[one.name] ?? '') })),
      });
      setRan(answer);
    } catch (cause) {
      setFailed(cause instanceof Error ? cause.message : t('It could not be run.'));
    } finally {
      setRunning(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={`${styles.dialog} ${styles.dialogWide}`}
      data-check="test-run"
      onCancel={onClose}
      onClose={onClose}
    >
      <div className={styles.body}>
        <header className={styles.header}>
          <span className={styles.labelWithHint}>
            <h2 className={styles.title}>{t('Test Run')}</h2>
            <FieldHint label={t('Test Run')}>
              Runs the saved function the way an action node would: the same sandbox, the same imports
              and libraries, and the workspace’s variables resolved the same way. It runs what is stored
              rather than what is in the column, so save first to try a change — and every run is
              recorded in this workspace’s audit, because it leaves no run of its own behind it.
            </FieldHint>
          </span>
        </header>

        {creating ? (
          <p className={styles.dialogMessage}>{t('Save this function first — a run is of what is stored.')}</p>
        ) : (
          <>
            {/*
              A function that is handed nothing at all says so.

              The window is a column of fields, and with nothing to draw it was
              a heading, a gap and two buttons - which reads as something that
              failed to load rather than as a function that needs nothing.
            */}
            {params.length === 0 && handed.length === 0 && (
              <p className={styles.dialogMessage}>{t('This function takes no parameters.')}</p>
            )}
            <div className={styles.fields}>
              {params.map((param) => (
                <div key={param.name} className={styles.field}>
                  <label className={styles.label} htmlFor={`run-arg-${param.name}`}>
                    {param.name} · {valueTypeLabel(param.type)}
                  </label>
                  {param.type === 'BOOLEAN' ? (
                    <div className={styles.inputWrapper}>
                      <select
                        id={`run-arg-${param.name}`}
                        className={`${styles.select} ${styles.inputMono}`}
                        value={values[param.name] ?? ''}
                        aria-label={`Argument ${param.name}`}
                        onChange={(event) =>
                          setValues((current) => ({ ...current, [param.name]: event.target.value }))
                        }
                      >
                        {/* Blank is a real answer: it is the `null` an unmapped node passes. */}
                        <option value="">nothing</option>
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                      <img src={chevronDown12Icon} alt="" width={12} height={12} />
                    </div>
                  ) : param.type === 'STRING' || param.type === 'NUMBER' ? (
                    <div className={styles.inputWrapper}>
                      <input
                        id={`run-arg-${param.name}`}
                        className={`${styles.input} ${styles.inputMono}`}
                        type={param.type === 'NUMBER' ? 'number' : 'text'}
                        value={values[param.name] ?? ''}
                        aria-label={`Argument ${param.name}`}
                        onChange={(event) =>
                          setValues((current) => ({ ...current, [param.name]: event.target.value }))
                        }
                      />
                    </div>
                  ) : (
                    <div className={styles.inputWrapperTall}>
                      <textarea
                        id={`run-arg-${param.name}`}
                        className={`${styles.textarea} ${styles.inputMono}`}
                        value={values[param.name] ?? ''}
                        placeholder={param.type === 'ARRAY' ? '[]' : '{}'}
                        aria-label={`Argument ${param.name}`}
                        onChange={(event) =>
                          setValues((current) => ({ ...current, [param.name]: event.target.value }))
                        }
                      />
                    </div>
                  )}
                </div>
              ))}

              {/*
                And the grants, under the parameters and after them, which is
                the order the sandbox receives them in.

                Each is blank and each blank one means the workspace's value, so
                the window opens ready to run the function exactly as a node
                would - typing into one is a deliberate act, not the default.
                The placeholder says which it is; the label says it is a grant
                rather than a parameter, because on a function like
                `checkJiraSignature` the difference decides what the test proves.
              */}
              {handed.map((one) => (
                <div key={`external-${one.name}`} className={styles.field}>
                  <label className={styles.label} htmlFor={`run-external-${one.name}`}>
                    {one.name} · {valueTypeLabel(one.type)} · {t('from the workspace')}
                  </label>
                  {one.type === 'BOOLEAN' ? (
                    <div className={styles.inputWrapper}>
                      <select
                        id={`run-external-${one.name}`}
                        className={`${styles.select} ${styles.inputMono}`}
                        value={instead[one.name] ?? ''}
                        aria-label={`Instead of ${one.name}`}
                        onChange={(event) =>
                          setInstead((current) => ({ ...current, [one.name]: event.target.value }))
                        }
                      >
                        <option value="">{t('the stored value')}</option>
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                      <img src={chevronDown12Icon} alt="" width={12} height={12} />
                    </div>
                  ) : (
                    <div className={styles.inputWrapper}>
                      <input
                        id={`run-external-${one.name}`}
                        className={`${styles.input} ${styles.inputMono}`}
                        type={one.type === 'NUMBER' ? 'number' : 'text'}
                        value={instead[one.name] ?? ''}
                        placeholder={t('the stored value')}
                        aria-label={`Instead of ${one.name}`}
                        onChange={(event) =>
                          setInstead((current) => ({ ...current, [one.name]: event.target.value }))
                        }
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* One line, and only when it is true: the column has moved on. */}
            {unsaved && <p className={styles.fieldHint}>This runs the saved function, not the column.</p>}

            {failed !== null && (
              <p className={styles.error} role="alert">
                {failed}
              </p>
            )}

            {ran !== null && (
              <div className={runStyles.runResult}>
                <p className={ran.ok ? runStyles.runVerdict : runStyles.runVerdictBad} role="status">
                  {ran.ok ? 'Returned' : 'Failed'} in {ran.durationMillis} ms
                </p>
                {/*
                  What came back, whichever it was. A failure prints its reason
                  here rather than in a toast, because it is the answer to the
                  question the button asked - and it is worded exactly as the run
                  history would have worded it.
                */}
                <pre className={runStyles.runAnswer}>
                  {ran.ok ? (ran.returned ?? t('It returned nothing.')) : ran.error}
                </pre>
                {!ran.ok && !ran.settled && (
                  <p className={styles.fieldHint}>It was stopped rather than refused; running it again may answer.</p>
                )}
                {ran.grants.length > 0 && (
                  <p className={styles.fieldHint}>Handed {ran.grants.join(', ')} from the workspace.</p>
                )}
              </div>
            )}
          </>
        )}

        <div className={styles.actions}>
          <button type="button" className={styles.ghost} data-close onClick={onClose}>
            {t('Close')}
          </button>
          {!creating && (
            <button type="button" className={styles.filled} onClick={() => void handleRun()} disabled={running}>
              {running ? t('Running…') : t('Run')}
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
