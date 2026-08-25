import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { ACTION_TYPE_LABEL, fetchWorkspaceActions, paramSummary } from '../../api/actions';
import type { Action } from '../../api/actions';
import type { PageOf } from '../../api/client';
import type { SessionUser } from '../../api/session';
import settingsIcon from '../../assets/settings-14.svg';
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
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import styles from './WorkspaceActionsPage.module.css';
import { t } from '../../i18n';

export interface WorkspaceActionsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

const PAGE_SIZE = 6;

/**
 * The workspace's action catalogue: the blocks its workflows are built from.
 *
 * A row is a link rather than a button, and so is Create Action: an action is
 * edited on a page of its own now, at `…/actions/:actionId`, which is what a
 * ctrl-click, a middle click and a pasted address all need it to be. The dialog
 * this page used to open is still there for the workflow editor's node panel;
 * see `ActionSettingsPage` for why the two doors differ.
 */
export function WorkspaceActionsPage({ session, onSignOut }: WorkspaceActionsPageProps) {
  const { workspaceId = '' } = useParams();

  const [actions, setActions] = useState<PageOf<Action> | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (workspaceId === '') return;
    setLoading(true);
    setError(null);
    fetchWorkspaceActions(workspaceId, page - 1, PAGE_SIZE)
      .then((result) => {
        setActions(result);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        setActions(null);
        setError(cause instanceof Error ? cause.message : t('Could not load the actions.'));
        setLoading(false);
      });
  }, [workspaceId, page]);

  useEffect(load, [load]);

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
            <h1 className={styles.title}>{t('Actions')}</h1>
            <p className={styles.subtitle}>{t('Reusable action blocks used inside workflows.')}</p>
          </div>
          <div className={transferStyles.headerActions}>
            <ImportComponentsButton workspaceId={workspaceId} onImported={load} />
            <UseTemplateButton workspaceId={workspaceId} kind="ACTION" onImported={load} />
            <Link className={styles.createAction} to={`/workspace/${workspaceId}/actions/new`}>
              {t('+ Create Action')}
            </Link>
          </div>
        </header>

        <div className={styles.table}>
          <div className={styles.tableHeader}>
            <span className={styles.colName}>{t('Name')}</span>
            <span className={styles.colType}>{t('Type')}</span>
            <span className={styles.colSubtype}>{t('Subtype')}</span>
            <span className={styles.colInput}>{t('Input Params')}</span>
            <span className={styles.colOutput}>{t('Output Params')}</span>
            <span className={styles.colActions}>{t('Actions')}</span>
          </div>

          {loading && <p className={styles.notice}><Loader /></p>}
          {error !== null && <p className={`${styles.notice} ${styles.noticeError}`}>{error}</p>}
          {!loading && error === null && actions?.content.length === 0 && (
            <p className={styles.notice}>{t('No actions yet.')}</p>
          )}

          {actions?.content.map((action) => (
            <div key={action.id} className={styles.row}>
              <Link
                className={`${styles.colName} ${styles.name} ${styles.nameLink}`}
                to={`/workspace/${workspaceId}/actions/${action.id}`}
                title={`Settings for ${action.name}`}
              >
                {action.name}
              </Link>
              <span className={styles.colType}>
                <span className={styles.badge}>{ACTION_TYPE_LABEL[action.type]}</span>
              </span>
              <span className={`${styles.colSubtype} ${styles.muted}`}>{action.subtypeLabel}</span>
              <span className={`${styles.colInput} ${styles.mono}`} title={paramSummary(action.inputParams)}>
                {paramSummary(action.inputParams)}
              </span>
              <span className={`${styles.colOutput} ${styles.mono}`} title={paramSummary(action.outputParams)}>
                {paramSummary(action.outputParams)}
              </span>
              <span className={styles.colActions}>
                <ExportComponentButton
                  workspaceId={workspaceId}
                  kind="ACTION"
                  id={action.id}
                  name={action.name}
                  className={styles.rowAction}
                />
                <SaveAsTemplateButton
                  workspaceId={workspaceId}
                  kind="ACTION"
                  id={action.id}
                  name={action.name}
                  className={styles.rowAction}
                  canPublish={session.admin}
                />
                <Link
                  className={styles.rowAction}
                  to={`/workspace/${workspaceId}/actions/${action.id}`}
                  aria-label={`Settings for ${action.name}`}
                  title={`Settings for ${action.name}`}
                >
                  <img src={settingsIcon} alt="" width={14} height={14} />
                </Link>
              </span>
            </div>
          ))}

          <CompactPagination
            page={page}
            pageSize={PAGE_SIZE}
            totalItems={actions?.totalElements ?? 0}
            onPageChange={setPage}
            unit="actions"
          />
        </div>
      </section>
    </AppShell>
  );
}
