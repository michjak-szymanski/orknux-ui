import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import {
  fetchProxyRoute,
  fetchProxyRules,
  moveProxyRule,
  setProxyRuleEnabled,
} from '../../api/networking';
import type { ProxyRoute, ProxyRule } from '../../api/networking';
import type { SessionUser } from '../../api/session';
import plusIcon from '../../assets/plus.svg';
import settingsIcon from '../../assets/settings.svg';
import toggleOffIcon from '../../assets/toggle-off.svg';
import toggleOnIcon from '../../assets/toggle-on.svg';
import { AdminSidebar } from '../../components/AdminSidebar';
import { AppShell } from '../../components/AppShell';
import { FieldHint } from '../../components/FieldHint';
import { Loader } from '../../components/Loader';
import { ProxyRuleDialog } from '../../components/ProxyRuleDialog';
import { shellUser } from '../../session/user';
import styles from './AdminNetworkingPage.module.css';

export interface AdminNetworkingPageProps {
  session: SessionUser;
  onSignOut?: () => void;
}

/**
 * Which outbound addresses go through a proxy.
 *
 * The list is ordered, and the order is shown rather than implied, because the
 * first rule that matches a URL is the one used and a rule sitting behind a
 * broader one will never fire. That is the failure this page exists to prevent:
 * a rule that looks configured, is configured, and does nothing. So the position
 * is a column, moving a rule is two buttons, and there is a box at the bottom
 * that will say for any URL which rule answers and which rules it beat.
 */
