import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import {
  fetchTrustedCertificate,
  trustCertificate,
  untrustCertificate,
  updateTrustedCertificate,
} from '../../api/networking';
import type { SessionUser } from '../../api/session';
import { AdminSidebar } from '../../components/AdminSidebar';
import { AppShell } from '../../components/AppShell';
import { BackLink } from '../../components/BackLink';
import { FieldHint } from '../../components/FieldHint';
import { Loader } from '../../components/Loader';
import { shellUser } from '../../session/user';
import styles from './AdminCertificatePage.module.css';
import { t } from '../../i18n';

export interface AdminCertificatePageProps {
  session: SessionUser;
  onSignOut: () => void;
}

/**
 * One certificate authority this installation trusts.
 *
 * The same page whether one is being added or edited, which is the whole reason
 * it is a page rather than a dialog: adding and changing an authority want the
 * same two fields and the same explanation of what pasting one means, and two
 * screens saying it would be two screens to keep in step. Issue #322.
 *
 * The certificate is shown in full rather than masked. It is not a secret - it
 * is what a server hands every client that connects - and being able to read
 * back which authority was added is the question somebody debugging a refused
 * handshake actually has.
 */
export function AdminCertificatePage({ session, onSignOut }: AdminCertificatePageProps) {
  const navigate = useNavigate();
  const { certificateId = '' } = useParams();
  /** The one route that is not an id: `/new` opens the same page with nothing in it. */
  const adding = certificateId === 'new';

  const [name, setName] = useState('');
  const [pem, setPem] = useState('');
  const [subject, setSubject] = useState<string | null>(null);
  const [addedBy, setAddedBy] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  const [loading, setLoading] = useState(!adding);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (adding) return;
    setLoading(true);
    /*
     * An answer that is no longer wanted is dropped rather than applied.
     *
     * This fills the form from what came back, so a reply landing late writes
     * the stored version over whatever is in the boxes - somebody's typing, or
     * the record they opened after this one. Nothing on screen says it
     * happened: it is the state behind the fields that is replaced, and the
     * state is what the save sends. #324, #862 and #863 were three reports of
     * it on three pages.
     */
    let abandoned = false;
    fetchTrustedCertificate(certificateId)
      .then((found) => {
        if (abandoned) return;
        if (found === null) {
          setError(t('That certificate authority is not here.'));
        } else {
          setName(found.name);
          setPem(found.pem);
          setSubject(found.subject);
          setAddedBy(found.addedBy);
          setExpiresAt(found.expiresAt);
          setExpired(found.expired);
        }
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (abandoned) return;
        setError(cause instanceof Error ? cause.message : t('That could not be read.'));
        setLoading(false);
      });
    return () => {
      abandoned = true;
    };
  }, [adding, certificateId]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || name.trim() === '' || pem.trim() === '') return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      if (adding) {
        const made = await trustCertificate(name.trim(), pem.trim());
        // Straight to the row that now exists, so the address matches what is
        // on screen and a refresh does not go back to an empty form.
        navigate(`/admin/networking/certificates/${made.id}`, { replace: true });
      } else {
        const updated = await updateTrustedCertificate(certificateId, name.trim(), pem.trim());
        setSubject(updated.subject);
        setExpiresAt(updated.expiresAt);
        setExpired(updated.expired);
      }
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('That could not be saved.'));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setError(null);
    try {
      await untrustCertificate(certificateId);
      navigate('/admin/networking');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('That could not be removed.'));
    }
  }

  return (
    <AppShell
      user={shellUser(session)}
      onSignOut={onSignOut}
      sidebar={<AdminSidebar active="networking" />}
    >
      <header className={styles.titleBar}>
        <BackLink to="/admin/networking" label={t('Networking')} />
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>
            <span className={styles.titleWithHint}>
              {adding ? t('Add a certificate authority') : name}
              <FieldHint label={t('Certificate authority')}>
                <p>
                  For anything this installation has to reach that is behind a private authority or
                  a self-signed certificate. It is trusted <strong>as well as</strong> the
                  authorities this installation already trusts, never instead of them, so nothing
                  that works today stops.
                </p>
                <p>
                  The hostname is still checked, the chain still has to build, and an expired
                  certificate is still expired. There is no trust-everything switch, deliberately.
                </p>
                <p>
                  It is not a secret: this is what a server hands every client that connects. The
                  key that signs with it is the secret, and it never comes here.
                </p>
              </FieldHint>
            </span>
          </h1>
          {subject !== null && <p className={styles.subject}>{subject}</p>}
        </div>
      </header>

      {loading ? (
        <Loader />
      ) : (
        <>
          <form className={styles.card} onSubmit={save}>
            <div className={styles.field}>
              <span className={styles.labelWithHint}>
                <label className={styles.label} htmlFor="certificate-name">{t('Name')}</label>
                <FieldHint label={t('Name')}>
                  {t('What to call it here. A list of certificates is a list nobody can read; the name is how one is told from another.')}
                </FieldHint>
              </span>
              <input
                id="certificate-name"
                className={styles.input}
                type="text"
                value={name}
                placeholder={t('Corporate root CA')}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>

            <div className={styles.field}>
              <span className={styles.labelWithHint}>
                <label className={styles.label} htmlFor="certificate-pem">{t('Certificate')}</label>
                <FieldHint label={t('Certificate')}>
                  {t('PEM. A chain is allowed, and an internal authority usually is one.')}
                </FieldHint>
              </span>
              <textarea
                id="certificate-pem"
                className={styles.pem}
                rows={12}
                spellCheck={false}
                value={pem}
                placeholder={'-----BEGIN CERTIFICATE-----'}
                onChange={(event) => setPem(event.target.value)}
                required
              />
            </div>

            {(addedBy !== null || expiresAt !== null) && (
              <p className={expired ? styles.expired : styles.meta}>
                {expired
                  ? `This expired on ${expiresAt?.slice(0, 10)}. It is still trusted and will not work.`
                  : [
                      addedBy === null ? null : `Added by ${addedBy}`,
                      expiresAt === null ? null : `good until ${expiresAt.slice(0, 10)}`,
                    ]
                      .filter((part) => part !== null)
                      .join(', ')}
              </p>
            )}

            <div className={styles.footer}>
              {error !== null && <p className={styles.error}>{error}</p>}
              {saved && error === null && <p className={styles.saved}>{t('Saved.')}</p>}
              <button
                type="submit"
                className={styles.save}
                disabled={saving || name.trim() === '' || pem.trim() === ''}
              >
                {saving ? t('Saving…') : adding ? t('Add') : t('Save Changes')}
              </button>
            </div>
          </form>

          {!adding && (
            <section className={`${styles.card} ${styles.dangerCard}`}>
              <h2 className={styles.dangerHeading}>{t('Danger Zone')}</h2>
              <div className={styles.dangerRow}>
                <div className={styles.dangerText}>
                  <p className={styles.dangerTitle}>{t('Stop trusting this authority')}</p>
                  <p className={styles.dangerNote}>
                    {t('Takes effect on the next connection, not the next restart. Anything reached only because of this certificate stops being reachable.')}
                  </p>
                </div>
                <button type="button" className={styles.dangerButton} onClick={() => void remove()}>
                  {t('Remove')}
                </button>
              </div>
            </section>
          )}
        </>
      )}
    </AppShell>
  );
}
