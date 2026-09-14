# Offering AI tools from your own Foundry module

Ninjo's Foundry MCP connects an AI assistant to a Foundry world. Your module can
add tools of its own. The assistant sees them next to the built-in ones, and your
module keeps running them: your rules, your data, your code.

## Registering

Two ways, both stable.

**Hook**, subscribed at the top level of your script (not inside your own `init`,
or you may miss the call when your module loads after this one):

```js
Hooks.on('ninjos-foundry-mcp.registerTools', register => {
  const result = register('my-module', {
    name: 'shop-stock-item',
    description: 'Put an item into a shop at a given price.',
    inputSchema: {
      type: 'object',
      properties: {
        shop: { type: 'string', description: 'Shop name or id' },
        item: { type: 'string' },
        price: { type: 'number' },
      },
      required: ['shop', 'item', 'price'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
    timeoutMs: 60000,
    handler: async (args, context) => {
      context.progress(1, 2, 'Looking up the item');
      // ... your code ...
      return `Stocked ${args.item} in ${args.shop} for ${args.price} gp.`;
    },
  });
  if (!result.accepted) console.warn(result.reason);
});
```

The hook is sent at `init` and once more at `ready`. Registering the same name
again from the same module replaces the earlier definition.

**API**, at any time after `init`:

```js
game.modules.get('ninjos-foundry-mcp').api.registerTool('my-module', definition);
```

## The definition

| Field         | Required | Meaning                                                                                  |
| ------------- | -------- | ---------------------------------------------------------------------------------------- |
| `name`        | yes      | Tool name as the assistant sees it. Use a prefix of your module.                         |
| `description` | yes      | When to use the tool. Without it the assistant cannot tell what the tool is for.         |
| `inputSchema` | no       | JSON Schema of the arguments. Arguments are checked against it before your handler runs. |
| `annotations` | no       | MCP hints. **Without `readOnlyHint: true` the tool counts as writing** (see below).      |
| `timeoutMs`   | no       | How long your handler may take. Default 25 seconds, at most 10 minutes.                  |
| `handler`     | yes      | `(args, context) => result`, may be async. `context.progress(done, total?, message?)`.   |

**Result:** a string is passed to the assistant as it is; anything else is sent as
indented JSON. **Throw** to report a failure: the assistant receives
`Third-party tool failed: <your message>`, marked as an error.

## What the GM controls

1. **Release.** Only modules listed under _Permissions · Modules with their own
   tools_ may register, and none is listed by default. The list is checked on every
   call and every listing: taking your module off the list blocks it immediately.
2. **Write switch.** With _Allow Write Operations_ off, only tools that declare
   `readOnlyHint: true` run. Declare it honestly: the permission matrix of this
   module does not reach into your handler, so the switch is the GM's only brake.
3. **Gamemaster only.** Tools run in the browser of the Gamemaster connected to the
   bridge. If that browser is closed, your tools are not offered.

## Refusals

`registerTool` returns `{ accepted: true }` or `{ accepted: false, reason }`, and
logs every refusal to the console with name, module and reason:

- the id of the registering module is missing
- the name is missing
- a handler is missing
- a description is missing
- the module is not released
- the name belongs to Ninjo's Foundry MCP (including tools planned for later versions)
- the name is already registered by another module

## When the assistant sees new tools

The server asks for extension tools every time a client requests the tool list.
When a client requests it is up to the client; a tool registered late may only
appear in the next session.
