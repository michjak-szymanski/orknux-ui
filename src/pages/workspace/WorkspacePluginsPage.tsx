import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

import {
  clearPluginParameter,
  fetchWorkspacePlugins,
  setPluginParameter,
} from '../../api/plugins';
import type { PluginParameterSetting, WorkspacePlugin } from '../../api/plugins';
import type { SessionUser } from '../../api/session';
import type { Variable } from '../../api/variables';
import puzzleIcon from '../../assets/puzzle.svg';
import { AppShell } from '../../components/AppShell';
import { FieldHint } from '../../components/FieldHint';
import { FieldPicker } from '../../components/FieldPicker';
import type { FieldOption, FieldPickerLabels } from '../../components/FieldPicker';
import { Loader } from '../../components/Loader';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import { useWorkspaceVariables } from './workspaceVariables';
import styles from './WorkspacePluginsPage.module.css';
import { t } from '../../i18n';

export interface WorkspacePluginsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/**
 * Written here, or read from somewhere else.
 *
 * The same two words a node's parameter offers in the workflow editor, because it
 * is the same question, and somebody who has answered it once there should not
 * have to work out that this screen is asking it again.
 */
type Answer = 'VALUE' | 'REFERENCE';

/**
 * What the picker says when the list it offers is this workspace's variables
 * rather than the fields an earlier node produces.
 */
const VARIABLE_LABELS: FieldPickerLabels = {
  empty: t('Choose a variable…'),
  search: t('Search variables'),
  none: t('This workspace has no variables yet.'),
  noMatch: t('No variable matches'),
  gone: 'no longer in this workspace',
};

/**
 * What this workspace has told the plugins loaded into the installation.
 *
 * Not the admin plugins screen and deliberately not beside it. Loading a plugin
 * is one decision made once for everyone; pointing it at this team's tracker with
 * this team's token is a different decision, made by the people whose tracker and
 * token they are. So this lists the same plugins and answers a different question.
 *
 * A plugin missing something it said it needs is marked in the list and again on
 * the parameter itself. Both come from the server rather than being worked out
 * here, or the row and what is inside it would eventually disagree.
 */
