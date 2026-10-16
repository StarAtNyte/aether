import { colorName } from './lexicon';
export { diffLineText } from './diff-text';
const HEX = /^#[0-9a-f]{6}$/i;
function round(n) {
    return String(Math.round(n * 100) / 100);
}
function short(v) {
    if (v === undefined)
        return undefined;
    if (typeof v === 'number')
        return round(v);
    if (typeof v === 'string')
        return HEX.test(v) ? colorName(v) : v.length > 28 ? `${v.slice(0, 27)}…` : v;
    if (typeof v === 'boolean')
        return v ? 'on' : 'off';
    if (v === null)
        return 'none';
    if (Array.isArray(v))
        return v.every((x) => typeof x === 'number') ? `(${v.map((x) => round(x)).join(', ')})` : `${v.length} items`;
    return '…';
}
const WORDS = [
    [/(^|\.)(color|accent|tint)$/i, 'colour'],
    [/^material\.color$/, 'colour'],
    [/^light\.color$/, 'light colour'],
    [/^light\.intensity$/, 'brightness'],
    [/^material\.(finish|preset)$/, 'material'],
    [/^material\.roughness$/, 'glossiness'],
    [/finishA\.color$|finishB\.color$/, 'wall colour'],
    [/finishA\.finish$|finishB\.finish$/, 'wall finish'],
    [/params\.finish\.color$/, 'colour'],
    [/params\.finish\.finish$/, 'finish'],
    [/^transform\.position$/, 'position'],
    [/^transform\.rotation$/, 'rotation'],
    [/^transform\.scale$/, 'size'],
    [/^shape\.params\.upholstery$/, 'upholstery'],
    [/^shape\.params\.legs$/, 'legs'],
    [/^shape\.params\.(width|height|depth|length|radius|size|thickness)$/, '$1'],
    [/^behaviors\.\d+\.params\.speed$/, 'speed'],
    [/^behaviors\.\d+\.params\.maxSpeed$/, 'top speed'],
    [/^behaviors\.\d+\.params\.period$/, 'bob period'],
    [/^behaviors\.\d+\.params\.lines$/, 'dialogue'],
    [/^behaviors\.\d+\.params\.swingAngle$/, 'swing angle'],
    [/^behaviors\.\d+\.params\.startOpen$/, 'starts open'],
    [/^behaviors\.\d+\.params\.hinge$/, 'hinge side'],
    [/^behaviors\.\d+\.params\.name$/, 'character name'],
    [/^behaviors\.\d+\.enabled$/, 'enabled'],
    [/^physics\.restitution$/, 'bounciness'],
    [/^physics\.mass$/, 'mass'],
    [/^physics\.friction$/, 'friction'],
    [/^physics\.body$/, 'body'],
    [/^visible$/, 'visibility'],
    [/^name$/, 'name'],
];
function propertyName(path) {
    for (const [re, name] of WORDS) {
        const m = re.exec(path);
        if (m)
            return name.replace('$1', m[1] ?? '');
    }
    const last = path.startsWith('shape.params.') ? path.slice('shape.params.'.length) : path.split('.').slice(-2).join(' ');
    return last.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\./g, ' ').toLowerCase();
}
function isColorChange(c) {
    return typeof c.to === 'string' && HEX.test(c.to) && (c.from === undefined || (typeof c.from === 'string' && HEX.test(c.from)));
}
/** The diff lines of a set of changes (at most `max`, entity changes grouped by entity). */
export function describeChanges(before, after, changes, max = 10) {
    const lines = [];
    const label = (id) => {
        const e = after.entities[id] ?? before.entities[id];
        if (e?.name)
            return e.name;
        if (e?.arch?.name)
            return e.arch.name;
        const h = id.replace(/[-_]+/g, ' ').trim();
        return h.charAt(0).toUpperCase() + h.slice(1);
    };
    const seenOverride = new Set();
    for (const c of changes) {
        if (c.scope === 'entity') {
            const subject = label(c.id);
            if (c.path === '') {
                lines.push({ id: c.id, subject, property: c.kind === 'add' ? 'added' : 'removed', kind: c.kind === 'add' ? 'add' : 'remove' });
                continue;
            }
            // Bookkeeping that mirrors a visible change.
            if (c.path.startsWith('arch.')) {
                if (!seenOverride.has(c.id))
                    seenOverride.add(c.id);
                continue;
            }
            if (c.path.startsWith('state.lightOffFrom'))
                continue;
            const colorLike = isColorChange(c);
            const prop = propertyName(c.path);
            lines.push({
                id: c.id,
                subject,
                property: colorLike && !/colou?r/.test(prop) ? `${prop} colour` : prop,
                ...(c.from !== undefined ? { from: short(c.from) } : {}),
                ...(c.to !== undefined ? { to: short(c.to) } : {}),
                ...(colorLike && typeof c.from === 'string' ? { fromColor: c.from } : {}),
                ...(colorLike && typeof c.to === 'string' ? { toColor: c.to } : {}),
                kind: 'change',
            });
        }
        else if (c.scope === 'environment') {
            lines.push({ id: '', subject: 'World', property: c.path.replace(/\./g, ' '), ...(c.from !== undefined ? { from: short(c.from) } : {}), ...(c.to !== undefined ? { to: short(c.to) } : {}), ...(isColorChange(c) ? { toColor: c.to, ...(typeof c.from === 'string' ? { fromColor: c.from } : {}) } : {}), kind: 'change' });
        }
        else if (c.scope === 'player') {
            lines.push({ id: '', subject: 'Player', property: propertyName(c.path) || c.path, ...(c.from !== undefined ? { from: short(c.from) } : {}), ...(c.to !== undefined ? { to: short(c.to) } : {}), kind: 'change' });
        }
        else if (c.scope === 'rule' || c.scope === 'state' || c.scope === 'hud' || c.scope === 'test' || c.scope === 'meta' || c.scope === 'voxel') {
            const subject = c.scope === 'rule' ? `Rule ${c.id}` : c.scope === 'state' ? 'Game' : c.scope === 'hud' ? 'HUD' : c.scope === 'voxel' ? 'Blocks' : c.scope === 'test' ? 'Test' : 'World';
            lines.push({ id: '', subject, property: (c.path || c.scope).replace(/\./g, ' ').slice(0, 40), ...(c.from !== undefined && c.path !== '' ? { from: short(c.from) } : {}), ...(c.to !== undefined && c.path !== '' ? { to: short(c.to) } : {}), kind: c.kind === 'add' && c.path === '' ? 'add' : 'change' });
        }
    }
    // Two shades with the same name read as no change: show the values.
    for (const l of lines) {
        if (l.fromColor && l.toColor && l.from === l.to) {
            l.from = l.fromColor;
            l.to = l.toColor;
        }
    }
    // Merge several entity lines with identical text ("Chair · colour" ×8).
    const merged = [];
    for (const l of lines) {
        const twin = merged.find((m) => m.subject === l.subject && m.property === l.property && m.from === l.from && m.to === l.to && m.kind === l.kind && l.id !== '' && m.n !== undefined);
        if (twin)
            twin.n++;
        else
            merged.push(l.id !== '' ? Object.assign({ ...l }, { n: 1 }) : l);
    }
    const out = merged.slice(0, max).map((l) => {
        const n = l.n;
        if (n && n > 1)
            return { ...l, subject: `${l.subject} ×${n}` };
        return l;
    });
    if (merged.length > max)
        out.push({ id: '', subject: `+${merged.length - max} more`, property: '', kind: 'change' });
    return out;
}
