/**
 * Area mcp-extras: resources, prompts, notification on a changed tool list.
 *
 * Server side: resources, resource templates, prompts, and the policy that
 * tells the MCP sessions when a list or a resource changed.
 */
import type { ServerArea } from '../../tools/areas.js';
import { ListChangePolicy } from './policy.js';
import { mcpExtrasPrompts } from './prompts.js';
import { MCP_EXTRAS_RESOURCES, MCP_EXTRAS_TEMPLATES } from './resources.js';

const policy = new ListChangePolicy();

export const mcpExtrasArea: ServerArea = {
  id: 'mcp-extras',
  tools: [],
  resources: MCP_EXTRAS_RESOURCES,
  resourceTemplates: MCP_EXTRAS_TEMPLATES,
  prompts: mcpExtrasPrompts(),
  requests: [policy.request()],
  start: context => policy.start(context),
  stop: context => policy.stop(context),
  onModuleConnection: (event, context) => policy.connection(event, context),
};
