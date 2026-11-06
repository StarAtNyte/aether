"""Serve the MCP for Blender add-on's socket from a headless Blender (no display needed).

The add-on refuses `blender -b` because its command queue is drained by a UI timer. This script
starts the same server object on 127.0.0.1 and drains the queue on Blender's main thread itself,
so the local bridge can drive a background Blender on a machine without a desktop:

    blender -b [file.blend] --python scripts/blender/mcp-serve-headless.py -- [--port 9876]

It stops when the parent closes stdin or on SIGTERM. Only loopback is ever bound.
"""
import signal
import sys
import time

import bpy  # noqa: F401  (the add-on module needs Blender's Python)

try:
    import mcp_for_blender as addon
except ImportError:
    print("AETHER_MCP_HEADLESS error: the mcp_for_blender add-on is not installed", flush=True)
    sys.exit(2)

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
port = 9876
if "--port" in argv:
    port = int(argv[argv.index("--port") + 1])

# Make sure the add-on's properties exist (enabled add-ons register them; a factory startup does not).
if not hasattr(bpy.types.Scene, "blendermcp_port"):
    addon.register()

server = addon.BlenderMCPServer(host="127.0.0.1", port=port)
import socket
import threading

server.running = True
server.socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
server.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
server.socket.bind(("127.0.0.1", port))
server.socket.listen(5)
server.server_thread = threading.Thread(target=server._server_loop, daemon=True)
server.server_thread.start()
print(f"AETHER_MCP_HEADLESS listening 127.0.0.1:{port}", flush=True)

stop = {"now": False}


def _stop(*_):
    stop["now"] = True


signal.signal(signal.SIGTERM, _stop)
signal.signal(signal.SIGINT, _stop)

while not stop["now"]:
    server._drain_command_queue()
    time.sleep(0.03)

server.stop()
print("AETHER_MCP_HEADLESS stopped", flush=True)
