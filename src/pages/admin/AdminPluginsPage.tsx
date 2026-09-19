import { useCallback, useEffect, useRef, useState } from 'react';

import {
  PluginPermissionsRequired,
  fetchMarketplace,
  fetchPluginSource,
  fetchPlugins,
  installFromMarketplace,
  loadPlugin,
  loadPluginFromUrl,
  pluginSize,
  pluginSourceUrl,
  pluginTemplate,
  setPluginEnabled,
  unloadPlugin,
  uploadPlugin,
} from '../../api/plugins';
import type { Loaded, MarketplaceListing, Plugin, PluginPermission } from '../../api/plugins';
import type { SessionUser } from '../../api/session';
import { timeAgo } from '../../api/tools';
import downloadIcon from '../../assets/download.svg';
import fileCodeIcon from '../../assets/file-code.svg';
import plusIcon from '../../assets/plus.svg';
import puzzleIcon from '../../assets/puzzle.svg';
import trashIcon from '../../assets/trash.svg';
import { AdminSidebar } from '../../components/AdminSidebar';
import { AppShell } from '../../components/AppShell';
import { FieldHint } from '../../components/FieldHint';
import { Loader } from '../../components/Loader';
import { Markdown } from '../../components/Markdown';
import { shellUser } from '../../session/user';
import styles from './AdminPluginsPage.module.css';
import { t } from '../../i18n';

export interface AdminPluginsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/**
 * The load, stopped at the question.
 *
 * What was being loaded is held rather than fetched again, so accepting is the
 * same load carried on — a file edited, or a URL that has changed since,
 * cannot become a different plugin between the list being read and the list
 * being agreed to. Which of the four doors it came through is what the held
 * fields say.
 */
interface Asking {
  /** The name it arrived as: what was picked, or the last part of the URL. */
  name: string;
  /** The text of a single-file plugin; absent for a zip or a fetched load. */
  source?: string;
  /** The archive itself, for a zip: accepting re-sends the same bytes. */
  archive?: File;
  /** The address, for a load the server fetches: accepting fetches it again. */
  address?: string;
  /** The catalog key, for an install: accepting installs it again. */
  catalogKey?: string;
  /** The server's lists, in the server's words. */
  libraries: string[];
  permissions: PluginPermission[];
  capabilities: PluginPermission[];
}

/**
 * A plugin's face, drawn safely.
 *
 * An SVG from a marketplace is somebody else's markup, and markup put into a
 * page can carry a script. An `<img>` cannot: a browser renders an SVG behind
 * one as a picture and runs nothing in it, so the drawing arrives as a data
 * URI rather than as elements. An emoji is a character and stands as itself;
 * a URL is drawn from where it is, the way any other picture is.
 */
function Face({ icon, size }: { icon: string | null; size: number }) {
  if (icon === null || icon.trim() === '') {
    return <span aria-hidden="true">🧩</span>;
  }
  const held = icon.trim();
  if (held.startsWith('<svg') || held.startsWith('<?xml')) {
    return (
      <img
        src={`data:image/svg+xml;utf8,${encodeURIComponent(held)}`}
        alt=""
        width={size}
        height={size}
      />
    );
  }
  if (held.startsWith('http://') || held.startsWith('https://')) {
    return <img src={held} alt="" width={size} height={size} />;
  }
  return <span aria-hidden="true">{held}</span>;
}

/** Which half of the screen is being read. */
type Tab = 'installed' | 'catalog';

/** And which shelf of the catalog: what is offered, or what you brought. */
type Source = 'marketplace' | 'local';

