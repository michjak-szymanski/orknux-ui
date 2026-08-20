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
}

const FIELDS =
  'attachmentsEnabled attachmentsConfigurable attachmentStorage attachmentLocation attachmentMaxFileSizeMb ' +
  'chatEnabled chatConfigurable metricsAnonymous metricsAnonymousConfigured';

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
