import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { fetchPluginTools } from '../../api/plugins';
import type { PluginAgentTool } from '../../api/plugins';
import type { SessionUser } from '../../api/session';
import { createTool, fetchWorkspaceTools, setToolEnabled, timeAgo } from '../../api/tools';
import type { Tool } from '../../api/tools';
import settingsIcon from '../../assets/settings-14.svg';
import toggleOffIcon from '../../assets/toggle-off.svg';
import toggleOnIcon from '../../assets/toggle-on.svg';
import { AppShell } from '../../components/AppShell';
import { CompactPagination } from '../../components/CompactPagination';
import {
  ExportComponentButton,
  ImportComponentsButton,
  SaveAsTemplateButton,
  UseTemplateButton,
  transferStyles,
} from '../../components/ComponentTransfer';
import { Loader } from '../../components/Loader';
import { NameDialog } from '../../components/NameDialog';
import { FieldHint } from '../../components/FieldHint';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { PAGE_SIZES, usePageSize } from '../../components/pageSize';
import { usePageWithin } from '../../components/pageWithin';
import { shellUser } from '../../session/user';
import styles from './CatalogueTable.module.css';
import { t } from '../../i18n';

export interface WorkspaceToolsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/** One row of the list: the workspace's own tool, or one a plugin offers. */
type ToolRow = { kind: 'tool'; tool: Tool } | { kind: 'plugin'; offered: PluginAgentTool };

/**
 * Enough of a workspace's tools to mix them with the plugins' in one sorted
 * list. A workspace past this has a tool beyond the mixed view's end; the
 * single-origin views page on the server and are never cut.
 */
const ALL_OF_THEM = 200;

