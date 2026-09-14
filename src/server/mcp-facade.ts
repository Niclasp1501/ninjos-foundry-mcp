/**
 * The MCP side: turns MCP requests into calls on a BackendApi.
 *
 * Independent of the transport. The wrapper connects it to standard input and
 * output; a Streamable HTTP front end can connect the same factory to an HTTP
 * transport inside the backend without changing anything here.
 */
import {
  Server,
  type CallToolResult,
  type GetPromptResult,
  type ReadResourceResult,
  type ResourceTemplateType,
  type Tool,
} from '@modelcontextprotocol/server';
import {
  errorResult,
  type BackendApi,
  type BackendEvent,
  type CallOptions,
  type CompletionRequest,
} from './control/api.js';
import type { Logger } from './logger.js';
import { messageOf } from './tools/results.js';

export interface McpServerOptions {
  name: string;
  version: string;
  api: BackendApi;
  logger: Logger;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/*
 * The backend's own result types are plain structural subsets of the SDK
 * types. They are cast here, at the single boundary, so the backend and the
 * control channel stay free of the SDK.
 */

export function createMcpServer({ name, version, api, logger }: McpServerOptions): Server {
  // listChanged and subscribe are declared always. A backend without events
  // simply never sends one, and a client without support ignores them (the mcp-extras area).
  const server = new Server(
    { name, version },
    {
      capabilities: {
        tools: { listChanged: true },
        resources: { subscribe: true, listChanged: true },
        prompts: { listChanged: true },
        completions: {},
      },
    }
  );

  server.setRequestHandler('tools/list', async () => {
    try {
      return { tools: (await api.listTools()) as Tool[] };
    } catch (error) {
      // An empty list rather than an error: some clients give up on a server whose list fails.
      logger.warn('Listing tools failed, answering with an empty list', {
        reason: messageOf(error),
      });
      return { tools: [] };
    }
  });

  server.setRequestHandler('tools/call', async (request, context) => {
    const params = request.params;
    const args = isRecord(params.arguments) ? params.arguments : {};
    const token = params._meta?.progressToken;
    const options: CallOptions = { signal: context.mcpReq.signal };
    if (token !== undefined) {
      options.onProgress = progress => {
        void context.mcpReq
          .notify({
            method: 'notifications/progress',
            params: { progressToken: token, ...progress },
          })
          .catch(() => undefined);
      };
    }
    try {
      return (await api.callTool(params.name, args, options)) as CallToolResult;
    } catch (error) {
      return errorResult(messageOf(error) || 'Backend unavailable') as CallToolResult;
    }
  });

  server.setRequestHandler('resources/list', async () => {
    try {
      return { resources: await api.listResources() };
    } catch (error) {
      logger.warn('Listing resources failed', { reason: messageOf(error) });
      return { resources: [] };
    }
  });

  server.setRequestHandler('resources/templates/list', async () => {
    try {
      const templates = api.listResourceTemplates ? await api.listResourceTemplates() : [];
      return { resourceTemplates: templates as ResourceTemplateType[] };
    } catch (error) {
      // A backend of an earlier state answers "Unknown method": it has no templates.
      logger.warn('Listing resource templates failed', { reason: messageOf(error) });
      return { resourceTemplates: [] };
    }
  });

  server.setRequestHandler(
    'resources/read',
    async (request, context) =>
      (await api.readResource(request.params.uri, {
        signal: context.mcpReq.signal,
      })) as ReadResourceResult
  );

  // Subscriptions belong to this session; the backend only says what changed.
  const subscriptions = new Set<string>();
  server.setRequestHandler('resources/subscribe', async request => {
    subscriptions.add(request.params.uri);
    return {};
  });
  server.setRequestHandler('resources/unsubscribe', async request => {
    subscriptions.delete(request.params.uri);
    return {};
  });

  server.setRequestHandler('prompts/list', async () => {
    try {
      return { prompts: await api.listPrompts() };
    } catch (error) {
      logger.warn('Listing prompts failed', { reason: messageOf(error) });
      return { prompts: [] };
    }
  });

  server.setRequestHandler('prompts/get', async request => {
    const args: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.params.arguments ?? {})) {
      if (typeof value === 'string') args[key] = value;
    }
    return (await api.getPrompt(request.params.name, args)) as GetPromptResult;
  });

  server.setRequestHandler('completion/complete', async request => {
    const { ref, argument } = request.params;
    const target: CompletionRequest['ref'] =
      ref.type === 'ref/prompt'
        ? { type: 'ref/prompt', name: ref.name }
        : { type: 'ref/resource', uri: ref.uri };
    const given = request.params.context?.arguments ?? {};
    try {
      if (!api.complete) return { completion: { values: [] } };
      const values = await api.complete({
        ref: target,
        argument: { name: argument.name, value: argument.value },
        arguments: given,
      });
      return { completion: { ...values } };
    } catch (error) {
      // Completion is a typing aid: a failure while typing is logged, not thrown at the user.
      logger.warn('Completion failed', { reason: messageOf(error) });
      return { completion: { values: [] } };
    }
  });

  let initialized = false;
  const forward = (event: BackendEvent): void => {
    if (!initialized) return;
    const sent: Array<Promise<void>> = [];
    switch (event.type) {
      case 'tools_changed':
        sent.push(server.sendToolListChanged());
        break;
      case 'resources_changed':
        sent.push(server.sendResourceListChanged());
        break;
      case 'prompts_changed':
        sent.push(server.sendPromptListChanged());
        break;
      case 'resources_updated':
        for (const uri of subscriptions) {
          if (event.prefixes.some(prefix => uri === prefix || uri.startsWith(prefix)))
            sent.push(server.sendResourceUpdated({ uri }));
        }
        break;
    }
    for (const promise of sent) promise.catch(() => undefined);
  };

  const unwatch = api.watch?.(forward);
  const previousInitialized = server.oninitialized;
  server.oninitialized = () => {
    initialized = true;
    previousInitialized?.();
  };
  const previousClose = server.onclose;
  server.onclose = () => {
    initialized = false;
    unwatch?.();
    previousClose?.();
  };

  return server;
}
