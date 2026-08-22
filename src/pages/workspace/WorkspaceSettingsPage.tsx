import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useParams } from 'react-router-dom';

import { answers, fetchModels } from '../../api/models';
import type { Model } from '../../api/models';
import type { SessionUser } from '../../api/session';
import {
  fetchWorkspace,
  updateWorkspace,
  setWorkspaceCompanionModel,
  setWorkspaceQuickChatModel,
  setWorkspaceQuickChatWrites,
  setWorkspaceSpeechModel,
  setWorkspaceTranscriptionModel,
} from '../../api/workspaces';
import type { Workspace } from '../../api/workspaces';
import chevronDown12Icon from '../../assets/chevron-down-12.svg';
import { AppShell } from '../../components/AppShell';
import { CatalogueNote, useCatalogue } from '../../components/Catalogue';
import { FieldHint } from '../../components/FieldHint';
import { Loader } from '../../components/Loader';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { useInstallation } from '../../session/installation';
import { shellUser } from '../../session/user';
import { forgetWorkspaces } from '../../session/workspaces';
import styles from './WorkspaceSettingsPage.module.css';

export interface WorkspaceSettingsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/**
 * What the workspace decides for itself.
 *
 * Two cards. The models it uses for its own small jobs, which anybody who can
 * see the workspace may choose, and above them its name and description, which
 * only somebody who administers *this* workspace may change.
 *
 * That card is here rather than only in the Admin section because this is where
 * a workspace administrator can actually get to. They are not an installation
 * administrator, so the Admin section is not theirs and the page under it is not
 * reachable; the workspace's own settings page is, and the setting is a
 * workspace's. It is hidden rather than disabled for anybody else, since a
 * greyed-out field for a permission somebody will never hold is a permanent
 * advertisement for something they cannot have.
 */
