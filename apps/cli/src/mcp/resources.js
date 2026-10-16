import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Patch, WorldDoc } from '@aether/core';
import { z } from 'zod';
import { MCP_LIMITS } from './limits';
/** The authoring guide shown as a resource. */
export const GUIDE = `# Driving Aether

Aether turns plain language into a World IR: entities (shape, transform, material, physics, behaviors), rules (when / if / then), tests and state. Everything changes through patches, so every step is validated and undoable.

Loop: create_world (or edit) -> verify -> playtest -> fix with edit or apply_patch -> render_still -> export.

- verify forks the physics world headless and fast-forwards it: tests like {"kind":"reaches"} and {"kind":"eventually"} are physics unit tests.
- A good world has tests for its main promise (the ball reaches the goal, the door opens, the tower stays up).
- Ids are lowercase slugs ("red-car"). Positions are metres, y is up. Rotations are degrees.
- Selectors: an entity id, "#tag", "player" or "*".
- Read aether://schema/patch before writing patches by hand.
`;
function schemaText(schema) {
    const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any', cycles: 'ref', reused: 'inline' });
    const text = JSON.stringify(json);
    return text.length > MCP_LIMITS.MAX_WORLD_BYTES ? JSON.stringify({ error: 'schema too large' }) : text;
}
/** Register every resource on `server`. */
export function registerResources(server, session) {
    const json = (uri, body) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: body }] });
    const plain = (uri, body, mimeType = 'text/plain') => ({ contents: [{ uri: uri.href, mimeType, text: body }] });
    server.registerResource('world', 'aether://world/current', { title: 'Current World IR', description: 'The whole world as JSON, exactly as the studio would save it.', mimeType: 'application/json' }, (uri) => json(uri, session.worldJson()));
    server.registerResource('world-summary', 'aether://world/summary', { title: 'World summary', description: 'Compact text summary of the world (what the planner reads).', mimeType: 'text/plain' }, (uri) => plain(uri, session.summary()));
    let worldSchema;
    server.registerResource('schema-world', 'aether://schema/world', { title: 'World IR JSON Schema', description: 'JSON Schema of a whole world document.', mimeType: 'application/json' }, (uri) => json(uri, (worldSchema ??= schemaText(WorldDoc))));
    let patchSchema;
    server.registerResource('schema-patch', 'aether://schema/patch', { title: 'Patch JSON Schema', description: 'JSON Schema of one patch (every op and its fields), for apply_patch.', mimeType: 'application/json' }, (uri) => json(uri, (patchSchema ??= schemaText(Patch))));
    server.registerResource('guide', 'aether://guide', { title: 'Authoring guide', description: 'How to drive Aether: the loop, conventions, selectors.', mimeType: 'text/markdown' }, (uri) => plain(uri, GUIDE, 'text/markdown'));
    server.registerResource('entity', new ResourceTemplate('aether://entity/{id}', {
        list: () => ({
            resources: Object.keys(session.world.entities)
                .slice(0, MCP_LIMITS.MAX_LIST)
                .map((id) => ({ uri: `aether://entity/${id}`, name: session.world.entities[id]?.name || id, mimeType: 'application/json' })),
        }),
    }), { title: 'Entity', description: 'One entity of the world as JSON.', mimeType: 'application/json' }, (uri, variables) => {
        const id = Array.isArray(variables['id']) ? variables['id'][0] : variables['id'];
        return json(uri, JSON.stringify(session.getEntity(String(id ?? '').slice(0, 64)), null, 2));
    });
}
