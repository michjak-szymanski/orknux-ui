import { graphql } from './client';

/**
 * What this installation allows, as the configuration file and the screen agree
 * it.
 *
 * The file is the floor: what it forbids cannot be switched back on here, which
 * is why `attachmentsConfigurable` exists — an operator who turned attachments
 * off owns the disk, and a browser does not get to overrule that.
 */
export interface InstallationSettings {
  attachmentsEnabled: boolean;
  attachmentsConfigurable: boolean;
  /** Where the bytes go; FILESYSTEM is the only one today. */
  attachmentStorage: string;
  /** The directory they are written under, shown so it can be checked. */
  attachmentLocation: string;
  attachmentMaxFileSizeMb: number;
  /** Whether this installation has a chat at all. */
  chatEnabled: boolean;
  chatConfigurable: boolean;
  /** Whether `/actuator/prometheus` answers a caller who has not signed in. */
  metricsAnonymous: boolean;
  /**
   * What a fresh installation would have answered: ORKNUX_METRICS_ANONYMOUS.
   *
   * Not a `configurable` flag like the two above it — nothing here is forbidden
   * by the file. It is the environment's answer, kept beside the stored one so
   * the page can say which of the two is actually in force when they differ.
   */
  metricsAnonymousConfigured: boolean;
  /**
   * How many days of component history are kept.
   *
   * A version of a function, tool, skill or agent is a whole copy of what it
   * was before a save — the code, the parameters, the prompt — so this is the
   * number that decides how much disk the history takes. Fourteen days unless
   * an administrator has said otherwise.
   */
  revisionRetentionDays: number;
  /** What a fresh installation would keep: ORKNUX_REVISION_RETENTION_DAYS. */
  revisionRetentionDaysConfigured: number;
  /**
   * How many minutes a task may sit queued before something hands it over
   * again.
   *
   * The net under the hand-over. A task whose start was lost — to a process
   * killed at the wrong moment, or a workflow that could not run — would
   * otherwise say Queued for ever. Five minutes unless somebody has said
   * otherwise.
   */
  taskSweepMinutes: number;
  /** What a fresh installation would wait: ORKNUX_TASK_SWEEP_MINUTES. */
  taskSweepMinutesConfigured: number;
  /**
   * False where the installation runs Temporal, and the field is not offered.
   *
   * A `configurable` flag like `chatConfigurable`, and the fact behind it is
   * which engine carries tasks. The sweep runs either way; what is not an
   * administrator's decision on Temporal is how long it waits.
   */
  taskSweepConfigurable: boolean;
}

const FIELDS =
  'attachmentsEnabled attachmentsConfigurable attachmentStorage attachmentLocation attachmentMaxFileSizeMb ' +
  'chatEnabled chatConfigurable metricsAnonymous metricsAnonymousConfigured ' +
  'revisionRetentionDays revisionRetentionDaysConfigured ' +
  'taskSweepMinutes taskSweepMinutesConfigured taskSweepConfigurable';

export async function fetchInstallationSettings(): Promise<InstallationSettings> {
  const data = await graphql<{ installationSettings: InstallationSettings }>(
    `query InstallationSettings { installationSettings { ${FIELDS} } }`,
  );
  return data.installationSettings;
}

export async function setChatEnabled(enabled: boolean): Promise<InstallationSettings> {
  const data = await graphql<{ setChatEnabled: InstallationSettings }>(
    `mutation SetChatEnabled($enabled: Boolean!) {
       setChatEnabled(enabled: $enabled) { ${FIELDS} }
     }`,
    { enabled },
  );
  return data.setChatEnabled;
}

export async function setAttachmentsEnabled(enabled: boolean): Promise<InstallationSettings> {
  const data = await graphql<{ setAttachmentsEnabled: InstallationSettings }>(
    `mutation SetAttachmentsEnabled($enabled: Boolean!) {
       setAttachmentsEnabled(enabled: $enabled) { ${FIELDS} }
     }`,
    { enabled },
  );
  return data.setAttachmentsEnabled;
}

/**
 * Opens the metrics endpoint to callers who have not signed in, or closes it
 * again. Administrators only, and recorded in the audit log; it takes effect on
 * the next scrape rather than the next restart.
 */
export async function setMetricsAnonymous(enabled: boolean): Promise<InstallationSettings> {
  const data = await graphql<{ setMetricsAnonymous: InstallationSettings }>(
    `mutation SetMetricsAnonymous($enabled: Boolean!) {
       setMetricsAnonymous(enabled: $enabled) { ${FIELDS} }
     }`,
    { enabled },
  );
  return data.setMetricsAnonymous;
}

/**
 * How long a component's history is kept before the sweep takes it.
 *
 * Between 1 and 3650 days; anything else is refused with a message saying so.
 * Administrators only, and recorded in the audit log. The sweep reads it on
 * every pass, so it takes effect without a restart.
 */
export async function setRevisionRetentionDays(days: number): Promise<InstallationSettings> {
  const data = await graphql<{ setRevisionRetentionDays: InstallationSettings }>(
    `mutation SetRevisionRetentionDays($days: Int!) {
       setRevisionRetentionDays(days: $days) { ${FIELDS} }
     }`,
    { days },
  );
  return data.setRevisionRetentionDays;
}

/**
 * How long a task may sit queued before something hands it over again.
 *
 * Between 1 and 1440 minutes; anything else is refused with a message saying
 * so. Administrators only, and recorded in the audit log. The sweep reads it
 * on every pass, so it takes effect without a restart — and it is refused
 * outright on an installation running Temporal, which is why the field is
 * drawn only when `taskSweepConfigurable` is true.
 */
export async function setTaskSweepMinutes(minutes: number): Promise<InstallationSettings> {
  const data = await graphql<{ setTaskSweepMinutes: InstallationSettings }>(
    `mutation SetTaskSweepMinutes($minutes: Int!) {
       setTaskSweepMinutes(minutes: $minutes) { ${FIELDS} }
     }`,
    { minutes },
  );
  return data.setTaskSweepMinutes;
}
