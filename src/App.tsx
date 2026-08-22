import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';

import { currentSession, login, logout } from './api/session';
import styles from './App.module.css';
import type { Credentials, SessionUser } from './api/session';
import { fetchWorkspaces } from './api/workspaces';
import { ForgotPasswordPage } from './pages/login/ForgotPasswordPage';
import { LoginPage } from './pages/login/LoginPage';
import { ResetPasswordPage } from './pages/login/ResetPasswordPage';
import { PAGES } from './navigation';
import { PAGE_ELEMENTS } from './routes';

export function App() {
  const navigate = useNavigate();
  const [session, setSession] = useState<SessionUser | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  // Where this user belongs after signing in: undefined = still resolving,
  // null = nothing they may see.
  const [home, setHome] = useState<string | null | undefined>(undefined);

  /**
   * Whether the server is answering at all, which is not the same question as
   * whether anybody is signed in.
   *
   * Signing out on any failed request was wrong, and it is what made a restart look
   * like a lost session: the server is unreachable for half a minute while it comes
   * back up, every call fails, and somebody who was perfectly signed in — cookie
   * intact, session sitting in the database — was shown a login form and typed their
   * password for no reason. `currentSession` already answers null only for a refusal;
   * everything else it throws, and a throw means "ask again", not "you are out".
   */
  const [reachable, setReachable] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let attempt = 0;

    const check = () => {
      currentSession()
        .then((found) => {
          if (cancelled) return;
          setSession(found);
          setReachable(true);
          setCheckingSession(false);
        })
        .catch(() => {
          if (cancelled) return;
          setReachable(false);
          attempt += 1;
          // Backs off to five seconds and keeps going: a restart takes about that
          // long, and the page should simply carry on once it is back.
          window.setTimeout(check, Math.min(1000 * attempt, 5000));
        });
    };

    check();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (session === null) {
      setHome(undefined);
      return;
    }
    if (session.admin) {
      setHome('/admin');
      return;
    }
    // Non-admins land on the first workspace their roles grant.
    fetchWorkspaces(0, 1)
      .then((page) => setHome(page.content[0] === undefined ? null : `/workspace/${page.content[0].id}`))
      .catch(() => setHome(null));
  }, [session]);

  const handleSignIn = useCallback(async (credentials: Credentials) => {
    setHome(undefined);
    setSession(await login(credentials));
  }, []);

  const handleSignOut = useCallback(async () => {
    await logout();
    setSession(null);
  }, []);

  /*
   * Not the login page: being unable to reach the server is not being signed out,
   * and a form that cannot work is a worse answer than saying what is wrong.
   */
  if (!reachable && session === null) {
    return (
      <div className={styles.unreachable} role="status">
        <p className={styles.unreachableTitle}>Cannot reach the server</p>
        <p className={styles.unreachableDetail}>Trying again — this page will carry on by itself.</p>
      </div>
    );
  }

  if (checkingSession) return null;
  if (session !== null && home === undefined) return null;

  const signedInHome = home === null ? '/no-workspaces' : (home ?? '/no-workspaces');

  return (
    <Routes>
      <Route
        path="/login"
        element={
          session ? (
            <Navigate to={signedInHome} replace />
          ) : (
            <LoginPage onSubmit={handleSignIn} onResetPassword={() => navigate('/forgot-password')} />
          )
        }
      />
      {/*
        The two screens somebody reaches without being anybody, and the only ones
        besides sign-in that are not in `PAGES`: those are the pages the palette
        offers to a person who is signed in, and neither of these is a place to go
        - one is a form for somebody who cannot get in, and the other is where a
        link in a mail lands. Not redirected away when a session exists either: a
        link followed on a shared machine is still that link's business.
      */}
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      {/*
        Every page, from the one list that also feeds Quick actions. Written out as
        forty-nine near-identical blocks before this, each repeating the same guard —
        which is how two pages came to exist without ever appearing in the palette.
        A page is now one entry in `navigation.ts` and one element in `routes.tsx`,
        and neither compiles without the other.
      */}
      {PAGES.map((page) => (
        <Route
          key={page.path}
          path={page.path}
          element={
            session === null ? (
              <Navigate to="/login" replace />
            ) : page.access === 'admin' && !session.admin ? (
              // Signed in, but this is not theirs: their own home, not the login
              // screen, which would be a lie about why they cannot see it.
              <Navigate to={signedInHome} replace />
            ) : (
              PAGE_ELEMENTS[page.path](session, handleSignOut)
            )
          }
        />
      ))}
      <Route path="*" element={<Navigate to={session ? signedInHome : '/login'} replace />} />
    </Routes>
  );
}
