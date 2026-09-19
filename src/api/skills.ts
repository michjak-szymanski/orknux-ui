import { graphql } from './client';
import type { PageOf } from './client';
import type { SourceValidation } from './tools';

/** A reusable instruction set that guides how an agent goes about something. */
/** A folder of skills, and the unit an agent is granted. */
export interface SkillCatalog {
  id: string;
  workspaceId: string;
  name: string;
  skillCount: number;
  createdAt: string;
  createdBy: string;
}

export interface Skill {
  id: string;
  workspaceId: string;
  /** The catalog it lives in; every skill is in one. */
  catalogId: string;
  name: string;
  description: string | null;
  /** Markdown, opening with a frontmatter block naming and describing it. */
  content: string;
  enabled: boolean;
  lastModifiedAt: string;
  lastModifiedBy: string;
}

const SKILL_FIELDS =
  'id workspaceId catalogId name description content enabled lastModifiedAt lastModifiedBy';

const CATALOG_FIELDS = 'id workspaceId name skillCount createdAt createdBy';

/** The whole workspace, or one catalog when `catalogId` names one. */
export async function fetchWorkspaceSkills(
  workspaceId: string,
  page = 0,
  size = 20,
  catalogId?: string,
): Promise<PageOf<Skill>> {
  const data = await graphql<{ workspaceSkills: PageOf<Skill> }>(
    `query WorkspaceSkills($workspaceId: ID!, $catalogId: ID, $page: Int!, $size: Int!) {
       workspaceSkills(workspaceId: $workspaceId, catalogId: $catalogId, page: $page, size: $size) {
         content { ${SKILL_FIELDS} }
         page size totalElements totalPages
       }
     }`,
    { workspaceId, catalogId: catalogId ?? null, page, size },
  );
  return data.workspaceSkills;
}

export async function fetchSkillCatalogs(workspaceId: string): Promise<SkillCatalog[]> {
  const data = await graphql<{ skillCatalogs: SkillCatalog[] }>(
    `query SkillCatalogs($workspaceId: ID!) { skillCatalogs(workspaceId: $workspaceId) { ${CATALOG_FIELDS} } }`,
    { workspaceId },
  );
  return data.skillCatalogs;
}

/**
 * A folder of skills a plugin brought, offered under the plugin's key.
 *
 * Not a `SkillCatalog`: there is no row behind it, so nothing here can be
 * renamed, deleted or added to. What it shares with the workspace's own is the
 * only part an agent needs — a name to grant.
 */
export interface PluginSkillCatalog {
  /** `jira_plugin` — the plugin's key, suffixed. What goes on a grant list. */
  name: string;
  /** The plugin's key on its own, for a screen saying where this came from. */
  key: string;
  /** What the plugin is called on screen. */
  plugin: string;
  skills: PluginSkill[];
}

/** One instruction set a plugin brings: markdown an agent reads, never code it runs. */
export interface PluginSkill {
  name: string;
  description: string | null;
  content: string;
}

/** Installation-wide, like the plugins themselves, so no workspace is asked for. */
export async function fetchPluginSkillCatalogs(): Promise<PluginSkillCatalog[]> {
  const data = await graphql<{ pluginSkillCatalogs: PluginSkillCatalog[] }>(
    `query PluginSkillCatalogs {
       pluginSkillCatalogs { name key plugin skills { name description content } }
     }`,
  );
  return data.pluginSkillCatalogs;
}

export async function createSkillCatalog(workspaceId: string, name: string): Promise<SkillCatalog> {
  const data = await graphql<{ createSkillCatalog: SkillCatalog }>(
    `mutation CreateSkillCatalog($workspaceId: ID!, $name: String!) {
       createSkillCatalog(workspaceId: $workspaceId, name: $name) { ${CATALOG_FIELDS} }
     }`,
    { workspaceId, name },
  );
  return data.createSkillCatalog;
}

export async function renameSkillCatalog(id: string, name: string): Promise<SkillCatalog> {
  const data = await graphql<{ renameSkillCatalog: SkillCatalog }>(
    `mutation RenameSkillCatalog($id: ID!, $name: String!) {
       renameSkillCatalog(id: $id, name: $name) { ${CATALOG_FIELDS} }
     }`,
    { id, name },
  );
  return data.renameSkillCatalog;
}

/** Takes the skills in it, the way a memory catalog does. */
export async function deleteSkillCatalog(id: string): Promise<boolean> {
  const data = await graphql<{ deleteSkillCatalog: boolean }>(
    `mutation DeleteSkillCatalog($id: ID!) { deleteSkillCatalog(id: $id) }`,
    { id },
  );
  return data.deleteSkillCatalog;
}

export async function fetchSkill(id: string): Promise<Skill | null> {
  const data = await graphql<{ skill: Skill | null }>(
    `query Skill($id: ID!) { skill(id: $id) { ${SKILL_FIELDS} } }`,
    { id },
  );
  return data.skill;
}

export interface CreateSkillInput {
  name: string;
  description?: string;
  /** Left out for a new skill, which starts from the shape with its parts named. */
  content?: string;
  /** Which folder it goes in; the workspace's first when nobody says. */
  catalogId?: string;
}

export async function createSkill(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
  const data = await graphql<{ createSkill: Skill }>(
    `mutation CreateSkill($input: CreateSkillInput!) { createSkill(input: $input) { ${SKILL_FIELDS} } }`,
    { input: { workspaceId, ...input } },
  );
  return data.createSkill;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  content?: string;
  /** Moves it to another folder; left out it stays where it is. */
  catalogId?: string;
}

export async function updateSkill(id: string, input: UpdateSkillInput): Promise<Skill> {
  const data = await graphql<{ updateSkill: Skill }>(
    `mutation UpdateSkill($id: ID!, $input: UpdateSkillInput!) {
       updateSkill(id: $id, input: $input) { ${SKILL_FIELDS} }
     }`,
    { id, input },
  );
  return data.updateSkill;
}

export async function setSkillEnabled(id: string, enabled: boolean): Promise<Skill> {
  const data = await graphql<{ setSkillEnabled: Skill }>(
    `mutation SetSkillEnabled($id: ID!, $enabled: Boolean!) {
       setSkillEnabled(id: $id, enabled: $enabled) { ${SKILL_FIELDS} }
     }`,
    { id, enabled },
  );
  return data.setSkillEnabled;
}

export async function validateSkillContent(workspaceId: string, content: string): Promise<SourceValidation> {
  const data = await graphql<{ validateSkillContent: SourceValidation }>(
    `mutation ValidateSkillContent($workspaceId: ID!, $content: String!) {
       validateSkillContent(workspaceId: $workspaceId, content: $content) { valid message line column }
     }`,
    { workspaceId, content },
  );
  return data.validateSkillContent;
}

export async function deleteSkill(id: string): Promise<boolean> {
  const data = await graphql<{ deleteSkill: boolean }>(
    'mutation DeleteSkill($id: ID!) { deleteSkill(id: $id) }',
    { id },
  );
  return data.deleteSkill;
}
