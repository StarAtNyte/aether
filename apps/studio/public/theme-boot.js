/* Applies the saved (or system) theme before first paint — no flash of the wrong theme.
   Kept tiny and dependency-free; mirrors loadSettings() in src/lib/storage.ts. */
(function () {
  var dark = false;
  try {
    var raw = localStorage.getItem('aether.studio.settings.v1');
    var s = raw && raw.length < 100000 ? JSON.parse(raw) : null;
    if (s && typeof s === 'object' && typeof s.darkTheme === 'boolean') dark = s.darkTheme;
    else dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch (e) {
    dark = false;
  }
  var root = document.documentElement;
  root.setAttribute('data-theme', dark ? 'dark' : 'light');
  root.style.colorScheme = dark ? 'dark' : 'light';
})();
