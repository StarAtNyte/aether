#!/bin/sh
# Firefox with WebGL on a machine without a GPU or a display.
#
# Playwright's headless Firefox cannot create a WebGL context here
# (FEATURE_FAILURE_WEBGL_EXHAUSTED_DRIVERS), so the studio has nothing to draw
# with. A headed Firefox on a virtual display (Xvfb) does: Mesa's llvmpipe
# software rasteriser provides WebGL 2. This wrapper is what the e2e suites
# launch as "the Firefox executable" (see `findFirefox` in env.ts): it drops
# Playwright's `-headless` flag and runs the real binary, named by
# AETHER_E2E_FIREFOX_REAL, under `xvfb-run`.
real="${AETHER_E2E_FIREFOX_REAL:?AETHER_E2E_FIREFOX_REAL is not set}"
n=$#
while [ "$n" -gt 0 ]; do
  a="$1"
  shift
  case "$a" in
    -headless | --headless) ;;
    *) set -- "$@" "$a" ;;
  esac
  n=$((n - 1))
done
export LIBGL_ALWAYS_SOFTWARE=1
exec xvfb-run -a -s "-screen 0 1920x1080x24 +extension GLX" "$real" "$@"
