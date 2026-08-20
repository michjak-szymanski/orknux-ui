/**
 * Builds the workspace the manual is photographed in.
 *
 * The screenshots used to come from whatever happened to be in the developer's
 * database, which is how a manual ends up showing a workflow called `dgd` and a
 * model called `whiper`. That is not a screenshot problem — no capture script
 * can photograph content that is not there — so the content is made here, and
 * the capture points at it.
 *
 * It builds a *second* workspace and never touches the first: the database this
 * runs against is somebody's working data, and a documentation script has no
 * business editing it.
 *
 *   docker exec orknux-ui-dev-1 node scripts/seed-demo.mjs
 *
 * Idempotent by demolition: a workspace of this name is deleted and rebuilt, so
 * a second run leaves one clean copy rather than two half-populated ones.
 *
 * The demonstration is a company of its own - Northwind - and not the company
 * whose name a development installation is likely to have grown by accident.
 * The first version of this seed was called "Acme Support", somebody started
 * keeping real work in the workspace it built, and from then on the manual was
 * photographing a live tracker: real issue titles, real conversations, real
 * notifications. Two names cannot be argued with at a distance, so the demo
 * takes a name nothing else here would reach for, and the two workflows it
 * builds are named for what they do rather than for what the old ones were
 * called - workflow names are unique across the whole installation, not per
 * workspace, so reusing them would collide with whatever holds them now.
 */
const BASE = process.env.ORKNUX_UI_URL ?? 'http://localhost:5173';
const USER = process.env.ORKNUX_USER ?? 'alice';
const PASSWORD = process.env.ORKNUX_PASSWORD ?? 'password';

/**
 * The name the capture looks for. The same variable is read there, so pointing
 * one at another workspace points both.
 */
export const WORKSPACE_NAME = process.env.ORKNUX_DEMO_WORKSPACE ?? 'Northwind Support';

/*
 * Where the demo's model comes from.
 *
 * The default is Ollama's own address on the machine running this, because a
 * checked-in default that names somebody's LAN is that person's network in
 * everybody's documentation. Point it at whatever actually answers:
 *
 *   ORKNUX_DEMO_ENDPOINT=http://10.0.0.5:8081 node scripts/seed-demo.mjs
 *
 * A demo whose model is dead photographs a red light and an agent that cannot
 * run, so it is worth pointing at something real before capturing. Give it the
 * root the server speaks to, not a path: the probe asks `<endpoint>/models` and
 * a chat goes to `<endpoint>/chat/completions`, and llama.cpp answers both at
 * its root as well as under `/v1`.
 *
 * The model id is the name asked for, not the name the provider gives back. A
 * llama.cpp server lists whatever file it loaded — an absolute path, on the
 * machine it runs on — and it will run whatever id is asked for, since it holds
 * exactly one model. So the id here is the readable one, and copying the id out
 * of the listing would put somebody's home directory in the manual's picture of
 * the models page.
 */
const OLLAMA_ENDPOINT = process.env.ORKNUX_DEMO_ENDPOINT ?? 'http://localhost:11434';
const OLLAMA_MODEL_ID = process.env.ORKNUX_DEMO_MODEL ?? 'gemma-4-31B-it-Q5_K_M';

/**
 * The role that opens the demonstration workspace, and the colleague who holds
 * it. Both exist so that something can happen to somebody: see the comment
 * where they are made.
 */
const DESK_ROLE = 'Support desk';
const COLLEAGUE = {
  username: 'dana',
  displayName: 'Dana Whitfield',
  email: 'dana@northwind.example',
  // Invented, and of use only on a demonstration workspace on this machine.
  password: process.env.ORKNUX_DEMO_COLLEAGUE_PASSWORD ?? 'demo-password',
};

let cookie = '';

async function signIn(username, password) {
  const response = await fetch(`${BASE}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) {
    throw new Error(`Could not sign in as ${username}: ${response.status} ${await response.text()}`);
  }
  // One cookie, and only its name=value: the attributes are the browser's business.
  const raw = response.headers.get('set-cookie');
  if (!raw) throw new Error('Signed in, but no session cookie came back');
  return raw.split(';')[0];
}

/**
 * One GraphQL call.
 *
 * Errors are thrown rather than collected: a seed that half worked is worse
 * than one that stopped, because the missing half stays invisible until it
 * turns up in a screenshot.
 */
async function gql(query, variables = {}, as = null) {
  const response = await fetch(`${BASE}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: as ?? cookie },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json();
  if (body.errors?.length) {
    throw new Error(`${body.errors[0].message}\n  in: ${query.trim().split('\n')[0]}`);
  }
  return body.data;
}

const log = (message) => console.log(message);

cookie = await signIn(USER, PASSWORD);

/* ---------------------------------------------------------------- workspace */

const { workspaces } = await gql('{ workspaces(size: 100) { content { id name } } }');
const previous = workspaces.content.find((w) => w.name === WORKSPACE_NAME);
if (previous) {
  /*
   * Refused unless somebody says so out loud.
   *
   * What follows deletes the whole workspace, and the workspace this seed wants
   * is one anybody might already be using for real: it is named after a plain
   * English idea, so a development installation grows one by accident and then
   * fills it with work. This script was one command away from taking a tracker
   * with seventy-five issues in it, which is not a risk worth carrying to save
   * one environment variable.
   *
   * The check is on the count rather than on the name, because the name is the
   * thing that collided in the first place.
   */
  const { workspaceIssues } = await gql(
    `{ workspaceIssues(workspaceId: "${previous.id}", size: 1) { totalElements } }`,
  );
  if (workspaceIssues.totalElements > 0 && process.env.ORKNUX_SEED_REPLACE !== '1') {
    log(
      `${WORKSPACE_NAME} already exists as workspace ${previous.id} and holds ` +
        `${workspaceIssues.totalElements} issues. Seeding would delete it and everything in it.
` +
        'Set ORKNUX_SEED_REPLACE=1 if that is what you want, or rename the workspace you are keeping.',
    );
    process.exit(1);
  }
  /*
   * The workflows go first, and not for tidiness: deleting a workspace cascades
   * to its agents, while `workflow_node.agent_id` still points at one, so a
   * workspace holding a graph with an agent node in it cannot be deleted at all
   * — the database refuses and the API answers INTERNAL_ERROR. Removing the
   * workflows takes the nodes with them, which unblocks the workspace.
   */
  const { workspaceWorkflows } = await gql(
    `{ workspaceWorkflows(workspaceId: "${previous.id}", size: 100) { content { id name } } }`,
  );
  for (const workflow of workspaceWorkflows.content) {
    // Emptying the graph is what actually releases the agents: `removeWorkflow`
    // only unassigns the workflow from the workspace — `workspace_workflow` is a
    // join table — so the nodes, and their references, would survive it.
    await gql(
      `mutation($ws: ID!, $id: ID!, $input: WorkflowGraphInput!) {
         saveWorkflowGraph(workspaceId: $ws, workflowId: $id, input: $input) { workflowId }
       }`,
      { ws: previous.id, id: workflow.id, input: { nodes: [], edges: [] } },
    );
    /*
     * Renamed before it is unassigned, because unassigning is all that is on
     * offer: the definition itself survives, workflow names are unique across
     * the installation, and the next run would collide with the leftovers of
     * this one. Retiring the name keeps it free.
     */
    await gql('mutation($id: ID!, $input: UpdateWorkflowInput!) { updateWorkflow(id: $id, input: $input) { id } }', {
      id: workflow.id,
      input: { name: `${workflow.name} (retired ${workflow.id})` },
    });
    await gql('mutation($id: ID!) { removeWorkflow(id: $id) }', { id: workflow.id });
  }
  await gql('mutation($id: ID!) { deleteWorkspace(id: $id) }', { id: previous.id });
  log(`removed the previous ${WORKSPACE_NAME} (id ${previous.id}, ${workspaceWorkflows.content.length} workflows)`);
}