export function AdminNetworkingPage({ session, onSignOut }: AdminNetworkingPageProps) {
  const [rules, setRules] = useState<ProxyRule[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // False when closed, true when adding, the rule itself when editing.
  const [dialog, setDialog] = useState<boolean | ProxyRule>(false);

  const [testUrl, setTestUrl] = useState('');
  const [testing, setTesting] = useState(false);
  const [route, setRoute] = useState<ProxyRoute | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchProxyRules()
      .then((result) => {
        setRules(result);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        setRules(null);
        setError(cause instanceof Error ? cause.message : 'Could not load the proxy rules.');
        setLoading(false);
      });
  }, []);

  useEffect(load, [load]);

  async function toggle(rule: ProxyRule) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await setProxyRuleEnabled(rule.id, !rule.enabled);
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change the rule.');
    } finally {
      setBusy(false);
    }
  }

  async function move(rule: ProxyRule, up: boolean) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setRules(await moveProxyRule(rule.id, up));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not move the rule.');
    } finally {
      setBusy(false);
    }
  }

  async function test(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (testUrl.trim() === '' || testing) return;
    setTesting(true);
    setTestError(null);
    setRoute(null);
    try {
      setRoute(await fetchProxyRoute(testUrl.trim()));
    } catch (cause) {
      setTestError(cause instanceof Error ? cause.message : 'Could not test that address.');
    } finally {
      setTesting(false);
    }
  }

  const listed = rules ?? [];

  return (
    <AppShell
      user={shellUser(session)}
      onSignOut={onSignOut}
      sidebar={<AdminSidebar active="networking" />}
    >
      <header className={styles.titleBar}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>
            <span className={styles.titleWithHint}>
              Networking
              {/*
                Was the footer under the table. Same words, behind the one
                affordance this product uses for an explanation.
              */}
              <FieldHint label="Networking">
                These rules apply to every outbound request this installation makes - connection
                checks, MCP servers, model providers and the token grants they need, Slack, the
                identity provider an OIDC installation signs in against, and anything a workflow
                calls. Mail is included: a rule is matched against <code>smtp://host:port</code>,
                and the proxy has to allow a <code>CONNECT</code> to that port for it to work.
                Directory sign-in over LDAP is not - it is not HTTP, and no rule here can carry it.
                Passwords are stored encrypted and are never shown again.
              </FieldHint>
            </span>
          </h1>
          <p className={styles.subtitle}>
            How this installation reaches the outside. A rule sends the requests it matches through
            a proxy; everything else goes out directly.
          </p>
        </div>
        <button type="button" className={styles.addRule} onClick={() => setDialog(true)}>
          <img src={plusIcon} alt="" width={14} height={14} />
          Add Proxy Rule
        </button>
      </header>

      <section className={styles.card}>
        <div className={styles.tableHeader}>
          <div className={styles.colOrder}>Order</div>
          <div className={styles.colName}>Name</div>
          <div className={styles.colPattern}>URL pattern</div>
          <div className={styles.colProxy}>Proxy</div>
          <div className={styles.colEnabled}>On</div>
          <div className={styles.colActions} />
        </div>

        {loading && (
          <p className={styles.notice}>
            <Loader />
          </p>
        )}
        {error !== null && <p className={`${styles.notice} ${styles.noticeError}`}>{error}</p>}
        {!loading && error === null && listed.length === 0 && (
          <p className={styles.notice}>
            No proxy rules yet. Every request goes out the way this host does.
          </p>
        )}

        {listed.map((rule, index) => (
          <div className={styles.row} key={rule.id}>
            <div className={styles.colOrder}>
              <span className={styles.position}>{index + 1}</span>
              <button
                type="button"
                className={styles.move}
                onClick={() => void move(rule, true)}
                disabled={busy || index === 0}
                aria-label={`Move ${rule.name} earlier`}
                title="Consult this rule earlier"
              >
                ↑
              </button>
              <button
                type="button"
                className={styles.move}
                onClick={() => void move(rule, false)}
                disabled={busy || index === listed.length - 1}
                aria-label={`Move ${rule.name} later`}
                title="Consult this rule later"
              >
                ↓
              </button>
            </div>
            <div className={styles.colName}>
              <span className={`${styles.name} ${rule.enabled ? '' : styles.nameDisabled}`}>
                {rule.name}
              </span>
              {rule.username !== null && rule.username !== '' && (
                <span className={styles.credentials}>
                  as {rule.username}
                  {rule.passwordSet ? ' with a password' : ''}
                </span>
              )}
            </div>
            <div className={styles.colPattern}>
              <span className={styles.pattern} title={rule.pattern}>
                {rule.pattern}
              </span>
            </div>
            <div className={styles.colProxy}>
              <span className={styles.proxy}>
                {rule.proxyHost}:{rule.proxyPort}
              </span>
            </div>
            <div className={styles.colEnabled}>
              <button
                type="button"
                className={styles.toggle}
                onClick={() => void toggle(rule)}
                disabled={busy}
                role="switch"
                aria-checked={rule.enabled}
                aria-label={`${rule.enabled ? 'Disable' : 'Enable'} ${rule.name}`}
                title={rule.enabled ? 'Disable' : 'Enable'}
              >
                <img
                  src={rule.enabled ? toggleOnIcon : toggleOffIcon}
                  alt=""
                  width={36}
                  height={20}
                  data-keeps-colour
                />
              </button>
            </div>
            <div className={styles.colActions}>
              <button
                type="button"
                className={styles.rowAction}
                onClick={() => setDialog(rule)}
                aria-label={`Edit ${rule.name}`}
                title="Edit"
              >
                <img src={settingsIcon} alt="" width={14} height={14} />
              </button>
            </div>
          </div>
        ))}
      </section>

      {/*
        The question somebody will have the moment there is a second rule.
        Answered by the server, which asks the thing that actually routes
        requests, so it cannot drift from what a real call would do.
      */}
      <section className={styles.testCard}>
        <h2 className={styles.testTitle}>
          <span className={styles.titleWithHint}>
            Which rule fires for an address
            <FieldHint label="Which rule fires for an address">
              Rules are consulted from the top and the first one that matches is used. Put an
              address in here to see which one that is, and which rules it beat to it.
            </FieldHint>
          </span>
        </h2>
        <form className={styles.testRow} onSubmit={test}>
          <input
            className={styles.testInput}
            type="text"
            placeholder="https://login.microsoftonline.com/contoso/oauth2/v2.0/token"
            value={testUrl}
            onChange={(event) => setTestUrl(event.target.value)}
            aria-label="An address to test against the rules"
          />
          <button
            type="submit"
            className={styles.testButton}
            disabled={testing || testUrl.trim() === ''}
          >
            {testing ? 'Checking…' : 'Check'}
          </button>
        </form>

        {testError !== null && <p className={styles.testWarning}>{testError}</p>}

        {route !== null && (
          <div className={styles.testAnswer}>
            {route.matched === null ? (
              <p>This address matches no rule, so the request goes out directly.</p>
            ) : (
              <p>
                Goes through <strong>{route.matched.name}</strong> at {route.matched.proxyHost}:
                {route.matched.proxyPort}.
              </p>
            )}
            {route.beaten.length > 0 && (
              <p className={styles.testWarning}>
                Also matched, and will never fire for this address:{' '}
                {route.beaten.map((rule) => rule.name).join(', ')}. Move one above{' '}
                {route.matched?.name} to use it instead.
              </p>
            )}
            {route.refusedBecause !== null && (
              <p className={styles.testWarning}>
                This address is refused before any rule is consulted: {route.refusedBecause}. A
                proxied request is checked exactly as an unproxied one is.
              </p>
            )}
            {route.proxyProblem !== null && (
              <p className={styles.testWarning}>
                That rule&apos;s own proxy cannot be used: {route.proxyProblem}.
              </p>
            )}
          </div>
        )}
      </section>

      <ProxyRuleDialog
        open={dialog}
        onClose={() => setDialog(false)}
        onSaved={() => {
          setDialog(false);
          setRoute(null);
          load();
        }}
      />
    </AppShell>
  );
}
