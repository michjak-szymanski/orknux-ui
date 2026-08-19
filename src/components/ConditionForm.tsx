import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';

import {
  CHECKS_BY_PROPERTY,
  CHECK_LABEL,
  CONDITION_TYPES,
  CONDITION_TYPE_LABEL,
  NEW_CONDITION,
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
import {
  NEW_FUNCTION,
  NEW_FUNCTION_NAME,
  createFunction,
  fetchWorkspaceFunctions,
  refusingFunction,
  validFunctionName,
} from '../api/functions';
import type { WorkspaceFunction } from '../api/functions';
import chevronDown12Icon from '../assets/chevron-down-12.svg';
/*
 * The dialog that frames this form, for the one case the form frames itself: a
 * combining condition whose member list is asked to make a member.
 *
 * The two modules name each other, which is what a recursive control looks like
 * when the frame and the fields are separate files. It holds because both are
 * hoisted function declarations and neither is called while the other is still
 * evaluating - the nested dialog is rendered from an event, long after both
 * modules have finished loading.
 */
import { ConditionDialog } from './ConditionDialog';
import { DefinitionPicker } from './DefinitionPicker';
import { IconField } from './IconField';

/**
 * The class names the form paints itself with.
 *
 * Handed in rather than imported, for the same reason `TriggerForm` asks for
 * them: this form is shown on two surfaces that are not the same. It is a modal
 * over the conditions it is about to join, a panel beside a workflow graph, and
 * a card on the condition's own page. The fields are identical in all three - so
 * there is one form - and the look belongs to whichever frame is holding it.
 */
export interface ConditionFormStyles {
  /** The form itself: a dialog's field stack, or a settings card. */
  body: string;
  fields: string;
  field: string;
  /** A label with something on its right — the way out to a definition. */
  labelRow: string;
  label: string;
  /** The link out of a field, to what the field is pointing at. */
  jump: string;
  input: string;
  select: string;
  inputWrapper: string;
  inputMono: string;
  fieldHint: string;
  toggleRow: string;
  toggleLabel: string;
  toggle: string;
  toggleOn: string;
  knob: string;
  tags: string;
  tag: string;
  tagRemove: string;
  addValue: string;
  error: string;
  actions: string;
  /** Delete, where the frame keeps it in the form rather than in a danger zone. */
  danger: string;
  ghost: string;
  filled: string;
}

export interface ConditionFormProps {
  workspaceId: string;
  /** Null creates one; a condition edits it. */
  condition?: Condition | null;
  /**
   * What a new condition starts as, when something else decided that for it.
   *
   * The function editor sends somebody here to wrap a function it already knows
   * the id of, and asking them to find it again in a list would be asking them
   * for the one thing they came with. Ignored when editing: a condition that
   * exists says what it is itself.
   */
  preset?: { functionId: string } | null;
  styles: ConditionFormStyles;
  onSaved: (condition: Condition) => void;
  /**
   * Deleting, where the frame wants it among the buttons.
   *
   * A dialog has nowhere else to put it. A page does — its own Danger Zone,
   * outside the form and behind a second click — so the page leaves this out
   * and deletes for itself.
   */
  onDeleted?: () => void;
  /** Left out where the frame already offers a way back, as a page's breadcrumb does. */
  onCancel?: () => void;
}

const PAGE_SIZE = 100;

/*
 * The rows that make a definition instead of choosing one.
 *
 * Held still rather than written into the JSX, because the picker treats a new
 * row object as a new list and puts its cursor back to the top - which, from a
 * form that re-renders on every keystroke, would be a picker nobody can arrow
 * down through.
 */
const NEW_FUNCTION_ROW = { value: NEW_FUNCTION, label: '+ New function' };
const NEW_CONDITION_ROW = { value: NEW_CONDITION, label: '+ New condition' };

/**
 * What a condition asks, and how to change it.
 *
 * What it asks for follows the type: a service condition asks which property
 * and how to check it, a function condition asks which function, and a
 * composite asks which conditions to combine. What the condition will mean is
 * shown underneath, in the words the list will use.
 *
 * Nothing here resets: the state is read from `condition` as it mounts, and the
 * frames mount it fresh — the dialog renders it only while open, the page keys
 * it by which condition is being edited. An effect that put the fields back
 * would be a second answer to the same question, and the two would eventually
 * disagree.
 */
export function ConditionForm({
  workspaceId,
  condition = null,
  preset = null,
  styles,
  onSaved,
  onDeleted,
  onCancel,
}: ConditionFormProps) {
  const [name, setName] = useState(condition?.name ?? '');
  const [type, setType] = useState<ConditionType>(condition?.type ?? (preset === null ? 'SLACK' : 'FUNCTION'));
  const startingProperty = condition?.property ?? 'MESSAGE_AUTHOR';
  const [property, setProperty] = useState<ConditionProperty>(startingProperty);
  // The first check the property offers, so a new condition never opens on one
  // the dropdown does not list.
  const [check, setCheck] = useState<ConditionCheck>(
    condition?.check ?? CHECKS_BY_PROPERTY[startingProperty][0],
  );
  const [negate, setNegate] = useState(condition?.negate ?? false);
  const [functionId, setFunctionId] = useState(condition?.functionId ?? preset?.functionId ?? '');
  /**
   * What to call the function this condition is about to bring into existence.
   *
   * Only read when the picker is on "New function". A condition whose whole job
   * is to ask one question usually needs a function nobody has written yet, and
   * sending somebody to the Functions screen to write it loses the half-filled
   * form they are standing in.
   */
  const [newFunctionName, setNewFunctionName] = useState(NEW_FUNCTION_NAME);
  const [values, setValues] = useState<string[]>(condition?.values ?? []);
  const [members, setMembers] = useState<string[]>(condition?.members ?? []);
  const [draftValue, setDraftValue] = useState('');
  const [icon, setIcon] = useState<string | null>(condition?.icon ?? null);

  const [functions, setFunctions] = useState<WorkspaceFunction[]>([]);
  const [others, setOthers] = useState<Condition[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Whether a Create Condition is open on top of this one.
   *
   * Only ever reached from the member list of a combining condition, where what
   * is being chosen is a condition - so what makes one is this same form. It
   * is rendered only while open, which is what keeps the recursion finite: a
   * closed one renders nothing, so nothing renders another.
   */
  const [makingMember, setMakingMember] = useState(false);

  const editing = condition !== null;
  /*
   * The two ids the catalogues turn on, rather than the objects holding them.
   *
   * The page hands this form a `condition` that is replaced when it saves, and
   * a `preset` it rebuilds per render; depending on the objects would refetch
   * both lists for a condition that has not changed.
   */
  const editingId = condition?.id ?? null;
  const presetFunctionId = preset?.functionId ?? null;

  useEffect(() => {
    if (workspaceId === '') return;

    // Only functions that answer a question can be a condition.
    fetchWorkspaceFunctions(workspaceId, 0, PAGE_SIZE)
      .then((page) => {
        const asking = page.content.filter((fn) => fn.returnType === 'BOOLEAN');
        setFunctions(asking);

        /*
         * Named after the function it was opened for.
         *
         * Somebody arriving from a function to wrap it has already said what
         * this is about, and an empty Name asks them to say it a second time.
         * Only when nothing has been typed: what is in the box is theirs from
         * the moment they touch it, and the functions arrive a moment after the
         * form does.
         */
        if (presetFunctionId === null) return;
        const wrapped = asking.find((fn) => fn.id === presetFunctionId);
        if (wrapped !== undefined) setName((present) => (present === '' ? wrapped.name : present));
      })
      .catch(() => setFunctions([]));

    fetchWorkspaceConditions(workspaceId, 0, PAGE_SIZE)
      .then((page) => setOthers(page.content.filter((other) => other.id !== editingId)))
      .catch(() => setOthers([]));
  }, [workspaceId, editingId, presetFunctionId]);

  const isComposite = composite(type);
  const properties = PROPERTIES_BY_TYPE[type];
  const checks = useMemo(() => (isComposite ? [] : CHECKS_BY_PROPERTY[property]), [isComposite, property]);
  const label = valuesLabel(isComposite || type === 'FUNCTION' ? null : check);

  /*
   * What each picker offers, with a second line saying which one this is.
   *
   * The hint is searched alongside the name, so a function can be found by an
   * argument it takes and a condition by what it asks - which is how somebody
   * who has forgotten the name still knows the one they mean.
   */
  const functionOptions = useMemo(
    () => functions.map((held) => ({ value: held.id, label: held.name, hint: held.signature })),
    [functions],
  );

  const memberOptions = useMemo(
    () =>
      others
        .filter((other) => !members.includes(other.id))
        .map((other) => ({ value: other.id, label: other.name, hint: other.description })),
    [others, members],
  );

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
      else if (functionId === NEW_FUNCTION && !validFunctionName(newFunctionName)) {
        missing.push('Name the new function as a script can call it: a letter, then letters or digits.');
      }
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
  }, [name, isComposite, members, type, functionId, newFunctionName, label, check, values, draftValue]);

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

    try {
      /*
       * Named in the picker, made here, before the condition that points at it.
       *
       * A condition holding the id of something that does not exist is a broken
       * condition, so the function goes in first and the condition gets a real id
       * or nothing at all. What it starts as says no to everything, which is a
       * condition that is simply never met until somebody opens it in the function
       * editor and writes the question.
       *
       * Boolean, because a question is the only thing a condition can ask.
       */
      let chosen = functionId;
      if (type === 'FUNCTION' && functionId === NEW_FUNCTION) {
        const called = newFunctionName.trim();
        const made = await createFunction({
          workspaceId,
          name: called,
          returnType: 'BOOLEAN',
          ...refusingFunction(called),
        });
        chosen = made.id;
      }

      const settings = {
        name: name.trim(),
        type,
        property: isComposite || type === 'FUNCTION' ? null : property,
        check: isComposite || type === 'FUNCTION' ? null : check,
        negate,
        functionId: type === 'FUNCTION' ? chosen : null,
        values: isComposite || type === 'FUNCTION' ? [] : values,
        members: isComposite ? members : [],
        icon,
      };

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
    <>
      <form className={styles.body} onSubmit={handleSubmit}>
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
              {/*
                The way to the function this condition is about (issue #88).

                Beside the picker, which is where every other form on this
                platform draws it - the trigger form puts one on exactly this
                field, and the workflow editor's node panel puts one beside
                each of its pickers.

                A tab of its own, which is the trigger form's answer to the same
                question and, more to the point, the only safe one here: this
                form holds unsaved edits, the function editor it leads to has
                nothing listening for a navigation away, and neither would say
                so before throwing the other's work out. It is also why the
                function editor's own way out to Variables opens a tab.

                Nothing to open while the picker is on a name: the function is
                created when the condition is saved, not before.
              */}
              <span className={styles.labelRow}>
                <label className={styles.label} htmlFor="condition-function">
                  Function
                </label>
                {functionId !== '' && functionId !== NEW_FUNCTION && (
                  <Link
                    className={styles.jump}
                    to={`/workspace/${workspaceId}/functions/${functionId}`}
                    target="_blank"
                    rel="noreferrer"
                    title="Opens the function in a new tab"
                  >
                    Open definition &#8599;
                  </Link>
                )}
              </span>
              {/* The way to make one sits above the list and outlasts the search:
                  a workspace's functions fill a hundred rows, and typing a name
                  that matches none of them is exactly when it is wanted. */}
              <DefinitionPicker
                id="condition-function"
                value={functionId}
                options={functionOptions}
                onChoose={setFunctionId}
                placeholder="Select function…"
                searchPlaceholder="Search functions…"
                create={NEW_FUNCTION_ROW}
              />
              {functionId === NEW_FUNCTION ? (
                <>
                  <div className={styles.inputWrapper}>
                    <input
                      id="condition-new-function"
                      className={`${styles.input} ${styles.inputMono}`}
                      type="text"
                      aria-label="New function name"
                      placeholder={NEW_FUNCTION_NAME}
                      value={newFunctionName}
                      // Selected on focus, as the function editor does it: the box
                      // arrives with a name in it, so typing over it is one gesture.
                      onFocus={(event) => event.target.select()}
                      onChange={(event) => setNewFunctionName(event.target.value)}
                    />
                  </div>
                  <p className={styles.fieldHint}>
                    Created with this condition, saying no to everything. Open it in Functions to write
                    the question it should be asking.
                  </p>
                </>
              ) : (
                <p className={styles.fieldHint}>
                  Only functions that return a boolean can answer a condition. It is handed what the run is
                  carrying.
                </p>
              )}
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
              {/*
                Held at nothing on purpose: this picks a member and hands it to
                the list above, so what it says afterwards is the invitation to
                add another rather than the one just added.
              */}
              <DefinitionPicker
                id="condition-members"
                value=""
                options={memberOptions}
                onChoose={(picked) => {
                  if (picked === NEW_CONDITION) setMakingMember(true);
                  else setMembers((current) => [...current, picked]);
                }}
                placeholder="+ Add Condition"
                searchPlaceholder="Search conditions…"
                ariaLabel="Add a condition"
                create={NEW_CONDITION_ROW}
              />
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
          {editing && onDeleted !== undefined && (
            <button type="button" className={styles.danger} onClick={handleDelete} disabled={submitting}>
              Delete
            </button>
          )}
          {onCancel !== undefined && (
            <button type="button" className={styles.ghost} onClick={onCancel} disabled={submitting}>
              Cancel
            </button>
          )}
          <button type="submit" className={styles.filled} disabled={!complete || submitting}>
            {submitting ? 'Saving…' : editing ? 'Save Changes' : 'Create Condition'}
          </button>
        </div>
      </form>

      {/*
        Beside the form rather than inside it. A form nested in a form is not
        something a browser will keep apart: the inner dialog's submit would
        bubble into this one's handler and save the condition being filled in.
      */}
      {makingMember && (
        <ConditionDialog
          open
          workspaceId={workspaceId}
          condition={null}
          onClose={() => setMakingMember(false)}
          onSaved={(made) => {
            // Into this form's own list as well as into the members, because
            // nothing is going to fetch the conditions again while it stays open.
            setOthers((current) => [...current, made]);
            setMembers((current) => [...current, made.id]);
            setMakingMember(false);
          }}
        />
      )}
    </>
  );
}
