/**
 * Cross-platform process handling: Windows batch shims, PATHEXT lookup,
 * SDK executables and process-tree termination (regressions for Windows,
 * where `.cmd` shims cannot be spawned directly and `process.kill` does not
 * reach a worker's children).
 */
import { EventEmitter } from 'node:events';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { commandPlan, isBatchShim, killTree, killTreePlan, sdkExecutable } from '../src/index';
import { which, windowsExtensions } from '../src/which';
describe('commandPlan', () => {
    it('runs a Windows .cmd shim through cmd.exe with quoted fixed arguments', () => {
        const plan = commandPlan('C:\\npm\\codex.cmd', ['login', '--device-auth'], 'win32', 'C:\\Windows\\system32\\cmd.exe');
        expect(plan).toEqual({ command: 'C:\\Windows\\system32\\cmd.exe', args: ['/d', '/s', '/c', '""C:\\npm\\codex.cmd" "login" "--device-auth""'], verbatim: true });
    });
    it('rejects cmd.exe metacharacters instead of escaping them', () => {
        for (const bad of ['a&calc', 'x|y', '%PATH%', 'a"b', 'a^b', 'a<b', 'a\nb'])
            expect(() => commandPlan('C:\\npm\\codex.BAT', [bad], 'win32')).toThrow(/unsafe/);
    });
    it('runs executables directly', () => {
        expect(commandPlan('/usr/bin/codex', ['login'], 'linux')).toEqual({ command: '/usr/bin/codex', args: ['login'], verbatim: false });
        expect(commandPlan('C:\\bin\\codex.exe', ['login'], 'win32').verbatim).toBe(false);
        // A .cmd name means nothing special off Windows.
        expect(commandPlan('/tmp/x.cmd', ['a&b'], 'linux').command).toBe('/tmp/x.cmd');
    });
    it('detects batch shims case-insensitively', () => {
        expect(isBatchShim('C:\\a\\Codex.CMD')).toBe(true);
        expect(isBatchShim('C:\\a\\codex.exe')).toBe(false);
    });
});
describe('sdkExecutable', () => {
    it('lets the SDK use its bundled binary instead of a Windows batch shim', () => {
        expect(sdkExecutable('C:\\npm\\codex.cmd', 'win32')).toBeUndefined();
        expect(sdkExecutable('C:\\bin\\codex.exe', 'win32')).toBe('C:\\bin\\codex.exe');
        expect(sdkExecutable('/usr/local/bin/codex', 'linux')).toBe('/usr/local/bin/codex');
        expect(sdkExecutable(null, 'linux')).toBeUndefined();
    });
});
describe('which on Windows', () => {
    it('only tries PATHEXT extensions for a bare name (npm also writes an unrunnable sh shim)', () => {
        expect(windowsExtensions('codex', { PATHEXT: '.COM;.EXE;.BAT;.CMD' }, 'win32')).toEqual(['.com', '.exe', '.bat', '.cmd']);
        expect(windowsExtensions('codex.cmd', { PATHEXT: '.EXE;.CMD' }, 'win32')).toEqual(['']);
        expect(windowsExtensions('codex', {}, 'linux')).toEqual(['']);
        // Garbage entries are ignored.
        expect(windowsExtensions('codex', { PATHEXT: '.EXE;;evil;.CMD' }, 'win32')).toEqual(['.exe', '.cmd']);
    });
    let dir = '';
    afterEach(() => {
        if (dir)
            rmSync(dir, { recursive: true, force: true });
        dir = '';
    });
    it('resolves the .cmd shim, not the extensionless sh script beside it', () => {
        dir = mkdtempSync(join(tmpdir(), 'aether-which-'));
        const bin = join(dir, 'bin');
        mkdirSync(bin);
        for (const f of ['codex', 'codex.cmd']) {
            writeFileSync(join(bin, f), 'x');
            chmodSync(join(bin, f), 0o755);
        }
        expect(which('codex', { PATH: bin, PATHEXT: '.EXE;.CMD' }, 'win32')).toBe(join(bin, 'codex.cmd'));
        expect(which('codex', { PATH: bin }, 'linux')).toBe(join(bin, 'codex'));
    });
});
describe('killTree', () => {
    it('signals the POSIX process group, falling back to the process', () => {
        const calls = [];
        killTree(4242, 'SIGTERM', {
            platform: 'linux',
            kill: (pid, sig) => {
                calls.push([pid, sig]);
                if (pid < 0)
                    throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
            },
        });
        expect(calls).toEqual([
            [-4242, 'SIGTERM'],
            [4242, 'SIGTERM'],
        ]);
    });
    it('ends the whole tree with taskkill on Windows (argument array, no shell)', () => {
        const spawned = [];
        const kills = [];
        killTree(77, 'SIGTERM', {
            platform: 'win32',
            kill: (pid) => void kills.push(pid),
            spawn: (command, args, options) => {
                spawned.push({ command, args, shell: options.shell });
                const fake = new EventEmitter();
                fake.unref = () => undefined;
                return fake;
            },
        });
        expect(spawned).toEqual([{ command: 'taskkill', args: ['/PID', '77', '/T', '/F'], shell: false }]);
        expect(kills).toEqual([]);
    });
    it('falls back to process.kill when taskkill cannot start', () => {
        const kills = [];
        killTree(78, 'SIGKILL', {
            platform: 'win32',
            kill: (pid) => void kills.push(pid),
            spawn: () => {
                throw new Error('ENOENT');
            },
        });
        expect(kills).toEqual([78]);
    });
    it('ignores invalid pids (never signals group 0 or -1)', () => {
        expect(killTreePlan(0, 'SIGTERM', 'linux')).toBeNull();
        expect(killTreePlan(-1, 'SIGTERM', 'linux')).toBeNull();
        expect(killTreePlan(1.5, 'SIGTERM', 'linux')).toBeNull();
        const calls = [];
        killTree(0, 'SIGKILL', { platform: 'linux', kill: (p) => void calls.push(p) });
        expect(calls).toEqual([]);
    });
});
