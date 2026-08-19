import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { deleteObject, fetchObject, fetchWorkspaceObjects, updateObject, validateObject } from '../../api/objects';
import type { ObjectPropertyInput, PropertyKind, WorkflowObject } from '../../api/objects';
import type { SessionUser } from '../../api/session';
import { timeAgo } from '../../api/tools';
import fileTextIcon from '../../assets/file-text.svg';
import { AppShell } from '../../components/AppShell';
import { BackLink } from '../../components/BackLink';
import { TrashIcon } from '../../components/TrashIcon';
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
 * One row of the editor, before it is a property: the type is held as the
 * picker's single value so the cell can stay one control, the way the design
 * draws it.
 */
interface Row {
  name: string;
  /** `STRING`, `OBJECT:12`, `ARRAY:STRING`, `ARRAY:OBJECT:12`. */
  type: string;
}

/** What the picker's value means, unpacked for the server. */
function asProperty(row: Row): ObjectPropertyInput {
  const parts = row.type.split(':');
  if (parts[0] === 'ARRAY') {
    return parts[1] === 'OBJECT'
      ? { name: row.name, kind: 'ARRAY', refObjectId: parts[2] }
      : { name: row.name, kind: 'ARRAY', elementKind: parts[1] as PropertyKind };
  }
  if (parts[0] === 'OBJECT') return { name: row.name, kind: 'OBJECT', refObjectId: parts[1] };
  return { name: row.name, kind: parts[0] as PropertyKind };
}

/**
 * What the last check found, or null when nothing has been checked.
 *
 * Null is a state of its own rather than an optimistic green, because the
 * footer used to open on `Schema compile healthy` before anything had been
 * asked: reassuring text that no check stood behind, and that stayed green
 * while the rows underneath it were edited into something the server would
 * refuse. The dot now only reports a round trip that examined these rows.
 */
interface Status {
  ok: boolean;
  message: string;
}

/** Grey, green or red, in that order of confidence. */
function indicatorTone(status: Status | null): string {
  if (status === null) return styles.indicatorIdle;
  return status.ok ? styles.indicatorOk : styles.indicatorBad;
}

/** And back again, so a saved object reopens on the value it was saved with. */
function asRow(property: WorkflowObject['properties'][number]): Row {
  if (property.kind === 'ARRAY') {
    return {
      name: property.name,
      type: property.refObjectId !== null ? `ARRAY:OBJECT:${property.refObjectId}` : `ARRAY:${property.elementKind}`,
    };
  }
  if (property.kind === 'OBJECT') return { name: property.name, type: `OBJECT:${property.refObjectId}` };
  return { name: property.name, type: property.kind };
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
  const [status, setStatus] = useState<Status | null>(null);
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

  function edit(index: number, change: Partial<Row>) {
    setRows((current) => current.map((row, at) => (at === index ? { ...row, ...change } : row)));
    setSaved(false);
    // The rows the last check looked at are gone, and so is what it found.
    setStatus(null);
  }

  async function handleValidate() {
    try {
      const checked = await validateObject(workspaceId, rows.map(asProperty));
      setStatus({ ok: checked.valid, message: checked.message });
    } catch (cause) {
      setStatus({ ok: false, message: cause instanceof Error ? cause.message : 'Could not check the schema.' });
    }
  }

  async function handleSave() {
    if (held === null || saving) return;
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
      setStatus({ ok: true, message: 'Saved, so every type resolves.' });
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Could not save the object.');
    } finally {
      setSaving(false);
    }
  }

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
      section="workspace"
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} active="objects" />}
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

              <div className={styles.propertyHeader}>
                <span className={styles.propertyNameCol}>Property name</span>
                <span className={styles.propertyTypeCol}>Type</span>
                <span className={styles.propertyActionCol} />
              </div>

              {rows.length === 0 && (
                <p className={styles.propertyEmpty}>
                  No properties yet. Each one is a name and a type, and every type has to resolve.
                </p>
              )}

              {rows.map((row, index) => (
                <div className={styles.propertyRow} key={index}>
                  <input
                    className={`${styles.propertyNameCol} ${styles.propertyName}`}
                    value={row.name}
                    spellCheck={false}
                    placeholder="channel"
                    aria-label={`Name of property ${index + 1}`}
                    onChange={(event) => edit(index, { name: event.target.value })}
                  />
                  <span className={styles.propertyTypeCol}>
                    <select
                      className={styles.propertyType}
                      value={row.type}
                      aria-label={`Type of ${row.name || `property ${index + 1}`}`}
                      onChange={(event) => edit(index, { type: event.target.value })}
                    >
                      <option value="STRING">string</option>
                      <option value="NUMBER">number</option>
                      <option value="BOOLEAN">boolean</option>
                      <option value="ARRAY:STRING">array&lt;string&gt;</option>
                      <option value="ARRAY:NUMBER">array&lt;number&gt;</option>
                      <option value="ARRAY:BOOLEAN">array&lt;boolean&gt;</option>
                      {/* An object may hold one of itself, which is how a tree is described. */}
                      {others.map((other) => (
                        <option key={`o-${other.id}`} value={`OBJECT:${other.id}`}>
                          {other.name}
                        </option>
                      ))}
                      {others.map((other) => (
                        <option key={`a-${other.id}`} value={`ARRAY:OBJECT:${other.id}`}>
                          array&lt;{other.name}&gt;
                        </option>
                      ))}
                    </select>
                  </span>
                  <span className={styles.propertyActionCol}>
                    <button
                      type="button"
                      className={styles.propertyDelete}
                      aria-label={`Remove ${row.name || `property ${index + 1}`}`}
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
              ))}

              <footer className={styles.editorFooter}>
                <button
                  type="button"
                  className={styles.addProperty}
                  onClick={() => {
                    setRows((current) => [...current, { name: '', type: 'STRING' }]);
                    setSaved(false);
                    setStatus(null);
                  }}
                >
                  + Add Property
                </button>
                <span className={styles.statusLeft}>
                  <span className={`${styles.indicator} ${indicatorTone(status)}`} aria-hidden="true" />
                  {status?.message ?? 'Not checked yet.'}
                </span>
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
    </AppShell>
  );
}