export function WorkspaceToolsPage({ session, onSignOut }: WorkspaceToolsPageProps) {
  const { workspaceId = '' } = useParams();
  const navigate = useNavigate();

  const [rows, setRows] = useState<ToolRow[] | null>(null);
  const [total, setTotal] = useState(0);
  /** Whether the current page of rows came already cut by the server. */
  const [serverPaged, setServerPaged] = useState(true);
  const [page, setPage] = usePageWithin(workspaceId);
  const [pageSize, setPageSize] = usePageSize('tools');
  /*
   * One origin, or both. The plugins' tools were nowhere on this page at all -
   * they stood only on the agent form's grant list, which is a place to grant,
   * not a place to browse - so the browser lists them beside the workspace's
   * own, each row saying which plugin offers it.
   */
  const [source, setSource] = useState<string>('');
  /** The plugins offering tools, for the sieve's own rows. */
  const [pluginChoices, setPluginChoices] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let current = true;
    fetchPluginTools()
      .then((offered) => {
        if (current) setPluginChoices([...new Set(offered.map((one) => one.plugin))]);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, []);

  const load = useCallback(() => {
    if (workspaceId === '') return;
    setError(null);

    const failed = (cause: unknown) => {
      setRows(null);
      setError(cause instanceof Error ? cause.message : t('Could not load the tools.'));
    };

    if (source === 'WORKSPACE') {
      fetchWorkspaceTools(workspaceId, page - 1, pageSize)
        .then((result) => {
          setRows(result.content.map((tool) => ({ kind: 'tool', tool })));
          setTotal(result.totalElements);
          setServerPaged(true);
        })
        .catch(failed);
      return;
    }

    if (source === 'PLUGIN' || source.startsWith('plugin:')) {
      const wanted = source.startsWith('plugin:') ? source.slice('plugin:'.length) : null;
      fetchPluginTools()
        .then((offered) => {
          const kept = wanted === null ? offered : offered.filter((one) => one.plugin === wanted);
          setRows(kept.map((one) => ({ kind: 'plugin' as const, offered: one })));
          setTotal(kept.length);
          setServerPaged(false);
        })
        .catch(failed);
      return;
    }

    // Both origins in one alphabet: the workspace's own and the plugins',
    // merged here because they live in two tables the server pages apart.
    Promise.all([fetchWorkspaceTools(workspaceId, 0, ALL_OF_THEM), fetchPluginTools()])
      .then(([own, offered]) => {
        const merged: ToolRow[] = [
          ...own.content.map((tool) => ({ kind: 'tool' as const, tool })),
          ...offered.map((one) => ({ kind: 'plugin' as const, offered: one })),
        ].sort((a, b) => {
          const nameOf = (row: ToolRow) => (row.kind === 'tool' ? row.tool.name : row.offered.name);
          return nameOf(a).localeCompare(nameOf(b));
        });
        setRows(merged);
        setTotal(merged.length);
        setServerPaged(false);
      })
      .catch(failed);
  }, [workspaceId, page, pageSize, source]);

  useEffect(load, [load]);

  /** The rows of the page being looked at, wherever the cutting happened. */
  const shown = rows === null ? null : serverPaged ? rows : rows.slice((page - 1) * pageSize, page * pageSize);

  async function toggle(tool: Tool) {
    try {
      await setToolEnabled(tool.id, !tool.enabled);
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Could not change the tool.'));
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
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>{t('Tools')}</h1>
          <p className={styles.subtitle}>
            {t('Custom JavaScript tools callable by agents during execution.')}
          </p>
        </div>
        <div className={transferStyles.headerActions}>
          {/* One origin, or both - the same sieve the functions list wears. */}
          <select
            className={styles.sourceFilter}
            aria-label={t('Which tools to list')}
            value={source}
            onChange={(event) => {
              setSource(event.target.value);
              // Which page somebody is on means nothing in another sieve.
              setPage(1);
            }}
          >
            <option value="">{t('All sources')}</option>
            <option value="WORKSPACE">{t('The workspace\'s own')}</option>
            <option value="PLUGIN">{t('From plugins')}</option>
            {/* And each plugin by name, which is the question people ask. */}
            {pluginChoices.map((plugin) => (
              <option key={plugin} value={`plugin:${plugin}`}>
                {plugin}
              </option>
            ))}
          </select>
          <ImportComponentsButton workspaceId={workspaceId} onImported={load} />
          <UseTemplateButton workspaceId={workspaceId} kind="TOOL" onImported={load} />
          <button type="button" className={styles.createButton} onClick={() => setCreating(true)}>{t('+ Create Tool')}</button>
        </div>
      </header>

      {error !== null && (
        <p className={styles.pageError} role="alert">
          {error}
        </p>
      )}

      <section className={styles.card}>
        <div className={styles.tableHeader}>
          <span className={styles.colName}>{t('Name')}</span>
          <span className={styles.colDescription}>{t('Description')}</span>
          <span className={styles.colStatus}>{t('Status')}</span>
          <span className={styles.colModified}>{t('Last Modified')}</span>
          <span className={styles.colActions}>{t('Actions')}</span>
        </div>

        {shown === null && error === null && <p className={styles.notice}><Loader /></p>}
        {shown?.length === 0 && (
          <p className={styles.notice}>
            <span className={styles.labelWithHint}>
              {source === 'PLUGIN' ? t('No plugin offers a tool yet.') : t('No tools yet.')}
              <FieldHint label={t('No tools yet')}>
                {t('A tool is JavaScript an agent may call while it runs.')}
              </FieldHint>
            </span>
          </p>
        )}

        {shown?.map((row) =>
          row.kind === 'tool' ? (
            <div key={row.tool.id} className={styles.row}>
              <Link className={`${styles.colName} ${styles.name}`} to={`/workspace/${workspaceId}/tools/${row.tool.id}`}>
                {row.tool.name}
              </Link>
              <span
                className={`${styles.colDescription} ${row.tool.description === null ? styles.noDescription : styles.description}`}
              >
                {row.tool.description ?? t('No description')}
              </span>
              <span className={styles.colStatus}>
                <button
                  type="button"
                  className={styles.toggle}
                  onClick={() => void toggle(row.tool)}
                  role="switch"
                  aria-checked={row.tool.enabled}
                  aria-label={`${row.tool.enabled ? 'Disable' : 'Enable'} ${row.tool.name}`}
                  title={row.tool.enabled ? 'Disable' : 'Enable'}
                >
                  <img src={row.tool.enabled ? toggleOnIcon : toggleOffIcon} alt="" width={36} height={20} data-keeps-colour />
                </button>
              </span>
              <span className={`${styles.colModified} ${styles.modified}`}>{timeAgo(row.tool.lastModifiedAt)}</span>
              <span className={styles.colActions}>
                <ExportComponentButton workspaceId={workspaceId} kind="TOOL" id={row.tool.id} name={row.tool.name} />
                <SaveAsTemplateButton
                  workspaceId={workspaceId}
                  kind="TOOL"
                  id={row.tool.id}
                  name={row.tool.name}
                  canPublish={session.admin}
                />
                <Link
                  className={styles.rowAction}
                  to={`/workspace/${workspaceId}/tools/${row.tool.id}`}
                  aria-label={`Open ${row.tool.name}`}
                  title={`Open ${row.tool.name}`}
                >
                  <img src={settingsIcon} alt="" width={14} height={14} />
                </Link>
              </span>
            </div>
          ) : (
            /*
              A tool a plugin offers. Not the workspace's to edit, export or
              switch off - it is on while its plugin is loaded - so the row
              says which plugin offers it and, where it fronts one of the
              plugin's functions, opens that function's page.
            */
            <div key={`plugin:${row.offered.name}`} className={styles.row}>
              <span className={`${styles.colName} ${styles.name}`}>
                {row.offered.name}
                <span className={styles.pluginBadge}>{row.offered.plugin}</span>
              </span>
              <span
                className={`${styles.colDescription} ${row.offered.description === null ? styles.noDescription : styles.description}`}
              >
                {row.offered.description ?? t('No description')}
              </span>
              <span className={`${styles.colStatus} ${styles.modified}`}>{t('From a plugin')}</span>
              <span className={`${styles.colModified} ${styles.modified}`}>—</span>
              <span className={styles.colActions}>
                {row.offered.functionId !== null && (
                  <Link
                    className={styles.rowAction}
                    to={`/workspace/${workspaceId}/functions/${row.offered.functionId}`}
                    aria-label={`Open the function ${row.offered.name} fronts`}
                    title={`Open the function ${row.offered.name} fronts`}
                  >
                    <img src={settingsIcon} alt="" width={14} height={14} />
                  </Link>
                )}
              </span>
            </div>
          ),
        )}

        {rows !== null && (
          <CompactPagination
            page={page}
            pageSize={pageSize}
            totalItems={total}
            unit="tools"
            onPageChange={setPage}
            pageSizes={PAGE_SIZES}
            onPageSizeChange={(chosen) => {
              setPageSize(chosen);
              // Which page somebody is on means something else at another size.
              setPage(1);
            }}
          />
        )}
      </section>

      <NameDialog
        open={creating}
        title={t('Create Tool')}
        message={t("A tool is JavaScript an agent may call while it runs.")}
        nameLabel="Name"
        namePlaceholder="httpRequest"
        descriptionPlaceholder={t("Make HTTP requests to external APIs")}
        submitLabel={t("Create Tool")}
        onClose={() => setCreating(false)}
        onSubmit={async (name, description) => {
          const created = await createTool(workspaceId, { name, description: description || undefined });
          navigate(`/workspace/${workspaceId}/tools/${created.id}`);
        }}
      />
    </AppShell>
  );
}