export function WorkspaceSettingsPage({ session, onSignOut }: WorkspaceSettingsPageProps) {
  const { workspaceId = '' } = useParams();

  /*
   * Whether this installation has a chat at all - issue #201.
   *
   * Three of the settings below are a chat's and nothing else's: what names a
   * chat, what the microphone in a chat speaks to, what reads an answer aloud
   * under one. With chat switched off they configure a screen nobody here can
   * open, and this is the page an administrator goes to straight after
   * switching it off.
   *
   * `=== true` rather than `!== false`, which is how the shell reads the same
   * flag: absent while the settings are still unknown, so the card does not
   * appear and take itself away a moment later.
   */
  const installation = useInstallation();
  const hasChat = installation?.chatEnabled === true;

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * Which card the message above belongs to.
   *
   * One saved-and-failed state serves every picker here, which was invisible
   * while they all sat in one card and the message was drawn under the first
   * field. They are two cards now - a chat's settings, and the AI button's -
   * so the message has to be told which one it is about, or saving the Quick
   * Chat model says "Saved." three fields further up, in a card that may not
   * even be drawn.
   */
  const [about, setAbout] = useState<'chat' | 'quick'>('chat');

  /*
   * Where that message is actually drawn.
   *
   * The card it belongs to, unless that card is not on the page - the workspace
   * failing to load reports itself through the same state, and with chat off
   * there would be no chat card to print it in. One card is always drawn, so
   * anything with nowhere else to go goes there.
   */
  const messageIn = hasChat ? about : 'quick';

  /** The General card's own draft, and its own saved and failed states. */
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [namingSaved, setNamingSaved] = useState(false);
  const [namingError, setNamingError] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);

  useEffect(() => {
    if (workspaceId === '') return;
    fetchWorkspace(workspaceId)
      .then((found) => {
        setWorkspace(found);
        setName(found?.name ?? '');
        setDescription(found?.description ?? '');
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Could not load the workspace.');
      });
  }, [workspaceId]);

  /*
   * The models the four pickers on this page offer.
   *
   * This ended `.catch(() => setModels([]))`, and the page's answer to an empty
   * list is a line saying to go and add one under Models. A workspace whose
   * models could not be fetched was told to add the ones it already has.
   */
  const modelCatalogue = useCatalogue('models in this workspace', () => fetchModels(workspaceId), [workspaceId], {
    skip: workspaceId === '',
  });
  const models: Model[] = modelCatalogue.items;

  async function hear(modelId: string) {
    setAbout('chat');
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
    setAbout('quick');
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
    setAbout('quick');
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
    setAbout('chat');
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

  /**
   * The name and description, saved without either role list.
   *
   * Both are left out rather than sent back unchanged: this form never shows
   * them, so it has nothing to say about them, and a mutation that posts a list
   * it did not display is one bug away from clearing it.
   */
  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (name.trim() === '' || naming) return;

    setNaming(true);
    setNamingError(null);
    setNamingSaved(false);
    try {
      const updated = await updateWorkspace(workspaceId, {
        name: name.trim(),
        description: description.trim() || undefined,
      });
      // A rename has to reach the selector, which paints from the cached list.
      forgetWorkspaces();
      setWorkspace(updated);
      setNamingSaved(true);
    } catch (cause) {
      setNamingError(cause instanceof Error ? cause.message : 'Could not save the workspace.');
    } finally {
      setNaming(false);
    }
  }

  async function choose(modelId: string) {
    setAbout('chat');
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
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} />}
    >
      <header className={styles.header}>
        <h1 className={styles.title}>Workspace Settings</h1>
      </header>

      {/*
        Two things this page had no way to say. Until the workspace arrives
        every section below is behind `workspace?.administered`, so the page was
        a heading over nothing - and a load that failed was the same heading
        over the same nothing, because the error is drawn inside a form that a
        failed load never reaches.
      */}
      {workspace === null && (
        <section className={styles.card}>
          {error !== null ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : (
            <Loader />
          )}
        </section>
      )}

      {/*
        Only for somebody who administers this workspace, which an installation
        administrator does everywhere and a workspace administrator does here.
        The server decides the same thing again on the save; this only decides
        whether to offer it.
      */}
      {workspace?.administered === true && (
        <form className={styles.card} onSubmit={rename}>
          <div className={styles.sectionTitle}>
            <span className={styles.labelWithHint}>
              <h2 className={styles.sectionHeading}>General</h2>
              {/*
                Against the card rather than against a field: it is about what
                this card does not decide, which is not a footnote to the name
                or to the description on their own.
              */}
              <FieldHint label="General">
                Who can see this workspace is set on the Roles screen by an installation administrator,
                not here.
              </FieldHint>
            </span>
            <div className={styles.rule} />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="workspace-name">
              Workspace Name
            </label>
            <div className={styles.inputWrapper}>
              <input
                id="workspace-name"
                className={`${styles.input} ${styles.prose}`}
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="workspace-description">
              Description
            </label>
            <div className={`${styles.inputWrapper} ${styles.inputWrapperTall}`}>
              <textarea
                id="workspace-description"
                className={`${styles.input} ${styles.prose} ${styles.textarea}`}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          </div>

          {namingError !== null && (
            <p className={styles.error} role="alert">
              {namingError}
            </p>
          )}

          <div className={styles.formActions}>
            {namingSaved && namingError === null && <p className={styles.saved}>Saved.</p>}
            <button type="submit" className={styles.save} disabled={name.trim() === '' || naming}>
              {naming ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      )}

      {/*
        A chat's own settings, drawn only where the installation has a chat.

        All three are about a screen and nothing else: what names a chat from
        what was said, what the microphone in a chat speaks to, what reads an
        answer aloud under one. With chat switched off they configure something
        nobody in this installation can open - which is issue #201, reported
        from this page. Dropped rather than disabled, for the reason the shell
        drops the Chat link: a control that leads to "this is turned off" is a
        worse answer than no control, and the admin screen is where the switch
        actually is.
      */}
      {hasChat && (
      <section className={styles.card}>
        <div className={styles.sectionTitle}>
          <h2 className={styles.sectionHeading}>Chat</h2>
          <div className={styles.rule} />
        </div>

        <div className={styles.field}>
          <span className={styles.labelWithHint}>
            <label className={styles.label} htmlFor="companion-model">
              Companion Model
            </label>
            <FieldHint label="Companion Model">
              Used for the workspace&rsquo;s own small jobs rather than for the conversation — naming a
              chat from what was said. A cheap model is the right choice here.
            </FieldHint>
          </span>
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
          {messageIn === 'chat' && saved && <p className={styles.saved}>Saved.</p>}
          {messageIn === 'chat' && error !== null && (
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
          <span className={styles.labelWithHint}>
            <label className={styles.label} htmlFor="transcription-model">
              Speech-to-text Model
            </label>
            <FieldHint label="Speech-to-text Model">
              Chosen once for the workspace: it is about what this installation runs, not about any one
              conversation.
            </FieldHint>
          </span>
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
          {/*
            The list being empty is not a footnote about the field, it is what
            the field has instead of contents - so it stays where the missing
            options would have been rather than going behind the (?).
          */}
          {modelCatalogue.failure === null ? (
            !modelCatalogue.loading &&
            !models.some((model) => model.kind === 'TRANSCRIPTION') && (
              <p className={styles.fieldNote}>
                No transcription model has been added yet. Add one under Models, pointing at your Whisper
                instance.
              </p>
            )
          ) : (
            <CatalogueNote catalogue={modelCatalogue} className={styles.fieldNote} />
          )}
        </div>

        {/*
          What reads an answer aloud. The mirror of the field above, and only
          speech models are offered for the same reason: a chat model handed an
          answer would talk about it rather than read it.
        */}
        <div className={styles.field}>
          <span className={styles.labelWithHint}>
            <label className={styles.label} htmlFor="speech-model">
              Text-to-speech Model
            </label>
            <FieldHint label="Text-to-speech Model">
              A speaker appears under every answer in a chat, which reads it in this model&rsquo;s voice.
            </FieldHint>
          </span>
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
          {modelCatalogue.failure === null ? (
            !modelCatalogue.loading &&
            !models.some((model) => model.kind === 'SPEECH') && (
              <p className={styles.fieldNote}>
                No speech model has been added yet. Add one under Models, pointing at whatever reads text
                aloud.
              </p>
            )
          ) : (
            <CatalogueNote catalogue={modelCatalogue} className={styles.fieldNote} />
          )}
        </div>

      </section>
      )}

      {/*
        The AI button, which is a card of its own rather than the last field of
        the one above.

        It shares a word with chat and is not the same feature: the switch on
        the admin screen governs the chat screen - `ChatAPI` and
        `ChatStreamAPI`, "off takes the tab away and refuses new messages" - and
        the panel that opens over a page answers through its own endpoint and
        goes on working. What turns *it* off is the None this field already
        offers, which is why it is still here on an installation with no chat.
        Folded in above, it would have gone with the card and left nobody a way
        to switch off something that still answers.
      */}
      <section className={styles.card}>
        <div className={styles.sectionTitle}>
          <h2 className={styles.sectionHeading}>Quick Chat</h2>
          <div className={styles.rule} />
        </div>

        <div className={styles.field}>
          <span className={styles.labelWithHint}>
            <label className={styles.label} htmlFor="quick-chat-model">
              Quick Chat Model
            </label>
            <FieldHint label="Quick Chat Model">
              Answers questions about the page somebody is on, and can look up this workspace&rsquo;s
              workflows and runs to do it.
            </FieldHint>
          </span>
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

          {/*
            Only where there is a panel to govern. The switch on its own, above
            a model nobody has chosen, is a setting for something that does not
            happen.
          */}
          {workspace?.quickChatModelId != null && (
            <div className={styles.checkRowWithHint}>
              <label className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={workspace.quickChatMayWrite}
                  onChange={(event) => void writes(event.target.checked)}
                />
                <span>Let it make changes</span>
              </label>
              {/*
                Beside the box rather than inside the label: the (?) is a button,
                and a button inside a <label> would tick the box on the way to
                opening the note.

                The consequence of granting this is exactly what the rules put
                behind the (?) - the field above it has one, and a screen where
                one explanation hides and the next sits in the open is worse
                than either convention on its own.
              */}
              <FieldHint label="Let it make changes">
                Off, it can only look things up. On, it can act on this workspace when asked: start a run,
                repeat one, and turn a workflow or an agent on or off. Those are real — a run that messaged
                somebody messages them again — and the panel opens over whatever somebody happens to be
                reading. It cannot delete anything either way.
              </FieldHint>
            </div>
          )}

          {/* The same message the card above has, about this card's own saves. */}
          {messageIn === 'quick' && saved && <p className={styles.saved}>Saved.</p>}
          {messageIn === 'quick' && error !== null && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </div>
      </section>
    </AppShell>
  );
}
