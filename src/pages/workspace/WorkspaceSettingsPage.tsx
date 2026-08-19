import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { answers, fetchModels } from '../../api/models';
import type { Model } from '../../api/models';
import type { SessionUser } from '../../api/session';
import {
  fetchWorkspace,
  setWorkspaceCompanionModel,
  setWorkspaceQuickChatModel,
  setWorkspaceQuickChatWrites,
  setWorkspaceSpeechModel,
  setWorkspaceTranscriptionModel,
} from '../../api/workspaces';
import type { Workspace } from '../../api/workspaces';
import chevronDown12Icon from '../../assets/chevron-down-12.svg';
import { AppShell } from '../../components/AppShell';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './WorkspaceSettingsPage.module.css';

export interface WorkspaceSettingsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/**
 * What the workspace decides for itself.
 *
 * One card so far: the companion model, which is what the workspace uses for
 * its own small jobs rather than for anything a person asked for. Naming a chat
 * from what was said is the first of them.
 */
export function WorkspaceSettingsPage({ session, onSignOut }: WorkspaceSettingsPageProps) {
  const { workspaceId = '' } = useParams();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (workspaceId === '') return;
    fetchWorkspace(workspaceId)
      .then(setWorkspace)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Could not load the workspace.');
      });
    fetchModels(workspaceId)
      .then(setModels)
      .catch(() => setModels([]));
  }, [workspaceId]);

  async function hear(modelId: string) {
    setError(null);
    setSaved(false);
    try {
      // Empty takes the microphone away rather than falling back to a model
      // that would answer the audio instead of transcribing it.
      setWorkspace(await setWorkspaceTranscriptionModel(workspaceId, modelId === '' ? null : modelId));
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save that.');
    }
  }

  async function quick(modelId: string) {
    setError(null);
    setSaved(false);
    try {
      // Empty takes the button away, rather than leaving one that opens onto
      // an apology.
      setWorkspace(await setWorkspaceQuickChatModel(workspaceId, modelId === '' ? null : modelId));
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save that.');
    }
  }

  async function writes(allowed: boolean) {
    setError(null);
    setSaved(false);
    try {
      setWorkspace(await setWorkspaceQuickChatWrites(workspaceId, allowed));
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save that.');
    }
  }

  async function read(modelId: string) {
    setError(null);
    setSaved(false);
    try {
      // Empty takes the speaker away rather than falling back to a model that
      // would answer the text instead of reading it.
      setWorkspace(await setWorkspaceSpeechModel(workspaceId, modelId === '' ? null : modelId));
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save that.');
    }
  }

  async function choose(modelId: string) {
    setError(null);
    setSaved(false);
    try {
      // Empty is "none", which switches those jobs off rather than guessing.
      setWorkspace(await setWorkspaceCompanionModel(workspaceId, modelId === '' ? null : modelId));
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save that.');
    }
  }

  return (
    <AppShell
      user={shellUser(session)}
      section="workspace"
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} active="settings" />}
    >
      <header className={styles.header}>
        <h1 className={styles.title}>Workspace Settings</h1>
      </header>

      <section className={styles.card}>
        <div className={styles.sectionTitle}>
          <h2 className={styles.sectionHeading}>Chat</h2>
          <div className={styles.rule} />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="companion-model">
            Companion Model
          </label>
          <div className={styles.inputWrapper}>
            <select
              id="companion-model"
              className={`${styles.input} ${styles.select}`}
              value={workspace?.companionModelId ?? ''}
              onChange={(event) => void choose(event.target.value)}
              disabled={workspace === null}
            >
              <option value="">None — chats keep the name they were given</option>
              {/* A small job is still a chat job: it asks a model for a title. */}
              {models
                .filter(answers)
                .map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.modelId}
                  </option>
                ))}
            </select>
            <img src={chevronDown12Icon} alt="" width={12} height={12} />
          </div>
          <p className={styles.hint}>
            Used for the workspace&rsquo;s own small jobs rather than for the conversation — naming a chat from
            what was said. A cheap model is the right choice here.
          </p>
          {saved && <p className={styles.saved}>Saved.</p>}
          {error !== null && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </div>

        {/*
          What the microphone in a chat speaks to. Only transcription models are
          offered: a chat model handed audio answers something, and what it
          answers is not a transcript.
        */}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="transcription-model">
            Speech-to-text Model
          </label>
          <div className={styles.inputWrapper}>
            <select
              id="transcription-model"
              className={`${styles.input} ${styles.select}`}
              value={workspace?.transcriptionModelId ?? ''}
              onChange={(event) => void hear(event.target.value)}
              disabled={workspace === null}
            >
              <option value="">None — the microphone is not offered</option>
              {models
                .filter((model) => model.kind === 'TRANSCRIPTION')
                .map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.modelId}
                  </option>
                ))}
            </select>
            <img src={chevronDown12Icon} alt="" width={12} height={12} />
          </div>
          <p className={styles.hint}>
            {models.some((model) => model.kind === 'TRANSCRIPTION')
              ? 'Chosen once for the workspace: it is about what this installation runs, not about any one conversation.'
              : 'No transcription model has been added yet. Add one under Models, pointing at your Whisper instance.'}
          </p>
        </div>

        {/*
          What reads an answer aloud. The mirror of the field above, and only
          speech models are offered for the same reason: a chat model handed an
          answer would talk about it rather than read it.
        */}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="speech-model">
            Text-to-speech Model
          </label>
          <div className={styles.inputWrapper}>
            <select
              id="speech-model"
              className={`${styles.input} ${styles.select}`}
              value={workspace?.speechModelId ?? ''}
              onChange={(event) => void read(event.target.value)}
              disabled={workspace === null}
            >
              <option value="">None — answers are not read aloud</option>
              {models
                .filter((model) => model.kind === 'SPEECH')
                .map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.modelId}
                  </option>
                ))}
            </select>
            <img src={chevronDown12Icon} alt="" width={12} height={12} />
          </div>
          <p className={styles.hint}>
            {models.some((model) => model.kind === 'SPEECH')
              ? 'A speaker appears under every answer in a chat, which reads it in this model’s voice.'
              : 'No speech model has been added yet. Add one under Models, pointing at whatever reads text aloud.'}
          </p>
        </div>

        {/*
          The panel that opens beside the page. A chat model, because it is
          asked questions and calls orknux's own tools to answer them.
        */}
        <div className={styles.field}>
          <label className={styles.label} htmlFor="quick-chat-model">
            Quick Chat Model
          </label>
          <div className={styles.inputWrapper}>
            <select
              id="quick-chat-model"
              className={`${styles.input} ${styles.select}`}
              value={workspace?.quickChatModelId ?? ''}
              onChange={(event) => void quick(event.target.value)}
              disabled={workspace === null}
            >
              <option value="">None — the AI button is not offered</option>
              {models
                .filter((model) => model.kind === 'CHAT')
                .map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.modelId}
                  </option>
                ))}
            </select>
            <img src={chevronDown12Icon} alt="" width={12} height={12} />
          </div>
          <p className={styles.hint}>
            Answers questions about the page somebody is on, and can look up this workspace’s workflows and
            runs to do it.
          </p>

          {/*
            Only where there is a panel to govern. The switch on its own, above
            a model nobody has chosen, is a setting for something that does not
            happen.
          */}
          {workspace?.quickChatModelId != null && (
            <>
              <label className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={workspace.quickChatMayWrite}
                  onChange={(event) => void writes(event.target.checked)}
                />
                <span>Let it make changes</span>
              </label>
              <p className={styles.hint}>
                Off, it can only look things up. On, it can act on this workspace when asked: start a run,
                repeat one, and turn a workflow or an agent on or off. Those are real — a run that messaged
                somebody messages them again — and the panel opens over whatever somebody happens to be
                reading. It cannot delete anything either way.
              </p>
            </>
          )}
        </div>
      </section>
    </AppShell>
  );
}
