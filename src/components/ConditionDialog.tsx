import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import {
  CHECKS_BY_PROPERTY,
  CHECK_LABEL,
  CONDITION_TYPES,
  CONDITION_TYPE_LABEL,
  PROPERTIES_BY_TYPE,
  PROPERTY_LABEL,
  composite,
  createCondition,
  deleteCondition,
  fetchWorkspaceConditions,
  updateCondition,
  valuesLabel,
} from '../api/conditions';
import type { Condition, ConditionCheck, ConditionProperty, ConditionType } from '../api/conditions';
import { fetchWorkspaceFunctions } from '../api/functions';
import type { WorkspaceFunction } from '../api/functions';
import chevronDown12Icon from '../assets/chevron-down-12.svg';
import { IconField } from './IconField';
import styles from './Dialog.module.css';

export interface ConditionDialogProps {
  open: boolean;
  workspaceId: string;
  /** Null creates one; a condition edits it. */
  condition: Condition | null;
  /**
   * What a new condition starts as, when something else decided that for it.
   *
   * The function editor sends somebody here to wrap a function it already knows
   * the id of, and asking them to find it again in a list would be asking them
   * for the one thing they came with. Ignored when editing: a condition that
   * exists says what it is itself.
   */
  preset?: { functionId: string } | null;
  onClose: () => void;
  onSaved: (condition: Condition) => void;
  onDeleted?: () => void;
}

const PAGE_SIZE = 100;

/**
 * Create Condition, and the same form for editing one.
 *
 * What it asks for follows the type: a service condition asks which property
 * and how to check it, a function condition asks which function, and a
 * composite asks which conditions to combine. What the condition will mean is
 * shown underneath, in the words the list will use.
 */
