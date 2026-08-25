import { useCallback, useEffect, useRef, useState } from 'react';

import {
  PluginPermissionsRequired,
  fetchPluginSource,
  fetchPlugins,
  loadPlugin,
  pluginSize,
  pluginSourceUrl,
  pluginTemplate,
  unloadPlugin,
} from '../../api/plugins';
import type { Plugin, PluginPermission } from '../../api/plugins';
import type { SessionUser } from '../../api/session';
import { timeAgo } from '../../api/tools';
import downloadIcon from '../../assets/download.svg';
import fileCodeIcon from '../../assets/file-code.svg';
import plusIcon from '../../assets/plus.svg';
import puzzleIcon from '../../assets/puzzle.svg';
import trashIcon from '../../assets/trash-2.svg';
import { AdminSidebar } from '../../components/AdminSidebar';
import { AppShell } from '../../components/AppShell';
import { FieldHint } from '../../components/FieldHint';
import { Loader } from '../../components/Loader';
import { shellUser } from '../../session/user';
import styles from './AdminPluginsPage.module.css';
import { t } from '../../i18n';

export interface AdminPluginsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/**
 * A load stopped at the question of what the plugin is allowed to do.
 *
 * The source is held rather than fetched again, so accepting is the same load
 * carried on — a URL that answered once and has changed since cannot become a
 * different plugin between the list being read and the list being agreed to.
 */
