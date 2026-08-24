import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import {
  FIELD_DESCRIPTION_LIMIT,
  deleteObject,
  fetchObject,
  fetchWorkspaceObjects,
  updateObject,
  validateObject,
} from '../../api/objects';
import type { ObjectPropertyInput, PropertyKind, WorkflowObject } from '../../api/objects';
import type { SessionUser } from '../../api/session';
import { timeAgo } from '../../api/tools';
import fileTextIcon from '../../assets/file-text.svg';
import { AppShell } from '../../components/AppShell';
import { BackLink } from '../../components/BackLink';
import { DefinitionPicker } from '../../components/DefinitionPicker';
import type { DefinitionOption } from '../../components/DefinitionPicker';
import { Loader } from '../../components/Loader';
import { TrashIcon } from '../../components/TrashIcon';
import { UnsavedWorkDialog } from '../../components/UnsavedWorkDialog';
import { UsedBy } from '../../components/UsedBy';
import { ValidationStatus } from '../../components/ValidationStatus';
import type { Validation } from '../../components/ValidationStatus';
import { useLeaveGuard } from '../../components/leaveGuard';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './EditorPage.module.css';

export interface ObjectEditorPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/** Every object in the workspace fits the type picker. */
const ALL_OBJECTS = 200;

/**
 * One row of the editor, before it is a property.
 *
 * What it holds and how many of them are two answers rather than one. They used
 * to be a single picker value - `ARRAY:OBJECT:12` beside `OBJECT:12` - which
 * made every type appear twice in the list and made "a list of these" something
 * you found by scrolling rather than something you said.
 */
interface Row {
  name: string;
  /** `STRING`, `NUMBER`, `BOOLEAN` or `OBJECT:12`. What one of it is. */
  type: string;
  /** One of that type, or a list of them. */
  many: boolean;
  /** What the field means, for whoever - or whatever - reads it. */
  description: string;
}

/** What the two controls mean together, unpacked for the server. */
function asProperty(row: Row): ObjectPropertyInput {
  const [kind, refObjectId] = row.type.split(':');
  const description = row.description.trim();
  const said = description === '' ? null : description;

  if (row.many) {
    return kind === 'OBJECT'
      ? { name: row.name, kind: 'ARRAY', refObjectId, description: said }
      : { name: row.name, kind: 'ARRAY', elementKind: kind as PropertyKind, description: said };
  }
  if (kind === 'OBJECT') return { name: row.name, kind: 'OBJECT', refObjectId, description: said };
  return { name: row.name, kind: kind as PropertyKind, description: said };
}

/**
 * And back again, so a saved object reopens on what it was saved with.
 *
 * An array saved before this existed comes back as its element type with Many
 * chosen, which is the same property said the new way - nothing is migrated and
 * nothing is lost, because the two halves were always in the row anyway.
 */
function asRow(property: WorkflowObject['properties'][number]): Row {
  const description = property.description ?? '';
  if (property.kind === 'ARRAY') {
    return {
      name: property.name,
      type: property.refObjectId !== null ? `OBJECT:${property.refObjectId}` : `${property.elementKind}`,
      many: true,
      description,
    };
  }
  if (property.kind === 'OBJECT') {
    return { name: property.name, type: `OBJECT:${property.refObjectId}`, many: false, description };
  }
  return { name: property.name, type: property.kind, many: false, description };
}

/**
 * One object: its properties on the left, what it is on the right.
 *
 * The properties are a table rather than text because they are a list of pairs,
 * and every one of them has to resolve — a type nobody can look up is the thing
 * this screen exists to prevent.
 */
