/**
 * Interface theme (light by default, dark on request). The palette lives in
 * CSS (`:root` and `:root[data-theme='dark']` in styles/tokens.css); this module
 * only flips the switch on the document and keeps the browser chrome in step
 * (`color-scheme`, `<meta name="theme-color">`). DOM access goes through a
 * tiny structural interface so it is testable without a browser.
 */
/** Browser-chrome color for each theme (matches `--surface`, the top bar, in styles/tokens.css). */
export const THEME_COLORS = Object.freeze({
    light: '#ffffff',
    dark: '#1f2022',
});
/** Theme name for the persisted `darkTheme` setting. */
export function themeFromSetting(darkTheme) {
    return darkTheme ? 'dark' : 'light';
}
/**
 * Apply a theme to the document: `data-theme` on `<html>`, the CSS
 * `color-scheme` (native form controls, scrollbars) and the meta tags the
 * browser uses for its own chrome. Missing meta tags are ignored; never throws.
 */
export function applyTheme(doc, theme) {
    if (!doc)
        return;
    try {
        const root = doc.documentElement;
        root.setAttribute('data-theme', theme);
        root.style.colorScheme = theme;
        doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
        doc.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme);
    }
    catch {
        /* a detached or locked-down document: the CSS default (light) still applies */
    }
}
