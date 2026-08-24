import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useParams } from 'react-router-dom';

import { fetchMemoryBudget } from '../../api/agents';
import type { SessionMemoryBudget } from '../../api/agents';
import { createIssueType, deleteIssueType, fetchIssueTypes, renameIssueType } from '../../api/issues';
import type { IssueType } from '../../api/issues';
import { answers, fetchModels } from '../../api/models';
import type { Model } from '../../api/models';
import type { SessionUser } from '../../api/session';
import {
  fetchWorkspace,
  updateWorkspace,
  setWorkspaceCompanionModel,
  setWorkspaceDefaultMemoryShare,
  setWorkspaceQuickChatModel,
  setWorkspaceQuickChatWrites,
  setWorkspaceSpeechModel,
  setWorkspaceTranscriptionModel,
  setWorkspaceVoiceSpeechChunking,
  setWorkspaceVoiceTurnTaking,
} from '../../api/workspaces';
import type { Workspace } from '../../api/workspaces';
import chevronDown12Icon from '../../assets/chevron-down-12.svg';
import { AppShell } from '../../components/AppShell';
import { CatalogueNote, useCatalogue } from '../../components/Catalogue';
import { FieldHint } from '../../components/FieldHint';
import { Loader } from '../../components/Loader';
import { CHUNKING_DEFAULT } from '../../components/readAloud';
import type { SpeechChunking } from '../../components/readAloud';
import { VOICE_TURN_TAKING_DEFAULTS } from '../../components/VoiceMode';
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
 * The widest share the track offers, which is the server's own ceiling.
 *
 * The server is what enforces it — a share past this comes back refused, in a
 * sentence saying why, and that refusal is drawn below whether or not the track
 * can reach it. This is where the track ends, not a second copy of the rule; if
 * the two ever part company it is the refusal that is right.
 */
const MAX_SHARE = 50;

/**
 * Where the track reads "Default": the position that means nothing is set.
 *
 * Zero rather than a switch beside the slider, exactly as on the agent, because
 * the two states are one question — a workspace either has a default share for
 * its agents or it has none — and zero is the only honest resting place for a
 * slider with nothing set, since every other position is a percentage nobody
 * chose. A workspace that has never been given one reads Default, sends null,
 * and leaves every agent in it exactly where it was.
 */
const DEFAULT_SHARE = 0;

/**
 * How long the slider must be still before its preview is asked for.
 *
 * A range input fires on every step of a drag and each one of these is a round
 * trip. The same pause the agent form uses, for the same reason.
 */
const PREVIEW_PAUSE = 150;

/*
 * The one place the workspace's units become a person's, and back.
 *
 * The server stores milliseconds and a percentage because those are the units
 * voice mode itself works in, and nothing converts at the boundary - a
 * conversion there would be a second opinion about what 2.5 seconds is. But
 * nobody setting a pause is thinking in milliseconds, so the boxes below are in
 * seconds and in minutes, and these two functions are the whole of that
 * translation: the placeholders, what is loaded into a box, and what a save
 * sends all go through them.
 */

/** How much of the stored unit makes one of the unit a box is typed in. */
const A_SECOND = 1_000;
const A_MINUTE = 60_000;

/** A percentage is already what a person reads, so it converts by nothing. */
const AS_IS = 1;

/**
 * What a box shows for a stored value, and nothing at all for a workspace that
 * has decided nothing.
 *
 * Rounded to two places so a tenth of a second states exactly and nothing
 * beyond it appears: 2,500 ms is "2.5" rather than "2.50", which is a number
 * nobody typed.
 */
function inBox(stored: number | null, per: number): string {
  return stored === null ? '' : String(Math.round((stored / per) * 100) / 100);
}

/**
 * And back. An empty box is nothing decided, which is what clears the setting
 * and puts voice mode back on its own value.
 */
function asStored(typed: string, per: number): number | null {
  const said = Number(typed);
  return typed.trim() === '' || Number.isNaN(said) ? null : Math.round(said * per);
}

