/** Catalog of the shipped library generators. */
export const LIBRARY_ENTRIES = [
    {
        "id": "airplane",
        "description": "Propeller airplane parked on its landing gear: fuselage, main wings, tail fin and stabilizers, cockpit canopy and a nose propeller",
        "category": "vehicles",
        "keywords": [
            "airplane",
            "aeroplane",
            "plane",
            "aircraft",
            "biplane"
        ],
        "params": {
            "color": {
                "type": "color",
                "default": "#d64b3f",
                "description": "Primary aircraft color"
            },
            "wingspan": {
                "type": "number",
                "default": 9,
                "min": 3,
                "max": 24,
                "description": "Overall wingspan in meters"
            }
        },
        "size": [
            9,
            3.36,
            6.908
        ]
    },
    {
        "id": "beach-umbrella",
        "description": "Beach umbrella with a striped canopy on a slightly tilted pole planted in the sand, with a beach towel underneath",
        "category": "props",
        "keywords": [
            "beach umbrella",
            "parasol",
            "sun umbrella",
            "umbrella"
        ],
        "params": {
            "color": {
                "type": "color",
                "default": "#e85d5d",
                "description": "primary canopy and towel color"
            },
            "stripeColor": {
                "type": "color",
                "default": "#fff3d6",
                "description": "alternating canopy and towel stripe color"
            },
            "tilt": {
                "type": "number",
                "default": 8,
                "min": -18,
                "max": 18,
                "description": "umbrella pole tilt in degrees"
            }
        },
        "size": [
            2.477,
            2.587,
            2.36
        ]
    },
    {
        "id": "bookshelf",
        "description": "Bookshelf full of colourful books.",
        "category": "props",
        "keywords": [
            "bookshelf",
            "bookcase",
            "book shelf",
            "library shelf"
        ],
        "params": {
            "width": {
                "type": "number",
                "default": 1.2,
                "min": 0.5,
                "max": 4,
                "description": "width in meters"
            },
            "height": {
                "type": "number",
                "default": 2,
                "min": 0.6,
                "max": 4,
                "description": "height in meters"
            },
            "shelves": {
                "type": "int",
                "default": 5,
                "min": 1,
                "max": 10,
                "description": "number of shelves"
            },
            "woodColor": {
                "type": "color",
                "default": "#8b5a2b",
                "description": "wood color"
            }
        },
        "size": [
            1.248,
            2,
            0.352
        ]
    },
    {
        "id": "bus",
        "description": "City bus: long boxy body with rounded corners, window strip, doors, six wheels with hubs, headlights and a route sign",
        "category": "vehicles",
        "keywords": [
            "bus",
            "city bus",
            "school bus"
        ],
        "params": {
            "color": {
                "type": "color",
                "default": "#e33b32",
                "description": "Primary body color"
            },
            "length": {
                "type": "number",
                "default": 10.5,
                "min": 6,
                "max": 18,
                "description": "Overall bus length in meters"
            }
        },
        "size": [
            12.222,
            3.415,
            2.868
        ]
    },
    {
        "id": "cart",
        "description": "Wooden hand cart with two spoked wheels, plank bed, side rails and two pull handles",
        "category": "vehicles",
        "keywords": [
            "cart",
            "wagon",
            "handcart",
            "wheelbarrow"
        ],
        "params": {
            "woodColor": {
                "type": "color",
                "default": "#8b5a2b",
                "description": "Main timber color"
            },
            "length": {
                "type": "number",
                "default": 2.4,
                "min": 1,
                "max": 6,
                "description": "Overall cart length in meters"
            }
        },
        "size": [
            1.641,
            1.467,
            2.692
        ]
    },
    {
        "id": "castle-gate",
        "description": "Castle gatehouse: two crenellated stone towers flanking an arched gate with a portcullis and a wall walk on top",
        "category": "architecture",
        "keywords": [
            "castle gate",
            "gatehouse",
            "portcullis"
        ],
        "params": {
            "stoneColor": {
                "type": "color",
                "default": "#8f8879",
                "description": "Main dressed-stone color"
            },
            "height": {
                "type": "number",
                "default": 8,
                "min": 3,
                "max": 24,
                "description": "Overall gatehouse height in meters"
            }
        },
        "size": [
            9.364,
            7.64,
            3.264
        ]
    },
    {
        "id": "cave-entrance",
        "description": "Rocky cave entrance: a rough rock mound with a dark arched opening framed by glowing crystals",
        "category": "nature",
        "keywords": [
            "cave",
            "cave entrance",
            "crystal cave",
            "grotto"
        ],
        "params": {
            "rockColor": {
                "type": "color",
                "default": "#514b52",
                "description": "primary color of the cave rocks"
            },
            "crystalColor": {
                "type": "color",
                "default": "#62e6ff",
                "description": "glowing crystal color"
            },
            "size": {
                "type": "number",
                "default": 6,
                "min": 2,
                "max": 20,
                "description": "overall cave mound width in meters"
            }
        },
        "size": [
            10.474,
            7.363,
            9.096
        ]
    },
    {
        "id": "coral",
        "description": "Branching coral cluster: several knobbly branching arms and a few fan shapes on a rock base, vivid colors",
        "category": "nature",
        "keywords": [
            "coral",
            "coral reef"
        ],
        "params": {
            "branches": {
                "type": "int",
                "default": 9,
                "min": 4,
                "max": 18,
                "description": "number of main branching arms"
            },
            "color": {
                "type": "color",
                "default": "#ff5f73",
                "description": "primary coral color"
            },
            "size": {
                "type": "number",
                "default": 2.4,
                "min": 0.6,
                "max": 8,
                "description": "overall cluster size in meters"
            }
        },
        "size": [
            2.674,
            2.396,
            2.4
        ]
    },
    {
        "id": "dragon-statue",
        "description": "Stone dragon statue on a plinth: coiled body, raised head with horns, folded wings, tail wrapping around",
        "category": "props",
        "keywords": [
            "dragon statue",
            "dragon"
        ],
        "params": {
            "color": {
                "type": "color",
                "default": "#7f8582",
                "description": "Primary stone color"
            },
            "height": {
                "type": "number",
                "default": 3.2,
                "min": 1,
                "max": 10,
                "description": "Overall statue height in meters"
            }
        },
        "size": [
            1.845,
            2.837,
            1.495
        ]
    },
    {
        "id": "ferris-wheel",
        "description": "Ferris wheel: A-frame supports, spoked wheel with rim lights and eight hanging gondolas",
        "category": "architecture",
        "keywords": [
            "ferris wheel",
            "big wheel",
            "observation wheel"
        ],
        "params": {
            "diameter": {
                "type": "number",
                "default": 8,
                "min": 3,
                "max": 24,
                "description": "wheel diameter in meters"
            },
            "color": {
                "type": "color",
                "default": "#d64045",
                "description": "primary wheel and support color"
            },
            "gondolas": {
                "type": "int",
                "default": 8,
                "min": 6,
                "max": 16,
                "description": "number of hanging gondolas"
            }
        },
        "size": [
            9.037,
            9.788,
            4.16
        ]
    },
    {
        "id": "fountain",
        "description": "Tiered stone fountain with water basins.",
        "category": "architecture",
        "keywords": [
            "fountain",
            "water fountain"
        ],
        "params": {
            "radius": {
                "type": "number",
                "default": 2,
                "min": 0.5,
                "max": 10,
                "description": "basin radius in meters"
            },
            "stoneColor": {
                "type": "color",
                "default": "#b9b2a6",
                "description": "stone color"
            },
            "waterColor": {
                "type": "color",
                "default": "#4fa8e0",
                "description": "water color"
            }
        },
        "size": [
            4,
            2.61,
            4
        ]
    },
    {
        "id": "helicopter",
        "description": "Helicopter on skids: rounded cabin with windows, tail boom with tail rotor, main rotor with four blades",
        "category": "vehicles",
        "keywords": [
            "helicopter",
            "chopper"
        ],
        "params": {
            "color": {
                "type": "color",
                "default": "#d84a32",
                "description": "Primary fuselage color"
            },
            "length": {
                "type": "number",
                "default": 6,
                "min": 2,
                "max": 20,
                "description": "Overall helicopter length in meters"
            }
        },
        "size": [
            5.02,
            5.4,
            6.135
        ]
    },
    {
        "id": "hero-car",
        "description": "Vintage roadster: 1930s roadster 4.3 m long, ~1.8 m wide track 1.5, ~1.4 m tall. Hood 1.4 m, tall chrome grille 0.75 h, 4 wheels R0.38 with whitewall and 20 spokes, extruded arching cream fenders, running boards, 2 chrome headlamps Ø0.28, split windscreen, folded soft top, rear spa",
        "category": "vehicles",
        "keywords": [
            "vintage car",
            "classic car",
            "roadster",
            "old car"
        ],
        "params": {
            "length": {
                "type": "number",
                "default": 4.3,
                "min": 2,
                "max": 8,
                "description": "car length in m"
            },
            "bodyColor": {
                "type": "color",
                "default": "#5a0f1e",
                "description": "paint"
            },
            "fenderColor": {
                "type": "color",
                "default": "#efe3c2",
                "description": "fender colour"
            },
            "topColor": {
                "type": "color",
                "default": "#2a2622",
                "description": "soft top"
            },
            "seatColor": {
                "type": "color",
                "default": "#8a5a2e",
                "description": "leather"
            }
        },
        "size": [
            1.8,
            1.528,
            4.2
        ]
    },
    {
        "id": "hero-cherry-tree",
        "description": "Cherry blossom tree: Sakura ~5.5 m tall, 7 m wide. Trunk: twisting tapered tube 2.2 m high, Ø0.5 base to Ø0.28 top with flared root. 6 branches evenly spaced around Y, arcing out to ~3-3.3 m and up to ~4 m, each with a fork twig. ~64 blossom clumps (r 0.6-1.3) along outer branches ",
        "category": "nature",
        "keywords": [
            "cherry blossom",
            "sakura tree",
            "blossom tree"
        ],
        "params": {
            "barkColor": {
                "type": "color",
                "default": "#3b2a24",
                "description": "bark color"
            },
            "blossomColor": {
                "type": "color",
                "default": "#f6a6c1",
                "description": "main blossom color"
            },
            "clumps": {
                "type": "int",
                "default": 64,
                "min": 15,
                "max": 120,
                "description": "blossom clump count"
            },
            "height": {
                "type": "number",
                "default": 5.5,
                "min": 2,
                "max": 12,
                "description": "tree height m"
            },
            "petals": {
                "type": "int",
                "default": 180,
                "min": 0,
                "max": 400,
                "description": "ground petals"
            },
            "spread": {
                "type": "number",
                "default": 7,
                "min": 3,
                "max": 14,
                "description": "canopy width m"
            }
        },
        "size": [
            8.072,
            6.012,
            8.628
        ]
    },
    {
        "id": "hero-explorer",
        "description": "Stylised explorer: Toy explorer 1.75m: boots 0.17x0.14x0.28; legs d0.14 y0.12-0.8 gap 0.04; torso ellipsoid 0.38w x 0.24d x 0.48h (y0.8-1.28) with olive vest; shoulders y1.22, arms d0.09 L0.45 angled 18deg out; scarf at 1.3; head r0.23 at 1.47; wide brim hat r0.38 brim 0.02 tilted,",
        "category": "props",
        "keywords": [
            "explorer",
            "adventurer",
            "hiker figure"
        ],
        "params": {
            "boots": {
                "type": "color",
                "default": "#5a3820",
                "description": "boots"
            },
            "height": {
                "type": "number",
                "default": 1.75,
                "min": 0.5,
                "max": 4,
                "description": "total height m"
            },
            "khaki": {
                "type": "color",
                "default": "#c2a878",
                "description": "clothing"
            },
            "olive": {
                "type": "color",
                "default": "#6b7040",
                "description": "vest/hat band"
            },
            "scarf": {
                "type": "color",
                "default": "#c8332b",
                "description": "scarf"
            },
            "skin": {
                "type": "color",
                "default": "#e8b48c",
                "description": "skin"
            }
        },
        "size": [
            0.823,
            1.835,
            0.799
        ]
    },
    {
        "id": "hero-fountain",
        "description": "Ornate fountain: Three-tier sandstone fountain, 3.4 m wide x 3 m tall: octagonal basin R1.7 h0.82 with moulded rim and 8 carved panels; fluted column r0.22 to y1.3; scalloped bowl 1 r1.0 (y1.25-1.7); stem r0.14; bowl 2 r0.62 (y1.95-2.3); stem r0.08; pinecone finial to y3.0; blue em",
        "category": "architecture",
        "keywords": [
            "ornate fountain",
            "tiered fountain",
            "plaza fountain"
        ],
        "params": {
            "width": {
                "type": "number",
                "default": 3.4,
                "min": 1.5,
                "max": 8,
                "description": "overall width in meters"
            },
            "stoneColor": {
                "type": "color",
                "default": "#c9a77c",
                "description": "sandstone color"
            },
            "waterColor": {
                "type": "color",
                "default": "#4fa8e8",
                "description": "water color"
            },
            "panels": {
                "type": "int",
                "default": 1,
                "min": 0,
                "max": 1,
                "description": "carved panels on basin (1 = yes)"
            }
        },
        "size": [
            3.44,
            3.15,
            3.44
        ]
    },
    {
        "id": "hero-gazebo",
        "description": "Garden gazebo: Victorian octagonal gazebo, 4 m across corners, 4.6 m tall. Deck: raised octagon 0.5 m with skirt, 2 entry steps (0.17/0.33) on +Z face. 8 turned lathe columns 2.6 m tall at corners; eave beams 0.15 m; fretwork triangle brackets at beam ends; railing 0.9 m (bottom ra",
        "category": "architecture",
        "keywords": [
            "gazebo",
            "garden pavilion",
            "bandstand"
        ],
        "params": {
            "width": {
                "type": "number",
                "default": 4,
                "min": 2,
                "max": 8,
                "description": "width across corners in meters"
            },
            "height": {
                "type": "number",
                "default": 4.6,
                "min": 2.5,
                "max": 9,
                "description": "total height in meters"
            },
            "color": {
                "type": "color",
                "default": "#f4f2ec",
                "description": "painted wood color"
            },
            "roofColor": {
                "type": "color",
                "default": "#4a5058",
                "description": "slate roof color"
            },
            "deckColor": {
                "type": "color",
                "default": "#9c7a52",
                "description": "deck color"
            },
            "balusters": {
                "type": "int",
                "default": 7,
                "min": 3,
                "max": 12,
                "description": "balusters per railing panel"
            }
        },
        "size": [
            4.619,
            4.81,
            5.055
        ]
    },
    {
        "id": "hero-lantern",
        "description": "Victorian street lantern: Victorian gas street lantern, 4.2 m default. Plinth step 0.1 h r0.3; fluted lathe base 0.9 h (r0.22 -> 0.09) with 8 half-round rib flutes 0.03 deep; tapered post r0.075->0.045 to 3.4 m; brass rings 0.02 h at 0.95/1.5/3.2 m; ladder bar 0.7 wide r0.0125 at 3",
        "category": "props",
        "keywords": [
            "victorian lantern",
            "gas lamp",
            "old street lamp"
        ],
        "params": {
            "brassColor": {
                "type": "color",
                "default": "#c8963c",
                "description": "brass color"
            },
            "glowColor": {
                "type": "color",
                "default": "#ffb840",
                "description": "glass glow color"
            },
            "height": {
                "type": "number",
                "default": 4.2,
                "min": 2,
                "max": 8,
                "description": "total height in meters"
            },
            "ironColor": {
                "type": "color",
                "default": "#1f2b25",
                "description": "iron color"
            }
        },
        "size": [
            0.78,
            4.48,
            0.64
        ]
    },
    {
        "id": "hero-ship",
        "description": "Sailing galleon: Galleon ~14.2 m long (hull 11.5 + bowsprit at 18 deg), beam 4.3. 60 lofted cross-sections with strong sheer (deck 2.2 mid, 3.0 at ends), raised keel at bow/stern; gold wale and rail 0.14 m; 6 red-framed gun ports per side; two-tier stern castle ~2.3 m above deck wi",
        "category": "vehicles",
        "keywords": [
            "galleon",
            "sailing ship",
            "tall ship"
        ],
        "params": {
            "billow": {
                "type": "number",
                "default": 0.8,
                "min": 0,
                "max": 1.5,
                "description": "sail billow depth"
            },
            "hullColor": {
                "type": "color",
                "default": "#3a2312",
                "description": "dark varnished wood"
            },
            "lanternColor": {
                "type": "color",
                "default": "#ffcf6a",
                "description": "lantern and window glow"
            },
            "pennantColor": {
                "type": "color",
                "default": "#c0281e",
                "description": "pennants"
            },
            "sailColor": {
                "type": "color",
                "default": "#f1e6c8",
                "description": "sail cloth"
            },
            "sailTiers": {
                "type": "int",
                "default": 3,
                "min": 1,
                "max": 3,
                "description": "sails on main and fore masts"
            },
            "trimColor": {
                "type": "color",
                "default": "#d4a017",
                "description": "gold trim"
            }
        },
        "size": [
            5.3,
            13.05,
            15.134
        ]
    },
    {
        "id": "hero-statue",
        "description": "Ancient statue: Classical marble statue, 2.8 m default. Plinth: base 0.9x0.2, step 0.75x0.15, die 0.6x0.5 with 0.4x0.12 inscription plate and 3 raised lines, cap 0.72x0.1 (top at 0.95). Figure on top: wide robe lathe hem r0.30 to waist 0.2 to shoulders 0.22 with 0.03-0.04 ring step",
        "category": "props",
        "keywords": [
            "ancient statue",
            "marble statue",
            "classical statue"
        ],
        "params": {
            "height": {
                "type": "number",
                "default": 2.8,
                "min": 1,
                "max": 8,
                "description": "total height in meters"
            },
            "marbleColor": {
                "type": "color",
                "default": "#f0eee8",
                "description": "marble color"
            },
            "stoneColor": {
                "type": "color",
                "default": "#6b6b68",
                "description": "plinth stone color"
            },
            "tilt": {
                "type": "number",
                "default": 8,
                "min": -20,
                "max": 20,
                "description": "head tilt degrees"
            },
            "veining": {
                "type": "number",
                "default": 0.45,
                "min": 0,
                "max": 1,
                "description": "vein strength"
            },
            "wreathColor": {
                "type": "color",
                "default": "#d9d6cb",
                "description": "wreath color"
            }
        },
        "size": [
            0.974,
            2.838,
            0.9
        ]
    },
    {
        "id": "hot-air-balloon",
        "description": "Hot air balloon: a striped teardrop envelope, ropes and a wicker basket with a burner, hovering 1 m above its base point",
        "category": "vehicles",
        "keywords": [
            "hot air balloon",
            "balloon"
        ],
        "params": {
            "color": {
                "type": "color",
                "default": "#c94f3d",
                "description": "main envelope color"
            },
            "stripeColor": {
                "type": "color",
                "default": "#f3c969",
                "description": "alternating envelope stripe color"
            },
            "height": {
                "type": "number",
                "default": 8,
                "min": 3,
                "max": 20,
                "description": "balloon height from basket bottom to envelope crown in meters"
            }
        },
        "size": [
            3.47,
            9,
            3.47
        ]
    },
    {
        "id": "igloo",
        "description": "Igloo: dome of snow blocks with visible block seams and a tunnel entrance",
        "category": "architecture",
        "keywords": [
            "igloo"
        ],
        "params": {
            "size": {
                "type": "number",
                "default": 3,
                "min": 1,
                "max": 10,
                "description": "Overall igloo dome diameter in meters"
            }
        },
        "size": [
            3.06,
            1.62,
            4.1
        ]
    },
    {
        "id": "jellyfish",
        "description": "Translucent glowing jellyfish: domed bell and long wavy tentacles, floating with its lowest tentacle tips at y = 0",
        "category": "nature",
        "keywords": [
            "jellyfish",
            "jelly fish"
        ],
        "params": {
            "color": {
                "type": "color",
                "default": "#72d9ff",
                "description": "Primary bioluminescent body color"
            },
            "size": {
                "type": "number",
                "default": 3,
                "min": 0.8,
                "max": 10,
                "description": "Overall jellyfish height in meters"
            }
        },
        "size": [
            1.68,
            2.646,
            1.68
        ]
    },
    {
        "id": "lighthouse",
        "description": "Striped lighthouse with a gallery, railing and a glowing lamp room.",
        "category": "architecture",
        "keywords": [
            "lighthouse",
            "light house",
            "beacon tower"
        ],
        "params": {
            "height": {
                "type": "number",
                "default": 10,
                "min": 3,
                "max": 40,
                "description": "tower height in meters"
            },
            "stripeColor": {
                "type": "color",
                "default": "#d1453b",
                "description": "stripe color"
            },
            "lightColor": {
                "type": "color",
                "default": "#fff2a8",
                "description": "lamp color"
            }
        },
        "size": [
            3.36,
            12.3,
            3.36
        ]
    },
    {
        "id": "mailbox",
        "description": "Rural mailbox on a wooden post with a rounded top and a red flag",
        "category": "props",
        "keywords": [
            "mailbox",
            "letterbox",
            "post box"
        ],
        "params": {
            "color": {
                "type": "color",
                "default": "#496a78",
                "description": "mailbox body color"
            }
        },
        "size": [
            0.88,
            2.29,
            1.334
        ]
    },
    {
        "id": "mushroom-house",
        "description": "Fairy-tale mushroom house: thick stalk with a round door and windows, huge spotted red cap as the roof, a tiny chimney",
        "category": "architecture",
        "keywords": [
            "mushroom house",
            "toadstool house",
            "fairy house",
            "gnome house"
        ],
        "params": {
            "capColor": {
                "type": "color",
                "default": "#b92f3a",
                "description": "Color of the mushroom cap roof"
            },
            "height": {
                "type": "number",
                "default": 5,
                "min": 2,
                "max": 12,
                "description": "Overall house height in meters"
            }
        },
        "size": [
            4.3,
            4.81,
            4.3
        ]
    },
    {
        "id": "pagoda",
        "description": "Multi-tier East Asian pagoda with upturned eaves on every tier, a stone base and a finial spire, about 12 m tall",
        "category": "architecture",
        "keywords": [
            "pagoda"
        ],
        "params": {
            "tiers": {
                "type": "int",
                "default": 5,
                "min": 3,
                "max": 7,
                "description": "number of pagoda stories"
            },
            "roofColor": {
                "type": "color",
                "default": "#315f4b",
                "description": "glazed roof tile color"
            },
            "wallColor": {
                "type": "color",
                "default": "#efe1c2",
                "description": "plaster wall color"
            }
        },
        "size": [
            6.156,
            12,
            6.156
        ]
    },
    {
        "id": "palm-hut",
        "description": "Tropical beach hut on short stilts: bamboo walls, thatched palm-leaf conical roof, small ladder and doorway",
        "category": "architecture",
        "keywords": [
            "palm hut",
            "beach hut",
            "tiki hut",
            "thatched hut",
            "bungalow"
        ],
        "params": {
            "roofColor": {
                "type": "color",
                "default": "#b8893f",
                "description": "Color of the dried palm-leaf thatch"
            },
            "size": {
                "type": "number",
                "default": 3.2,
                "min": 1.5,
                "max": 8,
                "description": "Width and depth of the hut in meters"
            }
        },
        "size": [
            5.408,
            6.424,
            5.408
        ]
    },
    {
        "id": "piano",
        "description": "Grand piano with a lifted lid on a prop stick, black and white keys, three legs, pedals and a bench",
        "category": "props",
        "keywords": [
            "piano",
            "grand piano"
        ],
        "params": {
            "color": {
                "type": "color",
                "default": "#171719",
                "description": "Main lacquer color of the piano and bench"
            },
            "lidOpen": {
                "type": "boolean",
                "default": true,
                "description": "Raise the grand piano lid and show its prop stick"
            }
        },
        "size": [
            3.18,
            2.412,
            3.42
        ]
    },
    {
        "id": "picnic-table",
        "description": "Wooden picnic table with two attached benches and A-frame legs",
        "category": "props",
        "keywords": [
            "picnic table",
            "picnic bench"
        ],
        "params": {
            "woodColor": {
                "type": "color",
                "default": "#9a6538",
                "description": "main wood colour"
            },
            "length": {
                "type": "number",
                "default": 2.2,
                "min": 1.2,
                "max": 4.5,
                "description": "overall table length in meters"
            }
        },
        "size": [
            2.235,
            0.84,
            1.78
        ]
    },
    {
        "id": "playground-slide",
        "description": "Playground slide: ladder with rails up to a small platform and a long curved chute down to the ground",
        "category": "props",
        "keywords": [
            "playground slide",
            "kids slide",
            "water slide"
        ],
        "params": {
            "color": {
                "type": "color",
                "default": "#e84b3c",
                "description": "main chute color"
            },
            "height": {
                "type": "number",
                "default": 2.2,
                "min": 1.2,
                "max": 4.5,
                "description": "platform height in meters"
            }
        },
        "size": [
            1.12,
            3.164,
            5.989
        ]
    },
    {
        "id": "robot",
        "description": "Friendly retro robot standing upright: boxy torso with a control panel, round head with glowing eyes and an antenna, jointed arms and legs",
        "category": "props",
        "keywords": [
            "robot",
            "droid",
            "android",
            "mech"
        ],
        "params": {
            "color": {
                "type": "color",
                "default": "#4f91a8",
                "description": "primary painted metal color"
            },
            "eyeColor": {
                "type": "color",
                "default": "#7dffda",
                "description": "glowing eye and indicator color"
            },
            "height": {
                "type": "number",
                "default": 2.2,
                "min": 0.8,
                "max": 8,
                "description": "overall robot height in meters"
            }
        },
        "size": [
            1.388,
            2.44,
            0.708
        ]
    },
    {
        "id": "rocket",
        "description": "Retro rocket ship on its fins, ready for launch.",
        "category": "vehicles",
        "keywords": [
            "rocket",
            "rocket ship",
            "spaceship",
            "space ship"
        ],
        "params": {
            "height": {
                "type": "number",
                "default": 6,
                "min": 1,
                "max": 40,
                "description": "height in meters"
            },
            "bodyColor": {
                "type": "color",
                "default": "#e8e8ee",
                "description": "body color"
            },
            "accentColor": {
                "type": "color",
                "default": "#d1453b",
                "description": "nose and fin color"
            }
        },
        "size": [
            2.014,
            6,
            2.326
        ]
    },
    {
        "id": "saguaro-cactus",
        "description": "Saguaro cactus: tall ribbed column with two or three upturned arms and small flowers on top",
        "category": "nature",
        "keywords": [
            "saguaro",
            "saguaro cactus",
            "desert cactus"
        ],
        "params": {
            "height": {
                "type": "number",
                "default": 5.5,
                "min": 1.5,
                "max": 14,
                "description": "Overall cactus height in meters"
            },
            "arms": {
                "type": "int",
                "default": 3,
                "min": 0,
                "max": 4,
                "description": "Number of upturned arms"
            },
            "color": {
                "type": "color",
                "default": "#3f7f4f",
                "description": "Primary cactus green"
            }
        },
        "size": [
            2.141,
            5.578,
            1.969
        ]
    },
    {
        "id": "sailing-ship",
        "description": "Wooden sailing ship (galleon) with a curved hull, deck, two masts with square sails and a bowsprit, about 14 m long",
        "category": "vehicles",
        "keywords": [
            "sailing ship",
            "ship",
            "galleon",
            "pirate ship",
            "sailboat"
        ],
        "params": {
            "hullColor": {
                "type": "color",
                "default": "#6f351d",
                "description": "Main stained wood color of the hull"
            },
            "sailColor": {
                "type": "color",
                "default": "#e8dcc0",
                "description": "Canvas color of the sails"
            },
            "length": {
                "type": "number",
                "default": 14,
                "min": 6,
                "max": 30,
                "description": "Overall ship length in meters, excluding some rigging"
            }
        },
        "size": [
            15.319,
            13.28,
            4.206
        ]
    },
    {
        "id": "satellite-dish",
        "description": "Large radio telescope satellite dish: parabolic reflector on a tilt mount, receiver arm and a concrete base",
        "category": "props",
        "keywords": [
            "satellite dish",
            "radio telescope",
            "antenna dish",
            "dish antenna"
        ],
        "params": {
            "diameter": {
                "type": "number",
                "default": 8,
                "min": 2,
                "max": 30,
                "description": "reflector diameter in meters"
            },
            "tilt": {
                "type": "number",
                "default": 35,
                "min": 5,
                "max": 80,
                "description": "dish elevation angle in degrees"
            },
            "color": {
                "type": "color",
                "default": "#d9dde0",
                "description": "reflector and structural frame color"
            }
        },
        "size": [
            6.815,
            9.618,
            8.245
        ]
    },
    {
        "id": "scarecrow",
        "description": "Scarecrow on a wooden cross post: burlap sack head with a straw hat, plaid shirt arms outstretched, straw tufts",
        "category": "props",
        "keywords": [
            "scarecrow"
        ],
        "params": {
            "shirtColor": {
                "type": "color",
                "default": "#8f3f36",
                "description": "Main color of the plaid shirt"
            },
            "hatColor": {
                "type": "color",
                "default": "#b8873f",
                "description": "Color of the straw hat"
            }
        },
        "size": [
            3.607,
            3.7,
            1.24
        ]
    },
    {
        "id": "seaweed",
        "description": "Clump of tall wavy kelp ribbons with small bladders, rooted on a rock",
        "category": "nature",
        "keywords": [
            "seaweed",
            "kelp",
            "sea grass"
        ],
        "params": {
            "color": {
                "type": "color",
                "default": "#547f2f",
                "description": "main kelp color"
            },
            "height": {
                "type": "number",
                "default": 3.2,
                "min": 0.8,
                "max": 10,
                "description": "overall kelp height in meters"
            },
            "strands": {
                "type": "int",
                "default": 9,
                "min": 3,
                "max": 20,
                "description": "number of tall kelp ribbons"
            }
        },
        "size": [
            1.673,
            3.519,
            1.414
        ]
    },
    {
        "id": "skyscraper",
        "description": "Modern glass skyscraper with setbacks, window grid bands, a lobby base and a rooftop antenna, about 60 m tall",
        "category": "architecture",
        "keywords": [
            "skyscraper",
            "office tower",
            "high rise",
            "highrise"
        ],
        "params": {
            "height": {
                "type": "number",
                "default": 60,
                "min": 24,
                "max": 150,
                "description": "Architectural height to the main roof in meters"
            },
            "floors": {
                "type": "int",
                "default": 20,
                "min": 8,
                "max": 50,
                "description": "Number of occupied floors"
            },
            "glassColor": {
                "type": "color",
                "default": "#4f7892",
                "description": "Primary curtain-wall glass color"
            },
            "lights": {
                "type": "boolean",
                "default": true,
                "description": "Show warm illuminated window bands"
            }
        },
        "size": [
            16.104,
            69.56,
            16.2
        ]
    },
    {
        "id": "snowman-deluxe",
        "description": "Snowman of three snowballs with a carrot nose, coal eyes and buttons, stick arms, a top hat and a knitted scarf",
        "category": "props",
        "keywords": [
            "snowman",
            "snow man"
        ],
        "params": {
            "scarfColor": {
                "type": "color",
                "default": "#b8324a",
                "description": "Color of the knitted scarf"
            },
            "height": {
                "type": "number",
                "default": 2.4,
                "min": 0.8,
                "max": 8,
                "description": "Overall snowman height in meters"
            }
        },
        "size": [
            2.11,
            2.816,
            1.25
        ]
    },
    {
        "id": "surfboard",
        "description": "Surfboard standing upright planted in sand, with a pointed nose, a fin and a center stripe",
        "category": "props",
        "keywords": [
            "surfboard",
            "surf board"
        ],
        "params": {
            "color": {
                "type": "color",
                "default": "#2f9eb3",
                "description": "main surfboard color"
            },
            "stripeColor": {
                "type": "color",
                "default": "#f4c95d",
                "description": "center stripe color"
            },
            "length": {
                "type": "number",
                "default": 2.1,
                "min": 1,
                "max": 4.5,
                "description": "surfboard length in meters"
            }
        },
        "size": [
            1.737,
            2.307,
            1.217
        ]
    },
    {
        "id": "swing-set",
        "description": "Playground swing set: A-frame metal posts, top bar, two swings hanging on chains with seats",
        "category": "props",
        "keywords": [
            "swing set",
            "playground swing"
        ],
        "params": {
            "color": {
                "type": "color",
                "default": "#2f78b7",
                "description": "main frame color"
            },
            "seats": {
                "type": "int",
                "default": 2,
                "min": 1,
                "max": 4,
                "description": "number of swings"
            }
        },
        "size": [
            3.07,
            2.432,
            1.73
        ]
    },
    {
        "id": "torii-gate",
        "description": "Japanese torii gate: two vermilion pillars on black bases, two crossbeams with the top one curved upward at the ends",
        "category": "architecture",
        "keywords": [
            "torii",
            "torii gate",
            "shrine gate"
        ],
        "params": {
            "color": {
                "type": "color",
                "default": "#d94a32",
                "description": "Vermilion color of the gate"
            },
            "height": {
                "type": "number",
                "default": 5,
                "min": 2,
                "max": 20,
                "description": "Overall gate height in meters"
            }
        },
        "size": [
            4.28,
            4.925,
            0.814
        ]
    },
    {
        "id": "totem-pole",
        "description": "Carved totem pole: stacked painted animal faces with beaks and wings near the top",
        "category": "props",
        "keywords": [
            "totem",
            "totem pole"
        ],
        "params": {
            "height": {
                "type": "number",
                "default": 6,
                "min": 2,
                "max": 20,
                "description": "Overall height of the totem pole in meters"
            }
        },
        "size": [
            3.69,
            6.075,
            1.913
        ]
    },
    {
        "id": "toy-tank",
        "description": "Chunky toy tank: rounded hull on two tread blocks with road wheels, turret with a short barrel, bright toy colors",
        "category": "vehicles",
        "keywords": [
            "toy tank",
            "army tank"
        ],
        "params": {
            "color": {
                "type": "color",
                "default": "#39b86b",
                "description": "main hull and turret color"
            },
            "trackColor": {
                "type": "color",
                "default": "#30343b",
                "description": "rubber tread color"
            }
        },
        "size": [
            2.325,
            1.725,
            2.432
        ]
    },
    {
        "id": "traffic-cone",
        "description": "Orange traffic cone with a square black base and two white reflective bands, 0.7 m tall",
        "category": "props",
        "keywords": [
            "traffic cone",
            "road cone",
            "safety cone"
        ],
        "params": {
            "color": {
                "type": "color",
                "default": "#f26a1b",
                "description": "cone body color"
            },
            "height": {
                "type": "number",
                "default": 0.7,
                "min": 0.3,
                "max": 2,
                "description": "overall cone height in meters"
            }
        },
        "size": [
            0.336,
            0.7,
            0.336
        ]
    },
    {
        "id": "train-engine",
        "description": "Old steam locomotive on a short rail segment: boiler with smokestack and dome, cab, cowcatcher, six driving wheels with rods",
        "category": "vehicles",
        "keywords": [
            "train",
            "train engine",
            "locomotive",
            "steam engine"
        ],
        "params": {
            "color": {
                "type": "color",
                "default": "#183b2b",
                "description": "main locomotive body color"
            },
            "trimColor": {
                "type": "color",
                "default": "#c69a3b",
                "description": "metal trim, bands and detail color"
            }
        },
        "size": [
            8.38,
            3.332,
            2.055
        ]
    },
    {
        "id": "volcano",
        "description": "Volcano: a wide rocky cone with a crater and glowing lava rivers running down its flanks, about 30 m tall",
        "category": "terrain",
        "keywords": [
            "volcano",
            "volcanic mountain"
        ],
        "params": {
            "height": {
                "type": "number",
                "default": 30,
                "min": 8,
                "max": 80,
                "description": "Volcano height in meters"
            },
            "lavaColor": {
                "type": "color",
                "default": "#ff4a0a",
                "description": "Color of the glowing molten lava"
            }
        },
        "size": [
            49.256,
            31.028,
            49.149
        ]
    },
    {
        "id": "waterfall",
        "description": "Waterfall: a stepped rock cliff with a wide translucent water sheet falling into a round pool with foam rocks",
        "category": "terrain",
        "keywords": [
            "waterfall",
            "cascade"
        ],
        "params": {
            "height": {
                "type": "number",
                "default": 5,
                "min": 2,
                "max": 15,
                "description": "Overall cliff height in meters"
            },
            "waterColor": {
                "type": "color",
                "default": "#48a9d6",
                "description": "Color of the waterfall and pool water"
            }
        },
        "size": [
            4.483,
            5.307,
            5.526
        ]
    },
    {
        "id": "wind-turbine",
        "description": "Modern wind turbine: tall tapered white tower, nacelle and three long slim blades",
        "category": "architecture",
        "keywords": [
            "wind turbine",
            "turbine"
        ],
        "params": {
            "height": {
                "type": "number",
                "default": 18,
                "min": 5,
                "max": 80,
                "description": "overall turbine height in meters"
            }
        },
        "size": [
            7.638,
            17.64,
            2.455
        ]
    },
    {
        "id": "wishing-well",
        "description": "Stone wishing well: round stone wall with water inside, two wooden posts, a small pitched roof, a crank and a bucket",
        "category": "architecture",
        "keywords": [
            "wishing well",
            "stone well",
            "water well",
            "old well"
        ],
        "params": {
            "stoneColor": {
                "type": "color",
                "default": "#8f918b",
                "description": "Main masonry color"
            },
            "roofColor": {
                "type": "color",
                "default": "#7b3f2a",
                "description": "Roof shingle color"
            }
        },
        "size": [
            2.385,
            2.71,
            1.94
        ]
    },
    {
        "id": "wizard-tower",
        "description": "Crooked wizard tower: stone round tower that leans slightly, small windows, a balcony, a tall pointed starry blue roof with a glowing orb on top",
        "category": "architecture",
        "keywords": [
            "wizard tower",
            "mage tower",
            "magic tower",
            "sorcerer tower"
        ],
        "params": {
            "roofColor": {
                "type": "color",
                "default": "#243b7a",
                "description": "Color of the tall starry roof"
            },
            "height": {
                "type": "number",
                "default": 9,
                "min": 4,
                "max": 24,
                "description": "Overall tower height in meters"
            }
        },
        "size": [
            3.41,
            9.603,
            3.41
        ]
    }
];
/** Lazy loaders (one JSON file per generator, its own chunk in the browser). */
export const LIBRARY_LOADERS = {
    'airplane': () => import('../library/airplane.json'),
    'beach-umbrella': () => import('../library/beach-umbrella.json'),
    'bookshelf': () => import('../library/bookshelf.json'),
    'bus': () => import('../library/bus.json'),
    'cart': () => import('../library/cart.json'),
    'castle-gate': () => import('../library/castle-gate.json'),
    'cave-entrance': () => import('../library/cave-entrance.json'),
    'coral': () => import('../library/coral.json'),
    'dragon-statue': () => import('../library/dragon-statue.json'),
    'ferris-wheel': () => import('../library/ferris-wheel.json'),
    'fountain': () => import('../library/fountain.json'),
    'helicopter': () => import('../library/helicopter.json'),
    'hero-car': () => import('../library/hero-car.json'),
    'hero-cherry-tree': () => import('../library/hero-cherry-tree.json'),
    'hero-explorer': () => import('../library/hero-explorer.json'),
    'hero-fountain': () => import('../library/hero-fountain.json'),
    'hero-gazebo': () => import('../library/hero-gazebo.json'),
    'hero-lantern': () => import('../library/hero-lantern.json'),
    'hero-ship': () => import('../library/hero-ship.json'),
    'hero-statue': () => import('../library/hero-statue.json'),
    'hot-air-balloon': () => import('../library/hot-air-balloon.json'),
    'igloo': () => import('../library/igloo.json'),
    'jellyfish': () => import('../library/jellyfish.json'),
    'lighthouse': () => import('../library/lighthouse.json'),
    'mailbox': () => import('../library/mailbox.json'),
    'mushroom-house': () => import('../library/mushroom-house.json'),
    'pagoda': () => import('../library/pagoda.json'),
    'palm-hut': () => import('../library/palm-hut.json'),
    'piano': () => import('../library/piano.json'),
    'picnic-table': () => import('../library/picnic-table.json'),
    'playground-slide': () => import('../library/playground-slide.json'),
    'robot': () => import('../library/robot.json'),
    'rocket': () => import('../library/rocket.json'),
    'saguaro-cactus': () => import('../library/saguaro-cactus.json'),
    'sailing-ship': () => import('../library/sailing-ship.json'),
    'satellite-dish': () => import('../library/satellite-dish.json'),
    'scarecrow': () => import('../library/scarecrow.json'),
    'seaweed': () => import('../library/seaweed.json'),
    'skyscraper': () => import('../library/skyscraper.json'),
    'snowman-deluxe': () => import('../library/snowman-deluxe.json'),
    'surfboard': () => import('../library/surfboard.json'),
    'swing-set': () => import('../library/swing-set.json'),
    'torii-gate': () => import('../library/torii-gate.json'),
    'totem-pole': () => import('../library/totem-pole.json'),
    'toy-tank': () => import('../library/toy-tank.json'),
    'traffic-cone': () => import('../library/traffic-cone.json'),
    'train-engine': () => import('../library/train-engine.json'),
    'volcano': () => import('../library/volcano.json'),
    'waterfall': () => import('../library/waterfall.json'),
    'wind-turbine': () => import('../library/wind-turbine.json'),
    'wishing-well': () => import('../library/wishing-well.json'),
    'wizard-tower': () => import('../library/wizard-tower.json'),
};
