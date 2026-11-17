/**
 * Product cards of the standalone player, the pure part: which entity a click on the world belongs to (the entity or the
 * nearest ancestor with `product`), and what its card shows. The DOM is in `mount.ts`.
 */
import type { EntityId, ProductSpec } from "@aether/core";

/** The world as far as the cards read it. */
export interface ProductWorld {
  entities: Readonly<
    Record<
      string,
      {
        name: string;
        parent: EntityId | null;
        product?: ProductSpec | undefined;
      }
    >
  >;
  guide?: unknown;
}

/** Window events of the cards (the guide sends and listens to them). */
export const SHOW_PRODUCT_EVENT = "aether:show-product";
export const ASK_GUIDE_EVENT = "aether:ask-guide";
/** Must equal `PICK_EVENT` of `../explore.ts` (not imported: that module is in another lazy chunk). */
export const PICK_ENTITY_EVENT = "aether:pick-entity";

/** Links a card may open: a shop page over https, or an e-mail address. */
const SAFE_URL = /^(https:\/\/|mailto:)[^\s"'<>]+$/;

/** True when any entity of the world is a product. */
export function hasProducts(world: ProductWorld): boolean {
  for (const id in world.entities) if (world.entities[id]?.product) return true;
  return false;
}

/** The product an entity belongs to: itself or its nearest ancestor with `product` (null: none). */
export function productOwner(
  world: ProductWorld,
  id: EntityId | null | undefined,
): EntityId | null {
  const seen = new Set<string>();
  let cur: string | null | undefined = id;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const e = world.entities[cur];
    if (!e) return null;
    if (e.product) return cur;
    cur = e.parent;
  }
  return null;
}

/** What a product card shows. */
export interface ProductCard {
  id: EntityId;
  name: string;
  size?: string;
  price?: string;
  details?: string;
  /** The main button; null: the showroom has no shop link yet. */
  action: { label: "Buy" | "Enquire"; url: string; mail: boolean } | null;
  /** Show "Ask the guide" (the world has a guide). */
  askGuide: boolean;
}

const text = (s: string | undefined): string | undefined => {
  const t = s?.trim();
  return t ? t : undefined;
};

/** The card of the product `id` belongs to (null: not a product). */
export function productCard(
  world: ProductWorld,
  id: EntityId | null | undefined,
): ProductCard | null {
  const owner = productOwner(world, id);
  if (!owner) return null;
  const e = world.entities[owner]!;
  const p = e.product!;
  const url = text(p.url);
  const card: ProductCard = {
    id: owner,
    name: text(p.name) ?? text(e.name) ?? "Product",
    action:
      url && SAFE_URL.test(url)
        ? {
            label: p.action === "buy" ? "Buy" : "Enquire",
            url,
            mail: url.startsWith("mailto:"),
          }
        : null,
    askGuide: world.guide !== undefined && world.guide !== null,
  };
  const size = text(p.size);
  const price = text(p.price);
  const details = text(p.details);
  if (size) card.size = size;
  if (price) card.price = price;
  if (details) card.details = details;
  return card;
}
