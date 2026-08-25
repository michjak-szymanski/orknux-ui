import { graphql } from './client';
import { t } from '../i18n';

/**
 * Files attached to a chat.
 *
 * REST, because what crosses is bytes: a multipart form is what a browser makes
 * of a file picker, and JSON would mean base64 in both directions.
 *
 * Where they are kept is the installation's business — a directory per
 * workspace, on whatever storage was configured — so nothing here says anything
 * about it beyond which workspace is asking.
 */
export interface Attachment {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

export async function uploadAttachments(workspaceId: string, files: File[]): Promise<Attachment[]> {
  const form = new FormData();
  files.forEach((file) => form.append('files', file, file.name));

  const answer = await fetch(`/api/workspaces/${workspaceId}/attachments`, {
    method: 'POST',
    body: form,
    credentials: 'include',
  });

  const said = (await answer.json().catch(() => null)) as
    | { attachments?: Attachment[]; error?: string; message?: string }
    | null;
  if (!answer.ok) {
    throw new Error(said?.error ?? said?.message ?? t('Those files could not be uploaded.'));
  }
  return said?.attachments ?? [];
}

/**
 * Says which chat these belong to.
 *
 * Sent once the message is, because a first message is what makes the chat: the
 * files went up while the sentence was being typed and had nowhere to belong
 * until then.
 */
export async function attachToChat(chatId: string, attachmentIds: string[]): Promise<void> {
  await graphql<{ attachToChat: unknown }>(
    `mutation AttachToChat($chatId: ID!, $attachmentIds: [ID!]!) {
       attachToChat(chatId: $chatId, attachmentIds: $attachmentIds) { id }
     }`,
    { chatId, attachmentIds },
  );
}

/** What was attached to one chat, oldest first. */
export async function fetchChatAttachments(chatId: string): Promise<Attachment[]> {
  const data = await graphql<{ chatAttachments: Attachment[] }>(
    `query ChatAttachments($chatId: ID!) {
       chatAttachments(chatId: $chatId) { id filename contentType sizeBytes }
     }`,
    { chatId },
  );
  return data.chatAttachments;
}

/** Where the browser downloads one from; checked against the workspace on the way. */
export function attachmentUrl(id: string): string {
  return `/api/attachments/${id}`;
}

/**
 * Whether the chat may show it rather than only offer it.
 *
 * The same list the server serves inline — raster pictures, and not SVG, which
 * is a document that can carry script.
 */
export function isShowable(contentType: string): boolean {
  return ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp'].includes(
    contentType.toLowerCase(),
  );
}

/** "2.4 MB", for a chip that has to fit beside a filename. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