export function ObjectEditorPage({ session, onSignOut }: ObjectEditorPageProps) {
  const { workspaceId = '', objectId = '' } = useParams();
  const navigate = useNavigate();

  const [held, setHeld] = useState<WorkflowObject | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  /** Everything nameable, so a property can point at another shape. */
  const [others, setOthers] = useState<WorkflowObject[]>([]);
  const [status, setStatus] = useState<Validation | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [removing, setRemoving] = useState(false);

  function apply(loaded: WorkflowObject) {
    setHeld(loaded);
    setName(loaded.name);
    setDescription(loaded.description ?? '');
    setRows(loaded.properties.map(asRow));
    setSaved(true);
    setStatus(null);
  }

  useEffect(() => {
    if (objectId === '') return;
    fetchObject(objectId)
      .then((loaded) => {
        if (loaded === null) setLoadError('That object does not exist, or you do not have access to it.');
        else apply(loaded);
      })
      .catch((cause: unknown) => {
        setLoadError(cause instanceof Error ? cause.message : 'Could not load the object.');
      });
  }, [objectId]);

  useEffect(() => {
    if (workspaceId === '') return;
    fetchWorkspaceObjects(workspaceId, 0, ALL_OBJECTS)
      .then((page) => setOthers(page.content))
      .catch(() => setOthers([]));
  }, [workspaceId]);

  /**
   * What a field can be one of.
   *
   * The scalars first, because that is what most fields are, and then every
   * shape the workspace has named - an object included in its own list, which is
   * how a tree is described. Each object carries its own description as the
   * second line, so choosing between two similar names does not mean opening
   * both of them.
   */
  const typeOptions = useMemo<DefinitionOption[]>(
    () => [
      { value: 'STRING', label: 'string' },
      { value: 'NUMBER', label: 'number' },
      { value: 'BOOLEAN', label: 'boolean' },
      ...others.map((other) => ({
        value: `OBJECT:${other.id}`,
        label: other.name,
        hint: other.description ?? `${other.propertyCount} ${other.propertyCount === 1 ? 'field' : 'fields'}`,
      })),
    ],
    [others],
  );

  function edit(index: number, change: Partial<Row>) {
    setRows((current) => current.map((row, at) => (at === index ? { ...row, ...change } : row)));
    setSaved(false);
    // The rows the last check looked at are gone, and so is what it found.
    setStatus(null);
  }

  async function handleValidate() {
    try {
      const checked = await validateObject(workspaceId, rows.map(asProperty));
      setStatus(
        checked.valid
          ? { ok: true, message: "every property's type resolves" }
          : { ok: false, message: checked.message },
      );
    } catch (cause) {
      setStatus({ ok: false, message: cause instanceof Error ? cause.message : 'Could not check the schema.', whole: true });
    }
  }

  /**
   * Stores what is on screen, and says whether it landed.
   *
   * The answer is for `Save & Leave` in the dialog below: leaving on a save the
   * server refused - a property naming a type it cannot resolve, a row with no
   * name - is exactly the loss the whole guard exists to prevent.
   */
  async function handleSave(): Promise<boolean> {
    if (held === null || saving) return false;
    setSaving(true);
    setSaveError(null);
    try {
      apply(
        await updateObject(held.id, {
          name,
          description,
          properties: rows.map(asProperty),
        }),
      );
      // A save the server accepted has already been through the rules Validate
      // asks for - it resolves every reference on the way in and refuses the
      // rest - so this green stands on a round trip rather than on hope.
      setStatus({ ok: true, message: "every property's type resolves" });
      return true;
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Could not save the object.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  /**
   * There is work on this screen the server has not been told about.
   *
   * Measured against what was loaded, not against whether anybody has typed.
   * The page keeps a `saved` flag as well - it is what lights the inline
   * "Saved." - but a flag can only ever say that a key was pressed. Somebody
   * who types a character and deletes it has changed nothing, and being asked
   * to confirm losing nothing is how a prompt teaches people to click through
   * prompts.
   *
   * The properties are compared as the payload a save would send rather than
   * row by row, because that is the only comparison that agrees with what
   * leaving would actually cost. It also means a blank row somebody added does
   * count as a change - unlike a function's or a tool's parameters, this
   * editor sends every row it has, so an unnamed one is work on its way to the
   * server and not a half-typed nothing.
   *
   * `held` is the baseline and it maintains itself: `apply` sets it on load and
   * again from what a save stored, so saving and then leaving asks nothing.
   * An object is always one that exists - there is no create route to this page
   * - so a null baseline means still loading, and there is nothing to lose yet.
   */
  const unsaved = useMemo(() => {
    if (held === null) return false;
    const sent = JSON.stringify(rows.map(asProperty));
    const was = JSON.stringify(held.properties.map(asRow).map(asProperty));
    return name.trim() !== held.name.trim() || description.trim() !== (held.description ?? '').trim() || sent !== was;
  }, [held, name, description, rows]);

  /*
   * The three ways out, and the question before any of them: a link, a Back
   * press, a closed tab. Shared with the function and tool editors, because all
   * three lose work the same way; see `useLeaveGuard`.
   */
  const guard = useLeaveGuard({
    unsaved,
    backTo: `/workspace/${workspaceId}/objects`,
    save: handleSave,
  });

  async function handleDelete() {
    if (held === null || removing) return;
    setRemoving(true);
    try {
      await deleteObject(held.id);
      navigate(`/workspace/${workspaceId}/objects`);
    } catch (cause) {
      setRemoving(false);
      // Refused while something still points at it, and the reason says which.
      setSaveError(cause instanceof Error ? cause.message : 'Could not delete the object.');
    }
  }

  return (
    <AppShell
      title={held?.name}
      user={shellUser(session)}
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} />}
    >
      <header className={styles.headerBlock}>
        <p className={styles.breadcrumbs}>
          <BackLink to={`/workspace/${workspaceId}/objects`} label="Objects" />
          <Link className={styles.crumbLink} to={`/workspace/${workspaceId}/objects`}>
            Objects
          </Link>
          <span className={styles.crumbSeparator}>/</span>
          <span className={styles.crumbCurrent}>{held?.name ?? '…'}</span>
        </p>
        <div className={styles.headerRow}>
          <div className={styles.titleGroup}>
            <h1 className={styles.pageTitle}>{held?.name ?? 'Object'}</h1>
          </div>
          <div className={styles.actions}>
            {saved && saveError === null && <span className={styles.savedInline}>Saved.</span>}
            {/*
              Beside the button it is about. It used to sit in the footer at the
              far end of a row from "+ Add Property", a control it has nothing
              to do with - see `ValidationStatus`.
            */}
            <ValidationStatus
              subject="The properties"
              status={status}
              explains={
                <>
                  Validate resolves every property's type against this workspace: the built-in ones, and the
                  objects a property names. It answers whether this shape could be stored and used, and says which
                  property is the problem if it could not.
                </>
              }
            />
            <button type="button" className={styles.secondaryButton} onClick={() => void handleValidate()}>
              Validate
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => void handleSave()}
              disabled={saving || held === null}
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </header>

      {loadError !== null ? (
        <p className={styles.loadError} role="alert">
          {loadError}
        </p>
      ) : held === null ? (
        <Loader />
      ) : (
        <>
          {saveError !== null && (
            <p className={styles.error} role="alert">
              {saveError}
            </p>
          )}

          <div className={styles.split}>
            <section className={styles.editorCard}>
              <header className={styles.editorHeader}>
                <span className={styles.editorTitle}>
                  <img src={fileTextIcon} alt="" width={16} height={16} />
                  Object Schema Definition
                </span>
                <span className={styles.editorBadge}>Typed Schema</span>
              </header>

              {rows.length === 0 && (
                <p className={styles.propertyEmpty}>
                  No properties yet. Each one is a name, a type and a sentence saying what it means — the
                  sentence is what a reader has instead of guessing from the name, and what a model has
                  instead of nothing at all.
                </p>
              )}

              {rows.map((row, index) => {
                const called = row.name || `property ${index + 1}`;
                return (
                  <div className={styles.propertyRow} key={index}>
                    <div className={styles.propertyMain}>
                      <span className={`${styles.propertyField} ${styles.propertyNameCol}`}>
                        <label className={styles.propertyLabel} htmlFor={`property-name-${index}`}>
                          Name
                        </label>
                        <input
                          id={`property-name-${index}`}
                          className={styles.propertyName}
                        value={row.name}
                        spellCheck={false}
                          placeholder="channel"
                          onChange={(event) => edit(index, { name: event.target.value })}
                        />
                      </span>
                      <span className={`${styles.propertyField} ${styles.propertyTypeCol}`}>
                        <label className={styles.propertyLabel} htmlFor={`property-type-${index}`}>
                          Type
                        </label>
                        <DefinitionPicker
                          id={`property-type-${index}`}
                          value={row.type}
                          options={typeOptions}
                          onChoose={(value) => edit(index, { type: value })}
                          placeholder="Choose a type…"
                          searchPlaceholder="Search types…"
                          ariaLabel={`Type of ${called}`}
                        />
                      </span>
                      {/*
                        Scalar or vector, asked once for whichever type is chosen.
                        Two buttons rather than a checkbox because both answers are
                        worth reading: a field carrying a single value is a decision
                        somebody made, not the absence of one.
                      */}
                      <span className={`${styles.propertyField} ${styles.propertyHoldsCol}`}>
                        <span className={styles.propertyLabel} id={`property-values-${index}`}>
                          Values
                        </span>
                        <span className={styles.holds} role="group" aria-label={`Whether ${called} is a single value or a list`}>
                          <button
                            type="button"
                            aria-pressed={!row.many}
                            className={row.many ? styles.holdsOption : styles.holdsOptionActive}
                            onClick={() => edit(index, { many: false })}
                          >
                            Single
                          </button>
                          <button
                            type="button"
                            aria-pressed={row.many}
                            className={row.many ? styles.holdsOptionActive : styles.holdsOption}
                            onClick={() => edit(index, { many: true })}
                          >
                            List
                          </button>
                        </span>
                      </span>
                      <span className={styles.propertyActionCol}>
                        <button
                          type="button"
                          className={styles.propertyDelete}
                          aria-label={`Remove ${called}`}
                          title="Remove this property"
                          onClick={() => {
                            setRows((current) => current.filter((_, at) => at !== index));
                            setSaved(false);
                            setStatus(null);
                          }}
                        >
                          <TrashIcon />
                        </button>
                      </span>
                    </div>
                    {/*
                      The sentence, on a line of its own, labelled and always visible.
                      Labelled because a placeholder disappears the moment somebody
                      types, and a field whose only explanation vanishes on first use
                      explains nothing to the person who comes back to it.
                      Behind a disclosure it would be written for the fields
                      somebody remembered to open, which is the half that needed
                      explaining least.
                    */}
                    <div className={`${styles.propertyField} ${styles.propertyDescriptionRow}`}>
                      <label className={styles.propertyLabel} htmlFor={`property-description-${index}`}>
                        Description
                      </label>
                      <input
                        id={`property-description-${index}`}
                        className={styles.propertyDescription}
                        value={row.description}
                        maxLength={FIELD_DESCRIPTION_LIMIT}
                        placeholder="What this field means, for a reader and for a model"
                        onChange={(event) => edit(index, { description: event.target.value })}
                      />
                    </div>
                  </div>
                );
              })}

              <footer className={styles.editorFooter}>
                <button
                  type="button"
                  className={styles.addProperty}
                  onClick={() => {
                    setRows((current) => [
                      ...current,
                      { name: '', type: 'STRING', many: false, description: '' },
                    ]);
                    setSaved(false);
                    setStatus(null);
                  }}
                >
                  + Add Property
                </button>
              </footer>
            </section>

            <aside className={styles.panel}>
              <div className={styles.panelSection}>
                <h2 className={styles.panelHeading}>Object Details</h2>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="object-name">
                    Name
                  </label>
                  <input
                    id="object-name"
                    className={`${styles.input} ${styles.inputMono}`}
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                      setSaved(false);
                    }}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="object-description">
                    Description
                  </label>
                  <textarea
                    id="object-description"
                    className={styles.textarea}
                    value={description}
                    onChange={(event) => {
                      setDescription(event.target.value);
                      setSaved(false);
                    }}
                    placeholder="What this shape is, for whoever points at it."
                  />
                </div>
              </div>

              {held !== null && (
                <div className={styles.metadata}>
                  <span className={styles.metadataLabel}>Last modified</span>
                  <span className={styles.metadataValue}>
                    {timeAgo(held.lastModifiedAt)} by <span className={styles.metadataWho}>{held.lastModifiedBy}</span>
                  </span>
                </div>
              )}

              {/*
                What names this shape, above the button that would take it
                away: another object holding it as a property, and any webhook
                that answers to it.
              */}
              {held !== null && (
                <div className={styles.panelSection}>
                  <UsedBy kind="OBJECT" componentId={objectId} />
                </div>
              )}

              <button
                type="button"
                className={styles.deleteButton}
                onClick={() => void handleDelete()}
                disabled={removing || held === null}
              >
                {removing ? 'Deleting…' : 'Delete Object'}
              </button>
            </aside>
          </div>
        </>
      )}

      {/*
        Outside the branch above, so it is the same dialog whichever state the
        page is in - and so closing it never depends on what the page happens to
        be showing behind it.
      */}
      <UnsavedWorkDialog
        subject={guard.asking ? (held?.name ?? 'This object') : null}
        creating={false}
        onStay={guard.stay}
        onLeave={guard.leave}
        onSaveAndLeave={guard.saveAndLeave}
      />
    </AppShell>
  );
}