/*
 * Held in a constant rather than written inline, because it is needed twice.
 *
 * The role is assigned by updating the workspace, and that update takes the
 * whole workspace: name, description and roles together. It used to send back
 * `workspace.description` from the creation above, which never selected the
 * field - so it sent `undefined`, the description was cleared a second after it
 * was set, and the manual's picture of the Workspaces list showed every
 * workspace with a description except the demonstration one.
 */
const WORKSPACE_DESCRIPTION =
  'Where Slack questions land: what the desk answers, and what it wakes somebody for.';

const { createWorkspace: workspace } = await gql(
  'mutation($input: CreateWorkspaceInput!) { createWorkspace(input: $input) { id name } }',
  { input: { name: WORKSPACE_NAME, description: WORKSPACE_DESCRIPTION } },
);
const ws = workspace.id;
log(`workspace ${ws}: ${workspace.name}`);

/* ------------------------------------------------------- who else works here */

/*
 * A second person, and a role that opens this workspace and nothing else.
 *
 * The tracker never tells anybody about their own doing, so a workspace where
 * one account files, comments, assigns and closes has an empty bell - and the
 * manual has a section about the bell. Somebody else has to act.
 *
 * The role is the point of it rather than a formality. A demonstration account
 * that could see every workspace on the machine is an account one typo away
 * from writing in somebody's live tracker; one whose only role opens this
 * workspace cannot reach anything else even if this script is wrong.
 */
const { roles: definedRoles } = await gql('{ roles { id name } }');
let deskRole = definedRoles.find((role) => role.name === DESK_ROLE);
if (!deskRole) {
  const { createRole } = await gql('mutation($input: RoleInput!) { createRole(input: $input) { id name } }', {
    input: { name: DESK_ROLE, description: 'Opens the demonstration support desk, and nothing else.' },
  });
  deskRole = createRole;
}
await gql('mutation($id: ID!, $input: UpdateWorkspaceInput!) { updateWorkspace(id: $id, input: $input) { id } }', {
  id: ws,
  input: { name: WORKSPACE_NAME, description: WORKSPACE_DESCRIPTION, roleIds: [deskRole.id] },
});

const { users: knownUsers } = await gql('{ users { id username type } }');
let colleague = knownUsers.find((user) => user.username === COLLEAGUE.username);
if (!colleague) {
  const { createUser } = await gql('mutation($input: UserInput!) { createUser(input: $input) { id username } }', {
    input: { username: COLLEAGUE.username, displayName: COLLEAGUE.displayName, roleIds: [deskRole.id] },
  });
  colleague = createUser;
} else {
  await gql('mutation($id: ID!, $input: UserInput!) { updateUser(id: $id, input: $input) { id } }', {
    id: colleague.id,
    input: { displayName: COLLEAGUE.displayName, roleIds: [deskRole.id] },
  });
}
await gql('mutation($id: ID!, $password: String!) { setUserPassword(id: $id, password: $password) { id } }', {
  id: colleague.id,
  password: COLLEAGUE.password,
});
await gql('mutation($id: ID, $email: String) { setUserEmail(id: $id, email: $email) { id } }', {
  id: colleague.id,
  email: COLLEAGUE.email,
});
log(`${COLLEAGUE.displayName} works here too, by the ${deskRole.name} role`);

/* -------------------------------------------------------------- the model */

const { createModelProvider: provider } = await gql(
  'mutation($input: CreateModelProviderInput!) { createModelProvider(input: $input) { id name status } }',
  {
    input: {
      workspaceId: ws,
      name: 'Ollama (on the LAN)',
      endpoint: OLLAMA_ENDPOINT,
      type: 'OLLAMA',
      // Ollama itself ignores this; the provider will not be called without one.
      secret: process.env.ORKNUX_DEMO_SECRET ?? 'ollama',
    },
  },
);

const { createModel: chatModel } = await gql(
  'mutation($input: CreateModelInput!) { createModel(input: $input) { id name } }',
  {
    input: {
      providerId: provider.id,
      name: 'Gemma 31B',
      modelId: OLLAMA_MODEL_ID,
      kind: 'CHAT',
      contextWindow: 131072,
      maxOutput: 4096,
      requestsPerMinute: 60,
      tokenLimit: 2000000,
      resetInterval: 'MONTHLY',
      inputCostPerMillion: 0,
      outputCostPerMillion: 0,
    },
  },
);
let providerStatus = provider.status;
try {
  const { testModelProvider } = await gql(
    'mutation($id: ID!) { testModelProvider(id: $id) { status lastCheckMessage } }',
    { id: provider.id },
  );
  providerStatus = testModelProvider.status;
} catch (failure) {
  console.warn(`  provider check: ${failure.message.split('\n')[0]}`);
}
log(`model ${chatModel.name} via ${provider.name} (${providerStatus})`);

/* --------------------------------------------------------- the connection */

const { createWorkspaceConnection: slack } = await gql(
  'mutation($input: CreateWorkspaceConnectionInput!) { createWorkspaceConnection(input: $input) { id name status } }',
  {
    input: {
      workspaceId: ws,
      name: 'Slack',
      type: 'SLACK_SOCKET_MODE',
      url: 'https://slack.com/api',
    },
  },
);
log(`connection ${slack.name}`);

/* --------------------------------------------------------------- variables */

const { createVariableCatalog: escalation } = await gql(
  'mutation($ws: ID!, $name: String!) { createVariableCatalog(workspaceId: $ws, name: $name) { id name } }',
  { ws, name: 'Escalation' },
);
const { createVariableCatalog: desk } = await gql(
  'mutation($ws: ID!, $name: String!) { createVariableCatalog(workspaceId: $ws, name: $name) { id name } }',
  { ws, name: 'Support desk' },
);

const VARIABLES = [
  [escalation.id, 'PAGERDUTY_ROUTING_KEY', 'Routing key the on-call page is sent with', 'STRING', 'SECRET', 'R02R2VNQ8XK4TZ1J0PLM'],
  [escalation.id, 'ONCALL_ROTA', 'Which rota answers out of hours', 'STRING', 'VALUE', 'platform-primary'],
  [escalation.id, 'SLA_MINUTES', 'Minutes before a P1 breaches its response target', 'NUMBER', 'VALUE', '30'],
  [desk.id, 'ESCALATION_CHANNEL', 'Where escalations are announced', 'STRING', 'VALUE', '#support-escalations'],
  [desk.id, 'JIRA_PROJECT', 'Project new support issues are raised in', 'STRING', 'VALUE', 'SUP'],
  [desk.id, 'ANSWER_OUT_OF_HOURS', 'Whether the desk answers outside working hours', 'BOOLEAN', 'VALUE', 'true'],
  [desk.id, 'ZENDESK_TOKEN', 'Reads the ticket a message refers to', 'STRING', 'SECRET', 'zd-9f41c7a2e8b34d05'],
];
for (const [catalogId, name, description, type, kind, value] of VARIABLES) {
  await gql('mutation($input: CreateVariableInput!) { createVariable(input: $input) { id } }', {
    input: { workspaceId: ws, catalogId, name, description, type, kind, value },
  });
}
log(`${VARIABLES.length} variables in 2 catalogs`);

