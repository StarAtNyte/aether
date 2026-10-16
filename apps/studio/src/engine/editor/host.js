/** Short display name of an entity for history messages. */
export function label(host, id) {
    const e = Object.prototype.hasOwnProperty.call(host.history.current.entities, id) ? host.history.current.entities[id] : undefined;
    return (e?.name || id).slice(0, 60);
}
