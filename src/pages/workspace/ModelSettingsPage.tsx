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
  updateModel,
  updateModelQuotas,
} from '../../api/models';
import type { Model, ModelUsage, ResetInterval } from '../../api/models';
import type { SessionUser } from '../../api/session';
import chevronDown12Icon from '../../assets/chevron-down-12.svg';
import toggleOffIcon from '../../assets/toggle-off.svg';
import toggleOnIcon from '../../assets/toggle-on.svg';
import { AppShell } from '../../components/AppShell';
import { BackLink } from '../../components/BackLink';
import { FieldHint } from '../../components/FieldHint';
import { Loader } from '../../components/Loader';
import { WorkspaceSidebar } from '../../components/WorkspaceSidebar';
import { shellUser } from '../../session/user';
import { UsageChart } from './UsageChart';
import styles from './ModelSettingsPage.module.css';
import { t } from '../../i18n';

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
  /**
   * The window, and what the model keeps out of it for its own answer.
   *
   * Their own state, their own save and their own message, apart from the
   * quotas below: a quota is what this workspace will allow, and these two are
   * facts about the model that everything sizing a prompt reads.
   */
  const [contextWindow, setContextWindow] = useState('');
  const [maxOutput, setMaxOutput] = useState('');
  const [imageCost, setImageCost] = useState('');
  const [windowError, setWindowError] = useState<string | null>(null);
  const [windowSaved, setWindowSaved] = useState(false);
  const [windowSaving, setWindowSaving] = useState(false);
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
          setLoadError(t('That model does not exist, or you do not have access to it.'));
          return;
        }
        apply(found);
      })
      .catch((cause: unknown) => {
        setLoadError(cause instanceof Error ? cause.message : t('Could not load the model.'));
      });

    // The metrics are their own request: the settings should still show if the
    // usage query is the thing that failed.
    fetchModelUsage(modelId)
      .then(setUsage)
      .catch(() => setUsage(null));
  }, [modelId]);

  function apply(found: Model) {
    setModel(found);
    setContextWindow(found.contextWindow === null ? '' : String(found.contextWindow));
    setMaxOutput(found.maxOutput === null ? '' : String(found.maxOutput));
    setImageCost(found.imageCostPerImage === null ? '' : String(found.imageCostPerImage));
    setTokenLimit(found.tokenLimit === null ? '' : String(found.tokenLimit));
    setResetInterval(found.resetInterval);
    setRequestsPerMinute(found.requestsPerMinute === null ? '' : String(found.requestsPerMinute));
  }

  async function handleToggle() {
    if (model === null) return;
    try {
      apply(await setModelEnabled(model.id, !model.enabled));
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : t('Could not change the model.'));
    }
  }

  /**
   * An image model is billed per picture, so this card is about a price.
   *
   * Same form and same save: the two fields it swaps for are meaningless on one
   * - a model that draws reads no context window and writes no tokens - and the
   * per-picture price had nowhere else to be changed, which would have made a
   * mistyped price permanent.
   */
  const draws = model?.kind === 'IMAGE';

  /**
   * The window and the reserved answer, saved.
   *
   * `updateModel` replaces a model's own details rather than patching them —
   * the schema says as much, and the form that was meant to send every field
   * was never built, which is why there was nowhere at all to record a window.
   * So the fields this card does not show are sent back exactly as they were
   * loaded: leaving one out would clear it.
   */
  async function handleSaveWindow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (model === null || windowSaving) return;

    setWindowSaving(true);
    setWindowError(null);
    setWindowSaved(false);
    try {
      apply(
        await updateModel(model.id, {
          name: model.name,
          modelId: model.modelId,
          kind: model.kind,
          contextWindow: toNumber(contextWindow),
          maxOutput: toNumber(maxOutput),
          inputCostPerMillion: model.inputCostPerMillion,
          outputCostPerMillion: model.outputCostPerMillion,
          voice: model.voice,
          // Sent back whatever it was, for the reason above: this mutation
          // replaces a model's details rather than patching them, so a field
          // this card does not show is a field left out and therefore cleared.
          imageCostPerImage: draws ? toNumber(imageCost) : model.imageCostPerImage,
        }),
      );
      setWindowSaved(true);
    } catch (cause) {
      setWindowError(cause instanceof Error ? cause.message : t('Could not save the context window.'));
    } finally {
      setWindowSaving(false);
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
      setSaveError(cause instanceof Error ? cause.message : t('Could not save the quotas.'));
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
      setSaveError(cause instanceof Error ? cause.message : t('Could not remove the model.'));
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
          <BackLink to={`/workspace/${workspaceId}/models`} label={t('Models')} />
          <Link className={styles.crumbLink} to={`/workspace/${workspaceId}/models`}>
            {t('Models')}
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
            <h2 className={styles.sectionHeading}>{t('Provider Details')}</h2>
            <div className={styles.detailGrid}>
              <div className={styles.detail}>
                <span className={styles.detailLabel}>{t('Provider')}</span>
                <Link className={styles.detailLink} to={`/workspace/${workspaceId}/models/providers/${model.providerId}`}>
                  {model.providerName}
                </Link>
              </div>
              <div className={styles.detail}>
                <span className={styles.detailLabel}>{t('Type')}</span>
                <span className={styles.detailValue}>{modelKindLabel(model.kind)}</span>
              </div>
              <div className={styles.detail}>
                <span className={styles.detailLabel}>{t('Model ID')}</span>
                <span className={styles.detailMono}>{model.modelId}</span>
              </div>
              <div className={styles.detail}>
                <span className={styles.detailLabel}>{t('Status')}</span>
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

          {/*
            Where the window is set, which is where the rest of the application
            says it is set.

            An agent's session memory is a share of this number, and refusing a
            share said "Set the model's context window on the Models screen
            first" while the Models screen only ever printed it — recorded when
            a model was added and unchangeable afterwards, and null on every
            model that arrived any other way. Issue #252.

            Per model rather than per provider. One provider serves models whose
            windows differ by an order of magnitude, so a number kept beside the
            key would be wrong for all but one of them, and it is this row that
            everything sizing a prompt reads.
          */}
          <form className={styles.card} onSubmit={handleSaveWindow}>
            <h2 className={styles.sectionHeading}>{draws ? t('Price') : t('Context Window')}</h2>

            <div className={styles.fieldRow}>
              {draws ? (
                <div className={styles.field}>
                  <span className={styles.labelWithHint}>
                    <label className={styles.label} htmlFor="image-cost">{t('$ / picture')}</label>
                    <FieldHint label={t('$ / picture')}>
                      {t('What the provider charges for one picture at the size this model draws. It is asked for here rather than as a price per million tokens because that is how these models are billed, and because an image call reports no tokens at all — costed the ordinary way, every picture would come out free. Empty means not recorded, and a drawing then reports no cost rather than nought.')}
                    </FieldHint>
                  </span>
                  <input
                    id="image-cost"
                    className={`${styles.input} ${styles.inputMono}`}
                    value={imageCost}
                    onChange={(event) => setImageCost(event.target.value)}
                    placeholder={t('Not recorded')}
                    inputMode="decimal"
                  />
                </div>
              ) : (
                <>
              <div className={styles.field}>
                <span className={styles.labelWithHint}>
                  <label className={styles.label} htmlFor="context-window">
                    {t('Context Window')}
                  </label>
                  <FieldHint label={t('Context Window')}>
                    {t('How many tokens this model reads at once, as its provider states it. Nothing here asks the model: it is what the workspace records, and it is what a share of a session’s memory is worked out from — an agent given a share of a model with no window recorded falls back to a fixed built-in allowance. Empty means not recorded.')}
                  </FieldHint>
                </span>
                <input
                  id="context-window"
                  className={`${styles.input} ${styles.inputMono}`}
                  value={contextWindow}
                  onChange={(event) => setContextWindow(event.target.value)}
                  placeholder={t('Not recorded')}
                  inputMode="numeric"
                />
              </div>
              <div className={styles.field}>
                <span className={styles.labelWithHint}>
                  <label className={styles.label} htmlFor="max-output">{t('Max Output')}</label>
                  <FieldHint label={t('Max Output')}>
                    {t('The most this model will write in one answer. It comes out of the window above, so it is the other half of what a session may be given: a model that reserves most of its window for its answer can carry very little conversation.')}
                  </FieldHint>
                </span>
                <input
                  id="max-output"
                  className={`${styles.input} ${styles.inputMono}`}
                  value={maxOutput}
                  onChange={(event) => setMaxOutput(event.target.value)}
                  placeholder={t('Not recorded')}
                  inputMode="numeric"
                />
              </div>
                </>
              )}
            </div>

            <div className={styles.formFooter}>
              {windowError !== null && (
                <p className={styles.saveError} role="alert">
                  {windowError}
                </p>
              )}
              {windowSaved && windowError === null && <p className={styles.saved}>{t('Saved.')}</p>}
              <button type="submit" className={styles.primaryButton} disabled={windowSaving}>
                {windowSaving ? t('Saving…') : t('Save Changes')}
              </button>
            </div>
          </form>

          <section className={styles.card}>
            <h2 className={styles.sectionHeading}>{t('Usage Metrics')}</h2>

            {usage === null || usage.empty ? (
              /*
               * Nothing has called this model, so there is nothing to show. A
               * grid of zeros would read as a result rather than as an absence.
               */
              <p className={styles.emptyMetrics}>
                {t('No usage has been recorded for this model yet. The figures here are summed from real calls, so they stay empty until something makes one.')}
              </p>
            ) : (
              <>
                <div className={styles.statsRow}>
                  <Stat
                    label={t('Total Requests')}
                    value={formatCompact(usage.requests)}
                    change={formatChange(usage.requestsChange)}
                    good={(usage.requestsChange ?? 0) >= 0}
                  />
                  <Stat
                    label={t('Tokens Used')}
                    value={formatCompact(usage.totalTokens)}
                    change={formatChange(usage.tokensChange)}
                    good={(usage.tokensChange ?? 0) >= 0}
                  />
                  <Stat
                    label={t('Avg Latency')}
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
                    <Figure label={t('Input Tokens')} value={formatTokens(usage.inputTokens)} />
                    <Figure label={t('Output Tokens')} value={formatTokens(usage.outputTokens)} />
                    <Figure label={t('Total Tokens')} value={formatTokens(usage.totalTokens)} />
                    <Figure
                      label={t('Cost Estimate')}
                      value={usage.costEstimate === null ? '—' : `$${usage.costEstimate.toFixed(2)}`}
                      accent
                    />
                  </div>
                </div>
              </>
            )}
          </section>

          <form className={styles.card} onSubmit={handleSave}>
            <h2 className={styles.sectionHeading}>{t('Quotas & Limits')}</h2>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="token-limit">{t('Token Limit')}</label>
                <input
                  id="token-limit"
                  className={`${styles.input} ${styles.inputMono}`}
                  value={tokenLimit}
                  onChange={(event) => setTokenLimit(event.target.value)}
                  placeholder={t('No limit')}
                  inputMode="numeric"
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="reset-interval">
                  {t('Reset Interval')}
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
                <span className={styles.label}>{t('Current Usage')}</span>
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
                  {t('Requests per Minute (RPM)')}
                </label>
                <input
                  id="rpm"
                  className={`${styles.input} ${styles.inputMono}`}
                  value={requestsPerMinute}
                  onChange={(event) => setRequestsPerMinute(event.target.value)}
                  placeholder={t('No limit')}
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
              {saved && saveError === null && <p className={styles.saved}>{t('Saved.')}</p>}
              <button type="submit" className={styles.primaryButton} disabled={saving}>
                {saving ? t('Saving…') : t('Save Changes')}
              </button>
            </div>
          </form>

          <section className={styles.dangerCard}>
            <h2 className={styles.dangerHeading}>{t('Danger Zone')}</h2>
            <div className={styles.dangerRow}>
              <div className={styles.dangerText}>
                <span className={styles.dangerTitle}>{t('Remove Model')}</span>
                <span className={styles.dangerNote}>
                  {t('Remove this model from your workspace configuration')}
                </span>
              </div>
              <button
                type="button"
                className={styles.dangerButton}
                onClick={() => void handleRemove()}
                disabled={removing}
              >
                {removing ? t('Removing…') : t('Remove Model')}
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
