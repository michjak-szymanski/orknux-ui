import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchPluginSource,
  fetchPlugins,
  loadPlugin,
  pluginSize,
  pluginSourceUrl,
  pluginTemplate,
  unloadPlugin,
} from '../../api/plugins';
import type { Plugin } from '../../api/plugins';
import type { SessionUser } from '../../api/session';
import { timeAgo } from '../../api/tools';
import downloadIcon from '../../assets/download.svg';
import fileCodeIcon from '../../assets/file-code.svg';
import infoIcon from '../../assets/info.svg';
import plusIcon from '../../assets/plus.svg';
import puzzleIcon from '../../assets/puzzle.svg';
import trashIcon from '../../assets/trash-2.svg';
import { AdminSidebar } from '../../components/AdminSidebar';
import { AppShell } from '../../components/AppShell';
import { Loader } from '../../components/Loader';
import { shellUser } from '../../session/user';
import styles from './AdminPluginsPage.module.css';

export interface AdminPluginsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/**
 * The plugins loaded into this installation.
 *
 * An organisation-level screen, beside workspaces and integrations, because a
 * plugin is loaded once for everyone rather than per workspace.
 *
 * List, load, unload, and read what each one declares - the functions it offers
 * and the parameters it needs. What those parameters are set to is not here: the
 * answers belong to each workspace, on that workspace's own Plugins page, because
 * the same plugin points at two different projects for two different teams.
 */
