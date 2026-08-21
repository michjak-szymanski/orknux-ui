import { graphql } from './client';

/**
 * Which kinds of component have a history, and what gives them one.
 *
 * The rule behind the split, in the owner's words: a component with a draft is
 * versioned by publishing, and one without is versioned by saving. A workflow
 * is the only kind with a draft, so its versions are its publications and it is
 * read through `fetchWorkflowPublications` rather than through the four here.
 */
export type ComponentRevisionKind = 'FUNCTION' | 'TOOL' | 'SKILL' | 'AGENT';

/** One line of a component's history: what it was, and when it stopped being it. */
export interface ComponentRevision {
  id: string;
  kind: ComponentRevisionKind;
  componentId: string;
  /** What it was called then, so a rename reads as one. */
  name: string;
  /** When this state was saved — the component's own stamp, not the row's. */
  savedAt: string;
  savedBy: string;
  /** When it stopped being current, which is what retention counts from. */
  recordedAt: string;
}

/** One revision with what it held. Asked for when a row is opened. */
export interface ComponentRevisionDetail extends ComponentRevision {
  /**
   * The part somebody reads: a function's or a tool's TypeScript, a skill's
   * markdown, an agent's system prompt. Null where this kind has none — an
   * agent may have no prompt at all.
   */
  content: string | null;
  /** `typescript`, `markdown` or `json`. */
  contentLanguage: string;
  /** The whole component as it was, as JSON. */
  snapshot: string;
}

const SUMMARY = 'id kind componentId name savedAt savedBy recordedAt';

export async function fetchComponentRevisions(
  kind: ComponentRevisionKind,
  componentId: string,
  limit?: number,
): Promise<ComponentRevision[]> {
  const data = await graphql<{ componentRevisions: ComponentRevision[] }>(
    `query ComponentRevisions($kind: ComponentRevisionKind!, $componentId: ID!, $limit: Int) {
       componentRevisions(kind: $kind, componentId: $componentId, limit: $limit) { ${SUMMARY} }
     }`,
    { kind, componentId, limit },
  );
  return data.componentRevisions;
}

/**
 * One revision, code and all.
 *
 * Fetched when a row is opened rather than with the list: a tool edited fifty
 * times in an afternoon is fifty copies of its source, and a list is read for
 * its dates.
 */
export async function fetchComponentRevision(id: string): Promise<ComponentRevisionDetail> {
  const data = await graphql<{ componentRevision: ComponentRevisionDetail }>(
    `query ComponentRevision($id: ID!) {
       componentRevision(id: $id) { ${SUMMARY} content contentLanguage snapshot }
     }`,
    { id },
  );
  return data.componentRevision;
}

/**
 * Makes an older state current again.
 *
 * What it displaces is recorded first, so this is undoable by the same button.
 * Answers whether it was done; the caller refetches the component for the rest.
 */
export async function restoreComponentRevision(id: string): Promise<boolean> {
  const data = await graphql<{ restoreComponentRevision: boolean }>(
    `mutation RestoreComponentRevision($id: ID!) { restoreComponentRevision(id: $id) }`,
    { id },
  );
  return data.restoreComponentRevision;
}

/** One publication of a workflow: a version of it, and possibly the live one. */
export interface WorkflowPublication {
  id: string;
  workflowId: string;
  publishedAt: string;
  publishedBy: string;
  /** The one the runner reads. Exactly one publication of each workflow is. */
  current: boolean;
  /** The publication this one copied, when it was made by restoring one. */
  restoredFrom: string | null;
}

export async function fetchWorkflowPublications(
  workspaceId: string,
  workflowId: string,
  limit?: number,
): Promise<WorkflowPublication[]> {
  const data = await graphql<{ workflowPublications: WorkflowPublication[] }>(
    `query WorkflowPublications($workspaceId: ID!, $workflowId: ID!, $limit: Int) {
       workflowPublications(workspaceId: $workspaceId, workflowId: $workflowId, limit: $limit) {
         id workflowId publishedAt publishedBy current restoredFrom
       }
     }`,
    { workspaceId, workflowId, limit },
  );
  return data.workflowPublications;
}

/**
 * Puts an older publication back into service, by publishing it again.
 *
 * The draft is untouched: it is not versioned, so overwriting it would destroy
 * unpublished work with nothing to get it back from. What changes is what runs.
 */
export async function restoreWorkflowPublication(
  workspaceId: string,
  publicationId: string,
): Promise<string> {
  const data = await graphql<{ restoreWorkflowPublication: { status: string } }>(
    `mutation RestoreWorkflowPublication($workspaceId: ID!, $publicationId: ID!) {
       restoreWorkflowPublication(workspaceId: $workspaceId, publicationId: $publicationId) { status }
     }`,
    { workspaceId, publicationId },
  );
  return data.restoreWorkflowPublication.status;
}
