import { useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';

import { authMethod } from '../../api/session';
import type { AuthMethodInfo, Credentials } from '../../api/session';
import eyeIcon from '../../assets/eye.svg';
import orknuxMark from '../../assets/orknux-mark.svg';
import { Attribution } from '../../components/Attribution';
import styles from './LoginPage.module.css';

export interface LoginPageProps {
  /** Called with the entered credentials once both fields are filled in. Rejects to show an error. */
  onSubmit?: (credentials: Credentials) => Promise<void> | void;
  /** Called when the user clicks "Reset" next to the password label. */
  onResetPassword?: () => void;
  /**
   * Shown in the badge beside the wordmark. Defaults to the version this bundle
   * was built at — the same one the monitoring screen reports, so the two cannot
   * disagree.
   */
  version?: string;
}

export function LoginPage({ onSubmit, onResetPassword, version = `v${__APP_VERSION__}` }: LoginPageProps) {
  const usernameId = useId();
  const passwordId = useId();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * How this installation signs people in. Null while it is being asked — the card
   * draws its frame but not its middle, because guessing wrong would show a password
   * box to somebody whose password this server has never seen.
   */
  const [signIn, setSignIn] = useState<AuthMethodInfo | null>(null);

  useEffect(() => {
    let current = true;
    authMethod().then((found) => {
      if (current) setSignIn(found);
    });
    return () => {
      current = false;
    };
  }, []);

  const canSubmit = username.trim() !== '' && password !== '' && !submitting;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit?.({ username: username.trim(), password });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed.');
      setSubmitting(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <header className={styles.header}>
          <div className={styles.logomark}>
            <span className={styles.logoIcon}>
              <img src={orknuxMark} alt="" />
            </span>
            <p className={styles.wordmark}>ORKNUX</p>
            <span className={styles.versionBadge}>{version}</span>
          </div>

          <div className={styles.headings}>
            <h1 className={styles.title}>Sign in</h1>
            <p className={styles.subtitle}>
              {signIn?.method === 'OIDC'
                ? `This installation signs in with ${signIn.displayName}.`
                : 'Enter your username and password.'}
            </p>
          </div>
        </header>

        {/*
          One door or the other, never both. Where the provider holds the passwords
          there is nothing here to type, and a form that looked as though there were
          would be a form that always failed.
        */}
        {signIn?.method === 'OIDC' && signIn.authorizeUrl !== null && (
          <div className={styles.form}>
            <a className={styles.provider} href={signIn.authorizeUrl}>
              Continue with {signIn.displayName}
            </a>
          </div>
        )}

        {signIn?.method !== 'OIDC' && (
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          <div className={styles.fields}>
            <div className={styles.field}>
              <div className={styles.fieldHeader}>
                <label className={styles.label} htmlFor={usernameId}>
                  Username
                </label>
              </div>
              <div className={styles.inputContainer}>
                <input
                  id={usernameId}
                  className={`${styles.input} ${styles.inputMono}`}
                  type="text"
                  name="username"
                  autoComplete="username"
                  placeholder="developer"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </div>
            </div>

            <div className={styles.field}>
              <div className={styles.fieldHeader}>
                <label className={styles.label} htmlFor={passwordId}>
                  Password
                </label>
                <button type="button" className={styles.resetLink} onClick={onResetPassword}>
                  Reset
                </button>
              </div>
              <div className={styles.inputContainer}>
                <input
                  id={passwordId}
                  className={styles.input}
                  type={passwordVisible ? 'text' : 'password'}
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  className={styles.toggleVisibility}
                  aria-label={passwordVisible ? 'Hide password' : 'Show password'}
                  aria-pressed={passwordVisible}
                  onClick={() => setPasswordVisible((visible) => !visible)}
                >
                  <img src={eyeIcon} alt="" />
                </button>
              </div>
            </div>
          </div>

          <div className={styles.actions}>
            {error !== null && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <button type="submit" className={styles.submit} disabled={!canSubmit}>
              {submitting ? 'Signing in…' : 'Sign In'}
            </button>
            <p className={styles.authNote}>Authenticating via LDAP</p>
          </div>
        </form>
        )}

        {/*
          The attribution, on the one screen everybody sees before they are
          anybody. Under the card rather than inside it, so it reads as belonging
          to the product and not to the sign-in form.
        */}
        <Attribution />
      </div>
    </main>
  );
}