export function AdminPluginsPage({ session, onSignOut }: AdminPluginsPageProps) {
  const [plugins, setPlugins] = useState<Plugin[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** The plugin whose unload is waiting to be confirmed. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  /** A plugin somewhere on the web, by its URL. */
  const [url, setUrl] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchPlugins()
      .then((found) => {
        setPlugins(found);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        setPlugins(null);
        setError(cause instanceof Error ? cause.message : 'Could not load the plugins.');
        setLoading(false);
      });
  }, []);

  useEffect(load, [load]);

  /** From a file or from a URL: the same plugin, loaded the same way. */
  async function loadSource(name: string, source: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const loaded = await loadPlugin(name, source);
      const what = loaded.replaced ? `Replaced ${loaded.plugin.key}` : `Loaded ${loaded.plugin.key}`;
      // Saying what it provides is the useful half: those names are what a
      // workflow will pick, and they are prefixed, so they are not what the
      // plugin author typed.
      setNotice(
        loaded.provides.length === 0
          ? `${what}. It declares no functions.`
          : `${what}. Provides ${loaded.provides.join(', ')}.`,
      );
      load();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Could not load that plugin.');
    } finally {
      setBusy(false);
      // Cleared so choosing the same file again still counts as a change.
      if (picker.current !== null) picker.current.value = '';
    }
  }

  async function onPicked(file: File | undefined) {
    if (file === undefined) return;
    await loadSource(file.name, await file.text());
  }

  /**
   * Loads a plugin from a URL.
   *
   * Fetched by the browser rather than by the server, which is what makes a
   * TypeScript file loadable at all — the compiler is here, not there. The cost is
   * the other site's CORS policy, and a host that refuses is reported as refusing.
   */
  async function onUrl() {
    const address = url.trim();
    if (address === '') return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { name, source } = await fetchPluginSource(address);
      setUrl('');
      await loadSource(name, source);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Could not fetch that URL.');
      setBusy(false);
    }
  }

  /**
   * Saves a plugin to start from.
   *
   * The file is built into a blob and handed to a link click, which is how a
   * browser is asked to save something it was given rather than something it
   * navigated to — and it keeps the session cookie on the fetch that got it.
   */
  async function onTemplate() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { filename, source } = await pluginTemplate();
      const saved = URL.createObjectURL(new Blob([source], { type: 'text/plain' }));
      const link = document.createElement('a');
      link.href = saved;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(saved);
      setNotice(`Saved ${filename}. Edit it and load it back.`);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Could not fetch the template.');
    } finally {
      setBusy(false);
    }
  }

  async function onUnload(plugin: Plugin) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await unloadPlugin(plugin.id);
      setNotice(`Unloaded ${plugin.name}.`);
      setConfirming(null);
      load();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Could not unload that plugin.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      user={shellUser(session)}
      section="admin"
      onSignOut={onSignOut}
      sidebar={<AdminSidebar active="plugins" />}
    >
      <header className={styles.titleBar}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>Plugins</h1>
          <p className={styles.subtitle}>
            JavaScript plugins loaded into this installation.{' '}
            {/*
              Said here because this is where somebody stands when they need it.
              A plugin is one file, and the library that produces it - the class
              to extend and the tool that bundles a project into that one file -
              lives elsewhere and is otherwise something you would have to know
              about already.
            */}
            Write one against{' '}
            <a
              className={styles.subtitleLink}
              href="https://github.com/michjak-szymanski/orknux-extension"
              target="_blank"
              rel="noreferrer noopener"
            >
              @orknux/plugin
            </a>
            , which bundles a project into the single file this page takes.
          </p>
        </div>
        {/*
         * The real input is hidden and driven by the button: a file input styles
         * differently in every browser, and this one has to sit beside the other
         * admin screens' buttons and look like them.
         */}
        <input
          ref={picker}
          className={styles.picker}
          type="file"
          accept=".js,.mjs,.ts,.mts,text/javascript,text/plain"
          onChange={(event) => void onPicked(event.target.files?.[0])}
        />
        <div className={styles.actions}>
          {/* A plugin that already answers both questions, so it loads unchanged. */}
          <button type="button" className={styles.template} disabled={busy} onClick={() => void onTemplate()}>
            <img src={fileCodeIcon} alt="" width={14} height={14} />
            Get Template
          </button>
          <span className={styles.divider} aria-hidden="true" />
          <button
            type="button"
            className={styles.load}
            disabled={busy}
            onClick={() => picker.current?.click()}
          >
            <img src={plusIcon} alt="" width={14} height={14} />
            Load Plugin
          </button>
        </div>
      </header>

        {/*
          A plugin does not have to be a file on this machine. The browser fetches
          the URL and compiles it if it is TypeScript, then loads it exactly as a
          picked file — one path, so a plugin behaves the same whichever way it
          arrived.
        */}
        <div className={styles.fromUrl}>
          <input
            className={styles.urlInput}
            type="url"
            value={url}
            placeholder="https://raw.githubusercontent.com/…/plugin.ts"
            aria-label="Plugin URL"
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void onUrl();
            }}
          />
          <button
            type="button"
            className={styles.template}
            disabled={busy || url.trim() === ''}
            onClick={() => void onUrl()}
          >
            Load from URL
          </button>
        </div>


      <section className={styles.card}>
        <div className={styles.tableHeader}>
          <span className={styles.colName}>Name</span>
          <span className={styles.colApi}>API</span>
          <span className={styles.colSize}>Size</span>
          <span className={styles.colWhen}>Loaded</span>
          <span className={styles.colActions}>Actions</span>
        </div>

        {loading && (
          <p className={styles.notice}>
            <Loader />
          </p>
        )}
        {error !== null && <p className={`${styles.notice} ${styles.noticeError}`}>{error}</p>}
        {notice !== null && error === null && <p className={styles.notice}>{notice}</p>}
        {!loading && error === null && plugins?.length === 0 && (
          <p className={styles.notice}>No plugins loaded yet.</p>
        )}

        {plugins?.map((plugin) => (
          <div key={plugin.id} className={styles.row}>
            <span className={styles.colName}>
              <img className={styles.icon} src={puzzleIcon} alt="" width={16} height={16} />
              <span className={styles.nameBlock}>
                <span className={styles.name}>{plugin.name}</span>
                {/*
                 * What it declares, under the name. A plugin is worth listing for
                 * what it offers, and "declares 2 functions" answers less than
                 * saying which.
                 */}
                <span className={styles.declares}>
                  {plugin.declaredFunctions.length === 0
                    ? 'declares no functions'
                    : plugin.declaredFunctions
                        .map((one) => `${one.name}${one.signature}`)
                        .join('  ·  ')}
                </span>
                {/*
                  What it asks to be told. Listed here because it is the whole of
                  what a plugin can reach, which is the thing an operator wants to
                  read before loading one. What each workspace sets it to is the
                  workspace's own screen; this is only the question.
                */}
                {plugin.declaredParameters.length > 0 && (
                  <span className={styles.declares}>
                    needs{' '}
                    {plugin.declaredParameters
                      .map((one) => `${one.name}${one.required ? '' : '?'}: ${one.type.toLowerCase()}`)
                      .join('  ·  ')}
                  </span>
                )}
              </span>
            </span>
            {/* The plugin API it asked for, which the server agreed to. */}
            <span className={styles.colApi}>
              <span className={styles.api}>v{plugin.apiVersion}</span>
            </span>
            <span className={`${styles.colSize} ${styles.muted}`}>{pluginSize(plugin.sizeBytes)}</span>
            <span className={`${styles.colWhen} ${styles.muted}`}>
              {timeAgo(plugin.uploadedAt)}
              {plugin.uploadedBy !== '' && ` by ${plugin.uploadedBy}`}
            </span>
            <span className={styles.colActions}>
              {/*
                What was written, not what runs: TypeScript where there is any. A
                plain link, so the browser saves it and the session cookie goes with
                the request.
              */}
              <a
                className={styles.rowAction}
                href={pluginSourceUrl(plugin.id)}
                title={`Download ${plugin.name}`}
                aria-label={`Download ${plugin.name}`}
              >
                <img src={downloadIcon} alt="" width={14} height={14} />
              </a>
              {/*
               * Confirmed in the row rather than in a modal. Unloading is one
               * click and the only dialog in this codebase that would fit is the
               * workflow one, which is about workflows.
               */}
              {confirming === plugin.id ? (
                <>
                  <button
                    type="button"
                    className={styles.confirm}
                    disabled={busy}
                    onClick={() => void onUnload(plugin)}
                  >
                    Unload
                  </button>
                  <button type="button" className={styles.cancel} onClick={() => setConfirming(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={styles.rowAction}
                  disabled={busy}
                  onClick={() => setConfirming(plugin.id)}
                  aria-label={`Unload ${plugin.name}`}
                  title={`Unload ${plugin.name}`}
                >
                  <img src={trashIcon} alt="" width={14} height={14} />
                </button>
              )}
            </span>
          </div>
        ))}
      </section>

      <p className={styles.disclaimer}>
        <img src={infoIcon} alt="" width={14} height={14} />
        A plugin's functions are available in every workspace, and run out of the plugin's own text
        in its own sandbox. What a plugin needs to be told is set per workspace, on that workspace's
        Plugins page. Loading a file with a name already in the list replaces it.
      </p>
    </AppShell>
  );
}