/* ----------------------------------------------------------------- objects */

const { createObject: ticket } = await gql(
  'mutation($input: CreateObjectInput!) { createObject(input: $input) { id name } }',
  {
    input: {
      workspaceId: ws,
      name: 'Ticket',
      description: 'The support ticket a Slack message turns out to be about.',
      properties: [
        { name: 'reference', kind: 'STRING' },
        { name: 'subject', kind: 'STRING' },
        { name: 'customer', kind: 'STRING' },
        { name: 'priority', kind: 'STRING' },
        { name: 'openedAt', kind: 'STRING' },
        { name: 'breached', kind: 'BOOLEAN' },
      ],
    },
  },
);
await gql('mutation($input: CreateObjectInput!) { createObject(input: $input) { id } }', {
  input: {
    workspaceId: ws,
    name: 'Customer',
    description: 'Who is asking, and what they are entitled to.',
    properties: [
      { name: 'name', kind: 'STRING' },
      { name: 'plan', kind: 'STRING' },
      { name: 'openTickets', kind: 'NUMBER' },
      { name: 'contacts', kind: 'ARRAY', elementKind: 'STRING' },
    ],
  },
});
log('2 objects');

/* --------------------------------------------------------------- functions */

const FUNCTIONS = [
  {
    name: 'ticketReference',
    description: 'Pulls a SUP-1234 style reference out of whatever the customer typed.',
    returnType: 'STRING',
    params: [{ name: 'text', type: 'STRING' }],
    typescript: [
      'export default function ticketReference(text: string): string {',
      '  const match = text.match(/\\bSUP-\\d{2,6}\\b/i);',
      "  return match ? match[0].toUpperCase() : '';",
      '}',
    ].join('\n'),
    source: [
      'export default function ticketReference(text) {',
      '  const match = text.match(/\\bSUP-\\d{2,6}\\b/i);',
      "  return match ? match[0].toUpperCase() : '';",
      '}',
    ].join('\n'),
  },
  {
    name: 'minutesUntilBreach',
    description: 'How long a ticket has left against its response target; negative once it is past.',
    returnType: 'NUMBER',
    params: [
      { name: 'openedAt', type: 'STRING' },
      { name: 'slaMinutes', type: 'NUMBER' },
    ],
    typescript: [
      'export default function minutesUntilBreach(openedAt: string, slaMinutes: number): number {',
      '  const opened = new Date(openedAt).getTime();',
      '  const elapsed = (Date.now() - opened) / 60000;',
      '  return Math.round(slaMinutes - elapsed);',
      '}',
    ].join('\n'),
    source: [
      'export default function minutesUntilBreach(openedAt, slaMinutes) {',
      '  const opened = new Date(openedAt).getTime();',
      '  const elapsed = (Date.now() - opened) / 60000;',
      '  return Math.round(slaMinutes - elapsed);',
      '}',
    ].join('\n'),
  },
  {
    name: 'severityOf',
    description: 'Reads a priority label as a number, so a condition can compare it.',
    returnType: 'NUMBER',
    params: [{ name: 'priority', type: 'STRING' }],
    typescript: [
      'export default function severityOf(priority: string): number {',
      '  const table: Record<string, number> = { P1: 1, P2: 2, P3: 3, P4: 4 };',
      '  return table[priority.toUpperCase()] ?? 4;',
      '}',
    ].join('\n'),
    source: [
      'export default function severityOf(priority) {',
      '  const table = { P1: 1, P2: 2, P3: 3, P4: 4 };',
      '  return table[priority.toUpperCase()] ?? 4;',
      '}',
    ].join('\n'),
  },
  {
    name: 'escalationNote',
    description: 'The line the escalation channel is given, so every escalation reads the same.',
    returnType: 'STRING',
    params: [
      { name: 'reference', type: 'STRING' },
      { name: 'customer', type: 'STRING' },
      { name: 'minutesLeft', type: 'NUMBER' },
    ],
    typescript: [
      'export default function escalationNote(reference: string, customer: string, minutesLeft: number): string {',
      '  const late = minutesLeft < 0;',
      '  const when = late ? Math.abs(minutesLeft) + "m over" : minutesLeft + "m left";',
      '  return reference + " \\u00b7 " + customer + " \\u00b7 " + when;',
      '}',
    ].join('\n'),
    source: [
      'export default function escalationNote(reference, customer, minutesLeft) {',
      '  const late = minutesLeft < 0;',
      '  const when = late ? Math.abs(minutesLeft) + "m over" : minutesLeft + "m left";',
      '  return reference + " \\u00b7 " + customer + " \\u00b7 " + when;',
      '}',
    ].join('\n'),
  },
];

const functionIds = {};
for (const fn of FUNCTIONS) {
  const { createFunction } = await gql(
    'mutation($input: CreateFunctionInput!) { createFunction(input: $input) { id name } }',
    { input: { workspaceId: ws, ...fn } },
  );
  functionIds[fn.name] = createFunction.id;
}
log(`${FUNCTIONS.length} functions`);

/* ------------------------------------------------------------------- tools */

const TOOLS = [
  {
    name: 'lookupCustomer',
    description: 'Who is asking: their plan, and how many tickets they already have open.',
    source: [
      '/** Looks the customer up by the address they wrote from. */',
      'function lookupCustomer(email) {',
      '  const found = orknux.http.get("https://crm.northwind.internal/customers?email=" + email);',
      '  return { name: found.name, plan: found.plan, openTickets: found.open };',
      '}',
    ].join('\n'),
  },
  {
    name: 'recentIncidents',
    description: 'Incidents on the status page in the last day, so an answer is not contradicted by one.',
    source: [
      '/** The last day of incidents, newest first. */',
      'function recentIncidents() {',
      '  const feed = orknux.http.get("https://status.northwind.internal/api/incidents?since=24h");',
      '  return feed.incidents.map((i) => i.startedAt + ": " + i.title + " (" + i.status + ")");',
      '}',
    ].join('\n'),
  },
  {
    name: 'raiseJiraIssue',
    description: 'Raises the ticket in Jira when the answer is that somebody has to do something.',
    source: [
      '/** Raises an issue in the support project and returns its key. */',
      'function raiseJiraIssue(summary, description, priority) {',
      '  const issue = orknux.jira.create({ project: "SUP", summary, description, priority });',
      '  return issue.key;',
      '}',
    ].join('\n'),
  },
];
for (const tool of TOOLS) {
  /*
   * The TypeScript goes with the JavaScript, because the API takes them
   * together or not at all - a tool whose halves were saved separately is one
   * whose editor and sandbox disagree about what it is. These demonstration
   * tools are written in the subset where the two read the same, so the pair is
   * honest rather than a second copy that has drifted.
   */
  await gql('mutation($input: CreateToolInput!) { createTool(input: $input) { id } }', {
    input: { workspaceId: ws, ...tool, typescript: tool.source },
  });
}
log(`${TOOLS.length} tools`);

/* ------------------------------------------------------------------ skills */

const { createSkillCatalog: playbooks } = await gql(
  'mutation($ws: ID!, $name: String!) { createSkillCatalog(workspaceId: $ws, name: $name) { id name } }',
  { ws, name: 'Support playbooks' },
);

