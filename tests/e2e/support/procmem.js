/**
 * Process memory sampling for the memory e2e: finds the browser processes
 * started by this test (descendants of the test process, minus the Node
 * server subtree) and reads their proportional set size (PSS) from
 * `/proc/<pid>/smaps_rollup`. PSS splits shared pages between processes, so
 * the sum is the real footprint of a multi-process browser; RSS (from `ps`)
 * is the fallback where smaps is unavailable.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
/** Parse `ps -eo pid=,ppid=,rss=,comm=,args=` output. Malformed lines are skipped. */
export function parsePs(text) {
    const rows = [];
    for (const line of text.split('\n')) {
        const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/.exec(line);
        if (!m)
            continue;
        rows.push({ pid: Number(m[1]), ppid: Number(m[2]), rssKb: Number(m[3]), comm: m[4] ?? '', args: (m[5] ?? '').slice(0, 2000) });
    }
    return rows;
}
/**
 * Descendants of `rootPid`, skipping whole subtrees rooted at a Node
 * process (the test server and its `tsx` children).
 */
export function browserDescendants(rows, rootPid) {
    const children = new Map();
    for (const r of rows) {
        const list = children.get(r.ppid);
        if (list)
            list.push(r);
        else
            children.set(r.ppid, [r]);
    }
    const out = [];
    const stack = [...(children.get(rootPid) ?? [])];
    while (stack.length > 0) {
        const r = stack.pop();
        if (r.comm === 'node' || /(^|\/)node(\s|$)/.test(r.args.split(' ')[0] ?? ''))
            continue;
        out.push(r);
        for (const c of children.get(r.pid) ?? [])
            stack.push(c);
    }
    return out;
}
/** Role of a browser process from its command line. */
export function processRole(args) {
    const type = /--type=([\w-]+)/.exec(args)?.[1];
    if (type)
        return type === 'gpu-process' ? 'gpu' : type;
    if (/-contentproc/.test(args)) {
        if (/\btab\b/.test(args) || /-isForBrowser/.test(args))
            return 'tab';
        const kind = /\s(\w+)\s*$/.exec(args)?.[1];
        return kind ?? 'content';
    }
    return 'main';
}
/** Parse the `Pss:` line of a smaps_rollup file into kB (null when missing). */
export function parsePssKb(smapsRollup) {
    const m = /^Pss:\s+(\d+)\s+kB/m.exec(smapsRollup);
    return m ? Number(m[1]) : null;
}
function pssMb(pid, rssKb) {
    try {
        const kb = parsePssKb(readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8'));
        if (kb !== null)
            return kb / 1024;
    }
    catch {
        // process gone or smaps unavailable (non-Linux): fall back to RSS
    }
    return rssKb / 1024;
}
/** Sample the memory of every browser process started by this test process. */
export function sampleBrowserMemory(rootPid = process.pid) {
    const text = execFileSync('ps', ['-eo', 'pid=,ppid=,rss=,comm=,args='], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 10_000 });
    const procs = browserDescendants(parsePs(text), rootPid).map((r) => ({ pid: r.pid, role: processRole(r.args), mb: pssMb(r.pid, r.rssKb) }));
    let totalMb = 0;
    let tabMb = 0;
    let gpuMb = 0;
    for (const p of procs) {
        totalMb += p.mb;
        if ((p.role === 'renderer' || p.role === 'tab') && p.mb > tabMb)
            tabMb = p.mb;
        if (p.role === 'gpu')
            gpuMb += p.mb;
    }
    return { totalMb, tabMb, gpuMb, processes: procs.sort((a, b) => b.mb - a.mb) };
}
