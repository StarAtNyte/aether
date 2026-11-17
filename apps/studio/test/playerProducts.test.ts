/**
 * Product cards of the standalone player (`src/player/products/model.ts`): a click on any part of a product finds it, the
 * card shows what the world says, and the Rug Exhibition Hall ships a catalogue.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateWorld } from "@aether/core";
import { PICK_EVENT } from "../src/player/explore";
import {
  ASK_GUIDE_EVENT,
  hasProducts,
  PICK_ENTITY_EVENT,
  productCard,
  productOwner,
  SHOW_PRODUCT_EVENT,
  type ProductWorld,
} from "../src/player/products/model";

const world = (guide?: unknown): ProductWorld => ({
  entities: {
    stand: { name: "Stand", parent: null },
    rug: {
      name: "Teal rug",
      parent: "stand",
      product: {
        price: "€900",
        size: "160 × 230 cm",
        details: "Wool.",
        url: "https://shop.example/rug",
        action: "buy",
      },
    },
    fringe: { name: "Fringe", parent: "rug" },
    knot: { name: "Knot", parent: "fringe" },
    lamp: {
      name: "Lamp",
      parent: null,
      product: { name: "  Brass lamp ", url: "mailto:hello@shop.example" },
    },
    vase: { name: "Vase", parent: null, product: {} },
    loopA: { name: "A", parent: "loopB" },
    loopB: { name: "B", parent: "loopA" },
  },
  ...(guide !== undefined ? { guide } : {}),
});

describe("product pick", () => {
  it("finds the product an entity or one of its ancestors is", () => {
    const w = world();
    expect(productOwner(w, "rug")).toBe("rug");
    expect(productOwner(w, "fringe")).toBe("rug");
    expect(productOwner(w, "knot")).toBe("rug");
    expect(productOwner(w, "stand")).toBeNull();
    expect(productOwner(w, "missing")).toBeNull();
    expect(productOwner(w, null)).toBeNull();
    expect(productOwner(w, "loopA")).toBeNull();
  });

  it("knows whether a world has products", () => {
    expect(hasProducts(world())).toBe(true);
    expect(hasProducts({ entities: { a: { name: "A", parent: null } } })).toBe(
      false,
    );
  });

  it("uses the same pick event name as the explore controller", () => {
    expect(PICK_ENTITY_EVENT).toBe(PICK_EVENT);
    expect(SHOW_PRODUCT_EVENT).toBe("aether:show-product");
    expect(ASK_GUIDE_EVENT).toBe("aether:ask-guide");
  });
});

describe("product card", () => {
  it("shows the product of a child mesh, with Buy", () => {
    expect(productCard(world(), "knot")).toEqual({
      id: "rug",
      name: "Teal rug",
      price: "€900",
      size: "160 × 230 cm",
      details: "Wool.",
      action: { label: "Buy", url: "https://shop.example/rug", mail: false },
      askGuide: false,
    });
  });

  it("defaults to Enquire, trims the name, and knows a mail link", () => {
    expect(productCard(world(), "lamp")).toMatchObject({
      name: "Brass lamp",
      action: {
        label: "Enquire",
        url: "mailto:hello@shop.example",
        mail: true,
      },
    });
  });

  it("has no button without a link, and Ask the guide only with a guide", () => {
    const c = productCard(world(), "vase");
    expect(c).toMatchObject({ name: "Vase", action: null, askGuide: false });
    expect(c).not.toHaveProperty("price");
    expect(productCard(world({ greeting: "Hi" }), "vase")?.askGuide).toBe(true);
  });

  it("refuses a link that is not https or mailto", () => {
    const w: ProductWorld = {
      entities: {
        a: { name: "A", parent: null, product: { url: "javascript:alert(1)" } },
      },
    };
    expect(productCard(w, "a")?.action).toBeNull();
  });

  it("is null for a non-product", () => {
    expect(productCard(world(), "stand")).toBeNull();
  });
});

describe("Rug Exhibition Hall catalogue", () => {
  const file = join(
    import.meta.dirname,
    "../public/templates/worlds/rug-exhibition-hall.json",
  );
  const raw = JSON.parse(readFileSync(file, "utf8")) as { world: unknown };
  const v = validateWorld(raw.world);

  it("gives every named rug a product with a name, size, price and details", () => {
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const rugs = Object.values(v.world.entities).filter(
      (e) => e.shape.kind === "asset" && /\b(rug|runner)\b/i.test(e.name),
    );
    expect(rugs.length).toBeGreaterThan(20);
    for (const e of rugs) {
      expect(e.product, e.id).toBeDefined();
      const c = productCard(v.world, e.id)!;
      expect(c.name.length).toBeGreaterThan(3);
      expect(c.size).toMatch(/^\d+ × \d+ cm$/);
      expect(c.price).toMatch(/^€[\d,]+$/);
      expect(c.details!.length).toBeGreaterThan(20);
      expect(c.action).toBeNull();
    }
  });
});