const SKILLS = [
  {
    name: 'Answering in a thread',
    description: 'How a reply is written when it lands in somebody else’s conversation.',
    content: [
      '# Answering in a thread',
      '',
      'Reply in the thread the question was asked in, never in the channel: the',
      'people watching the thread are the people who care.',
      '',
      '- Lead with the answer. The reasoning goes underneath it.',
      '- Name the ticket (`SUP-1234`) so the conversation and the record can be',
      '  found from each other.',
      '- If the answer is "somebody has to look at this", say who, and by when.',
      '- Never guess at a cause while an incident is open — link the status page.',
    ].join('\n'),
  },
  {
    name: 'When to escalate',
    description: 'The line between answering a question and waking somebody up.',
    content: [
      '# When to escalate',
      '',
      'Escalate when any of these is true, and not otherwise:',
      '',
      '| Signal | Escalate to |',
      '|--------|-------------|',
      '| P1, or a P2 within 10 minutes of its target | the on-call rota |',
      '| More than one customer reporting the same fault | the incident channel |',
      '| Anything touching billing or data loss | the duty manager |',
      '',
      'An escalation that turns out to be unnecessary costs one person ten',
      'minutes. One that is skipped costs a customer their afternoon.',
    ].join('\n'),
  },
  {
    name: 'Writing the customer update',
    description: 'What goes in an update while something is still broken.',
    content: [
      '# Writing the customer update',
      '',
      'An update says three things: what is broken, what it means for them, and',
      'when they will hear from us next. It does not say "we are investigating"',
      'and stop there — that is the absence of an update.',
      '',
      'Give the next time, not a duration: *"by 15:30"*, not *"within the hour"*.',
    ].join('\n'),
  },
];
for (const skill of SKILLS) {
  /*
   * A skill opens with a frontmatter fence naming itself: that header is what
   * an agent reads to decide whether the skill applies before it reads the
   * body, so the store insists on it.
   */
  const content = ['---', `name: ${skill.name}`, `description: ${skill.description}`, '---', '', skill.content].join('\n');
  await gql('mutation($input: CreateSkillInput!) { createSkill(input: $input) { id } }', {
    input: { workspaceId: ws, catalogId: playbooks.id, name: skill.name, description: skill.description, content },
  });
}
log(`${SKILLS.length} skills in ${playbooks.name}`);

/* -------------------------------------------------------------- conditions */

await gql('mutation($input: CreateConditionInput!) { createCondition(input: $input) { id } }', {
  input: {
    workspaceId: ws,
    name: 'Mentions an outage',
    type: 'SLACK',
    property: 'MESSAGE_TEXT',
    check: 'CONTAINS',
    values: ['outage', 'is down', 'cannot log in', 'incident'],
    icon: 'alert-triangle',
  },
});
await gql('mutation($input: CreateConditionInput!) { createCondition(input: $input) { id } }', {
  input: {
    workspaceId: ws,
    name: 'Out of hours',
    type: 'TIME',
    property: 'CURRENT_TIME',
    check: 'BETWEEN',
    values: ['18:00', '08:00'],
    icon: 'clock',
  },
});
log('2 conditions');

/* ----------------------------------------------------------------- actions */

const { createAction: findTicket } = await gql(
  'mutation($input: CreateActionInput!) { createAction(input: $input) { id name } }',
  {
    input: {
      workspaceId: ws,
      name: 'Find the ticket referred to',
      type: 'EXECUTE',
      subtype: 'FUNCTION',
      functionId: functionIds.ticketReference,
      icon: 'clipboard-list',
    },
  },
);
const { createAction: replyInThread } = await gql(
  'mutation($input: CreateActionInput!) { createAction(input: $input) { id name } }',
  {
    input: {
      workspaceId: ws,
      name: 'Reply in the Slack thread',
      type: 'EXECUTE',
      subtype: 'OUTGOING_CONNECTION',
      connectionId: slack.id,
      connectionAction: 'REPLY_IN_THREAD',
      target: 'CHANNEL',
      icon: 'slack',
    },
  },
);
await gql('mutation($input: CreateActionInput!) { createAction(input: $input) { id } }', {
  input: {
    workspaceId: ws,
    name: 'Page the on-call',
    type: 'EXECUTE',
    subtype: 'HTTP_REQUEST',
    url: 'https://events.pagerduty.com/v2/enqueue',
    method: 'POST',
    headers: '{"Content-Type":"application/json"}',
    timeoutSeconds: 10,
    retryIntervalSeconds: 30,
    icon: 'bell',
  },
});
const { createAction: holdBriefly } = await gql(
  'mutation($input: CreateActionInput!) { createAction(input: $input) { id name } }',
  {
    input: {
      workspaceId: ws,
      name: 'Hold for ten minutes',
      type: 'WAIT',
      subtype: 'TIME',
      durationSeconds: 600,
      icon: 'clock',
    },
  },
);
const { createAction: escalationNote } = await gql(
  'mutation($input: CreateActionInput!) { createAction(input: $input) { id name } }',
  {
    input: {
      workspaceId: ws,
      name: 'Write the escalation note',
      type: 'EXECUTE',
      subtype: 'FUNCTION',
      functionId: functionIds.escalationNote,
      icon: 'file-text',
    },
  },
);
log('5 actions');

/* ------------------------------------------------------------------ agents */

const RESPONDER_PROMPT = [
  'You answer support questions for Northwind in Slack.',
  '',
  'Answer the question first, then explain. If you are not certain, say so and',
  'name what would settle it. Never invent a ticket reference, a date, or a',
  'cause: if you need one, use the tools you have.',
].join('\n');

const { createAgent: responder } = await gql(
  'mutation($input: CreateAgentInput!) { createAgent(input: $input) { id name } }',
  {
    input: {
      workspaceId: ws,
      name: 'Support responder',
      type: 'LLM',
      description: 'Answers what it can, and says who to ask when it cannot.',
      systemPrompt: RESPONDER_PROMPT,
      icon: 'bot',
    },
  },
);
await gql('mutation($id: ID!, $input: UpdateAgentInput!) { updateAgent(id: $id, input: $input) { id } }', {
  id: responder.id,
  input: {
    name: 'Support responder',
    description: 'Answers what it can, and says who to ask when it cannot.',
    systemPrompt: RESPONDER_PROMPT,
    type: 'LLM',
    modelId: chatModel.id,
    skillCatalogs: ['Support playbooks'],
    tools: ['lookupCustomer', 'recentIncidents'],
    orknuxAccess: false,
    icon: 'bot',
  },
});

const HANDOVER_PROMPT = 'Summarise the day for the shift taking over. Lead with what is still open.';
const { createAgent: summariser } = await gql(
  'mutation($input: CreateAgentInput!) { createAgent(input: $input) { id name } }',
  {
    input: {
      workspaceId: ws,
      name: 'Handover summariser',
      type: 'LLM',
      description: 'Turns a day of threads into the note the next shift reads.',
      systemPrompt: HANDOVER_PROMPT,
      icon: 'book',
    },
  },
);
await gql('mutation($id: ID!, $input: UpdateAgentInput!) { updateAgent(id: $id, input: $input) { id } }', {
  id: summariser.id,
  input: {
    name: 'Handover summariser',
    description: 'Turns a day of threads into the note the next shift reads.',
    systemPrompt: HANDOVER_PROMPT,
    type: 'LLM',
    modelId: chatModel.id,
    tools: ['raiseJiraIssue'],
    icon: 'book',
  },
});
log('2 agents');

