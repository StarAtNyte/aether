#!/bin/bash
# usage: run.sh <scene.py> [script args...]   (headless Blender, niced; GPU via OptiX)
# Logs go to stdout; the caller redirects. Resume-safe: rendering skips frames that already exist.
BL=${BLENDER:-/home/at-office/tools/blender-4.2.3-linux-x64/blender}
SCENE=$1; shift
exec nice -n 10 "$BL" -b -P "$(dirname "$0")/$SCENE" -- "$@"
