import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { SHORTEST_PASSWORD, completePasswordReset } from '../../api/passwordReset';
import eyeIcon from '../../assets/eye.svg';
import orknuxMark from '../../assets/orknux-mark.svg';
import { Attribution } from '../../components/Attribution';
import styles from './LoginPage.module.css';

export interface ResetPasswordPageProps {
  version?: string;
}

/**
 * Setting a new password from a mailed link.
 *
 * The token is in the query string, because that is where the link the server
 * wrote puts it. It is never shown and never typed - a person arriving here
 * without one has followed something that is not the link, and is told to ask
 * for one rather than being given a form that cannot work.
 *
 * Two boxes, because the password is not typed again anywhere else afterwards:
 * a mistyped one here is a person locked out of the account they were in the
 * middle of getting back into.
 */
export function ResetPasswordPage({ version = `v${__APP_VERSION__}` }: ResetPasswordPageProps) {
  const passwordId = useId();
  const confirmId = useId();
  const [parameters] = useSearchParams();
  const token = parameters.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = password !== '' && confirmation !== '' && !submitting;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    if (password.length < SHORTEST_PASSWORD) {
      setError(`A password needs at least ${SHORTEST_PASSWORD} characters.`);
      return;
    }
    if (password !== confirmation) {
      setError('The two passwords are not the same.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      setDone(await completePasswordReset(token, password));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not set the password.');
    } finally {
      setSubmitting(false);
    }
  }

  const subtitle =
    done !== null
      ? `The password for ${done} has changed. Anywhere it was signed in has been signed out.`
      : token === ''
        ? 'This link is missing its token. Ask for a new one from the sign-in page.'
        : 'Choose a new password. The link you followed works only this once.';

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
            <h1 className={styles.title}>New password</h1>
            <p className={styles.subtitle}>{subtitle}</p>
          </div>
        </header>

        {token !== '' && done === null && (
          <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <div className={styles.fields}>
              <div className={styles.field}>
                <div className={styles.fieldHeader}>
                  <label className={styles.label} htmlFor={passwordId}>
                    Password
                  </label>
                </div>
                <div className={styles.inputContainer}>
                  <input
                    id={passwordId}
                    className={styles.input}
                    type={passwordVisible ? 'text' : 'password'}
                    name="new-password"
                    autoComplete="new-password"
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

              <div className={styles.field}>
                <div className={styles.fieldHeader}>
                  <label className={styles.label} htmlFor={confirmId}>
                    Again
                  </label>
                </div>
                <div className={styles.inputContainer}>
                  <input
                    id={confirmId}
                    className={styles.input}
                    type={passwordVisible ? 'text' : 'password'}
                    name="confirm-password"
                    autoComplete="new-password"
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                  />
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
                {submitting ? 'Saving…' : 'Set password'}
              </button>
              {/* The rule, until something goes wrong; then the thing that went
                  wrong says it, and repeating it underneath reads as two
                  complaints about one mistake. */}
              {error === null && <p className={styles.authNote}>At least {SHORTEST_PASSWORD} characters</p>}
            </div>
          </form>
        )}

        <div className={styles.actions}>
          <Link className={styles.resetLink} to="/login">
            {done === null ? 'Back to sign in' : 'Sign in'}
          </Link>
        </div>

        <Attribution />
      </div>
    </main>
  );
}
