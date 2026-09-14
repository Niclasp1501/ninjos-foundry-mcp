/**
 * Registers for MCP resources, resource templates and prompts.
 *
 * Resources give a client context without a tool call; prompts are guided
 * workflows such as preparing a session. The entries live in the areas
 * (src/server/areas/); the world information resource of the scenes area was the
 * first, the mcp-extras area added templates, completions and prompts that read the
 * world while they are built.
 */
import type {
  CompletionRequest,
  CompletionValues,
  ListedPrompt,
  ListedResource,
  ListedResourceTemplate,
  PromptResult,
  ResourceContents,
} from '../control/api.js';
import type { BridgeAccess } from './registry.js';

export interface ResourceContext {
  query: BridgeAccess['query'];
  signal?: AbortSignal;
}

export interface ResourceDefinition extends ListedResource {
  read(context: ResourceContext): Promise<string>;
}

/** What a completer gets: the typed text is its first argument, the rest is here. */
export interface CompletionContext extends ResourceContext {
  /** Arguments or URI variables the client already filled in. */
  arguments: Record<string, string>;
}

/** Candidate values for one argument, best first. The registry caps the list. */
export type Completer = (value: string, context: CompletionContext) => Promise<string[]>;

export interface ResourceTemplateDefinition extends ListedResourceTemplate {
  /** `variables` are the decoded parts of the URI, by the names in `uriTemplate`. */
  read(variables: Record<string, string>, context: ResourceContext): Promise<string>;
  /** Completers by variable name. */
  complete?: Readonly<Record<string, Completer>>;
}

/** The MCP limit of values in one completion answer. */
export const MAX_COMPLETION_VALUES = 100;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The simple level of RFC 6570 that the templates here use: `{name}` stands
 * for one path segment. Returns the variables, or null when the URI does not fit.
 */
export function matchUriTemplate(template: string, uri: string): Record<string, string> | null {
  const names: string[] = [];
  const pattern = template
    .split(/(\{[A-Za-z0-9_]+\})/)
    .map(part => {
      const variable = /^\{([A-Za-z0-9_]+)\}$/.exec(part);
      if (!variable) return escapeRegExp(part);
      names.push(variable[1]!);
      return '([^/?#]+)';
    })
    .join('');
  const found = new RegExp(`^${pattern}$`).exec(uri);
  if (!found) return null;
  const variables: Record<string, string> = {};
  for (const [index, name] of names.entries()) {
    const raw = found[index + 1]!;
    try {
      variables[name] = decodeURIComponent(raw);
    } catch {
      return null;
    }
  }
  return variables;
}

function capped(values: string[]): CompletionValues {
  const unique = [...new Set(values)];
  return unique.length > MAX_COMPLETION_VALUES
    ? { values: unique.slice(0, MAX_COMPLETION_VALUES), total: unique.length, hasMore: true }
    : { values: unique, total: unique.length, hasMore: false };
}

export class ResourceRegistry {
  private readonly resources = new Map<string, ResourceDefinition>();
  private readonly templates = new Map<string, ResourceTemplateDefinition>();

  register(resource: ResourceDefinition): void {
    if (this.resources.has(resource.uri))
      throw new Error(`Resource "${resource.uri}" is registered twice`);
    this.resources.set(resource.uri, resource);
  }

  registerTemplate(template: ResourceTemplateDefinition): void {
    if (this.templates.has(template.uriTemplate))
      throw new Error(`Resource template "${template.uriTemplate}" is registered twice`);
    this.templates.set(template.uriTemplate, template);
  }

  list(): ListedResource[] {
    return [...this.resources.values()].map(({ read: _read, ...listed }) => listed);
  }

  listTemplates(): ListedResourceTemplate[] {
    return [...this.templates.values()].map(
      ({ read: _read, complete: _complete, ...listed }) => listed
    );
  }

  /** A fixed resource first, then the first template the URI fits, in the order of registration. */
  async read(uri: string, context: ResourceContext): Promise<ResourceContents> {
    const resource = this.resources.get(uri);
    if (resource) {
      const text = await resource.read(context);
      return {
        contents: [{ uri, ...(resource.mimeType ? { mimeType: resource.mimeType } : {}), text }],
      };
    }
    for (const template of this.templates.values()) {
      const variables = matchUriTemplate(template.uriTemplate, uri);
      if (!variables) continue;
      const text = await template.read(variables, context);
      return {
        contents: [{ uri, ...(template.mimeType ? { mimeType: template.mimeType } : {}), text }],
      };
    }
    throw new Error(`Unknown resource "${uri}"`);
  }

  async complete(
    uriTemplate: string,
    request: Pick<CompletionRequest, 'argument' | 'arguments'>,
    context: ResourceContext
  ): Promise<CompletionValues> {
    const template = this.templates.get(uriTemplate);
    if (!template) throw new Error(`Unknown resource template "${uriTemplate}"`);
    const completer = template.complete?.[request.argument.name];
    if (!completer) return capped([]);
    return capped(
      await completer(request.argument.value, { ...context, arguments: request.arguments ?? {} })
    );
  }
}

export interface PromptDefinition extends ListedPrompt {
  /** May read the world through `context`, e.g. to name the game system. */
  build(
    args: Record<string, string>,
    context: ResourceContext
  ): PromptResult | Promise<PromptResult>;
  /** Completers by argument name. */
  complete?: Readonly<Record<string, Completer>>;
}

export class PromptRegistry {
  private readonly prompts = new Map<string, PromptDefinition>();

  register(prompt: PromptDefinition): void {
    if (this.prompts.has(prompt.name))
      throw new Error(`Prompt "${prompt.name}" is registered twice`);
    this.prompts.set(prompt.name, prompt);
  }

  list(): ListedPrompt[] {
    return [...this.prompts.values()].map(
      ({ build: _build, complete: _complete, ...listed }) => listed
    );
  }

  async get(
    name: string,
    args: Record<string, string>,
    context: ResourceContext
  ): Promise<PromptResult> {
    const prompt = this.prompts.get(name);
    if (!prompt) throw new Error(`Unknown prompt "${name}"`);
    const missing = (prompt.arguments ?? [])
      .filter(a => a.required && !args[a.name])
      .map(a => a.name);
    if (missing.length) throw new Error(`The prompt "${name}" needs: ${missing.join(', ')}`);
    return prompt.build(args, context);
  }

  async complete(
    name: string,
    request: Pick<CompletionRequest, 'argument' | 'arguments'>,
    context: ResourceContext
  ): Promise<CompletionValues> {
    const prompt = this.prompts.get(name);
    if (!prompt) throw new Error(`Unknown prompt "${name}"`);
    const completer = prompt.complete?.[request.argument.name];
    if (!completer) return capped([]);
    return capped(
      await completer(request.argument.value, { ...context, arguments: request.arguments ?? {} })
    );
  }
}
