import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { createAgent } from '../api/agents';
import type { Agent } from '../api/agents';
import { AgentForm } from './AgentForm';
import type { AgentFormStyles } from './AgentForm';
import { PanelClose, panelEscape } from './PanelClose';
import styles from './Dialog.module.css';
import { t } from '../i18n';

export interface CreateAgentDialogProps {
  /**
   * Whether this stands over the page or beside it.
   *
   * A modal is right when what somebody is doing has nothing to do with what
   * is behind it; making a component for the node they are editing is the
   * opposite, so the workflow editor asks for a panel and keeps its graph.
   */
  placement?: 'modal' | 'panel';
  open: boolean;
  workspaceId: string;
  /**
   * Null makes one; an agent opens its definition as it stands.
   *
   * Making an agent asks for a name and a description and nothing else - there
   * is no model to choose for something that does not exist yet, and no grant
   * to give it. Everything else an agent is arrives the moment it does, which
   * is why the two are not the same form.
   */
  agent?: Agent | null;
  onClose: () => void;
  /** What was made, or what was saved. */
  onCreated: (agent: Agent) => void;
}

/** The dialog's own names for what the form needs. */
const FORM_STYLES: AgentFormStyles = {
  // The padding belongs to the panel around it, which also holds the title.
  body: styles.fields,
  fields: styles.fields,
  field: styles.field,
  label: styles.label,
  input: styles.input,
  select: styles.select,
  inputWrapper: styles.inputWrapper,
  inputWrapperTall: styles.inputWrapperTall,
  textarea: styles.textarea,
  labelRow: styles.labelRow,
  jump: styles.jump,
  error: styles.error,
  actions: styles.actions,
  ghost: styles.ghost,
  filled: styles.filled,
};

/**
 * Create agent, from the agent list — and the whole of an agent's definition
 * again for one that exists, where the frame around it is a panel rather than a
 * modal.
 *
 * A modal still only creates: settings for something real want a URL, room, and
 * somewhere to keep a Danger Zone, which is what the agent's own page is for.
 * Beside a workflow graph the bargain is different — the reason somebody is
 * reading an agent there is the node in front of them, and a page would take
 * that off the screen to show a form this one already holds.
 */
export function CreateAgentDialog({ open, workspaceId, agent = null, onClose, onCreated, placement = 'modal' }: CreateAgentDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;

    if (open && !dialog.open) {
      setName('');
      setDescription('');
      setError(null);
      setSubmitting(false);
      if (placement === 'panel') dialog.show();
      else dialog.showModal();
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
      onCreated(
        await createAgent({ workspaceId, name: name.trim(), type: 'LLM', description: description.trim() || undefined }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Could not create the agent.'));
      setSubmitting(false);
    }
  }

  return (
    <dialog ref={dialogRef} className={`${styles.dialog} ${styles.dialogWide} ${placement === 'panel' ? styles.dialogPanel : ''}`} onCancel={onClose} onClose={onClose} onKeyDown={panelEscape(placement, onClose)}>
      {agent !== null ? (
        <div className={styles.body}>
          <header className={styles.header}>
            <h2 className={styles.title}>{t('Agent Settings')}</h2>
            {placement === 'panel' && <PanelClose onClose={onClose} />}
          </header>

          {/*
            Mounted only while this is open, and keyed by which agent it holds,
            which is what resets it: the form reads its fields as it mounts, so
            opening the panel on a second agent starts it over without anything
            having to empty it.
          */}
          {open && (
            <AgentForm
              key={agent.id}
              workspaceId={workspaceId}
              agent={agent}
              styles={FORM_STYLES}
              onSaved={onCreated}
              onCancel={onClose}
            />
          )}
        </div>
      ) : (
        <form className={styles.body} onSubmit={handleSubmit}>
          <header className={styles.header}>
            <h2 className={styles.title}>{t('Create agent')}</h2>
            {placement === 'panel' && <PanelClose onClose={onClose} />}
          </header>

          <div className={styles.fields}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="create-agent-name">{t('Agent name')}</label>
              <div className={styles.inputWrapper}>
                <input
                  id="create-agent-name"
                  name="agentName"
                  className={styles.input}
                  type="text"
                  placeholder={t('e.g. Research Agent')}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoFocus
                  required
                />
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="create-agent-description">
                {t('Description')}
              </label>
              <div className={`${styles.inputWrapper} ${styles.inputWrapperTall}`}>
                <textarea
                  id="create-agent-description"
                  name="agentDescription"
                  className={`${styles.input} ${styles.textarea}`}
                  placeholder={t('What this agent does.')}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
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
              {t('Cancel')}
            </button>
            <button type="submit" className={styles.filled} disabled={name.trim() === '' || submitting}>
              {submitting ? t('Creating…') : 'Create'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