/* ---------------------------------------------------------------- triggers */

const { createTrigger: onMention } = await gql(
  'mutation($input: CreateTriggerInput!) { createTrigger(input: $input) { id name } }',
  {
    input: {
      workspaceId: ws,
      name: 'Slack message received',
      type: 'INCOMING_CONNECTION',
      connectionId: slack.id,
      action: 'MENTION',
      icon: 'slack',
    },
  },
);
const { createTrigger: nightly } = await gql(
  'mutation($input: CreateTriggerInput!) { createTrigger(input: $input) { id name } }',
  {
    input: {
      workspaceId: ws,
      name: 'Nightly backlog sweep',
      type: 'SCHEDULED',
      cron: '0 30 6 * * *',
      timezone: 'Europe/Warsaw',
      icon: 'calendar',
    },
  },
);
await gql('mutation($input: CreateTriggerInput!) { createTrigger(input: $input) { id } }', {
  input: {
    workspaceId: ws,
    name: 'Ticket raised in Zendesk',
    type: 'WEBHOOK',
    /*
     * Under the demonstration's own name, because a webhook path is unique
     * across the whole installation rather than per workspace - the same reason
     * the workflows above are named for what they do. A bare
     * `zendesk/ticket-created` is exactly the path a real installation would
     * reach for, so the demonstration must not be holding it.
     */
    webhookPath: 'northwind/zendesk-ticket-created',
    authType: 'NONE',
    objectId: ticket.id,
    icon: 'link',
  },
});
log('3 triggers');

/* --------------------------------------------------------- the workflows */

/**
 * Creating a workflow, with the one failure it has that is worth explaining.
 *
 * Workflow names are unique across the whole installation rather than within a
 * workspace, so the name this wants can be held by a workspace this seed will
 * never look at - including one that was built by an older run of this script
 * and then kept. The database says so in the language of a constraint, which
 * sends whoever ran this looking for a bug in the graph.
 *
 * It stops rather than picking another name. A manual is full of pictures of
 * these names, and "Escalate before the target is missed 2" in a caption reads
 * as a product that cannot count. Freeing the name, or pointing this seed at a
 * different one, is a decision for whoever owns the installation.
 */
async function createWorkflow(name, description) {
  try {
    const { createWorkflow: made } = await gql(
      'mutation($input: CreateWorkflowInput!) { createWorkflow(input: $input) { id name } }',
      { input: { workspaceId: ws, name, description } },
    );
    return made;
  } catch (failure) {
    throw new Error(
      `Could not create the workflow "${name}": ${failure.message.split('\n')[0]}\n` +
        '  Workflow names are unique across this whole installation, so something else may already hold it.\n' +
        '  Rename whatever holds it, or give this seed names of its own.',
    );
  }
}

const flagship = await createWorkflow(
  'Answer a question asked in Slack',
  'Somebody mentions the bot in Slack; it works out which ticket they mean, and answers in the thread.',
);

const TRIGGER_KEY = 'trigger-slack';
const TICKET_KEY = 'action-ticket';
const AGENT_KEY = 'agent-responder';
const REPLY_KEY = 'action-reply';

await gql(
  `mutation($ws: ID!, $id: ID!, $input: WorkflowGraphInput!) {
     saveWorkflowGraph(workspaceId: $ws, workflowId: $id, input: $input) { workflowId problems { message } }
   }`,
  {
    ws,
    id: flagship.id,
    input: {
      nodes: [
        {
          key: TRIGGER_KEY,
          kind: 'TRIGGER',
          name: 'Wait for a mention',
          triggerId: onMention.id,
          icon: 'slack',
          x: 40,
          y: 60,
        },
        {
          key: TICKET_KEY,
          kind: 'ACTION',
          name: 'Find the ticket referred to',
          actionId: findTicket.id,
          outputName: 'reference',
          icon: 'clipboard-list',
          mappings: [
            { name: 'text', expression: 'trigger.text', mode: 'REFERENCE', sourceNodeKey: TRIGGER_KEY },
          ],
          x: 320,
          y: 340,
        },
        {
          key: AGENT_KEY,
          kind: 'AGENT',
          name: 'Support responder',
          agentId: responder.id,
          outputName: 'llmResult',
          icon: 'bot',
          mappings: [
            { name: 'prompt', expression: 'trigger.text', mode: 'REFERENCE', sourceNodeKey: TRIGGER_KEY },
            { name: 'systemPrompt', expression: 'reference', mode: 'REFERENCE', sourceNodeKey: TICKET_KEY },
          ],
          x: 800,
          y: 410,
        },
        {
          key: REPLY_KEY,
          kind: 'ACTION',
          name: 'Reply in the thread',
          actionId: replyInThread.id,
          icon: 'slack',
          mappings: [
            { name: 'target', expression: 'trigger.channel', mode: 'REFERENCE', sourceNodeKey: TRIGGER_KEY },
            { name: 'content', expression: 'llmResult', mode: 'REFERENCE', sourceNodeKey: AGENT_KEY },
            { name: 'threadTs', expression: 'trigger.threadTs', mode: 'REFERENCE', sourceNodeKey: TRIGGER_KEY },
          ],
          x: 1160,
          y: 170,
        },
      ],
      edges: [
        { source: TRIGGER_KEY, target: TICKET_KEY },
        { source: TICKET_KEY, target: AGENT_KEY },
        { source: AGENT_KEY, target: REPLY_KEY },
      ],
    },
  },
);
await gql('mutation($ws: ID!, $id: ID!) { publishWorkflow(workspaceId: $ws, workflowId: $id) { status } }', {
  ws,
  id: flagship.id,
});
log(`workflow ${flagship.id}: ${flagship.name} (published)`);

/*
 * A second workflow with no agent in it, so it can actually be run: the runs
 * are what the executions list and the run detail page are pictures of, and a
 * run that needs a live model is a run that fails on somebody else's machine.
 */
const sweep = await createWorkflow(
  'Escalate before the target is missed',
  'Runs before the morning shift: what is close to its target, and who is told about it.',
);
const SWEEP_TRIGGER = 'trigger-nightly';
const SWEEP_FIND = 'action-find';
const SWEEP_NOTE = 'action-note';

await gql(
  `mutation($ws: ID!, $id: ID!, $input: WorkflowGraphInput!) {
     saveWorkflowGraph(workspaceId: $ws, workflowId: $id, input: $input) { workflowId problems { message } }
   }`,
  {
    ws,
    id: sweep.id,
    input: {
      nodes: [
        {
          key: SWEEP_TRIGGER,
          kind: 'TRIGGER',
          name: 'Every morning at 06:30',
          triggerId: nightly.id,
          icon: 'calendar',
          x: 60,
          y: 200,
        },
        {
          key: SWEEP_FIND,
          kind: 'ACTION',
          name: 'Find the ticket referred to',
          actionId: findTicket.id,
          outputName: 'reference',
          icon: 'clipboard-list',
          mappings: [{ name: 'text', expression: 'SUP-4471 billing export failing', mode: 'VALUE' }],
          x: 430,
          y: 200,
        },
        {
          key: SWEEP_NOTE,
          kind: 'ACTION',
          name: 'Write the escalation note',
          actionId: escalationNote.id,
          outputName: 'note',
          icon: 'file-text',
          mappings: [
            { name: 'reference', expression: 'reference', mode: 'REFERENCE', sourceNodeKey: SWEEP_FIND },
            { name: 'customer', expression: 'Halden Foods', mode: 'VALUE' },
            { name: 'minutesLeft', expression: '-12', mode: 'VALUE' },
          ],
          x: 810,
          y: 200,
        },
      ],
      edges: [
        { source: SWEEP_TRIGGER, target: SWEEP_FIND },
        { source: SWEEP_FIND, target: SWEEP_NOTE },
      ],
    },
  },
);
await gql('mutation($ws: ID!, $id: ID!) { publishWorkflow(workspaceId: $ws, workflowId: $id) { status } }', {
  ws,
  id: sweep.id,
});
log(`workflow ${sweep.id}: ${sweep.name} (published)`);