export function WorkspacePluginsPage({ session, onSignOut }: WorkspacePluginsPageProps) {
  const { workspaceId = '' } = useParams();

  const [plugins, setPlugins] = useState<WorkspacePlugin[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Which plugin's parameters are open. One at a time; this is a list, not a form. */
  const [open, setOpen] = useState<string | null>(null);
  /*
   * What the pickers offer, kept current rather than read once with the plugins.
   * A parameter is answered with a variable, and the variable it wants is often
   * made on the Variables page after this one was opened.
   */
  const { variables, refresh: refreshVariables } = useWorkspaceVariables(workspaceId);

  const load = useCallback(() => {
    if (workspaceId === '') return;
    setLoading(true);
    setError(null);
    fetchWorkspacePlugins(workspaceId)
      .then((found) => {
        setPlugins(found);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        setPlugins(null);
        setError(cause instanceof Error ? cause.message : t('Could not load the plugins.'));
        setLoading(false);
      });
  }, [workspaceId]);

  useEffect(load, [load]);

  /** One plugin's answer replaces that plugin's row, and nothing else moves. */
  function replace(answered: WorkspacePlugin) {
    setPlugins((current) =>
      current === null
        ? current
        : current.map((one) => (one.plugin.id === answered.plugin.id ? answered : one)),
    );
  }

  async function onSet(
    pluginId: string,
    name: string,
    answer: { literal: string } | { variableId: string },
  ) {
    setBusy(true);
    setError(null);
    try {
      replace(await setPluginParameter(workspaceId, pluginId, name, answer));
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : t('Could not set that parameter.'));
    } finally {
      setBusy(false);
    }
  }

  async function onClear(pluginId: string, name: string) {
    setBusy(true);
    setError(null);
    try {
      replace(await clearPluginParameter(workspaceId, pluginId, name));
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : t('Could not clear that parameter.'));
    } finally {
      setBusy(false);
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
      <section className={styles.card}>
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <h1 className={styles.title}>{t('Plugins')}</h1>
            <p className={styles.subtitle}>
              {t('What this workspace tells the plugins loaded into the installation. A plugin only ever sees what is set here, so this list is also the answer to what each one can reach.')}
            </p>
          </div>
        </header>

        {loading && (
          <p className={styles.notice}>
            <Loader />
          </p>
        )}
        {error !== null && <p className={`${styles.notice} ${styles.noticeError}`}>{error}</p>}
        {!loading && error === null && plugins?.length === 0 && (
          <p className={styles.notice}>
            {t('No plugins are loaded into this installation, so there is nothing to configure.')}
          </p>
        )}

        {/*
          Said outright, because a page listing plugins and offering nothing against
          any of them reads as broken rather than as finished. What can be set here
          is what a plugin asked for, so plugins that ask for nothing leave a list
          with nothing to open — and that sentence is the difference between a
          screen that is working and one somebody reports.
        */}
        {!loading && error === null && plugins !== null && plugins.length > 0 && asksForNothing(plugins) && (
          <p className={styles.notice}>
            <span className={styles.labelWithHint}>
              None of the plugins loaded into this installation ask for anything, so there is nothing
              for this workspace to set.
              {/*
                Why the list is empty is the status and stays. How a plugin comes
                to have anything here at all is teaching, and goes behind the (?).
              */}
              <FieldHint label={t('Nothing to set')}>
                A plugin declares what it has to be told and only what it declares can be answered
                here
                {session.admin
                  ? ' — the template on the admin plugins page shows how a plugin declares a parameter.'
                  : '.'}
              </FieldHint>
            </span>
          </p>
        )}

        {plugins !== null && plugins.length > 0 && (
          <div className={styles.table}>
            <div className={styles.tableHeader}>
              <span className={styles.colName}>{t('Plugin')}</span>
              <span className={styles.colParams}>{t('Parameters')}</span>
            </div>

            {plugins.map((entry) => {
              const opens = entry.parameters.length > 0;
              const showing = open === entry.plugin.id;

              return (
                <div key={entry.plugin.id} className={styles.group}>
                  <div className={styles.row}>
                    <span className={styles.colName}>
                      <img className={styles.icon} src={puzzleIcon} alt="" width={16} height={16} />
                      <span className={styles.nameBlock}>
                        <span className={styles.name}>
                          {/*
                            The name is the way in, because it is what somebody
                            reaches for first. A real button, so Tab reaches it and
                            a reader announces it as something that opens - and a
                            plugin with nothing to open stays plain text rather than
                            becoming a control that answers a click with nothing.
                          */}
                          {opens ? (
                            <button
                              type="button"
                              className={styles.nameButton}
                              aria-expanded={showing}
                              aria-controls={`plugin-parameters-${entry.plugin.id}`}
                              title={`${showing ? 'Close' : 'Open'} what ${entry.plugin.name} asks for`}
                              onClick={() => {
                                // Opening the parameters is reaching for the
                                // list they are answered from, so it is read
                                // again; the picker takes what lands.
                                if (!showing) refreshVariables();
                                setOpen(showing ? null : entry.plugin.id);
                              }}
                            >
                              {entry.plugin.name}
                              <span className={styles.caret} aria-hidden="true">
                                {showing ? '▴' : '▾'}
                              </span>
                            </button>
                          ) : (
                            <span title={`${entry.plugin.name} declares no parameters, so it has nothing to set`}>
                              {entry.plugin.name}
                            </span>
                          )}
                          {/*
                            The red mark the list is read for. Titled rather than
                            left as decoration, so hovering says which parameters
                            are missing without opening anything.
                          */}
                          {entry.missing.length > 0 && (
                            <span
                              className={styles.mark}
                              title={`Not set: ${entry.missing.join(', ')}`}
                              aria-label={`Not set: ${entry.missing.join(', ')}`}
                            >
                              ●
                            </span>
                          )}
                        </span>
                        <span className={styles.key}>{entry.plugin.key}</span>
                      </span>
                    </span>

                    <span className={styles.colParams}>
                      <Summary entry={entry} />
                    </span>
                  </div>

                  {showing && (
                    <div className={styles.details} id={`plugin-parameters-${entry.plugin.id}`}>
                      {entry.parameters.map((parameter) => (
                        <ParameterRow
                          key={parameter.name}
                          pluginId={entry.plugin.id}
                          parameter={parameter}
                          variables={variables}
                          busy={busy}
                          onSet={(answer) => void onSet(entry.plugin.id, parameter.name, answer)}
                          onClear={() => void onClear(entry.plugin.id, parameter.name)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </AppShell>
  );
}

/** Whether every plugin in the list declared no parameters at all. */
function asksForNothing(plugins: WorkspacePlugin[]): boolean {
  return plugins.every((one) => one.parameters.length === 0);
}

/** What the row says about a plugin without opening it. */
function Summary({ entry }: { entry: WorkspacePlugin }) {
  /*
   * "Declares no parameters" rather than "needs nothing": the first says whose
   * doing it is that the row cannot be opened, and the second reads as if this
   * page had decided there was nothing worth showing.
   */
  if (entry.parameters.length === 0) {
    return <span className={styles.muted}>{t('declares no parameters')}</span>;
  }
  if (entry.missing.length > 0) {
    return (
      <span className={styles.missingText}>
        {entry.missing.length === 1
          ? `${entry.missing[0]} is not set`
          : `${entry.missing.length} parameters are not set`}
      </span>
    );
  }
  return (
    <span className={styles.muted}>
      {entry.parameters.length === 1 ? t('1 parameter set') : `all ${entry.parameters.length} set`}
    </span>
  );
}

interface ParameterRowProps {
  pluginId: string;
  parameter: PluginParameterSetting;
  variables: Variable[];
  busy: boolean;
  onSet: (answer: { literal: string } | { variableId: string }) => void;
  onClear: () => void;
}

/**
 * One parameter, and the two ways of answering it.
 *
 * Laid out the way a node's parameter is laid out in the workflow editor: the
 * name, then the Value-or-Reference switch, then whichever control that choice
 * asks for. It is the same question in both places, and reading as two unrelated
 * screens was the complaint.
 *
 * A secret can only be answered by pointing at a variable, because the server
 * refuses a typed-in value for one - a form that offered the box and then reported
 * the refusal would be inviting somebody to paste a token into a page that shows
 * it back. So the switch still says both words and Value is the one that cannot
 * be pressed, which says why rather than quietly leaving half the control out.
 */
function ParameterRow({ pluginId, parameter, variables, busy, onSet, onClear }: ParameterRowProps) {
  const [typed, setTyped] = useState(parameter.literal ?? '');

  // The stored value is the one to edit whenever it changes underneath, which it
  // does every time an answer comes back from the server.
  useEffect(() => setTyped(parameter.literal ?? ''), [parameter.literal]);

  const stored: Answer = parameter.secret || parameter.variableId !== null ? 'REFERENCE' : 'VALUE';
  const [mode, setMode] = useState<Answer>(stored);

  /*
   * Switching only changes which control is shown, and sends nothing: an answer
   * already stored is not thrown away by looking at the other way of giving one.
   * What is stored wins again the moment the server says anything, so the switch
   * cannot end up describing something other than what is set.
   */
  useEffect(() => setMode(stored), [stored]);

  const answered = parameter.literal !== null || parameter.variableId !== null;
  const unsaved = typed.trim() !== '' && typed.trim() !== (parameter.literal ?? '');
  const fieldId = `plugin-parameter-${pluginId}-${parameter.name}`;

  /*
   * A workspace variable in the shape the picker offers things in. Grouped by
   * catalog for the reason the editor groups by node: a name on its own is not
   * always enough to know which one was meant.
   */
  const options = useMemo<FieldOption[]>(
    () =>
      variables.map((variable) => ({
        groupKey: variable.catalogId,
        groupName: variable.catalogName,
        field: variable.name,
        expression: variable.id,
        type: variable.type.toLowerCase(),
      })),
    [variables],
  );

  return (
    <div className={`${styles.parameter} ${parameter.missing ? styles.parameterMissing : ''}`}>
      <span className={styles.parameterHead}>
        <span className={styles.parameterNameGroup}>
          <label className={styles.parameterName} htmlFor={fieldId}>
            {parameter.name}
          </label>
          {/*
            What the plugin says this parameter is for, asked for rather than
            printed: a plugin with six parameters printed six paragraphs, and
            the boxes to fill in were outnumbered by prose about them.
          */}
          {parameter.description !== null && (
            <FieldHint label={parameter.name}>{parameter.description}</FieldHint>
          )}
          <span className={styles.parameterType}>{parameter.type.toLowerCase()}</span>
          {parameter.required && <span className={styles.required}>{t('required')}</span>}
          {parameter.secret && <span className={styles.secret}>{t('secret')}</span>}
        </span>
        <span className={styles.parameterActions}>
          {/*
            Against the parameter itself, which is what the issue asks for: a plugin
            marked in the list is one thing, being told which of its parameters is
            the problem is what somebody actually needs to act on.
          */}
          {parameter.missing && <span className={styles.parameterMark}>{t('not set')}</span>}
          {answered && (
            <button type="button" className={styles.parameterAction} disabled={busy} onClick={onClear}>
              {t('Clear')}
            </button>
          )}
        </span>
      </span>

      <div className={styles.modeRow}>
        <div className={styles.modeSwitch} role="group" aria-label={`${parameter.name} source`}>
          {(['VALUE', 'REFERENCE'] as Answer[]).map((option) => (
            <button
              key={option}
              type="button"
              className={mode === option ? `${styles.modeOption} ${styles.modeOptionOn}` : styles.modeOption}
              aria-pressed={mode === option}
              disabled={parameter.secret && option === 'VALUE'}
              title={
                parameter.secret && option === 'VALUE'
                  ? t('A secret is only ever answered by pointing at a variable')
                  : undefined
              }
              onClick={() => setMode(option)}
            >
              {option === 'VALUE' ? 'Value' : 'Reference'}
            </button>
          ))}
        </div>
        {/*
          The two words the switch offers, explained once beside it. The same
          sentence stood under every parameter of every plugin, which is a lot
          of screen for something somebody reads once.
        */}
        <FieldHint label={t('Source')}>
          <strong>{t('Value')}</strong> is used exactly as written. <strong>{t('Reference')}</strong> reads one of this
          workspace&apos;s variables, and what that variable holds is never shown here.
        </FieldHint>
      </div>

      {mode === 'REFERENCE' ? (
        /*
         * Held to a width rather than filling the row. The picker is built to sit
         * in the editor's inspector, which is narrow, and a control stretched
         * across a full-width page stops looking like the same thing.
         */
        <div className={styles.reference}>
          <FieldPicker
            options={options}
            value={parameter.variableId ?? ''}
            label={`${parameter.name} reference`}
            labels={VARIABLE_LABELS}
            onChange={(option) => onSet({ variableId: option.expression })}
          />
        </div>
      ) : (
        <div className={styles.inputWrapper}>
          <input
            id={fieldId}
            className={`${styles.input} ${styles.parameterValue}`}
            value={typed}
            disabled={busy}
            placeholder={`A ${parameter.type.toLowerCase()}`}
            spellCheck={false}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && unsaved) onSet({ literal: typed.trim() });
            }}
          />
          {/*
            A workflow is saved as a whole and this is not: each answer is stored on
            its own, the moment it is given. Choosing a variable stores itself, so
            only the typed side needs somewhere to say "that one, then" - always
            there rather than appearing on the first keystroke, so nothing arrives
            under the cursor mid-sentence.
          */}
          <button
            type="button"
            className={styles.parameterAction}
            disabled={busy || !unsaved}
            onClick={() => onSet({ literal: typed.trim() })}
          >{t('Set')}</button>
        </div>
      )}

      {/*
        Both of these stay printed. The first is a dead end - the only way to
        answer this parameter is a list that is empty - and the second is what
        the parameter currently is, which is a reading and not an explanation.
      */}
      {parameter.secret && variables.length === 0 && (
        <p className={styles.parameterNote}>
          {t('A secret is only ever answered by pointing at a variable, and this workspace has none yet. Add one on the Variables page and it will be offered here.')}
        </p>
      )}

      {parameter.variableName !== null && (
        <p className={styles.parameterNote}>
          Reads {parameter.variableName} when the plugin runs, so changing that variable changes what the
          plugin is handed.
        </p>
      )}
    </div>
  );
}