interface Asking {
  /** The name it arrived as: what was picked, or the last part of the URL. */
  name: string;
  source: string;
  /** The server's list, in the server's words. */
  permissions: PluginPermission[];
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
  /** The load waiting on somebody agreeing to what the plugin asked for. */
  const [asking, setAsking] = useState<Asking | null>(null);
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
        setError(cause instanceof Error ? cause.message : t('Could not load the plugins.'));
        setLoading(false);
      });
  }, []);

  useEffect(load, [load]);

  /**
   * From a file or from a URL: the same plugin, loaded the same way.
   *
   * And refused the same way. A plugin that declares permissions nobody has
   * agreed to comes back with the list rather than with the plugin, and that
   * list is put in front of somebody here — so whichever way a plugin arrived,
   * the same question is asked before the sandbox is relaxed for it.
   */
  async function loadSource(name: string, source: string, accept?: string[]) {
    setBusy(true);
    setError(null);
    setNotice(null);
    setAsking(null);
    try {
      const loaded = await loadPlugin(name, source, accept);
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
      /*
        Not an error to reprint: it is a decision nobody has made yet. The
        message the server sent says the same thing in one sentence, and the
        list below says it in the shape somebody can answer.
      */
      if (cause instanceof PluginPermissionsRequired) {
        setAsking({ name, source, permissions: cause.permissions });
      } else {
        setError(cause instanceof Error ? cause.message : t('Could not load that plugin.'));
      }
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
    setAsking(null);
    try {
      const { name, source } = await fetchPluginSource(address);
      setUrl('');
      await loadSource(name, source);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : t('Could not fetch that URL.'));
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
      setError(cause instanceof Error ? cause.message : t('Could not fetch the template.'));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Agrees to exactly what was shown, and loads on that.
   *
   * The names go back as they came, so what is granted is what was read. A file
   * edited in the meantime to ask for more is refused again with the new list
   * rather than landing under this answer.
   */
  async function onAccept(pending: Asking) {
    await loadSource(
      pending.name,
      pending.source,
      pending.permissions.map((one) => one.name),
    );
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
      setError(cause instanceof Error ? cause.message : t('Could not unload that plugin.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell
      user={shellUser(session)}
      onSignOut={onSignOut}
      sidebar={<AdminSidebar active="plugins" />}
    >
      <header className={styles.titleBar}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>
            <span className={styles.titleWithHint}>
              {t('Plugins')}
              {/*
                Was the footer under the list. The same words, behind the (?)
                every other explanation in the product is behind.
              */}
              <FieldHint label={t('Plugins')}>
                {t('A plugin\'s functions are available in every workspace, and run out of the plugin\'s own text in its own sandbox. What a plugin needs to be told is set per workspace, on that workspace\'s Plugins page. Loading a file with a name already in the list replaces it.')}
              </FieldHint>
            </span>
          </h1>
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
            >@orknux/plugin</a>
            {t(', which bundles a project into the single file this page takes.')}
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
            {t('Get Template')}
          </button>
          <span className={styles.divider} aria-hidden="true" />
          <button
            type="button"
            className={styles.load}
            disabled={busy}
            onClick={() => picker.current?.click()}
          >
            <img src={plusIcon} alt="" width={14} height={14} />
            {t('Load Plugin')}
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
            aria-label={t('Plugin URL')}
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
          >{t('Load from URL')}</button>
        </div>

      {/*
        The load, stopped at the question.

        Inline and in the page rather than in a modal, the way unloading is
        confirmed in its row: this screen has no dialog idiom, and the thing
        being decided about — the file just chosen — is on the screen already.
        Nothing has been stored at this point; the plugin is loaded by the
        button below or by nothing.
      */}
      {asking !== null && (
        <section className={styles.asking}>
          <p className={styles.askingLine}>
            <span className={styles.askingName}>{asking.name}</span> needs these to run.
            <FieldHint label={t('Permissions')}>
              {t('The sandbox a plugin runs in switches these off for everything, because a plugin is somebody else\'s code running on this installation. Accepting turns them on for this plugin alone, and records who agreed and when. A plugin edited later to need something more is refused again, with the new list, rather than arriving under this answer.')}
            </FieldHint>
          </p>
          {/*
            Named and explained in the server's own words. This build's
            vocabulary is the server's, so a list written here would explain a
            permission it has since renamed - or miss one it has added.
          */}
          <ul className={styles.permissions}>
            {asking.permissions.map((one) => (
              <li key={one.name} className={styles.permission}>
                <span className={styles.permissionName}>{one.name}</span>
                <span className={styles.permissionSummary}>{one.summary}</span>
              </li>
            ))}
          </ul>
          <div className={styles.askingActions}>
            {/*
              The decision, worded as one. "OK" beside a list of what a stranger's
              code may reach reads as a way of making the list go away.
            */}
            <button
              type="button"
              className={styles.accept}
              disabled={busy}
              onClick={() => void onAccept(asking)}
            >{t('Allow and Load')}</button>
            <button
              type="button"
              className={styles.cancel}
              disabled={busy}
              onClick={() => {
                setNotice(`${asking.name} was not loaded.`);
                setAsking(null);
              }}
            >{t('Cancel')}</button>
          </div>
        </section>
      )}

      <section className={styles.card}>
        <div className={styles.tableHeader}>
          <span className={styles.colName}>{t('Name')}</span>
          <span className={styles.colApi}>API</span>
          <span className={styles.colSize}>{t('Size')}</span>
          <span className={styles.colWhen}>{t('Loaded')}</span>
          <span className={styles.colActions}>{t('Actions')}</span>
        </div>

        {loading && (
          <p className={styles.notice}>
            <Loader />
          </p>
        )}
        {error !== null && <p className={`${styles.notice} ${styles.noticeError}`}>{error}</p>}
        {notice !== null && error === null && <p className={styles.notice}>{notice}</p>}
        {!loading && error === null && plugins?.length === 0 && (
          <p className={styles.notice}>{t('No plugins loaded yet.')}</p>
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
                {/*
                  What the sandbox was relaxed to allow it, and on whose word.
                  Only where there is any: a plugin that asked for nothing would
                  otherwise grow a line saying so under every row, the way the
                  parameters above are drawn only when there are some.
                */}
                {plugin.permissions.length > 0 && (
                  <span className={styles.allows}>
                    allows {plugin.permissions.map((one) => one.name).join('  ·  ')}
                    {plugin.permissionsAcceptedAt !== null &&
                      `  ·  accepted ${timeAgo(plugin.permissionsAcceptedAt)}`}
                    {plugin.permissionsAcceptedBy !== null &&
                      plugin.permissionsAcceptedBy !== '' &&
                      ` by ${plugin.permissionsAcceptedBy}`}
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
                  >{t('Unload')}</button>
                  <button type="button" className={styles.cancel} onClick={() => setConfirming(null)}>{t('Cancel')}</button>
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

    </AppShell>
  );
}
