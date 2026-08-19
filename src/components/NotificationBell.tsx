import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { fetchNotificationCount, fetchNotifications, readNotifications } from '../api/notifications';
import type { Notification } from '../api/notifications';
import { timeAgo } from '../api/tools';
import bellIcon from '../assets/bell.svg';
import styles from './NotificationBell.module.css';

/** How often the count is asked for while somebody has the page open. */
const ASK_EVERY_MS = 60_000;

/** What each kind reads as, in the words somebody would use about it. */
const SAYS: Record<Notification['kind'], string> = {
  OPENED: 'new issue',
  ASSIGNED: 'assigned to you',
  STATUS: 'changed state',
  COMMENT: 'new comment',
  MENTIONED: 'mentioned you',
  OBSERVING: 'you are now an observer',
};

/**
 * What has happened that concerns whoever is signed in.
 *
 * It reads the same feed an assistant reads over MCP, deliberately: two records
 * of what happened on an issue would eventually disagree, and the one nobody is
 * looking at would be the one that was right.
 *
 * The count is asked for on a timer rather than pushed. A socket held open for
 * a number that changes a few times a day is a socket to reconnect, authorise
 * and reason about; a minute of staleness on a bell is not something anybody
 * notices, and coming back to the window asks again anyway.
 */
export function NotificationBell() {
  const [waiting, setWaiting] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[] | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let current = true;
    function ask() {
      fetchNotificationCount()
        .then((count) => {
          if (current) setWaiting(count);
        })
        // A bell that cannot be counted is a bell that shows nothing, not an
        // error over the page: whatever is wrong, it is not this person's
        // problem to read about here.
        .catch(() => undefined);
    }

    ask();
    const timer = window.setInterval(ask, ASK_EVERY_MS);
    window.addEventListener('focus', ask);
    return () => {
      current = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', ask);
    };
  }, []);

  /* Clicking anywhere else closes it, which is what a panel like this must do. */
  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (box.current !== null && !box.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function show() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setItems(null);
    try {
      const found = await fetchNotifications();
      setItems(found);
      /*
       * Opening the panel is what says they have been seen, and the count goes
       * to nothing there and then rather than after the server answers -
       * somebody who has just read them should not watch a number linger.
       */
      if (waiting > 0) {
        setWaiting(0);
        await readNotifications();
      }
    } catch {
      setItems([]);
    }
  }

  return (
    <div className={styles.bell} ref={box}>
      <button
        type="button"
        className={styles.button}
        onClick={() => void show()}
        aria-label={waiting === 0 ? 'Notifications' : `Notifications, ${waiting} waiting`}
        aria-expanded={open}
        title="What has happened that concerns you"
      >
        <img src={bellIcon} alt="" width={16} height={16} />
        {waiting > 0 && <span className={styles.count}>{waiting > 9 ? '9+' : waiting}</span>}
      </button>

      {open && (
        <div className={styles.panel} role="dialog" aria-label="Notifications">
          {items === null && <p className={styles.notice}>Looking…</p>}
          {items !== null && items.length === 0 && (
            <p className={styles.notice}>Nothing yet. Anything on your issues will appear here.</p>
          )}
          {items?.map((item) => (
            <Link
              key={item.id}
              /*
                The unread ones are marked rather than being the only ones
                shown. The panel is what happened; the number on the bell is
                what is new (issue #114).
              */
              className={item.unread ? `${styles.item} ${styles.itemUnread}` : styles.item}
              to={`/workspace/${item.workspaceId}/issues/${item.issueNumber}`}
              onClick={() => setOpen(false)}
            >
              <span className={styles.itemHead}>
                <span className={styles.kind}>{SAYS[item.kind]}</span>
                <span className={styles.when}>{timeAgo(item.at)}</span>
              </span>
              <span className={styles.title}>
                #{item.issueNumber} {item.issueTitle}
              </span>
              <span className={styles.by}>
                {item.actor}
                {/* The words themselves, for the two kinds that have any. */}
                {item.says !== null && (item.kind === 'COMMENT' || item.kind === 'MENTIONED')
                  ? `: ${item.says.slice(0, 90)}`
                  : ''}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