export function ConditionDialog({
  open,
  workspaceId,
  condition,
  preset = null,
  onClose,
  onSaved,
  onDeleted,
}: ConditionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [name, setName] = useState('');
  const [type, setType] = useState<ConditionType>('SLACK');
  const [property, setProperty] = useState<ConditionProperty>('MESSAGE_AUTHOR');
  const [check, setCheck] = useState<ConditionCheck>(CHECKS_BY_PROPERTY.MESSAGE_AUTHOR[0]);
  const [negate, setNegate] = useState(false);
  const [functionId, setFunctionId] = useState('');
  const [values, setValues] = useState<string[]>([]);
  const [members, setMembers] = useState<string[]>([]);
  const [draftValue, setDraftValue] = useState('');
  const [icon, setIcon] = useState<string | null>(null);

  const [functions, setFunctions] = useState<WorkspaceFunction[]>([]);
  const [others, setOthers] = useState<Condition[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editing = condition !== null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    if (open && !dialog.open) {
      setName(condition?.name ?? '');
      setType(condition?.type ?? (preset === null ? 'SLACK' : 'FUNCTION'));
      const startingProperty = condition?.property ?? 'MESSAGE_AUTHOR';
      setProperty(startingProperty);
      // The first check the property offers, so a new condition never opens on
      // one the dropdown does not list.
      setCheck(condition?.check ?? CHECKS_BY_PROPERTY[startingProperty][0]);
      setNegate(condition?.negate ?? false);
      setFunctionId(condition?.functionId ?? preset?.functionId ?? '');
      setValues(condition?.values ?? []);
      setMembers(condition?.members ?? []);
      setIcon(condition?.icon ?? null);
      setDraftValue('');
      setError(null);
      setSubmitting(false);
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, condition, preset]);

  useEffect(() => {
    if (!open || workspaceId === '') return;

    // Only functions that answer a question can be a condition.
    fetchWorkspaceFunctions(workspaceId, 0, PAGE_SIZE)
      .then((page) => setFunctions(page.content.filter((fn) => fn.returnType === 'BOOLEAN')))
      .catch(() => setFunctions([]));

    fetchWorkspaceConditions(workspaceId, 0, PAGE_SIZE)
      .then((page) => setOthers(page.content.filter((other) => other.id !== condition?.id)))
      .catch(() => setOthers([]));
  }, [open, workspaceId, condition]);

  const isComposite = composite(type);
  const properties = PROPERTIES_BY_TYPE[type];
  const checks = useMemo(() => (isComposite ? [] : CHECKS_BY_PROPERTY[property]), [isComposite, property]);
  const label = valuesLabel(isComposite || type === 'FUNCTION' ? null : check);

  function changeType(next: ConditionType) {
    setType(next);
    const first = PROPERTIES_BY_TYPE[next][0];
    if (first !== undefined) {
      setProperty(first);
      setCheck(CHECKS_BY_PROPERTY[first][0]);
    }
  }

  function changeProperty(next: ConditionProperty) {
    setProperty(next);
    setCheck(CHECKS_BY_PROPERTY[next][0]);
  }

  /**
   * What is still missing, in words.
   *
   * A disabled button with a form that looks filled in is a puzzle: the reason
   * is known here and nowhere else, so it says it rather than going quiet. The
   * value list is the usual culprit — a value typed but not added is not in the
   * list, and the box it is sitting in looks exactly like a filled-in field.
   */
  const blockers = useMemo(() => {
    const missing: string[] = [];

    if (name.trim() === '') missing.push('Give the condition a name.');

    if (isComposite) {
      if (members.length < 2) {
        missing.push(
          `Combining needs at least two conditions; ${members.length === 0 ? 'none are' : 'only one is'} selected.`,
        );
      }
    } else if (type === 'FUNCTION') {
      if (functionId === '') missing.push('Choose the function to call.');
    } else if (label !== null) {
      const needed = check === 'BETWEEN' ? 2 : 1;
      if (values.length < needed) {
        missing.push(
          draftValue.trim() === ''
            ? `This check compares against ${needed === 2 ? 'two values' : 'a value'}; add ${needed === 2 ? 'them' : 'one'} to the list.`
            : `“${draftValue.trim()}” has been typed but not added — press Add to put it in the list.`,
        );
      }
    }

    return missing;
  }, [name, isComposite, members, type, functionId, label, check, values, draftValue]);

  const complete = blockers.length === 0;

  function addValue() {
    const value = draftValue.trim();
    if (value === '') return;
    setValues((current) => [...current, value]);
    setDraftValue('');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    // Pressed while something is missing: say which thing, rather than doing
    // nothing and leaving the button looking broken.
    if (!complete) {
      setError(blockers.join(' '));
      return;
    }

    setSubmitting(true);
    setError(null);
    const settings = {
      name: name.trim(),
      type,
      property: isComposite || type === 'FUNCTION' ? null : property,
      check: isComposite || type === 'FUNCTION' ? null : check,
      negate,
      functionId: type === 'FUNCTION' ? functionId : null,
      values: isComposite || type === 'FUNCTION' ? [] : values,
      members: isComposite ? members : [],
      icon,
    };

    try {
      const saved = editing
        ? await updateCondition(condition.id, settings)
        : await createCondition({ workspaceId, ...settings });
      onSaved(saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the condition.');
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (condition === null) return;
    setSubmitting(true);
    try {
      await deleteCondition(condition.id);
      onDeleted?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete the condition.');
      setSubmitting(false);
    }
  }

  return (
    <dialog ref={dialogRef} className={styles.dialog} onCancel={onClose} onClose={onClose}>
      <form className={styles.body} onSubmit={handleSubmit}>
        <header className={styles.header}>
          <h2 className={styles.title}>{editing ? 'Condition Settings' : 'Create Condition'}</h2>
        </header>

        <p className={styles.dialogMessage}>Define a reusable condition for workflow branching.</p>

        <div className={styles.fields}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="condition-name">
              Condition Name
            </label>
            <div className={styles.inputWrapper}>
              <input
                id="condition-name"
                className={styles.input}
                type="text"
                placeholder="e.g. Is Workspacemate Message"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
                required
              />
            </div>
          </div>

          <IconField
            value={icon}
            onChange={setIcon}
            hint="Nodes drawn from this condition start with it; each node can change its own."
          />

          <div className={styles.field}>
            <label className={styles.label} htmlFor="condition-type">
              Type
            </label>
            <div className={styles.inputWrapper}>
              <select
                id="condition-type"
                className={`${styles.input} ${styles.select}`}
                value={type}
                onChange={(event) => changeType(event.target.value as ConditionType)}
              >
                {/* A type no longer offered still belongs to the condition that has it. */}
                {(CONDITION_TYPES.includes(type) ? CONDITION_TYPES : [type, ...CONDITION_TYPES]).map(
                  (candidate) => (
                    <option key={candidate} value={candidate}>
                      {CONDITION_TYPE_LABEL[candidate]}
                    </option>
                  ),
                )}
              </select>
              <img src={chevronDown12Icon} alt="" width={12} height={12} />
            </div>
          </div>

          {!isComposite && type !== 'FUNCTION' && (
            <>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="condition-property">
                  Property
                </label>
                <div className={styles.inputWrapper}>
                  <select
                    id="condition-property"
                    className={`${styles.input} ${styles.select}`}
                    value={property}
                    onChange={(event) => changeProperty(event.target.value as ConditionProperty)}
                  >
                    {properties.map((candidate) => (
                      <option key={candidate} value={candidate}>
                        {PROPERTY_LABEL[candidate]}
                      </option>
                    ))}
                  </select>
                  <img src={chevronDown12Icon} alt="" width={12} height={12} />
                </div>
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="condition-check">
                  Check
                </label>
                <div className={styles.inputWrapper}>
                  <select
                    id="condition-check"
                    className={`${styles.input} ${styles.select}`}
                    value={check}
                    onChange={(event) => setCheck(event.target.value as ConditionCheck)}
                  >
                    {checks.map((candidate) => (
                      <option key={candidate} value={candidate}>
                        {CHECK_LABEL[candidate]}
                      </option>
                    ))}
                  </select>
                  <img src={chevronDown12Icon} alt="" width={12} height={12} />
                </div>
              </div>
            </>
          )}

          {type === 'FUNCTION' && (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="condition-function">
                Function
              </label>
              <div className={styles.inputWrapper}>
                <select
                  id="condition-function"
                  className={`${styles.input} ${styles.select}`}
                  value={functionId}
                  onChange={(event) => setFunctionId(event.target.value)}
                  required
                >
                  <option value="" disabled>
                    Select function...
                  </option>
                  {functions.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
                </select>
                <img src={chevronDown12Icon} alt="" width={12} height={12} />
              </div>
              <p className={styles.fieldHint}>
                Only functions that return a boolean can answer a condition. It is handed what the run is
                carrying.
              </p>
            </div>
          )}

          <div className={styles.field}>
            <label className={styles.label} htmlFor="condition-negate">
              Negate
            </label>
            <div className={styles.toggleRow}>
              <span className={styles.toggleLabel}>Negate</span>
              <button
                type="button"
                id="condition-negate"
                className={negate ? `${styles.toggle} ${styles.toggleOn}` : styles.toggle}
                onClick={() => setNegate((current) => !current)}
                role="switch"
                aria-checked={negate}
              >
                <span className={styles.knob} />
              </button>
            </div>
          </div>

          {label !== null && (
            <div className={styles.field}>
              <p className={styles.label}>{label}</p>
              <div className={styles.tags}>
                {values.map((value, index) => (
                  <span key={`${value}-${index}`} className={styles.tag}>
                    {value}
                    <button
                      type="button"
                      className={styles.tagRemove}
                      aria-label={`Remove ${value}`}
                      onClick={() => setValues((current) => current.filter((_, at) => at !== index))}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {values.length === 0 && <span className={styles.fieldHint}>Nothing yet.</span>}
              </div>
              <div className={styles.inputWrapper}>
                <input
                  className={styles.input}
                  type="text"
                  placeholder={check === 'BETWEEN' ? '09:00' : 'Add a value…'}
                  value={draftValue}
                  onChange={(event) => setDraftValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addValue();
                    }
                  }}
                />
              </div>
              <button type="button" className={styles.addValue} onClick={addValue}>
                + Add Value
              </button>
            </div>
          )}

          {isComposite && (
            <div className={styles.field}>
              <p className={styles.label}>Conditions</p>
              <div className={styles.tags}>
                {members.map((member) => (
                  <span key={member} className={styles.tag}>
                    {others.find((other) => other.id === member)?.name ?? member}
                    <button
                      type="button"
                      className={styles.tagRemove}
                      aria-label="Remove condition"
                      onClick={() => setMembers((current) => current.filter((id) => id !== member))}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {members.length === 0 && <span className={styles.fieldHint}>Nothing yet.</span>}
              </div>
              <div className={styles.inputWrapper}>
                <select
                  className={`${styles.input} ${styles.select}`}
                  value=""
                  aria-label="Add a condition"
                  onChange={(event) => {
                    const id = event.target.value;
                    if (id !== '') setMembers((current) => [...current, id]);
                  }}
                >
                  <option value="">+ Add Condition</option>
                  {others
                    .filter((other) => !members.includes(other.id))
                    .map((other) => (
                      <option key={other.id} value={other.id}>
                        {other.name}
                      </option>
                    ))}
                </select>
                <img src={chevronDown12Icon} alt="" width={12} height={12} />
              </div>
            </div>
          )}

          {editing && <p className={styles.fieldHint}>{condition.description}</p>}
        </div>

        {error !== null && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}

        <div className={styles.actions}>
          {editing && (
            <button type="button" className={styles.danger} onClick={handleDelete} disabled={submitting}>
              Delete
            </button>
          )}
          <button type="button" className={styles.ghost} onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" className={styles.filled} disabled={!complete || submitting}>
            {submitting ? 'Saving…' : editing ? 'Save Changes' : 'Create Condition'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