/** Grouped the way the server groups them in its own sentences. */
function thousands(count: number): string {
  return count.toLocaleString('en-US');
}

/**
 * What a share works out to, in the server's numbers and under the server's
 * names for them.
 *
 * Nothing is computed here and nothing may be: every figure below is one the
 * API sent, and the same calculation is what the mutation judges a share with.
 * A second copy of it in the browser would eventually disagree, and the one
 * that drifted would be this.
 *
 * `toolResults` is not drawn, for the reason the agent's card does not draw it:
 * it is a ceiling on a query rather than an allowance, deliberately more than
 * can ever fit, and beside three numbers that are budgets it would read as a
 * fourth budget.
 */
function Figures({ budget }: { budget: SessionMemoryBudget }) {
  return (
    <dl className={styles.budget}>
      <div className={styles.budgetRow}>
        <dt>Altogether</dt>
        <dd>{thousands(budget.totalTokens)} tokens</dd>
      </div>
      <div className={styles.budgetRow}>
        <dt>Conversation</dt>
        <dd>
          {thousands(budget.conversationTokens)} tokens, {budget.turns} turns
        </dd>
      </div>
      <div className={styles.budgetRow}>
        <dt>Tool results</dt>
        <dd>
          {thousands(budget.toolResultTokens)} tokens, longest {thousands(budget.longestResultTokens)}
        </dd>
      </div>
    </dl>
  );
}