/* ---------------------------------------------------------------- the runs */

let runs = 0;
for (const input of ['SUP-4471', 'SUP-4468', 'SUP-4470', 'SUP-4455', 'SUP-4462']) {
  try {
    await gql(
      'mutation($ws: ID!, $id: ID!, $input: String) { startExecution(workspaceId: $ws, workflowId: $id, input: $input) { id status } }',
      { ws, id: sweep.id, input },
    );
    runs += 1;
  } catch (failure) {
    console.warn(`  run for ${input}: ${failure.message.split('\n')[0]}`);
  }
}
/*
 * And one run of the workflow with the agent in it, which is the run the manual
 * actually wants a picture of: a trigger, an action, a model that answers, and
 * a step that had nothing to do.
 *
 * The input is a JSON object rather than a sentence, and that is the whole
 * difference between this row being green and being red. The graph's nodes read
 * `trigger.text`, `trigger.channel` and `trigger.threadTs` - a manual run's
 * input *is* the event, and a reference into a bare string resolves to nothing,
 * so the first action was handed null and died on it. The manual then opened on
 * an executions list whose top row was a red "Answer a question asked in Slack",
 * which reads as a product that cannot run its own example. What the shape here
 * has to match is the trigger the graph was drawn around, so this is the event
 * Slack would have delivered.
 *
 * The reply step still has no bot token to send with, and that is fine: the
 * action reports that it sent nothing and the run completes. A skipped step
 * with a reason on it is a better picture than a failure, because it is what an
 * installation with one integration still to configure actually looks like.
 */
let flagshipRun = null;
try {
  const { startExecution } = await gql(
    'mutation($ws: ID!, $id: ID!, $input: String) { startExecution(workspaceId: $ws, workflowId: $id, input: $input) { id status } }',
    {
      ws,
      id: flagship.id,
      input: JSON.stringify({
        text:
          'Any update on SUP-4471? We know the cause is a schema change on our side and the fix ' +
          'ships at 15:30 - draft the reply for the thread.',
        channel: '#support',
        threadTs: '1755600000.000100',
      }),
    },
  );
  flagshipRun = startExecution.id;
  runs += 1;
} catch (failure) {
  console.warn(`  flagship run: ${failure.message.slice(0, 120)}`);
}
log(`${runs} runs started`);

/* --------------------------------------------------------------- the chats */

await gql('mutation($ws: ID!, $id: ID) { setWorkspaceQuickChatModel(workspaceId: $ws, modelId: $id) { id } }', {
  ws,
  id: chatModel.id,
});

const CHATS = [
  {
    title: 'Drafting the customer update',
    say: [
      "Draft a short update for a customer whose nightly billing export has failed three nights running.",
      'We know the cause - a schema change on our side - and expect the fix out by 15:30 today.',
      'Two short paragraphs, no apology theatre.',
    ].join(' '),
  },
  {
    title: 'First checks for a login failure',
    say: 'A customer says they cannot log in. What should I check first, in order, and why that order?',
  },
];
let chats = 0;
for (const chat of CHATS) {
  try {
    const { startChat } = await gql('mutation($input: StartChatInput!) { startChat(input: $input) { id title } }', {
      input: { workspaceId: ws, title: chat.title, modelId: chatModel.id },
    });
    await gql('mutation($id: ID!, $text: String!) { sendChatMessage(id: $id, text: $text) { __typename } }', {
      id: startChat.id,
      text: chat.say,
    });
    chats += 1;
  } catch (failure) {
    console.warn(`  chat "${chat.title}": ${failure.message.split('\n')[0]}`);
  }
}
log(`${chats} chats`);

/* ------------------------------------------------------------- the tracker */

/*
 * The tracker, which is the part of a demonstration workspace that most looks
 * like somebody's real one - and so the part a manual most needs made up on
 * purpose. An empty tracker photographs as an empty box, and a tracker nobody
 * seeded is whatever the machine happened to be tracking that afternoon.
 *
 * What the pictures need is here rather than implied: all three states beside
 * each other, labels that are used more than once so the label row means
 * something, an assignee that is an agent as well as ones that are people, and
 * one issue carrying everything the manual's second screenshot is about - a
 * conversation, a file and a couple of links.
 */
const ISSUES = [
  {
    title: 'The nightly billing export has failed three nights running',
    description: [
      'Northwind Retail have had no export since Sunday. The job reports success and writes a file of',
      'nine bytes, so nothing downstream complains either.',
      '',
      'First failure was the night the ledger schema changed, which is the obvious suspect.',
    ].join('\n'),
    labels: ['p1', 'billing'],
    status: 'OPEN',
  },
  {
    title: 'Slack replies land in the channel instead of the thread',
    description:
      'Only when the question was asked in a thread that already had a reply in it. In an unanswered thread it is fine.',
    labels: ['p2', 'slack'],
    status: 'IN_PROGRESS',
    assign: 'Support responder',
  },
  {
    title: 'The escalation note says "0m left" on a ticket that has already breached',
    description: 'Rounding, at a guess: -0.4 minutes is not zero minutes, and the note reads as though there is time.',
    labels: ['p2'],
    status: 'OPEN',
  },
  {
    title: 'Customer lookup times out for accounts with more than 200 open tickets',
    description: 'The CRM answers eventually. The tool gives up at ten seconds, so the agent answers without knowing who it is talking to.',
    labels: ['p2', 'crm'],
    status: 'IN_PROGRESS',
  },
  {
    title: 'The Zendesk webhook stops delivering after a token is rotated',
    description: 'Nothing is retried and nothing is logged: tickets simply stop arriving until somebody notices the quiet.',
    labels: ['p1', 'zendesk'],
    status: 'IN_PROGRESS',
  },
  {
    title: 'A P2 within ten minutes of its target should page, not wait',
    description: 'The playbook says it escalates. The sweep only looks at P1, so it does not.',
    labels: ['p2', 'escalation'],
    status: 'OPEN',
  },
  {
    title: 'Status page incidents are read once and cached for the rest of the day',
    description: 'An incident opened at 09:10 is still invisible to the desk at 16:00, which is when it is most worth knowing about.',
    labels: ['p2'],
    status: 'OPEN',
  },
  {
    title: 'The handover summary repeats yesterday morning as though it were today',
    description: 'It reads the last twenty-four hours from when it runs rather than from the end of the last shift.',
    labels: ['p3', 'handover'],
    status: 'OPEN',
  },
  {
    title: 'Attach the failing export to the ticket automatically',
    description: 'Every one of these ends with somebody asking for the file. It is already on disk when the ticket is raised.',
    labels: ['p3', 'wishlist'],
    status: 'OPEN',
  },
  {
    title: 'A ticket reference typed in lower case is not recognised',
    description: 'People write `sup-4471`. The pattern matched upper case only.',
    labels: ['p3'],
    status: 'CLOSED',
  },
  {
    title: 'The wrong rota was paged while the primary was on holiday',
    description: 'The rota name is a variable and the variable was not changed, so the page went to somebody on a beach.',
    labels: ['p1', 'escalation'],
    status: 'CLOSED',
  },
];

