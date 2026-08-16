import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import type { ValueType } from '../api/actions';
import { VALUE_TYPES, valueTypeLabel } from '../api/functions';
import type { FunctionParam } from '../api/functions';
import { VARIABLE_TYPE_LABEL, fetchVariables } from '../api/variables';
import type { Variable } from '../api/variables';
import chevronDown12Icon from '../assets/chevron-down-12.svg';
import plusIcon from '../assets/plus.svg';
import styles from './Dialog.module.css';

export interface CreateFunctionDialogProps {
  open: boolean;
  workspaceId: string;
  onClose: () => void;
  onCreated: (
    name: string,
    description: string,
    returnType: ValueType,
    params: FunctionParam[],
    /**
     * The workspace variables this function is handed, in the order it receives
     * them — after the parameters it declares. Choosable here rather than only in
     * the editor: a function that needs a key needs it from the first version, and
     * `createFunction` has always accepted them.
     */
    externalVariableIds: string[],
  ) => Promise<void>;
}

/**
 * What a function needs before there is anything to edit: a name a script can
 * be called by, what it takes and what it gives back. The code itself is the
 * editor's business, and a new function starts from a stub that runs.
 */
export function CreateFunctionDialog({ open, workspaceId, onClose, onCreated }: CreateFunctionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [returnType, setReturnType] = useState<ValueType>('OBJECT');
  const [params, setParams] = useState<FunctionParam[]>([]);
  const [externals, setExternals] = useState<string[]>([]);
  const [variables, setVariables] = useState<Variable[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * What the workspace keeps, so an external can be chosen by name. Fetched when
   * the dialog opens rather than with the page: a list of variables nobody is
   * about to look at is a request nobody needed.
   */
  useEffect(() => {
    if (!open) return;
    fetchVariables(workspaceId, { size: 100 })
      .then((page) => setVariables(page.content))
      .catch(() => setVariables([]));
  }, [open, workspaceId]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    if (open && !dialog.open) {
      setName('');
      setDescription('');
      setReturnType('OBJECT');
      setParams([]);
      setExternals([]);
      setError(null);
      setSubmitting(false);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim() === '' || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      await onCreated(
        name.trim(),
        description.trim(),
        returnType,
        params.filter((param) => param.name.trim() !== ''),
        externals,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the function.');
      setSubmitting(false);
    }
  }

  return (
    <dialog ref={dialogRef} className={styles.dialog} onCancel={onClose} onClose={onClose}>
      <form className={styles.body} onSubmit={handleSubmit}>
        <header className={styles.header}>
          <h2 className={styles.title}>Create Function</h2>
        </header>

        <p className={styles.dialogMessage}>
          JavaScript an action can call. It runs on the server, in a sandbox with no files and no network.
        </p>

        <div className={styles.fields}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="function-name">
              Name
            </label>
            <div className={styles.inputWrapper}>
              <input
                id="function-name"
                className={`${styles.input} ${styles.inputMono}`}
                type="text"
                placeholder="transformPayload"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
                required
              />
            </div>
            <p className={styles.fieldHint}>What the code is called by, so it has to be an identifier.</p>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="function-description">
              Description
            </label>
            <div className={`${styles.inputWrapper} ${styles.inputWrapperTall}`}>
              <textarea
                id="function-description"
                className={`${styles.input} ${styles.textarea}`}
                placeholder="Normalize payload structure before workflow execution."
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          </div>

          <div className={styles.field}>
            <p className={styles.paramHeading}>Parameters</p>
            <div className={styles.mappingList}>
              {params.map((param, index) => (
                <div key={index} className={styles.mappingRow}>
                  <div className={styles.inputWrapper}>
                    <input
                      className={`${styles.input} ${styles.inputMono}`}
                      type="text"
                      placeholder="input"
                      aria-label={`Parameter ${index + 1} name`}
                      value={param.name}
                      onChange={(event) =>
                        setParams((current) =>
                          current.map((row, at) =>
                            at === index ? { ...row, name: event.target.value } : row,
                          ),
                        )
                      }
                    />
                  </div>
                  <div className={styles.inputWrapper}>
                    <select
                      className={`${styles.input} ${styles.select}`}
                      aria-label={`Parameter ${index + 1} type`}
                      value={param.type}
                      onChange={(event) =>
                        setParams((current) =>
                          current.map((row, at) =>
                            at === index ? { ...row, type: event.target.value as ValueType } : row,
                          ),
                        )
                      }
                    >
                      {VALUE_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {valueTypeLabel(type)}
                        </option>
                      ))}
                    </select>
                    <img src={chevronDown12Icon} alt="" width={12} height={12} />
                  </div>
                </div>
              ))}
              <button
                type="button"
                className={styles.addRow}
                onClick={() => setParams((current) => [...current, { name: '', type: 'STRING' }])}
              >
                <img src={plusIcon} alt="" width={14} height={14} />
                Add Parameter
              </button>
            </div>
          </div>

          {/*
            What the workspace hands it, as opposed to what a caller does. Appended
            after the declared parameters, in this order — the same arrangement the
            editor shows, so a function created here and one edited there describe
            themselves the same way.
          */}
          <div className={styles.field}>
            <p className={styles.paramHeading}>External Parameters</p>
            <div className={styles.mappingList}>
              {externals.map((variableId, index) => {
                const held = variables.find((candidate) => candidate.id === variableId);
                return (
                  <div key={`${variableId}-${index}`} className={styles.mappingRow}>
                    <div className={styles.inputWrapper}>
                      <select
                        className={`${styles.input} ${styles.select}`}
                        aria-label={`External parameter ${index + 1}`}
                        value={variableId}
                        onChange={(event) =>
                          setExternals((current) =>
                            current.map((row, at) => (at === index ? event.target.value : row)),
                          )
                        }
                      >
                        {variables.map((variable) => (
                          <option key={variable.id} value={variable.id}>
                            {variable.name} · {variable.catalogName}
                          </option>
                        ))}
                      </select>
                      <img src={chevronDown12Icon} alt="" width={12} height={12} />
                    </div>
                    <div className={styles.externalMeta}>
                      <span className={styles.externalType}>
                        {held === undefined ? '—' : VARIABLE_TYPE_LABEL[held.type]}
                      </span>
                      <button
                        type="button"
                        className={styles.removeRow}
                        aria-label={`Remove external parameter ${index + 1}`}
                        onClick={() => setExternals((current) => current.filter((_, at) => at !== index))}
                      >
                        ×
                      </button>
                    </div>
                  </div>
                );
              })}
              <button
                type="button"
                className={styles.addRow}
                disabled={variables.length === 0}
                title={
                  variables.length === 0
                    ? 'This workspace has no variables yet'
                    : 'Hand this function one of the workspace’s variables'
                }
                onClick={() => {
                  const next = variables.find((variable) => !externals.includes(variable.id));
                  if (next === undefined) return;
                  setExternals((current) => [...current, next.id]);
                }}
              >
                <img src={plusIcon} alt="" width={14} height={14} />
                Add External
              </button>
              <p className={styles.fieldHint}>
                {variables.length === 0
                  ? 'Define a variable first; externals are chosen from what the workspace keeps.'
                  : 'The workspace’s values, handed to this function after its own parameters. Their values are never shown here.'}
              </p>
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="function-return">
              Return Type
            </label>
            <div className={styles.inputWrapper}>
              <select
                id="function-return"
                className={`${styles.input} ${styles.select}`}
                value={returnType}
                onChange={(event) => setReturnType(event.target.value as ValueType)}
              >
                {VALUE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {valueTypeLabel(type)}
                  </option>
                ))}
              </select>
              <img src={chevronDown12Icon} alt="" width={12} height={12} />
            </div>
          </div>
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
          <button type="submit" className={styles.filled} disabled={name.trim() === '' || submitting}>
            {submitting ? 'Creating…' : 'Create Function'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