/**
 * What the workspace decides for itself.
 *
 * Its name and description at the top, which only somebody who administers
 * *this* workspace may change; then what it decides for its agents; then the
 * models it uses for its own small jobs, which anybody who can see the
 * workspace may choose.
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

  /*
   * The kinds of thing this workspace files - issue #241.
   *
   * A workspace's own list and not the installation's: one team files bugs and
   * features, and the next files incidents and requests. Here rather than on a
   * page of its own because it is one short list, and a settings page that grew
   * a second page for every list would be a menu.
   */
  const [types, setTypes] = useState<IssueType[]>([]);
  const [newType, setNewType] = useState('');
  const [typeError, setTypeError] = useState<string | null>(null);
  const [typeBusy, setTypeBusy] = useState(false);
  /** Which type is being renamed, and to what. Null while none is. */
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  /*
   * The Agents card - issue #226.
   *
   * Its own draft and its own saved-and-failed states rather than the shared
   * pair above, for the reason the General card has its own: a slider is
   * dragged and then saved, so it has a moment of holding something the
   * workspace does not, and a message about that save has to appear beside it
   * rather than in whichever card the last select was in.
   */
  const [share, setShare] = useState<number | null>(null);
  /** Whether that share may be saved at all, which is the bounds and nothing else. */
  const [verdict, setVerdict] = useState<SessionMemoryBudget | null>(null);
  /** Which model the figures are figures for; '' is none, and shows none. */
  const [against, setAgainst] = useState('');
  /** What the share would mean for that one model. */
  const [preview, setPreview] = useState<SessionMemoryBudget | null>(null);
  const [memorySaved, setMemorySaved] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [memorySaving, setMemorySaving] = useState(false);

  /*
   * The Voice card - issue #256.
   *
   * Its own draft and its own saved-and-failed states, for the reason the two
   * cards above have theirs: three boxes are typed into and then saved
   * together, so the card holds something the workspace does not for as long as
   * that takes, and a refusal about it has to appear beside those boxes rather
   * than in whichever card a select was last used in.
   *
   * Strings rather than numbers, because empty is a value here and 0 is not
   * one: empty is the workspace having decided nothing, which is where every
   * workspace starts and what clearing a box goes back to. A number state would
   * have to invent something to mean that.
   */
  const [pause, setPause] = useState('');
  const [overRoom, setOverRoom] = useState('');
  const [unattended, setUnattended] = useState('');
  /**
   * Where an answer is cut for the speech model, drafted.
   *
   * Not a string-that-might-be-empty like the three above: one of the three is
   * always chosen, and the one chosen by default is on the list by name. The
   * default until the workspace has been read, so the control never draws blank.
   */
  const [chunking, setChunking] = useState<SpeechChunking>(CHUNKING_DEFAULT);
  const [voiceSaved, setVoiceSaved] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceSaving, setVoiceSaving] = useState(false);

  useEffect(() => {
    if (workspaceId === '') return;
    fetchWorkspace(workspaceId)
      .then((found) => {
        setWorkspace(found);
        setName(found?.name ?? '');
        setDescription(found?.description ?? '');
        setShare(found?.defaultMemoryShare ?? null);
        setPause(inBox(found?.voicePauseEndsTurnMs ?? null, A_SECOND));
        setOverRoom(inBox(found?.voiceSpeechOverRoomPercent ?? null, AS_IS));
        setUnattended(inBox(found?.voiceUnattendedMicrophoneMs ?? null, A_MINUTE));
        setChunking(found?.voiceSpeechChunking ?? CHUNKING_DEFAULT);
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

  /**
   * The models an agent could be pointed at, which are the ones a share of a
   * window means anything against.
   *
   * The agent form's own filter, so the model somebody previews the default
   * against is one an agent in this workspace could actually be given.
   */
  const answering = models.filter(answers);

  /*
   * Something to preview against as soon as there is anything to preview.
   *
   * The first model rather than none, because a figures panel that appears only
   * after a second choice is one most readers never see - and the whole
   * difficulty this card has is that a percentage means a different number of
   * tokens on every model, which is a thing to be shown rather than waited for.
   * Which model it starts on does not matter; the picker beside the figures
   * says which one they belong to, and changing it is one press.
   */
  useEffect(() => {
    if (against !== '' || answering.length === 0) return;
    setAgainst(answering[0].id);
  }, [against, answering]);

  useEffect(() => {
    if (workspaceId === '') return;
    fetchIssueTypes(workspaceId)
      .then(setTypes)
      .catch(() => setTypes([]));
  }, [workspaceId]);

  /*
   * Two questions about the drafted share, asked after the drag has stopped.
   *
   * They are two calls because they are two questions, and only one of them
   * decides anything. `workspaceDefault: true` is the judgement that matters -
   * whether this may be saved - and the server deliberately makes it on the
   * bounds alone, so its figures are the built-in allowance's rather than this
   * default's and are only worth printing at the Default position, where the
   * built-in allowance is exactly what agents get.
   *
   * The other is the same question an agent asks: what this share works out to
   * against one particular model. That is where the figures come from once a
   * share is set, and it is a preview in the strict sense - a workspace default
   * is not tied to a model and nothing that comes back from it can stop a save.
   *
   * Cancelled on the way out, so a slow answer to a share nobody is asking for
   * any more cannot land on top of a newer one.
   */
  useEffect(() => {
    if (workspaceId === '') return;

    let current = true;
    const timer = setTimeout(() => {
      const asking = [
        fetchMemoryBudget(workspaceId, null, share, true),
        share === null || against === ''
          ? Promise.resolve(null)
          : fetchMemoryBudget(workspaceId, against, share),
      ] as const;

      Promise.all(asking)
        .then(([bounds, shown]) => {
          if (!current) return;
          setVerdict(bounds);
          setPreview(shown);
        })
        .catch(() => {
          // The preview is not the setting. A failure here leaves the figures
          // off rather than putting a second error on a card that has its own.
          if (!current) return;
          setVerdict(null);
          setPreview(null);
        });
    }, PREVIEW_PAUSE);

    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [workspaceId, share, against]);

  /**
   * Why this default cannot be saved, in the server's words, or null.
   *
   * The bounds and nothing else, because that is all the mutation checks. A
   * model that could not give this share says so in the preview below and does
   * not stop the save: refusing a default because the smallest model in the
   * workspace could not give it would refuse a setting that is right for every
   * other model in it, and for agents that may never use that one.
   */
  const refusal = verdict?.refusal ?? null;

  /**
   * The default agents here fall back to, saved.
   *
   * Null clears it, which is what the Default position sends, and puts every
   * agent that sets nothing back on the built-in allowance.
   */
  async function remember() {
    if (memorySaving || refusal !== null) return;

    setMemorySaving(true);
    setMemoryError(null);
    setMemorySaved(false);
    try {
      const updated = await setWorkspaceDefaultMemoryShare(workspaceId, share);
      setWorkspace(updated);
      setShare(updated.defaultMemoryShare);
      setMemorySaved(true);
    } catch (cause) {
      setMemoryError(cause instanceof Error ? cause.message : 'Could not save that.');
    } finally {
      setMemorySaving(false);
    }
  }

  /**
   * How a turn ends here, saved.
   *
   * All three go on every call because that is what the mutation takes and what
   * lets a box be emptied at all: null clears one, and a form that sent only
   * what had changed would have no way to say "back to the default".
   *
   * Whatever comes back is what the boxes then hold, so what is on screen after
   * a save is what the workspace really has rather than what was typed at it.
   * Nothing here judges a value first: the bounds are the server's and are
   * stated in the sentence it refuses with, and a copy of them on this page
   * would be a second opinion about what may be saved.
   *
   * Two calls behind one press, and in this order. Turn-taking is three numbers
   * that are one decision and it is the half that can be refused, so a refusal
   * stops before the chunking is written and the card is left saying no with
   * nothing saved - rather than half saved, which is the state a reader of this
   * page cannot see. They are two calls at all because they are two decisions:
   * one about the half of a turn somebody else is talking and one about the
   * half the model is, and nothing about either can contradict the other.
   */
  async function listenLike() {
    if (voiceSaving) return;

    setVoiceSaving(true);
    setVoiceError(null);
    setVoiceSaved(false);
    try {
      await setWorkspaceVoiceTurnTaking(
        workspaceId,
        asStored(pause, A_SECOND),
        asStored(overRoom, AS_IS),
        asStored(unattended, A_MINUTE),
      );
      const updated = await setWorkspaceVoiceSpeechChunking(workspaceId, chunking);
      setWorkspace(updated);
      setPause(inBox(updated.voicePauseEndsTurnMs, A_SECOND));
      setOverRoom(inBox(updated.voiceSpeechOverRoomPercent, AS_IS));
      setUnattended(inBox(updated.voiceUnattendedMicrophoneMs, A_MINUTE));
      setChunking(updated.voiceSpeechChunking);
      setVoiceSaved(true);
    } catch (cause) {
      setVoiceError(cause instanceof Error ? cause.message : 'Could not save that.');
    } finally {
      setVoiceSaving(false);
    }
  }

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

  /*
   * Adding, renaming and taking away a type, each through the same wrapper.
   *
   * The refusal is printed as the server wrote it and never rephrased: a type
   * that issues are carrying cannot be deleted, and what the administrator
   * needs to see is how many - which only the server can count and only it
   * should be trusted to say.
   */
  async function withTypes(work: () => Promise<unknown>) {
    if (typeBusy) return;
    setTypeBusy(true);
    setTypeError(null);
    try {
      await work();
      setTypes(await fetchIssueTypes(workspaceId));
    } catch (cause) {
      setTypeError(cause instanceof Error ? cause.message : 'Could not change the issue types.');
    } finally {
      setTypeBusy(false);
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
        The kinds of thing this workspace files - issue #241.

        Behind `administered` like the General card above it, and for the same
        reason: this decides how the whole tracker sorts itself, and somebody
        who can file an issue should not be able to invent a fourth category on
        the way past.
      */}
      {workspace?.administered === true && (
        <section className={styles.card}>
          <div className={styles.sectionTitle}>
            <span className={styles.labelWithHint}>
              <h2 className={styles.sectionHeading}>Issues</h2>
              <FieldHint label="Issues">
                A type is what an issue is - one of these, or none. Labels are
                what a workspace says about an issue and stay free text, as many
                at once as it likes. Renaming a type carries every issue on it;
                deleting one is refused while any issue still carries it, and the
                refusal says how many.
              </FieldHint>
            </span>
            <div className={styles.rule} />
          </div>

          <div className={styles.field}>
            <span className={styles.label}>Issue types</span>
            <ul className={styles.typeList}>
              {types.map((type) => (
                <li key={type.id} className={styles.typeRow}>
                  {renaming?.id === type.id ? (
                    <input
                      className={`${styles.input} ${styles.typeName}`}
                      aria-label={`Rename ${type.name}`}
                      value={renaming.name}
                      autoFocus
                      onChange={(event) => setRenaming({ id: type.id, name: event.target.value })}
                      onBlur={() => setRenaming(null)}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') setRenaming(null);
                        if (event.key !== 'Enter') return;
                        const wanted = renaming.name.trim();
                        setRenaming(null);
                        if (wanted === '' || wanted === type.name) return;
                        void withTypes(() => renameIssueType(type.id, wanted));
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className={styles.typeName}
                      title="Rename"
                      onClick={() => setRenaming({ id: type.id, name: type.name })}
                    >
                      {type.name}
                    </button>
                  )}
                  <span className={styles.typeCount}>
                    {type.issues === 1 ? '1 issue' : `${type.issues} issues`}
                  </span>
                  <button
                    type="button"
                    className={styles.typeRemove}
                    aria-label={`Delete ${type.name}`}
                    disabled={typeBusy}
                    onClick={() => void withTypes(() => deleteIssueType(type.id))}
                  >
                    ×
                  </button>
                </li>
              ))}
              {types.length === 0 && <li className={styles.typeNone}>None yet.</li>}
            </ul>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="new-issue-type">
              Add a type
            </label>
            <div className={styles.typeAdd}>
              <div className={styles.inputWrapper}>
                <input
                  id="new-issue-type"
                  className={styles.input}
                  type="text"
                  value={newType}
                  maxLength={60}
                  placeholder="chore"
                  onChange={(event) => setNewType(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    const wanted = newType.trim();
                    if (wanted === '') return;
                    void withTypes(async () => {
                      await createIssueType(workspaceId, wanted);
                      setNewType('');
                    });
                  }}
                />
              </div>
              <button
                type="button"
                className={styles.save}
                disabled={newType.trim() === '' || typeBusy}
                onClick={() => {
                  const wanted = newType.trim();
                  void withTypes(async () => {
                    await createIssueType(workspaceId, wanted);
                    setNewType('');
                  });
                }}
              >
                Add
              </button>
            </div>
          </div>

          {typeError !== null && (
            <p className={styles.error} role="alert">
              {typeError}
            </p>
          )}
        </section>
      )}

      {/*
        What the workspace decides for its agents - issue #226.

        A card of its own, above the two below it, because those two are about
        one screen each and this is about every agent in the workspace. It is
        the middle step of three: an agent's own share, then this, then the
        built-in allowance. The per-agent setting is the right place to make an
        exception and the wrong place to state a policy - an installation that
        had decided its agents should remember more than the built-in allowance
        was saying so once per agent, again on every agent made afterwards, and
        could read the decision back only by opening every one of them.
      */}
      <section className={styles.card}>
        <div className={styles.sectionTitle}>
          <h2 className={styles.sectionHeading}>Agents</h2>
          <div className={styles.rule} />
        </div>

        {/*
          The control and its readout, kept close together and kept apart.

          The slider is the field; everything under it - the figures, the model
          they were worked out against, the sentence where there are no figures
          to give - is the card reading back what the field now holds, and it is
          drawn beside the field rather than inside it. That is not a detail of
          spacing: what a field prints under its own control is where an
          explanation hides when nobody wants to write a (?), which is what
          `hint-prose-check` reads. This is a readout, so it is not in there.
        */}
        <div className={styles.memory}>
          <div className={styles.field}>
            <span className={styles.labelWithHint}>
              <label className={styles.label} htmlFor="workspace-memory-share">
                Default Session Memory
              </label>
              <FieldHint label="Default Session Memory">
                How much of its model&rsquo;s context window one of an agent&rsquo;s sessions may hand
                back on its next turn: what was said in it, and what its tools last returned. This is
                what agents here are given when they set no share of their own — an agent that has set
                one keeps it. At Default nothing is decided and those agents get a fixed built-in
                allowance, which is what every workspace does until somebody sets this. It is a
                percentage rather than a count of tokens because the workspace runs several models
                whose windows differ by an order of magnitude, so the same share is a different number
                of tokens on each of them: the figures below are for the one model named beside them,
                and the picker changes which. A share a particular model cannot give is refused where
                that agent&rsquo;s budget is worked out, not here. Token figures are approximate — they
                are counted in characters and reported at four characters to the token.
              </FieldHint>
            </span>

            <div className={styles.shareRow}>
              <input
                id="workspace-memory-share"
                className={styles.shareSlider}
                type="range"
                min={DEFAULT_SHARE}
                max={MAX_SHARE}
                step={1}
                value={share ?? DEFAULT_SHARE}
                disabled={workspace === null}
                onChange={(event) => {
                  const at = Number(event.target.value);
                  setMemorySaved(false);
                  setShare(at === DEFAULT_SHARE ? null : at);
                }}
                aria-valuetext={share === null ? 'Default' : `${share}%`}
              />
              <output className={styles.shareValue} htmlFor="workspace-memory-share">
                {share === null ? 'Default' : `${share}%`}
              </output>
            </div>
          </div>

          {/*
            The refusal, or what the share means - never both.

            Which of three things is drawn is the whole of this card's honest
            problem, so it is worth saying plainly:

            - refused: the bounds sentence, in the server's own words. The track
              cannot reach a share outside them, so this is the safety net for
              the ceiling above having drifted from the server's - and it is the
              only thing here that turns Save off.
            - Default: the built-in allowance's own figures, which is exactly
              what agents get when the workspace decides nothing, and the one
              case where the figures depend on no model at all. There is nothing
              to work them out against, so nothing is offered to choose.
            - a share: what it works out to against one model, named. This is
              the honest difficulty of this setting - a share that is generous
              on a 200,000-token window is impossible on an 8,000-token one, and
              the server deliberately refuses a default on account of neither -
              and the answer taken here is to show it rather than to hide it or
              to invent a refusal this screen does not own. The figures are one
              model's and say whose; the picker changes which model, and changes
              nothing that is saved.
          */}
          {refusal !== null ? (
            <p className={styles.shareRefusal} role="alert">
              {refusal}
            </p>
          ) : share === null ? (
            verdict !== null && <Figures budget={verdict} />
          ) : (
            <>
              <div className={styles.previewPick}>
                <label className={styles.label} htmlFor="workspace-memory-against">
                  Worked Out Against
                </label>
                <div className={styles.inputWrapper}>
                  <select
                    id="workspace-memory-against"
                    className={`${styles.input} ${styles.select}`}
                    value={against}
                    onChange={(event) => setAgainst(event.target.value)}
                  >
                    <option value="">None — no figures shown</option>
                    {answering.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                  <img src={chevronDown12Icon} alt="" width={12} height={12} />
                </div>
              </div>

              {/*
                What that one model would make of it. Its refusal is printed
                where its figures would have been, because it is the answer to
                the same question - and it does not stop the save, since this
                default is not that model's and the agents it applies to may
                never use it.
              */}
              {preview !== null &&
                (preview.refusal !== null ? (
                  <p className={styles.shareNote}>{preview.refusal}</p>
                ) : (
                  <Figures budget={preview} />
                ))}
            </>
          )}
        </div>

        {memoryError !== null && (
          <p className={styles.error} role="alert">
            {memoryError}
          </p>
        )}

        <div className={styles.formActions}>
          {memorySaved && memoryError === null && <p className={styles.saved}>Saved.</p>}
          {/*
            A refused share stops the save here as well as at the server. Not
            instead of: the mutation refuses it from the same calculation, and
            this is only the card saying so before the press rather than after.
          */}
          <button
            type="button"
            className={styles.save}
            onClick={() => void remember()}
            disabled={workspace === null || memorySaving || refusal !== null}
          >
            {memorySaving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </section>

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
        How voice mode decides somebody has finished talking - issue #256.

        Beside the chat's own card and drawn under the same condition, because
        voice mode is a chat screen and nothing else: with chat switched off
        these three configure a panel nobody in this installation can open. A
        card of its own rather than three more fields on the one above, for the
        reason Quick Chat is one - that card chooses models, and this is a
        judgement about how people talk. Read as one list they would look like
        three more things to point at a model.

        It is here at all because getting one of these wrong ends somebody's
        sentence for them, which was reported three times over two numbers, and
        neither is a fact about audio that one answer settles: it is a room, a
        microphone and a person, and those differ.

        Empty is not zero. Every box is empty until somebody decides otherwise,
        which leaves voice mode on its own value - and the empty box says what
        that value is rather than this page pretending to hold it.
      */}
      {hasChat && (
      <section className={styles.card}>
        <div className={styles.sectionTitle}>
          <span className={styles.labelWithHint}>
            <h2 className={styles.sectionHeading}>Voice</h2>
            {/*
              Against the card rather than a field: what an empty box means is
              true of all three and a footnote to none of them.
            */}
            <FieldHint label="Voice">
              How the hands-free voice panel decides you have finished talking, so it can answer without
              you pressing anything between turns. Leave a box empty and voice mode uses its own value,
              which is what every workspace does until somebody changes one &mdash; the empty box says
              what that value is. None of this touches the microphone beside Send, which records until
              you press it again.
            </FieldHint>
          </span>
          <div className={styles.rule} />
        </div>

        <div className={styles.field}>
          <span className={styles.labelWithHint}>
            <label className={styles.label} htmlFor="voice-pause">
              Pause Before It Answers
            </label>
            <FieldHint label="Pause Before It Answers">
              How long you can go quiet, once it has heard you speak, before it takes that as your turn
              ending and sends what you said. Raise it if it answers while you are still talking: people
              stop to think in the middle of a sentence, and every one of those stops is this clock
              running. Lower it if it sits there after you have finished. Nothing is sent while a room is
              merely quiet &mdash; this only starts once somebody has spoken.
            </FieldHint>
          </span>
          <div className={styles.inputWrapper}>
            <input
              id="voice-pause"
              className={styles.input}
              type="number"
              inputMode="decimal"
              step={0.1}
              value={pause}
              placeholder={`Default — ${inBox(VOICE_TURN_TAKING_DEFAULTS.pauseEndsTurnMs, A_SECOND)}`}
              disabled={workspace === null}
              onChange={(event) => {
                setVoiceSaved(false);
                setPause(event.target.value);
              }}
            />
            <span className={styles.unit}>seconds</span>
          </div>
        </div>

        <div className={styles.field}>
          <span className={styles.labelWithHint}>
            <label className={styles.label} htmlFor="voice-over-room">
              Voice Above The Room
            </label>
            <FieldHint label="Voice Above The Room">
              How far above the room&rsquo;s own noise a sound has to stand to count as a voice rather
              than as the room &mdash; 300 is three times the room. Turn this down if it stops while you
              are still talking, and if you speak quietly or sit away from the microphone. Turn it up in a
              room with something going on in it, where a fan or a conversation behind you is heard as you
              and the turn never ends at all. The room is measured as it is actually heard, which is why
              this travels between microphones in a way a fixed loudness does not.
            </FieldHint>
          </span>
          <div className={styles.inputWrapper}>
            <input
              id="voice-over-room"
              className={styles.input}
              type="number"
              inputMode="numeric"
              step={10}
              value={overRoom}
              placeholder={`Default — ${inBox(VOICE_TURN_TAKING_DEFAULTS.speechOverRoomPercent, AS_IS)}`}
              disabled={workspace === null}
              onChange={(event) => {
                setVoiceSaved(false);
                setOverRoom(event.target.value);
              }}
            />
            <span className={styles.unit}>%</span>
          </div>
        </div>

        <div className={styles.field}>
          <span className={styles.labelWithHint}>
            <label className={styles.label} htmlFor="voice-unattended">
              Unattended Microphone
            </label>
            <FieldHint label="Unattended Microphone">
              How long an open microphone stays open when nothing else has ended the turn. A fuse rather
              than a limit on how much you may say: the pause above is what ends a turn, and this fires
              only where no pause ever came &mdash; a microphone left open in an empty room, or a room
              noisy enough to be heard as somebody talking. Every value here that looked like a
              reasonable limit on a turn turned out to cut somebody off in the middle of a thought, so it
              sits well past anything anybody says in one breath.
            </FieldHint>
          </span>
          <div className={styles.inputWrapper}>
            <input
              id="voice-unattended"
              className={styles.input}
              type="number"
              inputMode="numeric"
              step={1}
              value={unattended}
              placeholder={`Default — ${inBox(VOICE_TURN_TAKING_DEFAULTS.unattendedMicrophoneMs, A_MINUTE)}`}
              disabled={workspace === null}
              onChange={(event) => {
                setVoiceSaved(false);
                setUnattended(event.target.value);
              }}
            />
            <span className={styles.unit}>minutes</span>
          </div>
        </div>

        {/*
          Where an answer is cut for the speech model.

          On this card and not the one above it, although what it configures is
          the speech model: that card points things at models, and this is a
          judgement about listening. It is the last field here because it is
          about the half of a turn the model is talking, and the three above are
          about the half somebody else is.

          Three named things and no fourth. The default is `Sentence` and
          `Sentence` is on the list, so there is nothing for a "Default" option
          to mean that one of the three does not already say - and a control
          offering both would have to explain which of the two it saved.
        */}
        <div className={styles.field}>
          <span className={styles.labelWithHint}>
            <label className={styles.label} htmlFor="voice-chunking">
              Speech chunking
            </label>
            <FieldHint label="Speech chunking">
              <p>Where an answer is cut for the speech provider.</p>
              <ul>
                <li>
                  <strong>Sentence</strong> starts talking soonest.
                </li>
                <li>
                  <strong>Paragraph</strong> sends fewer, longer requests and reads more smoothly.
                </li>
                <li>
                  <strong>None</strong> waits for the whole answer and sends it once.
                </li>
              </ul>
            </FieldHint>
          </span>
          <div className={styles.inputWrapper}>
            <select
              id="voice-chunking"
              className={`${styles.input} ${styles.select}`}
              value={chunking}
              disabled={workspace === null}
              onChange={(event) => {
                setVoiceSaved(false);
                setChunking(event.target.value as SpeechChunking);
              }}
            >
              <option value="NONE">None</option>
              <option value="SENTENCE">Sentence</option>
              <option value="PARAGRAPH">Paragraph</option>
            </select>
            <img src={chevronDown12Icon} alt="" width={12} height={12} />
          </div>
        </div>

        {/*
          The server's own sentence, which names what is allowed rather than
          reporting that something was refused. Nothing on this page decides
          what may be saved, so this is the only place a bound is ever stated.
        */}
        {voiceError !== null && (
          <p className={styles.error} role="alert">
            {voiceError}
          </p>
        )}

        <div className={styles.formActions}>
          {voiceSaved && voiceError === null && <p className={styles.saved}>Saved.</p>}
          <button
            type="button"
            className={styles.save}
            onClick={() => void listenLike()}
            disabled={workspace === null || voiceSaving}
          >
            {voiceSaving ? 'Saving…' : 'Save Changes'}
          </button>
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
