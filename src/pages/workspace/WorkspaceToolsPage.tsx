import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import type { PageOf } from '../../api/client';
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
import { shellUser } from '../../session/user';
import styles from './CatalogueTable.module.css';
import { t } from '../../i18n';

export interface WorkspaceToolsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

const PAGE_SIZE = 10;

export function WorkspaceToolsPage({ session, onSignOut }: WorkspaceToolsPageProps) {
  const { workspaceId = '' } = useParams();
  const navigate = useNavigate();

  const [tools, setTools] = useState<PageOf<Tool> | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    if (workspaceId === '') return;
    setError(null);
    fetchWorkspaceTools(workspaceId, page - 1, PAGE_SIZE)
      .then(setTools)
      .catch((cause: unknown) => {
        setTools(null);
        setError(cause instanceof Error ? cause.message : t('Could not load the tools.'));
      });
  }, [workspaceId, page]);

  useEffect(load, [load]);

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

        {tools === null && error === null && <p className={styles.notice}><Loader /></p>}
        {tools?.content.length === 0 && (
          <p className={styles.notice}>
            <span className={styles.labelWithHint}>
              {t('No tools yet.')}
              <FieldHint label={t('No tools yet')}>
                {t('A tool is JavaScript an agent may call while it runs.')}
              </FieldHint>
            </span>
          </p>
        )}

        {tools?.content.map((tool) => (
          <div key={tool.id} className={styles.row}>
            <Link className={`${styles.colName} ${styles.name}`} to={`/workspace/${workspaceId}/tools/${tool.id}`}>
              {tool.name}
            </Link>
            <span
              className={`${styles.colDescription} ${tool.description === null ? styles.noDescription : styles.description}`}
            >
              {tool.description ?? t('No description')}
            </span>
            <span className={styles.colStatus}>
              <button
                type="button"
                className={styles.toggle}
                onClick={() => void toggle(tool)}
                role="switch"
                aria-checked={tool.enabled}
                aria-label={`${tool.enabled ? 'Disable' : 'Enable'} ${tool.name}`}
                title={tool.enabled ? 'Disable' : 'Enable'}
              >
                <img src={tool.enabled ? toggleOnIcon : toggleOffIcon} alt="" width={36} height={20} data-keeps-colour />
              </button>
            </span>
            <span className={`${styles.colModified} ${styles.modified}`}>{timeAgo(tool.lastModifiedAt)}</span>
            <span className={styles.colActions}>
              <ExportComponentButton workspaceId={workspaceId} kind="TOOL" id={tool.id} name={tool.name} />
              <SaveAsTemplateButton
                workspaceId={workspaceId}
                kind="TOOL"
                id={tool.id}
                name={tool.name}
                canPublish={session.admin}
              />
              <Link
                className={styles.rowAction}
                to={`/workspace/${workspaceId}/tools/${tool.id}`}
                aria-label={`Open ${tool.name}`}
                title={`Open ${tool.name}`}
              >
                <img src={settingsIcon} alt="" width={14} height={14} />
              </Link>
            </span>
          </div>
        ))}

        {tools !== null && (
          <CompactPagination
            page={page}
            pageSize={PAGE_SIZE}
            totalItems={tools.totalElements}
            unit="tools"
            onPageChange={setPage}
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
