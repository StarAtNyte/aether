/**
 * `npm run bridge` — start the Aether Bridge and print how to pair.
 * Prints the pairing code and a one-click deep link (the token travels in the
 * URL fragment, which browsers never send to any server).
 */
import { parseBridgeConfig, USAGE } from './config';
import { startBridge } from './start';
import { probeClaude, probeCodex } from './backends/status';
import { resolveCommands } from './headless';
function stamp() {
    return new Date().toISOString().slice(11, 19);
}
async function main() {
    let config;
    try {
        config = parseBridgeConfig(process.argv.slice(2));
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        process.stderr.write(`${msg === 'usage' ? '' : `${msg}\n\n`}${USAGE}\n`);
        process.exitCode = msg === 'usage' ? 0 : 2;
        return;
    }
    const logger = {
        info: (msg, f) => process.stdout.write(`${stamp()} ${msg}${f ? ` ${JSON.stringify(f)}` : ''}\n`),
        warn: (msg, f) => process.stderr.write(`${stamp()} WARN ${msg}${f ? ` ${JSON.stringify(f)}` : ''}\n`),
    };
    const bridge = await startBridge(config, { logger, onCode: (code) => process.stdout.write(`\n  New pairing code: ${code}\n\n`) });
    const deepToken = bridge.pairing.issue();
    const link = `${config.studioUrl}/?bridge=${encodeURIComponent(bridge.url)}#aether-bridge=${deepToken}`;
    const commands = resolveCommands({ codexPath: config.codexPath, claudePath: config.claudePath });
    const [codex, claude] = await Promise.all([probeCodex({ codexCommand: commands.codex, claudeCommand: null }), probeClaude({ codexCommand: null, claudeCommand: commands.claude })]);
    process.stdout.write([
        '',
        '  Aether Bridge',
        `  Listening on ${bridge.url} (this computer only)`,
        '',
        `  Codex:        ${codex.loggedIn ? 'ready' : 'unavailable'} — ${codex.detail}`,
        `  Claude Code:  ${claude.loggedIn ? 'ready' : 'unavailable'} — ${claude.detail}`,
        '',
        `  Pairing code: ${bridge.pairing.currentCode}`,
        '  In the studio: Settings → AI connection → Local bridge, then enter the code.',
        `  Or open: ${link}`,
        '',
        `  Allowed studio origins: ${config.origins.join(', ')}`,
        '  Press Ctrl+C to stop.',
        '',
    ].join('\n'));
    const stop = () => {
        void bridge.close().then(() => process.exit(0));
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
}
void main().catch((e) => {
    process.stderr.write(`Aether Bridge failed to start: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
});
