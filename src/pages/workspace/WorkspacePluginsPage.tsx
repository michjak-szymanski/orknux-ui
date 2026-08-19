import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import {
  clearPluginParameter,
  fetchWorkspacePlugins,
  setPluginParameter,
} from '../../api/plugins';
import type { PluginParameterSetting, WorkspacePlugin } from '../../api/plugins';
import type { SessionUser } from '../../api/session';
import { fetchVariables } from '../../api/variables';
import type { Variable } from '../../api/variables';
import puzzleIcon from '../../assets/puzzle.svg';
import { AppShell } from '../../components/AppShell';
import { Loader } from '../../components/Loader';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './WorkspacePluginsPage.module.css';

export interface WorkspacePluginsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/** More variables than a workspace realistically keeps, so the picker is complete. */
const VARIABLE_LIMIT = 500;

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
  const [variables, setVariables] = useState<Variable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Which plugin's parameters are open. One at a time; this is a list, not a form. */
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    if (workspaceId === '') return;
    setLoading(true);
    setError(null);
    Promise.all([
      fetchWorkspacePlugins(workspaceId),
      fetchVariables(workspaceId, { size: VARIABLE_LIMIT }),
    ])
      .then(([found, held]) => {
        setPlugins(found);
        setVariables(held.content);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        setPlugins(null);
        setError(cause instanceof Error ? cause.message : 'Could not load the plugins.');
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
      setError(cause instanceof Error ? cause.message : 'Could not set that parameter.');
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
      setError(cause instanceof Error ? cause.message : 'Could not clear that parameter.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      user={shellUser(session)}
      section="workspace"
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} active="plugins" />}
    >
      <section className={styles.card}>
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <h1 className={styles.title}>Plugins</h1>
            <p className={styles.subtitle}>
              What this workspace tells the plugins loaded into the installation. A plugin only ever
              sees what is set here, so this list is also the answer to what each one can reach.
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
            No plugins are loaded into this installation, so there is nothing to configure.
          </p>
        )}

        {plugins !== null && plugins.length > 0 && (
          <div className={styles.table}>
            <div className={styles.tableHeader}>
              <span className={styles.colName}>Plugin</span>
              <span className={styles.colParams}>Parameters</span>
              <span className={styles.colActions} />
            </div>

            {plugins.map((entry) => (
              <div key={entry.plugin.id} className={styles.group}>
                <div className={styles.row}>
                  <span className={styles.colName}>
                    <img className={styles.icon} src={puzzleIcon} alt="" width={16} height={16} />
                    <span className={styles.nameBlock}>
                      <span className={styles.name}>
                        {entry.plugin.name}
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

                  <span className={styles.colActions}>
                    {entry.parameters.length > 0 && (
                      <button
                        type="button"
                        className={styles.rowAction}
                        onClick={() => setOpen(open === entry.plugin.id ? null : entry.plugin.id)}
                      >
                        {open === entry.plugin.id ? 'Close' : 'Details'}
                      </button>
                    )}
                  </span>
                </div>

                {open === entry.plugin.id && (
                  <div className={styles.details}>
                    {entry.parameters.map((parameter) => (
                      <ParameterRow
                        key={parameter.name}
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
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}

/** What the row says about a plugin without opening it. */
function Summary({ entry }: { entry: WorkspacePlugin }) {
  if (entry.parameters.length === 0) {
    return <span className={styles.muted}>needs nothing</span>;
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
      {entry.parameters.length === 1 ? '1 parameter set' : `all ${entry.parameters.length} set`}
    </span>
  );
}

interface ParameterRowProps {
  parameter: PluginParameterSetting;
  variables: Variable[];
  busy: boolean;
  onSet: (answer: { literal: string } | { variableId: string }) => void;
  onClear: () => void;
}

/**
 * One parameter, and the two ways of answering it.
 *
 * A secret one offers only the variable, because the server refuses a typed-in
 * value for it — a form that offered the box and then reported a refusal would be
 * inviting somebody to paste a token into a page that shows it back.
 */
function ParameterRow({ parameter, variables, busy, onSet, onClear }: ParameterRowProps) {
  const [typed, setTyped] = useState(parameter.literal ?? '');

  // The stored value is the one to edit whenever it changes underneath, which it
  // does every time an answer comes back from the server.
  useEffect(() => setTyped(parameter.literal ?? ''), [parameter.literal]);

  const answered = parameter.literal !== null || parameter.variableId !== null;

  return (
    <div className={`${styles.parameter} ${parameter.missing ? styles.parameterMissing : ''}`}>
      <div className={styles.parameterHead}>
        <span className={styles.parameterName}>
          {parameter.name}
          <span className={styles.parameterType}>{parameter.type.toLowerCase()}</span>
          {parameter.required && <span className={styles.required}>required</span>}
          {parameter.secret && <span className={styles.secret}>secret</span>}
        </span>
        {/*
          Against the parameter itself, which is what the issue asks for: a plugin
          marked in the list is one thing, being told which of its parameters is
          the problem is what somebody actually needs to act on.
        */}
        {parameter.missing && <span className={styles.parameterMark}>not set</span>}
      </div>

      {parameter.description !== null && (
        <p className={styles.parameterDescription}>{parameter.description}</p>
      )}

      <div className={styles.parameterControls}>
        {!parameter.secret && (
          <>
            <input
              className={styles.value}
              value={typed}
              disabled={busy}
              placeholder={`A ${parameter.type.toLowerCase()}`}
              aria-label={`${parameter.name} value`}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && typed.trim() !== '') onSet({ literal: typed.trim() });
              }}
            />
            <button
              type="button"
              className={styles.save}
              disabled={busy || typed.trim() === ''}
              onClick={() => onSet({ literal: typed.trim() })}
            >
              Set
            </button>
            <span className={styles.or}>or</span>
          </>
        )}

        <select
          className={styles.picker}
          disabled={busy}
          value={parameter.variableId ?? ''}
          aria-label={`${parameter.name} variable`}
          onChange={(event) => {
            if (event.target.value !== '') onSet({ variableId: event.target.value });
          }}
        >
          <option value="">
            {parameter.secret ? 'Choose a variable' : 'Read a variable'}
          </option>
          {variables.map((variable) => (
            <option key={variable.id} value={variable.id}>
              {variable.name}
            </option>
          ))}
        </select>

        {answered && (
          <button type="button" className={styles.clear} disabled={busy} onClick={onClear}>
            Clear
          </button>
        )}
      </div>

      {parameter.variableName !== null && (
        <p className={styles.parameterNote}>
          Reads {parameter.variableName} when the plugin runs, so changing that variable changes
          what the plugin is handed. Its value is never shown here.
        </p>
      )}
    </div>
  );
}
