"""The rug and display-furniture assets of the Rug Exhibition Hall: ids, real sizes and build options (shared by
textures.py and the Blender build)."""

# id, design, catalog name, width cm, length cm, pile thickness m, fringe ('both' | 'bottom' | None), mount
RUGS = [
    ('rug-vinton-teal', 'vinton-teal', 'Vinton Persian rug, teal', 165, 220, 0.009, 'both', 'floor'),
    ('rug-vinton-rust', 'vinton-rust', 'Vinton Persian rug, rust', 210, 280, 0.009, 'both', 'floor'),
    ('rug-motion-denim', 'motion-denim', 'Motion modern rug, denim', 165, 220, 0.012, None, 'floor'),
    ('rug-motion-marine', 'motion-marine', 'Motion modern rug, marine', 210, 280, 0.013, None, 'floor'),
    ('rug-heriz-runner', 'heriz-runner', 'Heriz runner, teal', 80, 300, 0.011, 'both', 'floor'),
    ('rug-tabriz-runner', 'tabriz-runner', 'Tabriz runner, cream', 80, 250, 0.008, 'both', 'floor'),
    ('rug-isfahan-wall', 'isfahan', 'Isfahan wall rug, teal', 150, 200, 0.007, 'bottom', 'wall'),
    ('rug-motion-wall-denim', 'motion-wall-denim', 'Motion wall rug, denim', 135, 180, 0.011, None, 'wall'),
    ('rug-farmhouse-border', 'farmhouse-border', 'Farmhouse border rug, navy', 150, 200, 0.004, None, 'wall'),
    ('rug-kashan-heirloom', 'kashan', 'Kashan heirloom rug, rust', 255, 340, 0.010, 'bottom', 'wall'),
    ('rug-farmhouse-stripe', 'farmhouse-stripe', 'Farmhouse stripe rug, navy', 180, 240, 0.004, None, 'wall'),
    ('rug-mahal-wall', 'mahal', 'Mahal wall rug, rust', 150, 200, 0.009, 'bottom', 'wall'),
    ('rug-motion-wall-marine', 'motion-wall-marine', 'Motion wall rug, marine', 135, 180, 0.011, None, 'wall'),
]

# Fringe colour per design (undyed cotton warps; antique ones a little darker)
FRINGE = {
    'vinton-teal': '#ebe3d0', 'vinton-rust': '#ddd0b6', 'heriz-runner': '#e6dcc6', 'tabriz-runner': '#f0e9da',
    'isfahan': '#f1ebdd', 'kashan': '#e0d5bd', 'mahal': '#e2d7c0',
}

# Display furniture: id, name, width (x) m, height m, depth (z) m
FURNITURE = [
    ('display-table-oak', 'Gallery display table, oak', 1.0, 0.75, 3.3),
    ('display-plinth-oak', 'Gallery display plinth, oak top', 3.1, 0.4, 2.4),
]
