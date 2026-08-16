import { graphql } from './client';
import type { PageOf } from './client';

/** A folder of memories, with what it holds. */
export interface MemoryCatalog {
  id: string;
  workspaceId: string;
  name: string;
  /** What the count badge shows. */
  memoryCount: number;
  createdAt: string;
  createdBy: string;
}

/** One thing the workspace wants remembered. */
export interface Memory {
  id: string;
  catalogId: string;
  title: string;
  content: string;
  createdAt: string;
  /** Who added it. An editor does not become the author. */
  createdBy: string;
  lastModifiedAt: string;
  lastModifiedBy: string;
}

export type MemorySort = 'LAST_MODIFIED' | 'CREATED' | 'TITLE';

const CATALOG_FIELDS = 'id workspaceId name memoryCount createdAt createdBy';
const MEMORY_FIELDS = 'id catalogId title content createdAt createdBy lastModifiedAt lastModifiedBy';

export async function fetchMemoryCatalogs(workspaceId: string): Promise<MemoryCatalog[]> {
  const data = await graphql<{ memoryCatalogs: MemoryCatalog[] }>(
    `query MemoryCatalogs($workspaceId: ID!) { memoryCatalogs(workspaceId: $workspaceId) { ${CATALOG_FIELDS} } }`,
    { workspaceId },
  );
  return data.memoryCatalogs;
}

/** A blank search or author is no filter, which is what an empty box sends. */
/** One memory, by id: what the editor opens. */
export async function fetchMemory(id: string): Promise<Memory | null> {
  const data = await graphql<{ memory: Memory | null }>(
    `query MemoryById($id: ID!) { memory(id: $id) { ${MEMORY_FIELDS} } }`,
    { id },
  );
  return data.memory;
}

export async function fetchMemories(
  catalogId: string,
  options: { search?: string; author?: string; sort?: MemorySort; page?: number; size?: number } = {},
): Promise<PageOf<Memory>> {
  const data = await graphql<{ memories: PageOf<Memory> }>(
    `query Memories($catalogId: ID!, $search: String, $author: String, $sort: MemorySort, $page: Int!, $size: Int!) {
       memories(catalogId: $catalogId, search: $search, author: $author, sort: $sort, page: $page, size: $size) {
         content { ${MEMORY_FIELDS} }
         page size totalElements totalPages
       }
     }`,
    {
      catalogId,
      search: options.search ?? null,
      author: options.author ?? null,
      sort: options.sort ?? 'LAST_MODIFIED',
      page: options.page ?? 0,
      size: options.size ?? 5,
    },
  );
  return data.memories;
}

/** Who has written in this catalog, which is what the filter offers. */
export async function fetchMemoryAuthors(catalogId: string): Promise<string[]> {
  const data = await graphql<{ memoryAuthors: string[] }>(
    `query MemoryAuthors($catalogId: ID!) { memoryAuthors(catalogId: $catalogId) }`,
    { catalogId },
  );
  return data.memoryAuthors;
}

export async function createMemoryCatalog(workspaceId: string, name: string): Promise<MemoryCatalog> {
  const data = await graphql<{ createMemoryCatalog: MemoryCatalog }>(
    `mutation CreateMemoryCatalog($workspaceId: ID!, $name: String!) {
       createMemoryCatalog(workspaceId: $workspaceId, name: $name) { ${CATALOG_FIELDS} }
     }`,
    { workspaceId, name },
  );
  return data.createMemoryCatalog;
}

export async function renameMemoryCatalog(id: string, name: string): Promise<MemoryCatalog> {
  const data = await graphql<{ renameMemoryCatalog: MemoryCatalog }>(
    `mutation RenameMemoryCatalog($id: ID!, $name: String!) {
       renameMemoryCatalog(id: $id, name: $name) { ${CATALOG_FIELDS} }
     }`,
    { id, name },
  );
  return data.renameMemoryCatalog;
}

/** Takes the memories in it. */
export async function deleteMemoryCatalog(id: string): Promise<boolean> {
  const data = await graphql<{ deleteMemoryCatalog: boolean }>(
    `mutation DeleteMemoryCatalog($id: ID!) { deleteMemoryCatalog(id: $id) }`,
    { id },
  );
  return data.deleteMemoryCatalog;
}

export async function createMemory(catalogId: string, title: string, content: string): Promise<Memory> {
  const data = await graphql<{ createMemory: Memory }>(
    `mutation CreateMemory($input: CreateMemoryInput!) { createMemory(input: $input) { ${MEMORY_FIELDS} } }`,
    { input: { catalogId, title, content } },
  );
  return data.createMemory;
}

export async function updateMemory(id: string, title: string, content: string): Promise<Memory> {
  const data = await graphql<{ updateMemory: Memory }>(
    `mutation UpdateMemory($id: ID!, $input: UpdateMemoryInput!) {
       updateMemory(id: $id, input: $input) { ${MEMORY_FIELDS} }
     }`,
    { id, input: { title, content } },
  );
  return data.updateMemory;
}

/** Saves it into a different catalog, which the server records as a move. */
export async function moveMemory(
  id: string,
  title: string,
  content: string,
  catalogId: string,
): Promise<Memory> {
  const data = await graphql<{ updateMemory: Memory }>(
    `mutation MoveMemory($id: ID!, $input: UpdateMemoryInput!) {
       updateMemory(id: $id, input: $input) { ${MEMORY_FIELDS} }
     }`,
    { id, input: { title, content, catalogId } },
  );
  return data.updateMemory;
}

export async function deleteMemory(id: string): Promise<boolean> {
  const data = await graphql<{ deleteMemory: boolean }>(
    `mutation DeleteMemory($id: ID!) { deleteMemory(id: $id) }`,
    { id },
  );
  return data.deleteMemory;
}

/** "Jan 24, 2026", as the cards show a date. */
export function memoryDate(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return at.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}
