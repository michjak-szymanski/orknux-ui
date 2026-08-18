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
 */
const BASE = process.env.ORKNUX_UI_URL ?? 'http://localhost:5173';
const USER = process.env.ORKNUX_USER ?? 'alice';
const PASSWORD = process.env.ORKNUX_PASSWORD ?? 'password';

/** The name the capture looks for. Changing it here changes it there too. */
export const WORKSPACE_NAME = 'Acme Support';

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
 * run, so it is worth pointing at something real before capturing.
 */
const OLLAMA_ENDPOINT = process.env.ORKNUX_DEMO_ENDPOINT ?? 'http://localhost:11434';
const OLLAMA_MODEL_ID = process.env.ORKNUX_DEMO_MODEL ?? 'gemma-4-31B-it-Q5_K_M';

let cookie = '';

async function signIn() {
  const response = await fetch(`${BASE}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASSWORD }),
  });
  if (!response.ok) {
    throw new Error(`Could not sign in as ${USER}: ${response.status} ${await response.text()}`);
  }
  // One cookie, and only its name=value: the attributes are the browser's business.
  const raw = response.headers.get('set-cookie');
  if (!raw) throw new Error('Signed in, but no session cookie came back');
  cookie = raw.split(';')[0];
}

/**
 * One GraphQL call.
 *
 * Errors are thrown rather than collected: a seed that half worked is worse
 * than one that stopped, because the missing half stays invisible until it
 * turns up in a screenshot.
 */
async function gql(query, variables = {}) {
  const response = await fetch(`${BASE}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json();
  if (body.errors?.length) {
    throw new Error(`${body.errors[0].message}\n  in: ${query.trim().split('\n')[0]}`);
  }
  return body.data;
}

const log = (message) => console.log(message);

await signIn();

/* ---------------------------------------------------------------- workspace */

const { workspaces } = await gql('{ workspaces(size: 100) { content { id name } } }');
const previous = workspaces.content.find((w) => w.name === WORKSPACE_NAME);
if (previous) {
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

const { createWorkspace: workspace } = await gql(
  'mutation($input: CreateWorkspaceInput!) { createWorkspace(input: $input) { id name } }',
  {
    input: {
      name: WORKSPACE_NAME,
      description: 'The support desk: what Slack asks it, what it answers, and what it escalates.',
    },
  },
);
const ws = workspace.id;
log(`workspace ${ws}: ${workspace.name}`);

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
      '  const found = orknux.http.get("https://crm.acme.internal/customers?email=" + email);',
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
      '  const feed = orknux.http.get("https://status.acme.internal/api/incidents?since=24h");',
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
  await gql('mutation($input: CreateToolInput!) { createTool(input: $input) { id } }', {
    input: { workspaceId: ws, ...tool },
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
  'You answer support questions for Acme in Slack.',
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
    webhookPath: 'zendesk/ticket-created',
    authType: 'NONE',
    objectId: ticket.id,
    icon: 'link',
  },
});
log('3 triggers');

/* --------------------------------------------------------- the workflows */

const { createWorkflow: flagship } = await gql(
  'mutation($input: CreateWorkflowInput!) { createWorkflow(input: $input) { id name } }',
  {
    input: {
      workspaceId: ws,
      name: 'Azure Agent reply for Slack',
      description:
        'Somebody mentions the bot in Slack; it works out which ticket they mean, and answers in the thread.',
    },
  },
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
const { createWorkflow: sweep } = await gql(
  'mutation($input: CreateWorkflowInput!) { createWorkflow(input: $input) { id name } }',
  {
    input: {
      workspaceId: ws,
      name: 'Escalate what is about to breach',
      description: 'Runs before the morning shift: what is close to its target, and who is told about it.',
    },
  },
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
            { name: 'customer', expression: 'Northwind Trading', mode: 'VALUE' },
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
 * And one run of the workflow that reaches Slack, which is not configured here.
 * It fails, which is the point: a list where every row is green says nothing
 * about what the status column is for.
 */
try {
  await gql(
    'mutation($ws: ID!, $id: ID!, $input: String) { startExecution(workspaceId: $ws, workflowId: $id, input: $input) { id status } }',
    { ws, id: flagship.id, input: 'Any update on SUP-4471?' },
  );
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
      'We know the cause — a schema change on our side — and expect the fix out by 15:30 today.',
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

log(`\n${WORKSPACE_NAME} is workspace ${ws}. Point the capture at it.`);
