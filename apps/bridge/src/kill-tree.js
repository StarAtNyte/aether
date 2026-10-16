/**
 * Terminate a process together with everything it started.
 *
 * POSIX: the process was spawned `detached`, so it leads its own process
 * group; signalling `-pid` reaches the whole group (a Codex / Claude Code CLI
 * and anything it launched). Windows has no process groups or POSIX signals:
 * `process.kill` there ends only the one process and would orphan the CLI it
 * started, so the tree is ended with `taskkill /T /F` (argument array, no
 * shell). Never throws.
 */
import { spawn } from 'node:child_process';
/** The plan for `pid` (pure). */
export function killTreePlan(pid, signal, platform) {
    if (!Number.isSafeInteger(pid) || pid <= 0)
        return null;
    // taskkill cannot deliver a polite signal to a console process; /F is the only reliable form.
    if (platform === 'win32')
        return { kind: 'taskkill', command: 'taskkill', args: ['/PID', String(pid), '/T', '/F'] };
    return { kind: 'group', pid, signal };
}
/**
 * End `pid` and its descendants. On POSIX the group is signalled, falling
 * back to the single process when it does not lead a group.
 */
export function killTree(pid, signal, deps = {}) {
    const plan = killTreePlan(pid, signal, deps.platform ?? process.platform);
    if (!plan)
        return;
    const kill = deps.kill ?? ((p, s) => void process.kill(p, s));
    if (plan.kind === 'taskkill') {
        try {
            const child = (deps.spawn ?? spawn)(plan.command, plan.args, { shell: false, windowsHide: true, stdio: 'ignore' });
            child.once('error', () => {
                try {
                    kill(pid, signal);
                }
                catch {
                    /* already gone */
                }
            });
            child.unref();
        }
        catch {
            try {
                kill(pid, signal);
            }
            catch {
                /* already gone */
            }
        }
        return;
    }
    try {
        kill(-plan.pid, plan.signal);
    }
    catch {
        try {
            kill(plan.pid, plan.signal);
        }
        catch {
            /* already gone */
        }
    }
}