/**
 * What an issue can be handed to here, so an agent can be found by its name.
 *
 * `hint` is asked for as well as `name`, and it is not decoration: further down
 * both people are found by it - `hint` is the username, and a display name is
 * not one. Without it the two lookups compared against `undefined`, found
 * nobody, and silently skipped the handover to alice and everything that makes
 * the colleague's bell ring. The manual's picture of the notifications panel
 * shipped as an empty box because a field was missing from this line.
 */
const { issueAssignees } = await gql(`{ issueAssignees(workspaceId: "${ws}") { kind id name hint } }`);
const assigneeNamed = (name) => issueAssignees.find((candidate) => candidate.name === name);

const filed = [];
for (const issue of ISSUES) {
  const held = issue.assign ? assigneeNamed(issue.assign) : null;
  const { createIssue } = await gql('mutation($input: IssueInput!) { createIssue(input: $input) { id number title } }', {
    input: {
      workspaceId: ws,
      title: issue.title,
      description: issue.description,
      status: issue.status,
      labels: issue.labels,
      ...(held ? { assigneeKind: held.kind, assigneeId: held.id } : {}),
    },
  });
  filed.push(createIssue);
}
log(`${filed.length} issues`);

/*
 * The one issue the manual photographs on its own, so everything the page can
 * hold is on it. The file is a few lines of a log rather than a picture: a
 * screenshot of a screenshot teaches nothing, and this way the thumbnail is
 * plainly a document.
 */
const illustrated = filed[0];

const upload = async (filename, contentType, text, as = null) => {
  const form = new FormData();
  form.set('files', new Blob([text], { type: contentType }), filename);
  const response = await fetch(`${BASE}/api/workspaces/${ws}/issue-attachments`, {
    method: 'POST',
    headers: { cookie: as ?? cookie },
    body: form,
  });
  if (!response.ok) throw new Error(`Could not upload ${filename}: ${response.status} ${await response.text()}`);
  const { attachments } = await response.json();
  return attachments.map((attachment) => attachment.id);
};

const EXPORT_LOG = [
  '2026-08-18T02:00:04Z  export.start        account=northwind-retail window=2026-08-17',
  '2026-08-18T02:00:04Z  ledger.read         rows=0 expected=48210',
  '2026-08-18T02:00:05Z  ledger.warn         unknown column "settled_at", falling back to no columns',
  '2026-08-18T02:00:05Z  export.write        bytes=9 path=/exports/northwind-retail/2026-08-17.csv',
  '2026-08-18T02:00:05Z  export.finish       status=ok duration=1.2s',
].join('\n');
await gql('mutation($id: ID!, $ids: [ID!]!) { attachToIssue(id: $id, attachmentIds: $ids) { id } }', {
  id: illustrated.id,
  ids: await upload('billing-export-2026-08-18.log', 'text/plain', EXPORT_LOG),
});

for (const [url, title] of [
  ['https://github.com/northwind/support-desk/pull/214', null],
  ['https://status.northwind.example/incidents/2026-08-18', 'The status page for that night'],
]) {
  await gql('mutation($id: ID!, $url: String!, $title: String) { addIssueLink(id: $id, url: $url, title: $title) { id } }', {
    id: illustrated.id,
    url,
    title,
  });
}

/* ------------------------------------------------------- and the other desk */

/*
 * Everything from here is done as somebody else, which is the only way the
 * bell ends up with anything in it: the tracker never tells you about your own
 * doing. It is also what makes the conversation on the illustrated issue read
 * as a conversation rather than as one person thinking aloud.
 */
let asColleague = null;
try {
  asColleague = await signIn(COLLEAGUE.username, COLLEAGUE.password);
} catch (failure) {
  console.warn(`  ${COLLEAGUE.displayName} could not sign in: ${failure.message.split('\n')[0]}`);
}

if (asColleague) {
  const say = (issue, content) =>
    gql(
      'mutation($id: ID!, $content: String!) { commentOnIssue(id: $id, content: $content) { id } }',
      { id: issue.id, content },
      asColleague,
    );

  await say(
    illustrated,
    [
      'Nine bytes is the header and nothing else, so the query returned no rows rather than failing.',
      '',
      '| Night | Rows | File |',
      '| --- | --- | --- |',
      '| Saturday | 47,880 | 3.1 MB |',
      '| Sunday | 0 | 9 B |',
      '| Monday | 0 | 9 B |',
      '',
      'The ledger gained `settled_at` on Sunday afternoon. The export selects columns by name and swallows',
      'the one it cannot find, which is how a broken read reports success.',
    ].join('\n'),
  );
  await gql(
    'mutation($id: ID!, $content: String!) { commentOnIssue(id: $id, content: $content) { id } }',
    {
      id: illustrated.id,
      content: [
        'Agreed on the cause. Two things, then:',
        '',
        '```sql',
        'select count(*) from ledger_entry where settled_at is not null;',
        '```',
        '',
        'and the export should refuse to write a file with no rows in it rather than call that a success.',
        'The second one is what stopped anybody noticing for three days.',
      ].join('\n'),
    },
  );
  await say(
    illustrated,
    '@alice I can take the write-refusal part this afternoon if you are on the column. Same fix otherwise.',
  );

  // Handed over, closed and picked up, so the bell shows more than one kind of
  // thing happening: the table in the manual has four rows in it.
  const handed = filed.find((issue) => issue.title.startsWith('Attach the failing export'));
  const alice = issueAssignees.find((candidate) => candidate.kind === 'USER' && candidate.hint === USER);
  if (handed && alice) {
    await gql(
      'mutation($id: ID!, $input: IssueInput!) { updateIssue(id: $id, input: $input) { id } }',
      { id: handed.id, input: { assigneeKind: alice.kind, assigneeId: alice.id } },
      asColleague,
    );
  }

  const rounded = filed.find((issue) => issue.title.includes('0m left'));
  if (rounded) {
    await say(rounded, 'It is `Math.round` on a negative number. Fix is one line; I would rather it printed "12m over".');
    await gql(
      'mutation($id: ID!, $input: IssueInput!) { updateIssue(id: $id, input: $input) { id } }',
      { id: rounded.id, input: { status: 'IN_PROGRESS' } },
      asColleague,
    );
  }

  const lowercase = filed.find((issue) => issue.title.includes('lower case'));
  if (lowercase) {
    await say(lowercase, 'Out with this morning. The pattern is case-insensitive now and the reference is upper-cased on the way out.');
  }
  /*
   * And the same in the other direction, so the colleague's own bell has
   * something in it.
   *
   * The tracker never tells you about your own doing, so a seed where the
   * colleague only ever acts leaves her notifications empty - which matters
   * because the bell is photographed as her: it is installation-wide, and on a
   * development machine the owner's bell holds the owner's real tracker.
   */
  const forDana = filed.find((issue) => issue.title.includes('handover summary'));
  const dana = issueAssignees.find((candidate) => candidate.kind === 'USER' && candidate.hint === COLLEAGUE.username);
  if (forDana && dana) {
    await gql(
      'mutation($id: ID!, $input: IssueInput!) { updateIssue(id: $id, input: $input) { id } }',
      { id: forDana.id, input: { assigneeKind: dana.kind, assigneeId: dana.id } },
    );
    await gql(
      'mutation($id: ID!, $content: String!) { commentOnIssue(id: $id, content: $content) { id } }',
      {
        id: forDana.id,
        content:
          '@Dana Whitfield this one is yours - it reads yesterday morning as today whenever the shift ends after midnight.',
      },
    );
    await gql(
      'mutation($id: ID!, $input: IssueInput!) { updateIssue(id: $id, input: $input) { id } }',
      { id: forDana.id, input: { status: 'IN_PROGRESS' } },
    );
  }

  log(`the desk answered, as ${COLLEAGUE.displayName}`);
}

