import { graphql } from './client';
import { t } from '../i18n';

/**
 * A machine this installation can run commands on, over SSH.
 *
 * There is no private key on this and no way to ask for one. `privateKeySet` is
 * everything the server will say about a stored key, which is all the form needs
 * in order to tell somebody it is about to replace one.
 */
export interface Shell {
  id: string;
  name: string;
  host: string;
  port: number;
  /**
   * The account on the far side, or null when none was given. Optional in the
   * way it is optional at `ssh build.internal`.
   */
  username: string | null;
  /**
   * The account commands actually run as: `username` when there is one, and the
   * account the server itself runs as when there is not. From the server
   * because nothing here can know what account that process runs as.
   */
  account: string;
  privateKeySet: boolean;
  passphraseSet: boolean;
  /**
   * The host key this shell was first seen with, as a `SHA256:` fingerprint, or
   * null until the first connection succeeds. Trust on first use: what answered
   * the first time is what has to answer from now on.
   */
  hostKey: string | null;
  enabled: boolean;
  status: ShellStatus;
  lastCheckMessage: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
  lastModifiedAt: string;
}

export type ShellStatus = 'NOT_CONFIGURED' | 'NOT_CHECKED' | 'CONNECTED' | 'FAILED';

export interface ShellInput {
  name: string;
  host: string;
  port: number;
  /** Empty or absent means the account the server itself runs as. */
  username?: string | null;
  /** Left out entirely to keep the stored key; empty to clear it. */
  privateKey?: string | null;
  keyPassphrase?: string | null;
  enabled?: boolean;
  /** Ticked after a machine is rebuilt; the only way past a key mismatch. */
  forgetHostKey?: boolean;
}

/** What to call each state on the row, in words rather than in an enum. */
export function shellStatusLabel(status: ShellStatus): string {
  switch (status) {
    case 'CONNECTED':
      return 'Connected';
    case 'FAILED':
      return 'Unreachable';
    case 'NOT_CHECKED':
      return t('Not checked');
    case 'NOT_CONFIGURED':
      return t('No key');
  }
}

const SHELL_FIELDS =
  'id name host port username account privateKeySet passphraseSet hostKey enabled status ' +
  'lastCheckMessage lastCheckedAt createdAt lastModifiedAt';

const SHELLS_QUERY = `
  query Shells {
    shells { ${SHELL_FIELDS} }
  }
`;

const SHELL_QUERY = `
  query Shell($id: ID!) {
    shell(id: $id) { ${SHELL_FIELDS} }
  }
`;

const CREATE_SHELL_MUTATION = `
  mutation CreateShell($input: ShellInput!) {
    createShell(input: $input) { ${SHELL_FIELDS} }
  }
`;

const UPDATE_SHELL_MUTATION = `
  mutation UpdateShell($id: ID!, $input: ShellInput!) {
    updateShell(id: $id, input: $input) { ${SHELL_FIELDS} }
  }
`;

const SET_SHELL_ENABLED_MUTATION = `
  mutation SetShellEnabled($id: ID!, $enabled: Boolean!) {
    setShellEnabled(id: $id, enabled: $enabled) { ${SHELL_FIELDS} }
  }
`;

const CHECK_SHELL_MUTATION = `
  mutation CheckShell($id: ID!) {
    checkShell(id: $id) { ${SHELL_FIELDS} }
  }
`;

const DELETE_SHELL_MUTATION = `
  mutation DeleteShell($id: ID!) { deleteShell(id: $id) }
`;

export async function fetchShells(): Promise<Shell[]> {
  const data = await graphql<{ shells: Shell[] }>(SHELLS_QUERY);
  return data.shells;
}

/**
 * One shell, by id, or null when there is no such shell.
 *
 * Null rather than an error on purpose: the page that opens on an id somebody
 * typed or bookmarked has to be able to say the shell is gone, and a thrown
 * error would send it down the path meant for a server that failed.
 */
export async function fetchShell(id: string): Promise<Shell | null> {
  const data = await graphql<{ shell: Shell | null }>(SHELL_QUERY, { id });
  return data.shell;
}

export async function createShell(input: ShellInput): Promise<Shell> {
  const data = await graphql<{ createShell: Shell }>(CREATE_SHELL_MUTATION, { input });
  return data.createShell;
}

export async function updateShell(id: string, input: ShellInput): Promise<Shell> {
  const data = await graphql<{ updateShell: Shell }>(UPDATE_SHELL_MUTATION, { id, input });
  return data.updateShell;
}

export async function setShellEnabled(id: string, enabled: boolean): Promise<Shell> {
  const data = await graphql<{ setShellEnabled: Shell }>(SET_SHELL_ENABLED_MUTATION, { id, enabled });
  return data.setShellEnabled;
}

/**
 * Asks a machine now rather than waiting for the sweep.
 *
 * The check is a real connection - the handshake, the key accepted, and a
 * command actually run - so a host that answers on port 22 and refuses every
 * account comes back as a failure rather than as a green dot.
 */
export async function checkShell(id: string): Promise<Shell> {
  const data = await graphql<{ checkShell: Shell }>(CHECK_SHELL_MUTATION, { id });
  return data.checkShell;
}

export async function deleteShell(id: string): Promise<boolean> {
  const data = await graphql<{ deleteShell: boolean }>(DELETE_SHELL_MUTATION, { id });
  return data.deleteShell;
}
