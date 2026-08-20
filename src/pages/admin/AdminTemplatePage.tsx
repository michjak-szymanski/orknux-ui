import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import type { SessionUser } from '../../api/session';
import type { ComponentTemplate } from '../../api/templates';
import {
  contentsSummary,
  createComponentTemplate,
  deleteComponentTemplate,
  fetchComponentTemplate,
  fetchTemplateEnvelope,
  updateComponentTemplate,
} from '../../api/templates';
import { KIND_LABEL, saveJson } from '../../api/transfer';
import { AdminSidebar } from '../../components/AdminSidebar';
import { AppShell } from '../../components/AppShell';
import { BackLink } from '../../components/BackLink';
import { FieldHint } from '../../components/FieldHint';
import { Loader } from '../../components/Loader';
import { shellUser } from '../../session/user';
import styles from './AdminTemplatePage.module.css';

export interface AdminTemplatePageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/**
 * One template: published here for the first time, or edited here afterwards.
 *
 * The same shape as the shell page — one form for adding and editing, and a
 * danger zone for removing the thing — because it is the same kind of screen.
 * What is particular to a template is that its *contents* are read-only. A
 * template holds an exported file and nothing else, so the edits it has are its
 * name, its description, and replacing that file wholesale; a screen that let
 * somebody take one component out of an envelope would be a second exporter,
 * and the moment there were two the file would stop being the thing that
 * decided what a template holds.
 *
 * Replacing is also the only way a template moves on, which the page says out
 * loud. Everybody who sees a named thing beside the thing it was made from
 * assumes the two follow each other. These do not.
 */
