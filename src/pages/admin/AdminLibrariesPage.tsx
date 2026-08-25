import { useCallback, useEffect, useRef, useState } from 'react';

import {
  deleteScriptLibrary,
  fetchLibraryRegistry,
  fetchScriptLibraries,
  installScriptLibrary,
  librarySize,
  librarySourceUrl,
  uploadLibrary,
} from '../../api/libraries';
import type { LibraryRegistryStatus, ScriptLibrary } from '../../api/libraries';
import type { SessionUser } from '../../api/session';
import { timeAgo } from '../../api/tools';
import downloadIcon from '../../assets/download.svg';
import packageIcon from '../../assets/package.svg';
import plusIcon from '../../assets/plus.svg';
import trashIcon from '../../assets/trash-2.svg';
import { AdminSidebar } from '../../components/AdminSidebar';
import { AppShell } from '../../components/AppShell';
import { FieldHint } from '../../components/FieldHint';
import { Loader } from '../../components/Loader';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { DependantLinks } from '../../components/UsedBy';
import { shellUser } from '../../session/user';
import styles from './AdminLibrariesPage.module.css';
import { t } from '../../i18n';

export interface AdminLibrariesPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/**
 * The libraries loaded into this installation.
 *
 * Beside Plugins, because both are code an operator loads once for everyone
 * rather than something a workspace owns. What separates them is what they are
 * for: a plugin declares functions the product calls, a library is a bundle
 * somebody's own function imports and calls itself.
 *
 * `usedBy` is why this screen is an administrator's rather than a workspace's. It
 * names every function and tool importing a library across every workspace, which
 * is what somebody deciding whether to replace or remove one has to know, and it
 * is the only place in the product that can answer it.
 *
 * There are two ways in and one kind of row. A file somebody chose, and a package
 * somebody named — and what the second produces is the same stored artefact as the
 * first, fetched once by the server and never consulted again. The field for it is
 * drawn only where a registry is configured: an installation with no way out
 * should be shown the upload rather than a control that fails on being used.
 */
/**
 * What to call the place a package is fetched from.
 *
 * "npm" where the registry is npm's own, and the host otherwise - an
 * installation pointed at a mirror is not fetching from npm and should not be
 * told it is. The host alone rather than the whole URL: this is a label on a
 * field, and `https://registry.npmjs.org/` spends a line saying what `npm` says
 * in three letters.
 */
function registryName(url: string): string {
  try {
    const host = new URL(url).host;
    return host === 'registry.npmjs.org' ? 'npm' : host;
  } catch {
    return t('Registry');
  }
}

/**
 * Where the file came from, and what spelling it is in, on one line.
 *
 * Two facts and one line, because they answer the same question and a second
 * grey line under a name is a row that has started to look like a paragraph. An
 * uploaded ES module has neither and draws nothing at all: an uploaded file has
 * no provenance this installation can vouch for, and a row of blanks would read
 * as though it had.
 */
function origin(library: ScriptLibrary): string {
  const parts: string[] = [];
  if (library.registry !== null) {
    parts.push(`npm  ·  ${library.registry.packageName}@${library.registry.version}  ·  ${library.registry.entry}`);
  }
  if (library.format === 'COMMONJS') parts.push('CommonJS');
  return parts.join('  ·  ');
}

/**
 * The same, at length, on the hover.
 *
 * The registry's hash is what makes a row checkable and is eighty characters
 * nobody needs across a table. The CommonJS sentence is here rather than in the
 * row for the reason the hash is: what it says is that the stored file is the
 * one that was published and the wrapper goes round it when it runs, which
 * matters exactly once — to whoever is comparing this row against a package.
 */
function provenance(library: ScriptLibrary): string {
  const lines: string[] = [];
  if (library.registry !== null) lines.push(library.registry.url, library.registry.integrity);
  if (library.format === 'COMMONJS') {
    lines.push(t('Stored as it was published; given its module and exports when it runs.'));
  }
  return lines.join('\n');
}