/**
 * The plugins loaded into this installation, and where more come from.
 *
 * Two tabs, because they answer two questions. **Installed** is what is
 * running here and what can be done to it — switched off, updated, unloaded.
 * **Catalog** is where a plugin comes from: the marketplace, or a file of
 * your own.
 *
 * Loading is the same act whichever door it arrives by, and refused the same
 * way: a plugin that needs something nobody has agreed to comes back with the
 * lists rather than with the plugin, and that question is put in front of
 * somebody here before the sandbox is relaxed for it.
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

  const [tab, setTab] = useState<Tab>('installed');
  const [source, setSource] = useState<Source>('marketplace');
  /** The catalog, read once the shelf is opened rather than on arrival. */
  const [listings, setListings] = useState<MarketplaceListing[] | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  /** Which offering's details are open, by key. */
  const [reading, setReading] = useState<string | null>(null);

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
   * The catalog, asked for when somebody opens the shelf.
   *
   * Not on arrival: reading it is a call to another service, and most visits
   * to this screen are about what is already installed.
   */
  const browse = useCallback((refresh = false) => {
    setCatalogLoading(true);
    setCatalogError(null);
    fetchMarketplace(refresh)
      .then((found) => {
        setListings(found);
        setCatalogLoading(false);
      })
      .catch((cause: unknown) => {
        setListings(null);
        setCatalogError(cause instanceof Error ? cause.message : t('Could not read the marketplace.'));
        setCatalogLoading(false);
      });
  }, []);

  useEffect(() => {
    if (tab === 'catalog' && source === 'marketplace' && listings === null && !catalogLoading) browse();
  }, [tab, source, listings, catalogLoading, browse]);

  /**
   * One load, however the plugin arrived, refused the one way.
   *
   * A refusal is not an error to reprint: it is a decision nobody has made
   * yet. What was being loaded is held on the ask, so accepting is the same
   * load carried on.
   */
  async function attempted(
    what: Omit<Asking, 'permissions' | 'capabilities' | 'libraries'>,
    attempt: () => Promise<Loaded>,
  ) {
    setBusy(true);
    setError(null);
    setNotice(null);
    setAsking(null);
    try {
      const loaded = await attempt();
      const named = loaded.replaced ? `Replaced ${loaded.plugin.key}` : `Loaded ${loaded.plugin.key}`;
      // Saying what it provides is the useful half: those names are what a
      // workflow will pick, and they are prefixed, so they are not what the
      // plugin author typed.
      setNotice(
        loaded.provides.length === 0
          ? `${named}. It declares no functions.`
          : `${named}. Provides ${loaded.provides.join(', ')}.`,
      );
      load();
      // The catalog's own idea of what is installed has just moved.
      if (listings !== null) browse();
    } catch (cause: unknown) {
      if (cause instanceof PluginPermissionsRequired) {
        setAsking({
          ...what,
          permissions: cause.permissions,
          capabilities: cause.capabilities,
          libraries: cause.libraries,
        });
      } else {
        setError(cause instanceof Error ? cause.message : t('Could not load that plugin.'));
      }
    } finally {
      setBusy(false);
      // Cleared so choosing the same file again still counts as a change.
      if (picker.current !== null) picker.current.value = '';
    }
  }

  async function loadSource(name: string, text: string, accept?: string[]) {
    await attempted({ name, source: text }, () => loadPlugin(name, text, accept));
  }

  /** A zip: the plugin and its libraries, sent as the archive they came as. */
  async function loadArchive(archive: File, accept?: string[]) {
    await attempted({ name: archive.name, archive }, () => uploadPlugin(archive, undefined, accept));
  }

  /** A URL the server fetches from, imports and all. */
  async function loadAddress(address: string, accept?: string[]) {
    const name = address.substring(address.lastIndexOf('/') + 1);
    await attempted({ name, address }, () => loadPluginFromUrl(address, accept));
  }

  /**
   * The catalog's own door. Installing and updating are one call because they
   * are one act: what is installed under that key is replaced by what the
   * catalog offers now.
   */
  async function install(listing: MarketplaceListing, accept?: string[]) {
    await attempted({ name: listing.name, catalogKey: listing.key }, async () => {
      const answer = await installFromMarketplace(listing.key, accept);
      if (answer.plugin === null) {
        throw new PluginPermissionsRequired(
          answer.message ?? t('This plugin needs to be accepted.'),
          answer.needsPermissions,
          answer.needsCapabilities,
          answer.needsLibraries,
        );
      }
      return { plugin: answer.plugin, replaced: listing.installed, provides: [], tools: [] };
    });
  }

  async function onPicked(file: File | undefined) {
    if (file === undefined) return;
    // An archive is the plugin and its libraries; a bare file is the plugin.
    if (file.name.endsWith('.zip')) {
      await loadArchive(file);
    } else {
      await loadSource(file.name, await file.text());
    }
  }

  /**
   * Loads a plugin from a URL.
   *
   * Two fetchers, because they can reach different things. TypeScript needs
   * the compiler, which is here — so a .ts URL is fetched by the browser,
   * compiled, and uploaded, under the other site's CORS policy. Everything
   * else the server fetches itself: no CORS in the way, the installation's
   * proxy rules in force, and the plugin's imports fetched from beside it,
   * which is the whole of how a multi-file plugin loads from where it lives.
   */
  async function onUrl() {
    const address = url.trim();
    if (address === '') return;

    if (address.endsWith('.ts') || address.endsWith('.mts')) {
      setBusy(true);
      setError(null);
      setNotice(null);
      setAsking(null);
      try {
        const { name, source: text } = await fetchPluginSource(address);
        setUrl('');
        await loadSource(name, text);
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : t('Could not fetch that URL.'));
        setBusy(false);
      }
    } else {
      setUrl('');
      await loadAddress(address);
    }
  }

  async function onTemplate() {
    setBusy(true);
    setError(null);
    try {
      const { filename, source: text } = await pluginTemplate();
      const file = new Blob([text], { type: 'text/plain' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(file);
      link.download = filename;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : t('Could not fetch the template.'));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Accepting is the same load again, with the names that were shown.
   *
   * The names go back as they came, so what is granted is what was read. A
   * file edited in the meantime to ask for more is refused again with the new
   * list rather than landing under this answer.
   */
  async function onAccept(pending: Asking) {
    // Every list goes back in one answer; the server reads each by its own
    // names — and a library's name is its path.
    const names = [
      ...[...pending.permissions, ...pending.capabilities].map((one) => one.name),
      ...pending.libraries,
    ];
    if (pending.archive !== undefined) {
      await loadArchive(pending.archive, names);
    } else if (pending.address !== undefined) {
      await loadAddress(pending.address, names);
    } else if (pending.catalogKey !== undefined) {
      const listing = listings?.find((one) => one.key === pending.catalogKey);
      if (listing !== undefined) await install(listing, names);
    } else {
      await loadSource(pending.name, pending.source ?? '', names);
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
      if (listings !== null) browse();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : t('Could not unload that plugin.'));
    } finally {
      setBusy(false);
    }
  }

  /** Switched off keeps everything and offers nothing; on puts it back. */
  async function onEnabled(plugin: Plugin, enabled: boolean) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const changed = await setPluginEnabled(plugin.id, enabled);
      setPlugins((current) =>
        current === null ? current : current.map((one) => (one.id === changed.id ? changed : one)),
      );
      setNotice(enabled ? `${plugin.name} is on.` : `${plugin.name} is off. Nothing it offers is available.`);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : t('Could not switch that plugin.'));
    } finally {
      setBusy(false);
    }
  }

  /** What the catalog says about a plugin loaded here, where it says anything. */
  const listingFor = (plugin: Plugin) =>
    plugin.marketplaceKey === null
      ? undefined
      : listings?.find((one) => one.key === plugin.marketplaceKey);

  const installedOf = (listing: MarketplaceListing) =>
    plugins?.find((one) => one.marketplaceKey === listing.key || one.key === listing.key);

  const open = reading === null ? undefined : listings?.find((one) => one.key === reading);

  /** One plugin as a row: what it is, and what can be done to it. */
  function pluginRow(plugin: Plugin) {
    const listing = listingFor(plugin);
    return (
      <div key={plugin.id} className={plugin.enabled ? styles.row : `${styles.row} ${styles.rowOff}`}>
        <span className={styles.colName}>
          {/* The face it came with, or the shape every plugin shares. */}
          <span className={styles.icon}>
            {plugin.icon === null ? (
              <img src={puzzleIcon} alt="" width={16} height={16} />
            ) : (
              <Face icon={plugin.icon} size={18} />
            )}
          </span>
          <span className={styles.nameBlock}>
            <span className={styles.name}>
              {plugin.name}
              {!plugin.enabled && <span className={styles.offMark}>{t('off')}</span>}
              {/*
                Where it came from, where that is the catalog: the version it
                was installed at, so the Update beside it means something.
              */}
              {plugin.marketplaceVersion !== null && (
                <span className={styles.fromMarket}>{plugin.marketplaceVersion}</span>
              )}
            </span>
            {/*
             * What it declares, under the name. A plugin is worth listing for
             * what it offers, and "declares 2 functions" answers less than
             * saying which.
             */}
            <span className={styles.declares}>
              {plugin.declaredFunctions.length === 0
                ? 'declares no functions'
                : plugin.declaredFunctions.map((one) => `${one.name}${one.signature}`).join('  ·  ')}
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
            {/* The files it brought, which somebody allowed when it was loaded. */}
            {plugin.libraries.length > 0 && (
              <span className={styles.declares}>
                ships {plugin.libraries.length === 1 ? '1 file' : `${plugin.libraries.length} files`}
                {'  ·  '}
                {plugin.libraries.join('  ·  ')}
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
            An update, where the catalog has moved on and this installation
            has not. Only for a plugin that came from the catalog: there is
            nothing to compare a hand-loaded file against.
          */}
          {listing?.updatable === true && (
            <button
              type="button"
              className={styles.update}
              disabled={busy}
              onClick={() => void install(listing)}
              title={`Update ${plugin.name} to ${listing.version}`}
            >{t('Update')}</button>
          )}
          {/*
            On and off, as one control that says which it is. Switched off a
            plugin keeps its rows, its edits and every workspace's answers,
            and offers nothing — the reversible half of unloading.
          */}
          <button
            type="button"
            className={plugin.enabled ? `${styles.toggle} ${styles.toggleOn}` : styles.toggle}
            role="switch"
            aria-checked={plugin.enabled}
            disabled={busy}
            onClick={() => void onEnabled(plugin, !plugin.enabled)}
            title={plugin.enabled ? `Switch ${plugin.name} off` : `Switch ${plugin.name} on`}
          >{plugin.enabled ? t('On') : t('Off')}</button>
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
    );
  }

  /** The header a list of plugins carries, said once. */
  const tableHead = (
    <div className={styles.tableHeader}>
      <span className={styles.colName}>{t('Name')}</span>
      <span className={styles.colApi}>API</span>
      <span className={styles.colSize}>{t('Size')}</span>
      <span className={styles.colWhen}>{t('Loaded')}</span>
      <span className={styles.colActions}>{t('Actions')}</span>
    </div>
  );

  const hand = plugins?.filter((one) => one.marketplaceKey === null) ?? [];

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
              <FieldHint label={t('Plugins')}>
                {t('A plugin\'s functions are available in every workspace, and run out of the plugin\'s own text in its own sandbox. What a plugin needs to be told is set per workspace, on that workspace\'s Plugins page. Loading a file with a name already in the list replaces it.')}
              </FieldHint>
            </span>
          </h1>
          <p className={styles.subtitle}>
            JavaScript plugins loaded into this installation.{' '}
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
      </header>

      {/*
        Two questions, two tabs. What is running here and what can be done to
        it is one; where a plugin comes from is the other, and mixing them is
        what made this screen a list with a toolbar bolted to the top.
      */}
      <div className={styles.tabs} role="tablist" aria-label={t('Plugins')}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'installed'}
          className={tab === 'installed' ? `${styles.tab} ${styles.tabOn}` : styles.tab}
          onClick={() => setTab('installed')}
        >
          {t('Installed')}
          {plugins !== null && <span className={styles.tabCount}>{plugins.length}</span>}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'catalog'}
          className={tab === 'catalog' ? `${styles.tab} ${styles.tabOn}` : styles.tab}
          onClick={() => setTab('catalog')}
        >{t('Catalog')}</button>
      </div>

      {/*
        The load, stopped at the question.

        Inline and in the page rather than in a modal, the way unloading is
        confirmed in its row: this screen has no dialog idiom, and the thing
        being decided about is on the screen already. Nothing has been stored
        at this point; the plugin is loaded by the button below or by nothing.
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
          {asking.permissions.length > 0 && (
            <ul className={styles.permissions}>
              {asking.permissions.map((one) => (
                <li key={one.name} className={styles.permission}>
                  <span className={styles.permissionName}>{one.name}</span>
                  <span className={styles.permissionSummary}>{one.summary}</span>
                </li>
              ))}
            </ul>
          )}
          {/*
            The files it ships with, folded shut by default: what matters at
            this distance is that there are files and how many, and the paths
            are one click away for whoever wants to read them. Allowing covers
            them either way - the count is part of the sentence, so nothing is
            agreed to unseen-and-unsaid.
          */}
          {asking.libraries.length > 0 && (
            <details className={styles.askingFiles}>
              <summary className={styles.askingLine}>
                {asking.libraries.length === 1
                  ? t('It ships 1 library file of its own.')
                  : `It ships ${asking.libraries.length} library files of its own.`}
              </summary>
              <ul className={styles.permissions}>
                {asking.libraries.map((path) => (
                  <li key={path} className={styles.permission}>
                    <span className={styles.permissionName}>{path}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {/*
            Its own list under its own sentence, never folded into the one
            above: a permission turns a language feature back on inside the
            sandbox, a capability has the server act on the plugin's behalf,
            and those are not decisions of the same size.
          */}
          {asking.capabilities.length > 0 && (
            <>
              <p className={styles.askingLine}>
                {t('It asks the server to do these on its behalf.')}
              </p>
              <ul className={styles.permissions}>
                {asking.capabilities.map((one) => (
                  <li key={one.name} className={styles.permission}>
                    <span className={styles.permissionName}>{one.name}</span>
                    <span className={styles.permissionSummary}>{one.summary}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
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

      {tab === 'installed' && (
        <section className={styles.card}>
          {tableHead}

          {loading && (
            <p className={styles.notice}>
              <Loader />
            </p>
          )}
          {error !== null && <p className={`${styles.notice} ${styles.noticeError}`}>{error}</p>}
          {notice !== null && error === null && <p className={styles.notice}>{notice}</p>}
          {!loading && error === null && plugins?.length === 0 && (
            <p className={styles.notice}>
              {t('No plugins loaded yet. The Catalog tab is where they come from.')}
            </p>
          )}

          {plugins?.map(pluginRow)}
        </section>
      )}

      {tab === 'catalog' && (
        <div className={styles.catalog}>
          {/*
            Two shelves, named for where a plugin comes from rather than for
            what the screen does: the marketplace offers them, and Local is
            the file on your own machine.
          */}
          <nav className={styles.rail} aria-label={t('Catalog')}>
            <button
              type="button"
              className={source === 'marketplace' ? `${styles.railItem} ${styles.railItemOn}` : styles.railItem}
              onClick={() => setSource('marketplace')}
            >{t('Marketplace')}</button>
            <button
              type="button"
              className={source === 'local' ? `${styles.railItem} ${styles.railItemOn}` : styles.railItem}
              onClick={() => setSource('local')}
            >{t('Local')}</button>
          </nav>

          {source === 'marketplace' && (
            <div className={styles.catalogBody}>
              <div className={styles.listingList}>
                <div className={styles.listingHead}>
                  <span>{t('From the marketplace')}</span>
                  <button
                    type="button"
                    className={styles.refresh}
                    disabled={catalogLoading || busy}
                    onClick={() => browse(true)}
                  >{t('Refresh')}</button>
                </div>

                {catalogLoading && (
                  <p className={styles.notice}>
                    <Loader />
                  </p>
                )}
                {/*
                  The one thing on this screen that needs the marketplace, and
                  the one thing an outage takes away. Said plainly, with what
                  is *not* affected beside it: everything installed goes on
                  running, because a plugin is stored here — source, libraries
                  and the face it wears — and nothing asks the marketplace
                  again until somebody opens this shelf.
                */}
                {catalogError !== null && (
                  <div className={styles.catalogDown}>
                    <p className={styles.catalogDownLine}>{catalogError}</p>
                    <p className={styles.catalogDownNote}>
                      {t('Only this list is affected. Every plugin already installed keeps running, and Local still loads a file of your own.')}
                    </p>
                    <button
                      type="button"
                      className={styles.refresh}
                      disabled={catalogLoading}
                      onClick={() => browse(true)}
                    >{t('Try again')}</button>
                  </div>
                )}
                {!catalogLoading && catalogError === null && listings?.length === 0 && (
                  <p className={styles.notice}>{t('The marketplace offers nothing yet.')}</p>
                )}

                {listings?.map((listing) => {
                  const here = installedOf(listing);
                  return (
                    <button
                      key={listing.key}
                      type="button"
                      className={
                        reading === listing.key
                          ? `${styles.listing} ${styles.listingOn}`
                          : styles.listing
                      }
                      aria-pressed={reading === listing.key}
                      onClick={() => setReading(listing.key)}
                    >
                      <span className={styles.listingIcon}>
                        <Face icon={listing.icon} size={22} />
                      </span>
                      <span className={styles.listingBody}>
                        <span className={styles.listingName}>
                          {listing.name}
                          <span className={styles.listingVersion}>{listing.version}</span>
                          {listing.installed && !listing.updatable && (
                            <span className={styles.installedMark}>{t('installed')}</span>
                          )}
                          {listing.updatable && (
                            <span className={styles.updateMark}>{t('update')}</span>
                          )}
                          {here?.enabled === false && <span className={styles.offMark}>{t('off')}</span>}
                        </span>
                        <span className={styles.listingSummary}>{listing.summary}</span>
                        <span className={styles.listingMeta}>{listing.author}</span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {/*
                The details, to the right of the list rather than over it: the
                question somebody is answering is "which of these", and a pane
                that covers the list takes the comparison away.
              */}
              <div className={styles.details}>
                {open === undefined ? (
                  <p className={styles.notice}>{t('Choose a plugin to read what it does.')}</p>
                ) : (
                  <>
                    <div className={styles.detailsHead}>
                      <div className={styles.detailsTitle}>
                        <span className={styles.listingIcon}>
                          <Face icon={open.icon} size={26} />
                        </span>
                        <span>
                          <span className={styles.detailsName}>{open.name}</span>
                          <span className={styles.detailsMeta}>
                            {open.author}
                            {'  ·  '}
                            {open.version}
                            {open.installed && open.installedVersion !== null &&
                              open.installedVersion !== open.version &&
                              `  ·  installed ${open.installedVersion}`}
                          </span>
                        </span>
                      </div>
                      <div className={styles.detailsActions}>
                        {/*
                          Install, update and uninstall in one place at the
                          top, because the decision is made from the name and
                          the first line — not after reading to the bottom.
                        */}
                        {!open.installed && (
                          <button
                            type="button"
                            className={styles.accept}
                            disabled={busy}
                            onClick={() => void install(open)}
                          >{t('Install')}</button>
                        )}
                        {open.updatable && (
                          <button
                            type="button"
                            className={styles.accept}
                            disabled={busy}
                            onClick={() => void install(open)}
                          >{`Update to ${open.version}`}</button>
                        )}
                        {open.installed && (() => {
                          const here = installedOf(open);
                          if (here === undefined) return null;
                          return (
                            <button
                              type="button"
                              className={styles.cancel}
                              disabled={busy}
                              onClick={() => void onUnload(here)}
                            >{t('Uninstall')}</button>
                          );
                        })()}
                      </div>
                    </div>
                    <div className={styles.detailsBody}>
                      {/*
                        Somebody else's prose from a public repository, so it
                        is rendered by the same component the documentation
                        and the chat use — which is where the sanitising is.
                      */}
                      <Markdown>{open.description}</Markdown>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {source === 'local' && (
            <div className={styles.catalogBody}>
              <div className={styles.localPane}>
                <div className={styles.listingHead}>
                  <span>{t('From a file of your own')}</span>
                </div>
                <p className={styles.localNote}>
                  {t('A single .js or .ts file, or a .zip holding the plugin and the libraries it ships with. A URL loads the same way: the server fetches the plugin and whatever it imports from beside it.')}
                </p>

                {/*
                 * The real input is hidden and driven by the button: a file input
                 * styles differently in every browser, and this one has to sit
                 * beside the other admin screens' buttons and look like them.
                 */}
                <input
                  ref={picker}
                  className={styles.picker}
                  type="file"
                  accept=".js,.mjs,.ts,.mts,.zip,text/javascript,text/plain,application/zip"
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

                <div className={styles.fromUrl}>
                  <input
                    className={styles.urlInput}
                    type="url"
                    value={url}
                    placeholder="https://raw.githubusercontent.com/…/plugin.js"
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

                {error !== null && <p className={`${styles.notice} ${styles.noticeError}`}>{error}</p>}
                {notice !== null && error === null && <p className={styles.notice}>{notice}</p>}

                {/*
                  What was brought by hand, kept apart from what the catalog
                  offers: these are the ones nothing will ever offer to update,
                  so the list that shows them is the list that says so.
                */}
                <div className={styles.card}>
                  {tableHead}
                  {loading && (
                    <p className={styles.notice}>
                      <Loader />
                    </p>
                  )}
                  {!loading && hand.length === 0 && (
                    <p className={styles.notice}>{t('Nothing has been loaded from a file or a URL.')}</p>
                  )}
                  {hand.map(pluginRow)}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
