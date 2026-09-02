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
import {
  fetchTrustedCertificates,
  trustCertificate,
  untrustCertificate,
} from '../../api/networking';
import type { TrustedCertificate } from '../../api/networking';
import { AdminSidebar } from '../../components/AdminSidebar';
import { AppShell } from '../../components/AppShell';
import { FieldHint } from '../../components/FieldHint';
import { Loader } from '../../components/Loader';
import { ProxyRuleDialog } from '../../components/ProxyRuleDialog';
import { shellUser } from '../../session/user';
import styles from './AdminNetworkingPage.module.css';
import { t } from '../../i18n';

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
        setError(cause instanceof Error ? cause.message : t('Could not load the proxy rules.'));
        setLoading(false);
      });
  }, []);

  useEffect(load, [load]);

  /* --------------------------------------------------- certificate authorities */

  /**
   * What this installation trusts on the way out, beyond the JVM's own roots.
   *
   * Here rather than on a server's own page because it is one decision for the
   * whole installation: an authority trusted to reach one MCP server is trusted
   * by every outbound connection this server makes, and a list spread across
   * whichever workspaces happened to paste one in is a list nobody can read.
   * Issue #322.
   */
  const [certificates, setCertificates] = useState<TrustedCertificate[] | null>(null);
  const [certificateName, setCertificateName] = useState('');
  const [pem, setPem] = useState('');
  const [adding, setAdding] = useState(false);
  const [certificateError, setCertificateError] = useState<string | null>(null);

  const loadCertificates = useCallback(() => {
    fetchTrustedCertificates()
      .then(setCertificates)
      .catch((cause: unknown) => {
        setCertificates([]);
        setCertificateError(
          cause instanceof Error ? cause.message : t('Could not read what this installation trusts.'),
        );
      });
  }, []);

  useEffect(loadCertificates, [loadCertificates]);

  async function trust(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (adding || certificateName.trim() === '' || pem.trim() === '') return;
    setAdding(true);
    setCertificateError(null);
    try {
      await trustCertificate(certificateName.trim(), pem.trim());
      setCertificateName('');
      setPem('');
      loadCertificates();
    } catch (cause) {
      setCertificateError(cause instanceof Error ? cause.message : t('That could not be trusted.'));
    } finally {
      setAdding(false);
    }
  }

  async function untrust(certificate: TrustedCertificate) {
    setCertificateError(null);
    try {
      await untrustCertificate(certificate.id);
      loadCertificates();
    } catch (cause) {
      setCertificateError(cause instanceof Error ? cause.message : t('That could not be removed.'));
    }
  }

  async function toggle(rule: ProxyRule) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await setProxyRuleEnabled(rule.id, !rule.enabled);
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Could not change the rule.'));
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
      setError(cause instanceof Error ? cause.message : t('Could not move the rule.'));
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
      setTestError(cause instanceof Error ? cause.message : t('Could not test that address.'));
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
              {t('Networking')}
              {/*
                Was the footer under the table. Same words, behind the one
                affordance this product uses for an explanation.
              */}
              <FieldHint label={t('Networking')}>
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
            {t('How this installation reaches the outside. A rule sends the requests it matches through a proxy; everything else goes out directly.')}
          </p>
        </div>
        <button type="button" className={styles.addRule} onClick={() => setDialog(true)}>
          <img src={plusIcon} alt="" width={14} height={14} />
          {t('Add Proxy Rule')}
        </button>
      </header>

      <section className={styles.card}>
        <div className={styles.tableHeader}>
          <div className={styles.colOrder}>{t('Order')}</div>
          <div className={styles.colName}>{t('Name')}</div>
          <div className={styles.colPattern}>{t('URL pattern')}</div>
          <div className={styles.colProxy}>{t('Proxy')}</div>
          <div className={styles.colEnabled}>{t('On')}</div>
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
            {t('No proxy rules yet. Every request goes out the way this host does.')}
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
                title={t('Consult this rule earlier')}
              >
                ↑
              </button>
              <button
                type="button"
                className={styles.move}
                onClick={() => void move(rule, false)}
                disabled={busy || index === listed.length - 1}
                aria-label={`Move ${rule.name} later`}
                title={t('Consult this rule later')}
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
                title={t('Edit')}
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
            {t('Which rule fires for an address')}
            <FieldHint label={t('Which rule fires for an address')}>
              {t('Rules are consulted from the top and the first one that matches is used. Put an address in here to see which one that is, and which rules it beat to it.')}
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
            aria-label={t('An address to test against the rules')}
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
              <p>{t('This address matches no rule, so the request goes out directly.')}</p>
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

      <section className={styles.card} aria-label={t('Certificate authorities')}>
        <h2 className={styles.testTitle}>
          <span className={styles.titleWithHint}>
            {t('Certificate authorities')}
            <FieldHint label={t('Certificate authorities')}>
              <p>
                For anything this installation has to reach that is behind a private authority or a
                self-signed certificate &mdash; an MCP server inside your own network is the usual
                case. Paste the authority&apos;s certificate in PEM and it is trusted{' '}
                <strong>as well as</strong> the ones this installation already trusts, never instead
                of them, so nothing that works today stops.
              </p>
              <p>
                Everything else about TLS is unchanged: the hostname is still checked, the chain
                still has to build, and an expired certificate is still expired. There is no
                &ldquo;trust everything&rdquo; here, deliberately.
              </p>
              <p>
                It is not a secret. This is what the server hands every client that connects; the
                key that signs with it is the secret, and it never comes here.
              </p>
            </FieldHint>
          </span>
        </h2>

        {certificates === null ? (
          <Loader />
        ) : certificates.length === 0 ? (
          <p className={styles.subtitle}>
            {t('Nothing beyond the authorities this installation came with.')}
          </p>
        ) : (
          <ul className={styles.certificateList}>
            {certificates.map((certificate) => (
              <li className={styles.certificateRow} key={certificate.id}>
                <span className={styles.certificateText}>
                  <span className={styles.certificateName}>{certificate.name}</span>
                  <span className={styles.certificateSubject}>{certificate.subject}</span>
                  {/*
                    An expired authority is still on the list and still does
                    nothing, which is exactly the state somebody would spend an
                    afternoon on. Said on the row rather than left to be worked
                    out from a date.
                  */}
                  <span className={certificate.expired ? styles.certificateExpired : styles.certificateWhen}>
                    {certificate.expired
                      ? `Expired ${certificate.expiresAt ?? ''} — it is trusted and will not work`
                      : `Added by ${certificate.addedBy}${
                          certificate.expiresAt === null ? '' : `, good until ${certificate.expiresAt}`
                        }`}
                  </span>
                </span>
                <button
                  type="button"
                  className={styles.certificateRemove}
                  onClick={() => void untrust(certificate)}
                  aria-label={`Stop trusting ${certificate.name}`}
                >
                  {t('Remove')}
                </button>
              </li>
            ))}
          </ul>
        )}

        <form className={styles.certificateForm} onSubmit={trust}>
          <input
            className={styles.testInput}
            type="text"
            placeholder={t('What to call it')}
            value={certificateName}
            onChange={(event) => setCertificateName(event.target.value)}
            aria-label={t('Name for the certificate authority')}
          />
          <textarea
            className={styles.certificateInput}
            rows={4}
            spellCheck={false}
            placeholder={'-----BEGIN CERTIFICATE-----'}
            value={pem}
            onChange={(event) => setPem(event.target.value)}
            aria-label={t('The certificate, in PEM')}
          />
          <button
            type="submit"
            className={styles.testButton}
            disabled={adding || certificateName.trim() === '' || pem.trim() === ''}
          >
            {adding ? 'Adding…' : 'Trust it'}
          </button>
        </form>

        {certificateError !== null && <p className={styles.testWarning}>{certificateError}</p>}
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
