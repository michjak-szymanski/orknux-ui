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
}

const FIELDS =
  'attachmentsEnabled attachmentsConfigurable attachmentStorage attachmentLocation attachmentMaxFileSizeMb ' +
  'chatEnabled chatConfigurable';

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