/* ------------------------------------------------ and the tokens she signs with */

/*
 * Access tokens on the colleague's account, because the manual has a picture of
 * a user page and that page is mostly about tokens.
 *
 * It used to photograph whichever internal account came first, which on the
 * machine that takes these pictures is the account an AI assistant signs in
 * with - two administrator roles and three live tokens named after the tool
 * holding them. The capture now asks for this colleague by name, and this is
 * what makes her page worth photographing: three tokens that were invented on
 * purpose, so nothing has to be painted over afterwards.
 *
 * Added by name and only when the name is free, the way the proxy rules and
 * shells below are: this account survives a rebuild of the workspace, and a
 * seed run twice should not leave her holding six.
 *
 * Two of them are then used - one call each, which is all it takes for the page
 * to say "used ... ago" beside them. A page where every row reads "never used"
 * is a picture of three things nobody has done anything with.
 */
if (colleague) {
  const TOKENS = ['Nightly export', 'Rota sync', 'Status page'];
  const { userTokens } = await gql(`{ userTokens(id: "${colleague.id}") { id name } }`);
  const already = new Set(userTokens.map((token) => token.name));
  const issued = [];
  for (const name of TOKENS) {
    if (already.has(name)) continue;
    const { createUserToken } = await gql(
      'mutation($id: ID!, $name: String!) { createUserToken(id: $id, name: $name) { token { id name } secret } }',
      { id: colleague.id, name },
    );
    issued.push(createUserToken.secret);
  }
  // A token is a bearer credential, so it goes in the header rather than in the
  // session cookie the rest of this script uses.
  for (const secret of issued.slice(0, 2)) {
    const response = await fetch(`${BASE}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
      body: JSON.stringify({ query: '{ myNotificationCount }' }),
    });
    if (!response.ok) console.warn(`  token call: ${response.status}`);
  }
  log(`${issued.length} access tokens for ${COLLEAGUE.displayName}`);
}

/*
 * The run with the model in it, finished before this script says it is done.
 *
 * It was started well above and has been running while the tracker was filled,
 * which is the point of starting it there - but a capture that opens the
 * executions list while it is still going photographs a spinner, and the
 * workflows list beside it photographs a workflow with no outcome yet.
 */
if (flagshipRun !== null) {
  const until = Date.now() + 180_000;
  let status = 'RUNNING';
  while (status === 'RUNNING' && Date.now() < until) {
    await new Promise((wake) => setTimeout(wake, 3000));
    const { execution } = await gql(`{ execution(id: "${flagshipRun}") { status } }`);
    status = execution.status;
  }
  log(`the run with the model in it: ${status}`);
}


/* ------------------------------------------- and the two installation lists */

/*
 * Everything above belongs to a workspace. These two do not: shells and proxy
 * rules are the installation's, and the Admin pages holding them show whatever
 * this machine holds. On a machine with none they photograph as an empty box,
 * which tells a reader nothing about what either page is for.
 *
 * So this adds by name, and only when the name is free. Nothing here is edited
 * or deleted. The rest of this script may demolish a workspace it built itself;
 * these two lists can hold somebody's real proxies and real machines, and a
 * documentation script has no business touching those.
 *
 * Every address below is a literal address on a private network, which is not a
 * style choice. A shell's host goes past the same guard every outbound address
 * goes past, and a name that does not resolve is refused as it is saved - so
 * `build.northwind.example`, which is what the rest of this seed would have
 * reached for, cannot be stored at all. A literal `10.` address has nothing to
 * look up, and points at a network this machine is not on.
 */

const { proxyRules } = await gql('{ proxyRules { id name } }');
const held = new Set(proxyRules.map((rule) => rule.name));

/*
 * The patterns are narrow on purpose, and for a different reason: a proxy rule
 * applies to the requests this installation really makes, so a demonstration
 * rule matching something it really calls would send that call into a hole.
 */
const RULES = [
  {
    name: 'Vendor APIs',
    // Found anywhere in the URL and ignoring case, so the anchor is doing real
    // work.
    pattern: '^https://api\.(zendesk|pagerduty)\.northwind\.example/',
    proxyHost: '10.0.4.2',
    proxyPort: 3128,
    username: 'orknux',
    // The page shows that a password is stored, and never the password.
    password: 'demo-only-never-used',
    enabled: true,
  },
  {
    name: 'Internal registry',
    pattern: '^https://registry\.northwind\.example/',
    proxyHost: '10.0.4.2',
    proxyPort: 3128,
    enabled: true,
  },
  {
    // Third, off, and last on purpose. The list is read top to bottom and the
    // first enabled rule that matches is the one used, so a row broader than
    // the two above it and switched off shows both of the things this page is
    // about at once.
    //
    // Short, because the name column is narrow and truncates: the manual's
    // picture of this page used to end in "Everything else at North…", which
    // reads as a product that cannot fit its own data on its own screen.
    name: 'All Northwind hosts',
    pattern: '^https?://[^/]*\.northwind\.example/',
    proxyHost: '10.0.4.2',
    proxyPort: 3128,
    enabled: false,
  },
];

for (const rule of RULES) {
  if (held.has(rule.name)) continue;
  await gql('mutation($input: ProxyRuleInput!) { createProxyRule(input: $input) { id } }', { input: rule });
}
log(`proxy rules: ${RULES.filter((rule) => !held.has(rule.name)).length} added`);

const { shells } = await gql('{ shells { id name } }');
const machines = new Set(shells.map((shell) => shell.name));

/*
 * A key is made here rather than checked in.
 *
 * A shell with no key reads as "No private key is stored", which photographs
 * the one state the page is not trying to explain. A key committed to a public
 * repository is worse in a different way - it is a private key in a public
 * repository, whatever it opens - so one is generated per run, for two machines
 * on a network this is not on. It opens nothing and it outlives nothing.
 */
const { generateKeyPairSync } = await import('node:crypto');
const throwaway = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  }).privateKey;

const MACHINES = [
  { name: 'Build box', host: '10.0.4.12', port: 22, username: 'orknux' },
  { name: 'Export runner', host: '10.0.4.19', port: 22, username: 'deploy' },
];

for (const machine of MACHINES) {
  if (machines.has(machine.name)) continue;
  await gql('mutation($input: ShellInput!) { createShell(input: $input) { id } }', {
    input: { ...machine, privateKey: throwaway() },
  });
}
log(`shells: ${MACHINES.filter((machine) => !machines.has(machine.name)).length} added`);

log(`\n${WORKSPACE_NAME} is workspace ${ws}. Point the capture at it.`);