export function AdminLibrariesPage({ session, onSignOut }: AdminLibrariesPageProps) {
  const [libraries, setLibraries] = useState<ScriptLibrary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** The library whose removal is waiting to be confirmed. */
  const [confirming, setConfirming] = useState<string | null>(null);
  /** The library whose removal was refused because something still imports it. */
  const [refused, setRefused] = useState<string | null>(null);
  /** Whether a package can be named here. Null until the server has said. */
  const [registry, setRegistry] = useState<LibraryRegistryStatus | null>(null);
  const [spec, setSpec] = useState('');
  const picker = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchScriptLibraries()
      .then((found) => {
        setLibraries(found);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        setLibraries(null);
        setError(cause instanceof Error ? cause.message : t('Could not load the libraries.'));
        setLoading(false);
      });
  }, []);

  useEffect(load, [load]);

  /*
   * Asked once. Whether this installation fetches packages is a setting, not
   * something that changes while somebody is looking at the screen, and a
   * registry that cannot be read leaves the upload standing rather than an error.
   */
  useEffect(() => {
    fetchLibraryRegistry()
      .then(setRegistry)
      .catch(() => setRegistry({ configured: false, url: '' }));
  }, []);

  /**
   * Fetches a named package, or shows why it was refused.
   *
   * Every refusal is the server's own sentence — a range instead of a version, a
   * package naming a file it never published, one whose entry imports or requires
   * a second package, a file that did not hash to what the registry claimed. They
   * want different things done about them, so none is replaced here with a
   * shorter one.
   */
  async function onInstall() {
    const named = spec.trim();
    if (named === '') return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const installed = await installScriptLibrary(named);
      setNotice(`Installed ${installed.key} from ${installed.registry?.packageName ?? named}.`);
      setSpec('');
      load();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : t('Could not install that package.'));
    } finally {
      setBusy(false);
    }
  }

  async function onPicked(file: File | undefined) {
    if (file === undefined) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const loaded = await uploadLibrary(file.name, await file.text());
      setNotice(loaded.replaced ? `Replaced ${loaded.key}.` : `Loaded ${loaded.key}.`);
      load();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : t('Could not load that library.'));
    } finally {
      setBusy(false);
      // Cleared so choosing the same file again still counts as a change.
      if (picker.current !== null) picker.current.value = '';
    }
  }

  /**
   * Removes one, or shows why it cannot be removed.
   *
   * Issue #268. The server refuses while anything imports it and names what
   * does, and that sentence used to be the whole answer: shown at the top of the
   * card, in the row's own words, with the importers as plain text. Being told
   * *"That library is imported by slugify in Backend"* and left to go and find
   * `slugify` is the reader doing by hand what the screen already knows.
   *
   * So the refusal lands on the row it is about, in one line, and the answer is
   * the line already under the library's key — where every importer is now
   * something to press. The server's sentence is still shown for anything else
   * that could go wrong, because a refusal we did not anticipate is one nobody
   * should have to guess at.
   */
  async function onRemove(library: ScriptLibrary) {
    setBusy(true);
    setError(null);
    setNotice(null);
    setRefused(null);
    try {
      await deleteScriptLibrary(library.id);
      setNotice(`Removed ${library.key}.`);
      setConfirming(null);
      load();
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : t('Could not remove that library.');
      if (library.usedBy.length > 0) {
        setRefused(library.id);
        setConfirming(null);
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell user={shellUser(session)} onSignOut={onSignOut} sidebar={<AdminSidebar active="libraries" />}>
      <header className={styles.titleBar}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>
            <span className={styles.titleWithHint}>
              {t('Libraries')}
              <FieldHint label={t('Libraries')}>
                A library is available in every workspace, and is imported by a function or a tool under a
                local name of its own — <code>imports.dateFns</code>. Its key is the filename without the
                extension, so loading a file with a key already in the list replaces it in place and nothing
                importing it is repointed. One that something imports cannot be removed.
                <br />
                <br />
                Installing a package fetches it once, here on the server, into this database — the file is
                what is stored and what runs, and nothing reaches a registry afterwards. Name an exact
                version, never <code>latest</code>: a version that resolves differently tomorrow is not an
                answer to what code is running here. A package has to publish one self-contained file. An ES
                module is taken as it is and a CommonJS one is given its <code>module</code> and{' '}
                <code>exports</code> as it runs, so <code>main</code> and a UMD bundle both work; what is
                refused is a file that imports or requires a second package, because this installation does
                not bundle. Build a bundle elsewhere and upload it.
              </FieldHint>
            </span>
          </h1>
          <p className={styles.subtitle}>
            {t('JavaScript any workspace’s function or tool may import.')}
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
          {/*
            Drawn only where a registry is configured. An installation with no way
            out is shown the upload, rather than a field that fails on being used.
          */}
          {registry?.configured === true && (
            <form
              className={styles.install}
              onSubmit={(event) => {
                event.preventDefault();
                void onInstall();
              }}
            >
              {/*
                The registry is named on the control, not only in a tooltip.
                
                A box taking `random@4.1.0` beside a button reading Install says
                where the file comes from to whoever already knows; to anybody
                else it is a package manager they have to guess at, and this one
                reaches the network on an administrator's press. It says npm
                where npm is what is configured, and the host itself where an
                installation points at a mirror of its own.
              */}
              <label className={styles.specLabel} htmlFor="library-spec">
                {registryName(registry.url)}
              </label>
              <input
                id="library-spec"
                className={styles.spec}
                type="text"
                value={spec}
                placeholder={t('random@4.1.0')}
                aria-label={t('Package and exact version')}
                title={`${t('Fetched once from')} ${registry.url}`}
                disabled={busy}
                onChange={(event) => setSpec(event.target.value)}
              />
              <button type="submit" className={styles.installButton} disabled={busy || spec.trim() === ''}>
                {t('Install')}
              </button>
            </form>
          )}
          <button
            type="button"
            className={styles.load}
            disabled={busy}
            onClick={() => picker.current?.click()}
          >
            <img src={plusIcon} alt="" width={14} height={14} />
            {t('Load Library')}
          </button>
        </div>
      </header>

      <section className={styles.card}>
        <div className={styles.tableHeader}>
          <span className={styles.colName}>{t('Name')}</span>
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
        {!loading && error === null && libraries?.length === 0 && (
          <p className={styles.notice}>{t('No libraries loaded yet.')}</p>
        )}

        {libraries?.map((library) => (
          <div key={library.id} className={styles.row}>
            <span className={styles.colName}>
              <img className={styles.icon} src={packageIcon} alt="" width={16} height={16} />
              <span className={styles.nameBlock}>
                <span className={styles.name}>{library.key}</span>
                {/*
                  Where it came from, on the rows that came from somewhere. An
                  uploaded file has no provenance this installation can vouch for,
                  so nothing is drawn for one rather than a row of blanks that
                  would read as though it had. The hash the registry claimed is on
                  the hover: it is what makes the row checkable, and it is eighty
                  characters nobody needs across a table.
                */}
                {(library.registry !== null || library.format === 'COMMONJS') && (
                  <span className={styles.from} title={provenance(library)}>
                    {origin(library)}
                  </span>
                )}
                {/*
                 * What it exports, under the name. A library is worth listing for
                 * what an importer can reach on it, and "4 members" answers less
                 * than saying which — the brackets mark the ones to call.
                 */}
                <span className={styles.declares}>{exported(library)}</span>
                {/*
                  And who has it. This is the line the whole screen exists for: a
                  library is installation-wide, so the question before replacing or
                  removing one is whose code stops working, and nowhere else in the
                  product can answer it.
                */}
                <span className={styles.usedBy}>
                  {library.usedBy.length === 0 ? 'used by nothing' : 'used by '}
                  <DependantLinks entries={library.usedBy} hidden={0} showWorkspace none="" />
                </span>
                {/*
                  The refusal, on the row it is about and in one line. What to
                  do about it is the line above, which names every importer and
                  opens it.
                */}
                {refused === library.id && (
                  <span className={styles.refused} role="alert">
                    {t('Still imported — open one of those and take the import off first.')}
                  </span>
                )}
              </span>
            </span>
            <span className={`${styles.colSize} ${styles.muted}`}>{librarySize(library.sizeBytes)}</span>
            <span className={`${styles.colWhen} ${styles.muted}`}>
              {timeAgo(library.uploadedAt)}
              {library.uploadedBy !== '' && ` by ${library.uploadedBy}`}
            </span>
            <span className={styles.colActions}>
              {/*
                What was written, not what runs: TypeScript where there is any. A
                plain link, so the browser saves it and the session cookie goes with
                the request.
              */}
              <a
                className={styles.rowAction}
                href={librarySourceUrl(library.id)}
                title={`Download ${library.key}`}
                aria-label={`Download ${library.key}`}
              >
                <img src={downloadIcon} alt="" width={14} height={14} />
              </a>
              {/*
                Asked in a modal, not in the row.
                
                Unloading a plugin confirms in its row and this followed it, but
                the two are not the same size of act: a plugin belongs to the
                installation and so does a library, yet a library is imported by
                name from any workspace's functions and tools - so removing one
                breaks code somewhere nobody removing it is looking. That is the
                company an issue and a chat keep, and both of those ask here.
              */}
              <button
                type="button"
                className={styles.rowAction}
                disabled={busy}
                onClick={() => setConfirming(library.id)}
                aria-label={`Remove ${library.key}`}
                title={`Remove ${library.key}`}
              >
                <img src={trashIcon} alt="" width={14} height={14} />
              </button>
            </span>
          </div>
        ))}
      </section>

      <ConfirmDialog
        subject={libraries?.find((library) => library.id === confirming)?.key ?? null}
        kind="removeLibrary"
        onClose={() => setConfirming(null)}
        onConfirm={async () => {
          const library = libraries?.find((held) => held.id === confirming);
          if (library !== undefined) await onRemove(library);
        }}
      />
    </AppShell>
  );
}

/**
 * What the library's export turned out to be, as one line.
 *
 * A callable one is said as what it is rather than listed, because there is one
 * thing to say about it: the local name is the call. Everything else is its
 * members, with the callable ones marked the way this product marks a call.
 */
function exported(library: ScriptLibrary): string {
  const members = library.members.map((member) => (member.callable ? `${member.name}()` : member.name));
  if (library.callable) return members.length === 0 ? 'exports a function' : `exports a function  ·  ${members.join('  ·  ')}`;
  return members.length === 0 ? 'exports nothing' : `exports ${members.join('  ·  ')}`;
}

