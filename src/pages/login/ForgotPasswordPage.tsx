import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';

import { requestPasswordReset } from '../../api/passwordReset';
import orknuxMark from '../../assets/orknux-mark.svg';
import { Attribution } from '../../components/Attribution';
import styles from './LoginPage.module.css';

export interface ForgotPasswordPageProps {
  version?: string;
}

/**
 * Asking for a reset link.
 *
 * The same card as sign-in, and the same stylesheet rather than a copy of it:
 * this is the sign-in screen with one field, and somebody who arrived here by
 * pressing Reset should not feel they have left.
 *
 * What it shows afterwards is whatever the server said, unchanged and without
 * anything added to it. That sentence is the same whether the address belongs to
 * an account or to nobody, and a helpful "we could not find that" written here
 * would undo the whole point of the server having been careful.
 */
export function ForgotPasswordPage({ version = `v${__APP_VERSION__}` }: ForgotPasswordPageProps) {
  const emailId = useId();

  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = email.trim() !== '' && !submitting;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setError(null);
    try {
      setSent(await requestPasswordReset(email.trim()));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not ask for a link.');
    } finally {
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
            <h1 className={styles.title}>Reset password</h1>
            <p className={styles.subtitle}>
              {sent === null
                ? 'Enter the address on your account and we will send a link to set a new password.'
                : sent}
            </p>
          </div>
        </header>

        {sent === null && (
          <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <div className={styles.fields}>
              <div className={styles.field}>
                <div className={styles.fieldHeader}>
                  <label className={styles.label} htmlFor={emailId}>
                    Email
                  </label>
                </div>
                <div className={styles.inputContainer}>
                  <input
                    id={emailId}
                    className={`${styles.input} ${styles.inputMono}`}
                    type="email"
                    name="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
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
                {submitting ? 'Sending…' : 'Send link'}
              </button>
              <Link className={styles.resetLink} to="/login">
                Back to sign in
              </Link>
            </div>
          </form>
        )}

        {sent !== null && (
          <div className={styles.actions}>
            <Link className={styles.resetLink} to="/login">
              Back to sign in
            </Link>
          </div>
        )}

        <Attribution />
      </div>
    </main>
  );
}
