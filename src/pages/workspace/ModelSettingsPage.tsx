import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import {
  fetchModel,
  fetchModelUsage,
  formatChange,
  formatCompact,
  formatLatency,
  formatTokens,
  modelKindLabel,
  removeModel,
  resetIntervalLabel,
  setModelEnabled,
  updateModelQuotas,
} from '../../api/models';
import type { Model, ModelUsage, ResetInterval } from '../../api/models';
import type { SessionUser } from '../../api/session';
import chevronDown12Icon from '../../assets/chevron-down-12.svg';
import toggleOffIcon from '../../assets/toggle-off.svg';
import toggleOnIcon from '../../assets/toggle-on.svg';
import { AppShell } from '../../components/AppShell';
import { BackLink } from '../../components/BackLink';
import { Loader } from '../../components/Loader';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import { UsageChart } from './UsageChart';
import styles from './ModelSettingsPage.module.css';

export interface ModelSettingsPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

const RESET_INTERVALS: ResetInterval[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'NEVER'];

/** An empty box is no limit, which is a thing the form has to be able to say. */
function toNumber(value: string): number | null {
  const digits = value.replace(/[,\s]/g, '');
  if (digits === '') return null;
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : null;
}

export function ModelSettingsPage({ session, onSignOut }: ModelSettingsPageProps) {
  const { workspaceId = '', modelId = '' } = useParams();
  const navigate = useNavigate();

  const [model, setModel] = useState<Model | null>(null);
  const [usage, setUsage] = useState<ModelUsage | null>(null);
  const [tokenLimit, setTokenLimit] = useState('');
  const [resetInterval, setResetInterval] = useState<ResetInterval>('MONTHLY');
  const [requestsPerMinute, setRequestsPerMinute] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    if (modelId === '') return;
    fetchModel(modelId)
      .then((found) => {
        if (found === null) {
          setLoadError('That model does not exist, or you do not have access to it.');
          return;
        }
        apply(found);
      })
      .catch((cause: unknown) => {
        setLoadError(cause instanceof Error ? cause.message : 'Could not load the model.');
      });

    // The metrics are their own request: the settings should still show if the
    // usage query is the thing that failed.
    fetchModelUsage(modelId)
      .then(setUsage)
      .catch(() => setUsage(null));
  }, [modelId]);

  function apply(found: Model) {
    setModel(found);
    setTokenLimit(found.tokenLimit === null ? '' : String(found.tokenLimit));
    setResetInterval(found.resetInterval);
    setRequestsPerMinute(found.requestsPerMinute === null ? '' : String(found.requestsPerMinute));
  }

  async function handleToggle() {
    if (model === null) return;
    try {
      apply(await setModelEnabled(model.id, !model.enabled));
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Could not change the model.');
    }
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (model === null || saving) return;

    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      apply(
        await updateModelQuotas(model.id, {
          tokenLimit: toNumber(tokenLimit),
          resetInterval,
          requestsPerMinute: toNumber(requestsPerMinute),
        }),
      );
      setSaved(true);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Could not save the quotas.');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (model === null || removing) return;
    setRemoving(true);
    try {
      await removeModel(model.id);
      navigate(`/workspace/${workspaceId}/models`);
    } catch (cause) {
      setRemoving(false);
      setSaveError(cause instanceof Error ? cause.message : 'Could not remove the model.');
    }
  }

  const limit = model?.tokenLimit ?? null;
  const used = usage?.periodTokens ?? 0;
  const share = limit === null || limit === 0 ? null : Math.min(used / limit, 1);

  return (
    <AppShell
      user={shellUser(session)}
      workspacePath={`/workspace/${workspaceId}`}
      showAdmin={session.admin}
      onSignOut={onSignOut}
      sidebar={<WorkspaceSidebar workspaceId={workspaceId} />}
    >
      <header className={styles.headerBlock}>
        <p className={styles.breadcrumbs}>
          <BackLink to={`/workspace/${workspaceId}/models`} label="Models" />
          <Link className={styles.crumbLink} to={`/workspace/${workspaceId}/models`}>
            Models
          </Link>
          <span className={styles.crumbSeparator}>/</span>
          <span className={styles.crumbCurrent}>{model?.name ?? '…'}</span>
        </p>
        <h1 className={styles.pageTitle}>{model?.name ?? 'Model'}</h1>
      </header>

      {loadError !== null ? (
        <section className={styles.card}>
          <p className={styles.loadError} role="alert">
            {loadError}
          </p>
        </section>
      ) : model === null ? (
        <section className={styles.card}>
          <p className={styles.notice}><Loader /></p>
        </section>
      ) : (
        <>
          <section className={styles.card}>
            <h2 className={styles.sectionHeading}>Provider Details</h2>
            <div className={styles.detailGrid}>
              <div className={styles.detail}>
                <span className={styles.detailLabel}>Provider</span>
                <Link className={styles.detailLink} to={`/workspace/${workspaceId}/models/providers/${model.providerId}`}>
                  {model.providerName}
                </Link>
              </div>
              <div className={styles.detail}>
                <span className={styles.detailLabel}>Type</span>
                <span className={styles.detailValue}>{modelKindLabel(model.kind)}</span>
              </div>
              <div className={styles.detail}>
                <span className={styles.detailLabel}>Max Output</span>
                <span className={styles.detailValue}>
                  {model.maxOutput === null ? '—' : `${formatTokens(model.maxOutput)} tokens`}
                </span>
              </div>
              <div className={styles.detail}>
                <span className={styles.detailLabel}>Model ID</span>
                <span className={styles.detailMono}>{model.modelId}</span>
              </div>
              <div className={styles.detail}>
                <span className={styles.detailLabel}>Context Window</span>
                <span className={styles.detailValue}>
                  {model.contextWindow === null ? '—' : `${formatTokens(model.contextWindow)} tokens`}
                </span>
              </div>
              <div className={styles.detail}>
                <span className={styles.detailLabel}>Status</span>
                <span className={styles.statusRow}>
                  <button
                    type="button"
                    className={styles.toggle}
                    onClick={() => void handleToggle()}
                    role="switch"
                    aria-checked={model.enabled}
                    aria-label={`${model.enabled ? 'Deactivate' : 'Activate'} ${model.name}`}
                  >
                    <img src={model.enabled ? toggleOnIcon : toggleOffIcon} alt="" width={36} height={20} data-keeps-colour />
                  </button>
                  <span className={model.enabled ? styles.statusActive : styles.statusInactive}>
                    {model.enabled ? 'Active' : 'Inactive'}
                  </span>
                </span>
              </div>
            </div>
          </section>

          <section className={styles.card}>
            <h2 className={styles.sectionHeading}>Usage Metrics</h2>

            {usage === null || usage.empty ? (
              /*
               * Nothing has called this model, so there is nothing to show. A
               * grid of zeros would read as a result rather than as an absence.
               */
              <p className={styles.emptyMetrics}>
                No usage has been recorded for this model yet. The figures here are summed from real
                calls, so they stay empty until something makes one.
              </p>
            ) : (
              <>
                <div className={styles.statsRow}>
                  <Stat
                    label="Total Requests"
                    value={formatCompact(usage.requests)}
                    change={formatChange(usage.requestsChange)}
                    good={(usage.requestsChange ?? 0) >= 0}
                  />
                  <Stat
                    label="Tokens Used"
                    value={formatCompact(usage.totalTokens)}
                    change={formatChange(usage.tokensChange)}
                    good={(usage.tokensChange ?? 0) >= 0}
                  />
                  <Stat
                    label="Avg Latency"
                    value={formatLatency(usage.averageLatencyMillis)}
                    change={formatChange(usage.latencyChange)}
                    /* Slower is worse, so the sign reads the other way round. */
                    good={(usage.latencyChange ?? 0) <= 0}
                  />
                </div>

                <div className={styles.chartArea}>
                  <p className={styles.chartTitle}>Usage Over Time ({usage.days} days)</p>
                  <UsageChart series={usage.series} />
                  <div className={styles.chartDates}>
                    <span>{usage.from}</span>
                    <span>{usage.to}</span>
                  </div>
                </div>

                <div className={styles.breakdown}>
                  <p className={styles.breakdownTitle}>Token Breakdown (Last {usage.days} Days)</p>
                  <div className={styles.breakdownGrid}>
                    <Figure label="Input Tokens" value={formatTokens(usage.inputTokens)} />
                    <Figure label="Output Tokens" value={formatTokens(usage.outputTokens)} />
                    <Figure label="Total Tokens" value={formatTokens(usage.totalTokens)} />
                    <Figure
                      label="Cost Estimate"
                      value={usage.costEstimate === null ? '—' : `$${usage.costEstimate.toFixed(2)}`}
                      accent
                    />
                  </div>
                </div>
              </>
            )}
          </section>

          <form className={styles.card} onSubmit={handleSave}>
            <h2 className={styles.sectionHeading}>Quotas &amp; Limits</h2>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="token-limit">
                  Token Limit
                </label>
                <input
                  id="token-limit"
                  className={`${styles.input} ${styles.inputMono}`}
                  value={tokenLimit}
                  onChange={(event) => setTokenLimit(event.target.value)}
                  placeholder="No limit"
                  inputMode="numeric"
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="reset-interval">
                  Reset Interval
                </label>
                <div className={styles.selectWrapper}>
                  <select
                    id="reset-interval"
                    className={`${styles.input} ${styles.select}`}
                    value={resetInterval}
                    onChange={(event) => setResetInterval(event.target.value as ResetInterval)}
                  >
                    {RESET_INTERVALS.map((interval) => (
                      <option key={interval} value={interval}>
                        {resetIntervalLabel(interval)}
                      </option>
                    ))}
                  </select>
                  <img className={styles.selectChevron} src={chevronDown12Icon} alt="" width={12} height={12} />
                </div>
              </div>
            </div>

            <div className={styles.usageBlock}>
              <div className={styles.usageHeader}>
                <span className={styles.label}>Current Usage</span>
                <span className={share !== null && share >= 0.8 ? styles.usageWarn : styles.usageValue}>
                  {limit === null
                    ? `${formatCompact(used)} tokens, no limit set`
                    : `${formatCompact(used)} / ${formatCompact(limit)} tokens (${Math.round((share ?? 0) * 100)}%)`}
                </span>
              </div>
              <div className={styles.usageTrack}>
                <div
                  className={share !== null && share >= 0.8 ? styles.usageFillWarn : styles.usageFill}
                  style={{ width: `${(share ?? 0) * 100}%` }}
                />
              </div>
              <p className={styles.usageNote}>Counting from {usage?.periodStart ?? '—'}.</p>
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="rpm">
                  Requests per Minute (RPM)
                </label>
                <input
                  id="rpm"
                  className={`${styles.input} ${styles.inputMono}`}
                  value={requestsPerMinute}
                  onChange={(event) => setRequestsPerMinute(event.target.value)}
                  placeholder="No limit"
                  inputMode="numeric"
                />
              </div>
              <div className={styles.field} />
            </div>

            <div className={styles.formFooter}>
              {saveError !== null && (
                <p className={styles.saveError} role="alert">
                  {saveError}
                </p>
              )}
              {saved && saveError === null && <p className={styles.saved}>Saved.</p>}
              <button type="submit" className={styles.primaryButton} disabled={saving}>
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </form>

          <section className={styles.dangerCard}>
            <h2 className={styles.dangerHeading}>Danger Zone</h2>
            <div className={styles.dangerRow}>
              <div className={styles.dangerText}>
                <span className={styles.dangerTitle}>Remove Model</span>
                <span className={styles.dangerNote}>Remove this model from your workspace configuration</span>
              </div>
              <button
                type="button"
                className={styles.dangerButton}
                onClick={() => void handleRemove()}
                disabled={removing}
              >
                {removing ? 'Removing…' : 'Remove Model'}
              </button>
            </div>
          </section>
        </>
      )}
    </AppShell>
  );
}

function Stat({
  label,
  value,
  change,
  good,
}: {
  label: string;
  value: string;
  change: string | null;
  good: boolean;
}) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
      {/* Nothing to compare with is nothing to say, rather than a zero. */}
      {change !== null && (
        <span className={good ? styles.statChangeGood : styles.statChangeBad}>{change} vs last period</span>
      )}
    </div>
  );
}

function Figure({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={styles.figure}>
      <span className={accent ? styles.figureLabelAccent : styles.figureLabel}>{label}</span>
      <span className={accent ? styles.figureValueAccent : styles.figureValue}>{value}</span>
    </div>
  );
}
