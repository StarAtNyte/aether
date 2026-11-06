"""Enable the MCP for Blender add-on (MIT, ahujasid/mcp-for-blender) for Aether's local bridge.

Run once after copying the add-on's addon.py to <blender user scripts>/addons/mcp_for_blender.py:

    blender -b --factory-startup --python scripts/blender/mcp-addon-setup.py

It enables the add-on in the user preferences, binds its socket to 127.0.0.1 only, keeps remote
connections and telemetry off, and saves the preferences. The add-on's own asset search and model
generation integrations stay off (Aether never offers them: everything it makes is procedural).
"""
import addon_utils
import bpy

MODULE = "mcp_for_blender"

addon_utils.enable(MODULE, default_set=True, persistent=True)
prefs = bpy.context.preferences.addons[MODULE].preferences
prefs.bind_address = "127.0.0.1"
prefs.allow_remote_connections = False
prefs.telemetry_consent = False
bpy.context.preferences.use_preferences_save = True
bpy.ops.wm.save_userpref()
print(f"AETHER_MCP_ADDON enabled bind={prefs.bind_address} remote={prefs.allow_remote_connections} telemetry={prefs.telemetry_consent}")
