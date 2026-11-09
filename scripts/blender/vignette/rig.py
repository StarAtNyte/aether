"""Lighting, camera and render rig for photoreal vignettes (Cycles, OptiX/CUDA, AgX).

One strong light idea: a low warm sun through a window (shadow rays pass through the glass, a portal helps the sky sample),
a cool sky fill, a faint cool bounce card, a thin atmosphere for shafts. Camera: real lens, f-stop DoF with an animated
focus target, slow dolly with hand-held noise. Compositor: fog-glow bloom and a touch of lateral chromatic aberration.
Grain and vignette are added in ffmpeg (see assemble.sh) so they stay temporally coherent.
"""
import math

import bpy
from mathutils import Vector


def aim(obj, target):
    d = Vector(target) - Vector(obj.location)
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def world_sky(sun_elev_deg=20.0, sun_rot_deg=0.0, strength=0.55, dust=1.2, air=1.0):
    w = bpy.context.scene.world or bpy.data.worlds.new("World")
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    sky = nt.nodes.new("ShaderNodeTexSky")
    sky.sky_type = "NISHITA"
    sky.sun_elevation = math.radians(sun_elev_deg)
    sky.sun_rotation = math.radians(sun_rot_deg)
    sky.sun_disc = False  # the sun is a lamp, so shadow rays and glass handling are controlled
    sky.dust_density = dust
    sky.air_density = air
    sky.ozone_density = 1.0
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = strength
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(sky.outputs[0], bg.inputs["Color"])
    nt.links.new(bg.outputs[0], out.inputs["Surface"])
    return sky


def sun(direction, strength=4.0, color=(1.0, 0.78, 0.55), angle_deg=1.0):
    """direction = the way the light travels."""
    ld = bpy.data.lights.new("Sun", "SUN")
    ld.energy = strength
    ld.color = color
    ld.angle = math.radians(angle_deg)
    ob = bpy.data.objects.new("Sun", ld)
    bpy.context.scene.collection.objects.link(ob)
    d = Vector(direction).normalized()
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return ob


def area(name, loc, size, energy, color=(1, 1, 1), target=None, shape="RECTANGLE", portal=False, size_y=None):
    ld = bpy.data.lights.new(name, "AREA")
    ld.shape = shape
    ld.size = size
    if size_y:
        ld.size_y = size_y
    ld.energy = energy
    ld.color = color
    if portal and hasattr(ld.cycles, "is_portal"):
        ld.cycles.is_portal = True
    ob = bpy.data.objects.new(name, ld)
    ob.location = loc
    bpy.context.scene.collection.objects.link(ob)
    if target:
        aim(ob, target)
    return ob


def camera(lens=45.0, fstop=2.8, sensor=36.0):
    cd = bpy.data.cameras.new("Cam")
    cd.lens = lens
    cd.sensor_width = sensor
    cd.dof.use_dof = True
    cd.dof.aperture_fstop = fstop
    cd.clip_start = 0.02
    ob = bpy.data.objects.new("Cam", cd)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.scene.camera = ob
    return ob


def empty(name, loc):
    e = bpy.data.objects.new(name, None)
    e.location = loc
    bpy.context.scene.collection.objects.link(e)
    return e


def key(obj, frame, loc=None):
    if loc is not None:
        obj.location = loc
    obj.keyframe_insert("location", frame=frame)


def smooth_fcurves(obj, noise=0.0, noise_scale=40.0, seed=0):
    ad = obj.animation_data
    if not ad or not ad.action:
        return
    for fc in ad.action.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = "BEZIER"
            kp.handle_left_type = kp.handle_right_type = "AUTO_CLAMPED"
        if noise:
            m = fc.modifiers.new("NOISE")
            m.scale = noise_scale
            m.strength = noise
            m.phase = seed + fc.array_index * 7.3
            m.depth = 1


def render_setup(res=(1920, 1080), samples=192, fps=24, shutter=0.4, device="OPTIX", exposure=0.0, look="AgX - High Contrast",
                 denoise=True, threshold=0.012):
    sc = bpy.context.scene
    r = sc.render
    r.engine = "CYCLES"
    r.resolution_x, r.resolution_y = res
    r.resolution_percentage = 100
    r.fps = fps
    r.use_motion_blur = True
    sc.cycles.motion_blur_position = "CENTER"
    r.motion_blur_shutter = shutter
    c = sc.cycles
    if device == "CPU":
        c.device = "CPU"
        c.denoiser = "OPENIMAGEDENOISE"
    else:
        c.device = "GPU"
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = device
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == device
    c.samples = samples
    c.use_adaptive_sampling = True
    c.adaptive_threshold = threshold
    c.adaptive_min_samples = 32
    c.use_denoising = denoise and not __import__("os").environ.get("NODENOISE")
    c.denoiser = "OPTIX" if device != "CPU" else "OPENIMAGEDENOISE"
    c.denoising_input_passes = "RGB_ALBEDO_NORMAL"
    c.denoising_prefilter = "ACCURATE"
    c.max_bounces = 10
    c.diffuse_bounces = 6
    c.glossy_bounces = 4
    c.transmission_bounces = 8
    c.volume_bounces = 2
    c.transparent_max_bounces = 16
    c.caustics_reflective = False
    c.caustics_refractive = False
    c.sample_clamp_indirect = 4.0
    c.sample_clamp_direct = 0.0
    c.blur_glossy = 0.5
    c.volume_step_rate = 1.0
    c.volume_max_steps = 256
    c.use_light_tree = True
    c.use_auto_tile = True
    c.tile_size = int(__import__("os").environ.get("TILE", "2048"))
    c.seed = 7
    c.use_animated_seed = False
    r.filter_size = 1.3
    r.film_transparent = False
    vs = sc.view_settings
    vs.view_transform = "AgX"
    try:
        vs.look = look
    except TypeError:
        pass
    vs.exposure = exposure
    vs.gamma = 1.0
    sc.display_settings.display_device = "sRGB"
    r.image_settings.file_format = "PNG"
    r.image_settings.color_depth = "16"
    r.image_settings.compression = 15


def compositor(bloom=True, aberration=0.012, glare_threshold=1.1, glare_size=7, mix=-0.8):
    sc = bpy.context.scene
    sc.use_nodes = True
    nt = sc.node_tree
    nt.nodes.clear()
    rl = nt.nodes.new("CompositorNodeRLayers")
    last = rl.outputs["Image"]
    if bloom:
        g = nt.nodes.new("CompositorNodeGlare")
        g.glare_type = "FOG_GLOW"
        g.quality = "HIGH"
        g.threshold = glare_threshold
        g.size = glare_size
        g.mix = mix
        nt.links.new(last, g.inputs["Image"])
        last = g.outputs["Image"]
    if aberration:
        ld = nt.nodes.new("CompositorNodeLensdist")
        ld.use_fit = True
        ld.inputs["Dispersion"].default_value = aberration
        nt.links.new(last, ld.inputs["Image"])
        last = ld.outputs["Image"]
    co = nt.nodes.new("CompositorNodeComposite")
    nt.links.new(last, co.inputs["Image"])
