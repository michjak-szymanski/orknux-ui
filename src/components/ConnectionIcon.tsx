import type { ConnectionType } from '../api/integrations';
import mailIcon from '../assets/mail.svg';
import plugIcon from '../assets/plug.svg';
import slackIcon from '../assets/slack.svg';
import styles from './ConnectionIcon.module.css';

const ICONS: Record<ConnectionType, string> = {
  SLACK: slackIcon,
  SMTP: mailIcon,
  HTTP: plugIcon,
};

export interface ConnectionIconProps {
  type: ConnectionType;
  /** The workspace table shows the glyph on its own, without the boxed surround. */
  bare?: boolean;
}

/** The service glyph for a connection, boxed as the admin table shows it. */
export function ConnectionIcon({ type, bare = false }: ConnectionIconProps) {
  const glyph = <img src={ICONS[type]} alt="" width={14} height={14} />;
  if (bare) return <span className={styles.bare}>{glyph}</span>;

  return (
    <span className={styles.box} aria-hidden="true">
      {glyph}
    </span>
  );
}
