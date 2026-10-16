function parseVec(text) {
    const parts = text.split(',').map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n)))
        return undefined;
    return [parts[0], parts[1], parts[2]];
}
/** Split "a(x=1,y=[1,2]),b" on top-level commas. */
function splitTopLevel(text) {
    const out = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '(' || c === '[' || c === '{')
            depth++;
        else if (c === ')' || c === ']' || c === '}')
            depth--;
        else if (c === ',' && depth === 0) {
            out.push(text.slice(start, i));
            start = i + 1;
        }
    }
    out.push(text.slice(start));
    return out.map((s) => s.trim()).filter(Boolean);
}
function parseParamValue(raw) {
    try {
        return JSON.parse(raw);
    }
    catch {
        return undefined;
    }
}
/** Parse "spin(axis=[0,1,0],speed=90),bob[off]" (params past the summary's cap are lost). */
function parseBehaviors(text) {
    const out = [];
    for (const item of splitTopLevel(text)) {
        const m = /^([A-Za-z]+)(?:\((.*)\))?(\[off\])?$/.exec(item);
        if (!m)
            continue;
        const params = {};
        for (const kv of splitTopLevel(m[2] ?? '')) {
            const eq = kv.indexOf('=');
            if (eq <= 0)
                continue;
            const key = kv.slice(0, eq);
            if (key === '__proto__' || key === 'constructor' || key === 'prototype')
                continue;
            const value = parseParamValue(kv.slice(eq + 1));
            if (value !== undefined)
                params[key] = value;
        }
        out.push({ type: m[1], params, enabled: m[3] === undefined });
    }
    return out;
}
function parseShape(text, e) {
    e.shape = text;
    let m = /^gen:([a-z0-9-]+)/.exec(text);
    if (m) {
        e.generator = m[1];
        e.shape = 'procedural';
        return;
    }
    m = /^scatter \d+x (?:gen:([a-z0-9-]+)|(\w+))/.exec(text);
    if (m) {
        e.shape = 'scatter';
        if (m[1])
            e.generator = m[1];
        else if (m[2])
            e.primitive = m[2];
        return;
    }
    m = /^(box|sphere|cylinder|cone|capsule|torus|plane)\b(.*)$/.exec(text);
    if (m) {
        e.primitive = m[1];
        e.shape = 'primitive';
        const rest = m[2] ?? '';
        const box = /(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/.exec(rest);
        const h = /h=(\d+(?:\.\d+)?)/.exec(rest);
        const d = /d=(\d+(?:\.\d+)?)/.exec(rest);
        if (box)
            e.height = Number(box[2]);
        else if (h)
            e.height = Number(h[1]);
        else if (d && e.primitive === 'sphere')
            e.height = Number(d[1]);
    }
}
function parseNpc(text) {
    const m = /^npc (?:"((?:[^"\\]|\\.)*)"|-)((?: [a-z]+=\S+)*)/.exec(text);
    if (!m)
        return undefined;
    const kv = new Map();
    for (const [, k, v] of (m[2] ?? '').matchAll(/ ([a-z]+)=(\S+)/g))
        kv.set(k, v);
    const num = (k, d) => {
        const v = Number(kv.get(k));
        return Number.isFinite(v) && kv.has(k) ? v : d;
    };
    const list = (k) => (kv.get(k) ?? '').split('/').filter(Boolean);
    const view = {
        role: m[1] ?? '',
        archetype: kv.get('arch') ?? 'villager',
        faction: kv.get('fac') ?? 'neutral',
        speed: num('spd', 1.5),
        runSpeed: num('run', 4.2),
        health: num('hp', 100),
        sight: num('sight', 14),
        fov: num('fov', 110),
        hearing: num('hear', 7),
        waypoints: num('wp', 0),
        wander: num('wander', 0),
        dialogueNodes: num('dlg', 0),
        chat: / chat(?: |$)/.test(text),
        foes: list('foes'),
        allies: list('allies'),
        fears: list('fears'),
        carries: list('carries'),
    };
    if (kv.has('dmg'))
        view.damage = num('dmg', 0);
    const hours = kv.get('hours');
    if (hours)
        view.hours = hours;
    return view;
}
function parseEntityLine(line) {
    const depth = Math.floor((line.length - line.trimStart().length) / 2);
    const parts = line.trim().split(' | ');
    const id = parts[0];
    if (!id || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id) || parts.length < 4)
        return null;
    const e = { id, name: parts[1] === '-' ? '' : (parts[1] ?? ''), shape: '', pos: [0, 0, 0], scale: 1, sensor: false, behaviors: [], tags: [], hasLight: false, template: false, depth, locked: false };
    parseShape(parts[2] ?? '', e);
    for (const part of parts.slice(3)) {
        if (part.startsWith('pos '))
            e.pos = parseVec(part.slice(4)) ?? e.pos;
        else if (part.startsWith('scale ')) {
            const s = part.slice(6);
            const v = s.includes(',') ? parseVec(s) : undefined;
            e.scale = v ? Math.max(v[0], v[1], v[2]) : Number(s) || 1;
        }
        else if (/^(static|dynamic|kinematic)\b/.test(part)) {
            e.body = part.split(' ')[0];
            e.sensor = part.includes('sensor');
            const m = /m=(\d+(?:\.\d+)?)/.exec(part);
            if (m)
                e.mass = Number(m[1]);
        }
        else if (part.startsWith('npc ')) {
            const npc = parseNpc(part);
            if (npc)
                e.npc = npc;
        }
        else if (part.startsWith('behaviors '))
            e.behaviors = parseBehaviors(part.slice(10));
        else if (part.startsWith('tags '))
            e.tags = part.slice(5).split(',').filter(Boolean);
        else if (part.startsWith('mat ')) {
            const m = /#[0-9a-fA-F]{6}/.exec(part);
            if (m)
                e.color = m[0];
        }
        else if (part.startsWith('light '))
            e.hasLight = true;
        else if (part.startsWith('user-edited('))
            e.userEditedAge = part.includes('just now') ? 0 : 1;
        else {
            const words = part.split(' ');
            if (words.includes('template'))
                e.template = true;
            if (part.includes('locked('))
                e.locked = true;
        }
    }
    return e;
}
/** Parse a world summary; an empty string yields an empty world. */
export function parseWorldSummary(summary) {
    const view = { entityCount: 0, entities: [], elided: false, stateKeys: [], hud: [], ruleIds: [], testIds: [], hasGround: true, recentEdits: [] };
    let section = 'head';
    for (const line of summary.split('\n')) {
        const t = line.trim();
        if (t === 'entities:') {
            section = 'entities';
            continue;
        }
        if (t === 'rules:') {
            section = 'rules';
            continue;
        }
        if (t === 'tests:') {
            section = 'tests';
            continue;
        }
        const recent = /^user recently edited by hand \(newest first\): ([^—]+)/.exec(t);
        if (recent) {
            view.recentEdits = recent[1].split(',').map((s) => s.trim()).filter((s) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(s));
            continue;
        }
        if (section === 'head') {
            const count = /^world .* entities=(\d+)/.exec(t);
            if (count)
                view.entityCount = Number(count[1]);
            else if (t.startsWith('env ')) {
                view.sky = /sky=(\w+)/.exec(t)?.[1];
                view.weather = /weather=(\w+)/.exec(t)?.[1];
                view.hasGround = !t.includes('ground=none');
            }
            else if (t.startsWith('state ')) {
                for (const m of t.slice(6).matchAll(/(?:^|\s)([^\s=]+)=/g))
                    view.stateKeys.push(m[1]);
            }
            else if (t.startsWith('hud ')) {
                for (const m of t.slice(4).matchAll(/([^\s:]+):"((?:[^"\\]|\\.)*)"/g))
                    view.hud.push({ key: m[1], label: m[2] });
            }
        }
        else if (section === 'entities') {
            if (t.startsWith('... '))
                view.elided = true;
            else {
                const e = parseEntityLine(line);
                if (e)
                    view.entities.push(e);
            }
        }
        else if (section === 'rules') {
            const m = /^rule ([^:]+):/.exec(t);
            if (m)
                view.ruleIds.push(m[1]);
        }
        else {
            const m = /^test ([^:]+):/.exec(t);
            if (m)
                view.testIds.push(m[1]);
        }
    }
    if (view.entityCount === 0)
        view.entityCount = view.entities.length;
    return view;
}