export function AdminTemplatePage({ session, onSignOut }: AdminTemplatePageProps) {
  const { templateId } = useParams();
  const navigate = useNavigate();
  const adding = templateId === undefined;
  const fileRef = useRef<HTMLInputElement>(null);

  const [template, setTemplate] = useState<ComponentTemplate | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  /** The uploaded file: required when publishing, "replace it" when editing. */
  const [envelope, setEnvelope] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');

  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (templateId === undefined) return;
    let current = true;
    fetchComponentTemplate(templateId)
      .then((found) => {
        if (!current) return;
        if (found === null) {
          setLoadError('That template no longer exists.');
          return;
        }
        setTemplate(found);
        setName(found.name);
        setDescription(found.description ?? '');
      })
      .catch((cause: unknown) => {
        if (current) setLoadError(cause instanceof Error ? cause.message : 'Could not load the template.');
      });
    return () => {
      current = false;
    };
  }, [templateId]);

  const complete = name.trim() !== '' && (!adding || envelope !== null);

  async function chosen(file: File | undefined) {
    if (file === undefined) return;
    setFileName(file.name);
    setEnvelope(await file.text());
    setError(null);
    // A name worth suggesting, once, and only where there is nothing to lose.
    if (name.trim() === '') setName(file.name.replace(/\.orkx\.json$|\.json$/, ''));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!complete || saving) return;
    setSaving(true);
    setError(null);

    const input = {
      name: name.trim(),
      description: description.trim() === '' ? null : description.trim(),
      // Absent means "leave the stored file alone", which is what somebody
      // fixing a typo in a description expects. Only a chosen file replaces one.
      ...(envelope === null ? {} : { envelope }),
    };

    try {
      if (adding) {
        const made = await createComponentTemplate(input);
        navigate(`/admin/templates/${made.id}`);
      } else {
        const updated = await updateComponentTemplate(templateId, input);
        setTemplate(updated);
        setEnvelope(null);
        setFileName('');
        if (fileRef.current !== null) fileRef.current.value = '';
        setSaving(false);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the template.');
      setSaving(false);
    }
  }

  async function handleDownload() {
    if (templateId === undefined || template === null) return;
    setError(null);
    try {
      saveJson(`${template.name.replace(/[^\w-]/g, '-')}.orkx.json`, await fetchTemplateEnvelope(templateId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not download it.');
    }
  }

  async function handleDelete() {
    if (templateId === undefined || saving) return;
    setSaving(true);
    setError(null);
    try {
      await deleteComponentTemplate(templateId);
      navigate('/admin/templates');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not delete the template.');
      setSaving(false);
    }
  }

  const called = adding ? 'New Template' : (template?.name ?? '…');

  return (
    <AppShell
      title={adding ? 'New template' : template?.name}
      user={shellUser(session)}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<AdminSidebar active="templates" />}
    >
      <header className={styles.headerBlock}>
        <p className={styles.breadcrumbs}>
          <BackLink to="/admin/templates" label="Templates" />
          <Link className={styles.crumbLink} to="/admin/templates">
            Templates
          </Link>
          <span className={styles.crumbSeparator}>/</span>
          <span className={styles.crumbCurrent}>{called}</span>
        </p>
        <h1 className={styles.pageTitle}>{called}</h1>
        <p className={styles.subtitle}>
          An exported component, published for every workspace on this installation. It holds a copy
          taken when the file was uploaded and follows nothing: editing what it was made from does not
          change it, and replacing the file here is what brings it up to date.
        </p>
      </header>

      {loadError !== null ? (
        <section className={styles.card}>
          <p className={styles.loadError} role="alert">
            {loadError}
          </p>
          <Link className={styles.crumbLink} to="/admin/templates">
            Back to Templates
          </Link>
        </section>
      ) : !adding && template === null ? (
        <section className={styles.card}>
          <Loader />
        </section>
      ) : (
        <form className={styles.form} onSubmit={(event) => void handleSubmit(event)}>
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Template</h2>
            <div className={styles.divider} />

            <div className={styles.field}>
              <span className={styles.labelWithHint}>
                <label className={styles.label} htmlFor="template-name">
                  Name <span className={styles.required}>*</span>
                </label>
                <FieldHint label="Name">
                  What it is called everywhere it is offered, and unique across this installation.
                </FieldHint>
              </span>
              <input
                id="template-name"
                className={styles.input}
                type="text"
                placeholder="e.g. Order handling"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
                autoFocus
                required
              />
            </div>

            <div className={styles.field}>
              <span className={styles.labelWithHint}>
                <label className={styles.label} htmlFor="template-description">
                  Description
                </label>
                <FieldHint label="Description">
                  A template with a name and nothing else is a row people scroll past. Say what it
                  does and what somebody has to have already.
                </FieldHint>
              </span>
              <textarea
                id="template-description"
                className={`${styles.input} ${styles.textarea}`}
                placeholder="What it is for, and when somebody would reach for it"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={1000}
                rows={3}
              />
            </div>
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>
              <span className={styles.labelWithHint}>
                {adding ? 'File' : 'What is inside'}
                <FieldHint label="File">
                  The JSON an Export control downloads. It is read before anything is saved, so a
                  file this installation cannot read is refused here rather than at the button
                  somebody presses later.
                </FieldHint>
              </span>
            </h2>
            <div className={styles.divider} />

            {!adding && template !== null && (
              <>
                {template.usable ? (
                  <>
                    <ul className={styles.contents}>
                      {template.contents.map((held) => (
                        <li className={styles.content} key={`${held.kind}:${held.name}`}>
                          <span className={styles.contentKind}>{KIND_LABEL[held.kind]}</span>
                          <span className={styles.contentName}>{held.name}</span>
                        </li>
                      ))}
                    </ul>
                    <p className={styles.meta}>
                      <span>{contentsSummary(template)}</span>
                      <span>Format version {template.formatVersion}</span>
                      {template.producedBy !== null && <span>From {template.producedBy}</span>}
                      <span>
                        Published by {template.createdBy} on {new Date(template.createdAt).toLocaleDateString()}
                      </span>
                    </p>
                  </>
                ) : (
                  /*
                    A file this installation cannot read - which is what a
                    rollback past the format version it was written under looks
                    like from here. The refusal is the format's own sentence,
                    naming both versions, rather than a stack trace.
                  */
                  <p className={styles.problem} role="alert">
                    {template.problem}
                  </p>
                )}
              </>
            )}

            <div className={styles.field}>
              <label className={styles.label} htmlFor="template-file">
                {adding ? (
                  <>
                    Exported file <span className={styles.required}>*</span>
                  </>
                ) : (
                  'Replace the file'
                )}
              </label>
              <input
                ref={fileRef}
                id="template-file"
                className={styles.hiddenInput}
                type="file"
                accept="application/json,.json"
                onChange={(event) => void chosen(event.target.files?.[0])}
              />
              <div className={styles.buttons}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => fileRef.current?.click()}
                  disabled={saving}
                >
                  Choose a file
                </button>
                {!adding && (
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => void handleDownload()}
                    disabled={saving}
                  >
                    Download
                  </button>
                )}
              </div>
              {fileName !== '' && <p className={styles.fileName}>{fileName}</p>}
              {/*
                What uploading does to a template that already exists, which is
                a consequence and not an explanation: it stays on screen. What
                the file has to be is behind the (?) on the heading.
              */}
              {!adding && (
                <p className={styles.fieldNote}>
                  Uploading one replaces what this template holds. Workspaces that already used it
                  keep what they took: a template is a copy, and this changes what the next one
                  gets.
                </p>
              )}
            </div>
          </section>

          <div className={styles.footer}>
            <div className={styles.buttons}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => navigate('/admin/templates')}
                disabled={saving}
              >
                Cancel
              </button>
              <button type="submit" className={styles.primaryButton} disabled={!complete || saving}>
                {saving ? 'Saving…' : adding ? 'Publish Template' : 'Save Changes'}
              </button>
            </div>
          </div>

          {error !== null && (
            <p className={styles.loadError} role="alert">
              {error}
            </p>
          )}
        </form>
      )}

      {!adding && loadError === null && template !== null && (
        <section className={styles.dangerCard}>
          <h2 className={styles.dangerHeading}>Danger Zone</h2>
          <div className={styles.divider} />
          <div className={styles.dangerRow}>
            <div className={styles.dangerText}>
              <span className={styles.dangerTitle}>Delete Template</span>
              <span className={styles.dangerNote}>
                {confirmingDelete
                  ? `Delete ${template.name}? Nothing any workspace took from it is touched — those are copies of their own.`
                  : 'Take it off the list. What it has already created stays where it is'}
              </span>
            </div>
            {confirmingDelete ? (
              <div className={styles.buttons}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => setConfirmingDelete(false)}
                  disabled={saving}
                >
                  Keep
                </button>
                <button
                  type="button"
                  className={styles.dangerButton}
                  onClick={() => void handleDelete()}
                  disabled={saving}
                >
                  {saving ? 'Deleting…' : 'Delete Template'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className={styles.dangerButton}
                onClick={() => setConfirmingDelete(true)}
                disabled={saving}
              >
                Delete Template
              </button>
            )}
          </div>
        </section>
      )}
    </AppShell>
  );
}
