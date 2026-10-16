/** Caps of {@link summarizeReport}. */
export const REPORT_LIMITS = Object.freeze({ MAX_TESTS: 40, MAX_DIAGNOSTICS: 20, MAX_MESSAGE: 300 });
const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 };
function clip(s) {
    const flat = s.replace(/\s+/g, ' ').trim();
    return flat.length > REPORT_LIMITS.MAX_MESSAGE ? `${flat.slice(0, REPORT_LIMITS.MAX_MESSAGE - 1)}…` : flat;
}
/** Text summary of a verification report (a few hundred tokens at most). */
export function summarizeReport(report) {
    const total = report.results.length;
    const ok = report.results.filter((r) => r.passed).length;
    const errors = report.diagnostics.filter((d) => d.severity === 'error').length;
    const lines = [];
    const head = total > 0 ? `${ok}/${total} tests passed` : 'no tests';
    lines.push(`PHYSICS VERIFY ${report.passed ? 'PASS' : 'FAIL'}: ${head}, ${errors} error diagnostic(s); simulated ${report.simulatedSeconds.toFixed(1)}s in ${Math.round(report.ms)}ms`);
    const ordered = [...report.results].sort((a, b) => Number(a.passed) - Number(b.passed));
    for (const r of ordered.slice(0, REPORT_LIMITS.MAX_TESTS)) {
        lines.push(`${r.passed ? 'ok  ' : 'FAIL'} ${clip(r.id)} (${r.kind}): ${clip(r.message)}`);
    }
    if (ordered.length > REPORT_LIMITS.MAX_TESTS)
        lines.push(`… ${ordered.length - REPORT_LIMITS.MAX_TESTS} more tests`);
    if (report.diagnostics.length > 0) {
        const diags = [...report.diagnostics].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
        lines.push(`Diagnostics (${diags.length}):`);
        for (const d of diags.slice(0, REPORT_LIMITS.MAX_DIAGNOSTICS)) {
            lines.push(`- ${d.severity} ${d.code}: ${clip(d.message)}${d.suggestion ? ` -> fix: ${clip(d.suggestion)}` : ''}`);
        }
        if (diags.length > REPORT_LIMITS.MAX_DIAGNOSTICS)
            lines.push(`… ${diags.length - REPORT_LIMITS.MAX_DIAGNOSTICS} more diagnostics`);
    }
    return lines.join('\n');
}
