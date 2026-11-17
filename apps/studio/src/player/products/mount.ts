/**
 * Product cards of the standalone player: a click on a product (an entity with `product`, or any part of one) opens its
 * card with the name, size, price, details and an Enquire or Buy button; hovering one shows a pointer and its name.
 *
 * Clicks come from explore mode's pick event (`aether:pick-entity`, sent by `../explore.ts` before the walk view glides;
 * the card cancels it so the camera stays) and, while playing, from the canvas itself. The guide opens a card with
 * `aether:show-product` (`detail: { id }`); "Ask the guide" sends `aether:ask-guide` (`detail: { id }`).
 *
 * Lazy-loaded by `PlayerApp.tsx` for worlds with products only.
 */
import type { EntityId } from "@aether/core";
import type { Simulation } from "../../engine/Simulation";
import {
  ASK_GUIDE_EVENT,
  PICK_ENTITY_EVENT,
  productCard,
  productOwner,
  SHOW_PRODUCT_EVENT,
  type ProductCard,
  type ProductWorld,
} from "./model";
import "../products.css";

/** Least time (ms) between two hover raycasts. */
const HOVER_MS = 80;
/** Farthest product a hover or a click reaches (m). */
const REACH = 80;
/** Pointer travel (px) above which a press is a drag, not a click (play mode). */
const CLICK_SLOP = 6;

/** Mount the cards over `host` (the player root); returns the unmount. */
export function mountProducts(
  sim: Simulation,
  world: ProductWorld,
  host: HTMLElement,
): () => void {
  const canvas = sim.renderer.domElement;
  let card: HTMLElement | null = null;
  let openId: EntityId | null = null;
  let returnFocus: HTMLElement | null = null;

  const label = document.createElement("div");
  label.className = "pl-prod-hover";
  label.setAttribute("aria-hidden", "true");
  label.hidden = true;
  host.appendChild(label);

  /** The product under client coordinates (null: none). */
  const productAt = (clientX: number, clientY: number): EntityId | null => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);
    const r = sim.renderer;
    const ray = r.cursorRay(ndcX, ndcY);
    return productOwner(
      world,
      r.raycastWorld(ray.origin, ray.direction, REACH)?.id,
    );
  };

  const close = (): void => {
    if (!card) return;
    card.remove();
    card = null;
    openId = null;
    const back = returnFocus;
    returnFocus = null;
    if (back?.isConnected) back.focus({ preventScroll: true });
    else canvas.focus({ preventScroll: true });
  };

  const open = (id: EntityId | null | undefined): boolean => {
    const model = productCard(world, id);
    if (!model) return false;
    if (openId === model.id && card) {
      card.focus({ preventScroll: true });
      return true;
    }
    const active = document.activeElement;
    if (!card)
      returnFocus =
        active instanceof HTMLElement && active !== document.body
          ? active
          : null;
    card?.remove();
    card = renderCard(model, close);
    openId = model.id;
    host.appendChild(card);
    card.focus({ preventScroll: true });
    hideLabel();
    return true;
  };

  // Explore mode: the click explore.ts picked (cancel it: the camera does not glide to the product).
  const onPick = (e: Event): void => {
    const id = (e as CustomEvent<{ id?: unknown }>).detail?.id;
    if (typeof id === "string" && open(id)) e.preventDefault();
  };
  const onShow = (e: Event): void => {
    const id = (e as CustomEvent<{ id?: unknown }>).detail?.id;
    if (typeof id === "string") open(id);
    // `{ id: null }`: close the card (the guide moving on to a stop without a product).
    else if (id === null) close();
  };

  // Play mode (no explore controller): a click on the canvas without pointer lock.
  let press: { id: number; x: number; y: number } | null = null;
  const onDown = (e: PointerEvent): void => {
    press =
      sim.mode === "play" &&
      e.isPrimary &&
      (e.pointerType !== "mouse" || e.button === 0)
        ? { id: e.pointerId, x: e.clientX, y: e.clientY }
        : null;
  };
  const onUp = (e: PointerEvent): void => {
    const p = press;
    press = null;
    if (
      !p ||
      p.id !== e.pointerId ||
      sim.mode !== "play" ||
      document.pointerLockElement
    )
      return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK_SLOP) return;
    open(productAt(e.clientX, e.clientY));
  };

  // Hover: a pointer and the product's name, at most one raycast per HOVER_MS.
  let lastCast = 0;
  let trailing: ReturnType<typeof setTimeout> | null = null;
  let pending: { x: number; y: number } | null = null;
  let hovered: EntityId | null = null;
  function hideLabel(): void {
    hovered = null;
    label.hidden = true;
    canvas.style.cursor = "";
  }
  const cast = (): void => {
    trailing = null;
    const at = pending;
    pending = null;
    if (!at) return;
    lastCast = performance.now();
    const id = productAt(at.x, at.y);
    if (!id) {
      if (hovered) hideLabel();
      return;
    }
    if (id !== hovered) {
      hovered = id;
      const m = productCard(world, id);
      label.textContent = m
        ? m.price
          ? `${m.name} · ${m.price}`
          : m.name
        : "";
    }
    const rect = host.getBoundingClientRect();
    label.style.transform = `translate(${Math.round(at.x - rect.left + 14)}px, ${Math.round(at.y - rect.top + 18)}px)`;
    label.hidden = false;
    canvas.style.cursor = "pointer";
  };
  const onMove = (e: PointerEvent): void => {
    if (
      e.pointerType === "touch" ||
      e.buttons !== 0 ||
      document.pointerLockElement
    ) {
      if (hovered) hideLabel();
      pending = null;
      return;
    }
    pending = { x: e.clientX, y: e.clientY };
    if (trailing) return;
    const wait = HOVER_MS - (performance.now() - lastCast);
    if (wait <= 0) cast();
    else trailing = setTimeout(cast, wait);
  };
  const onLeave = (): void => {
    pending = null;
    if (hovered) hideLabel();
  };

  // Escape closes the card before the player's own Escape (the menu); keys pressed on the card stay with it.
  const onKey = (e: KeyboardEvent): void => {
    if (!card) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
      return;
    }
    if (e.target instanceof Node && card.contains(e.target) && e.key !== "Tab")
      e.stopImmediatePropagation();
  };

  window.addEventListener(PICK_ENTITY_EVENT, onPick);
  window.addEventListener(SHOW_PRODUCT_EVENT, onShow);
  window.addEventListener("keydown", onKey, { capture: true });
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);
  return () => {
    window.removeEventListener(PICK_ENTITY_EVENT, onPick);
    window.removeEventListener(SHOW_PRODUCT_EVENT, onShow);
    window.removeEventListener("keydown", onKey, { capture: true });
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointerup", onUp);
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerleave", onLeave);
    if (trailing) clearTimeout(trailing);
    canvas.style.cursor = "";
    card?.remove();
    card = null;
    label.remove();
  };
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  textContent?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  n.className = className;
  if (textContent !== undefined) n.textContent = textContent;
  return n;
}

let cardSerial = 0;

/** The card's DOM (text only through textContent: product data comes from the world file). */
function renderCard(m: ProductCard, close: () => void): HTMLElement {
  const titleId = `pl-prod-title-${++cardSerial}`;
  const card = el("section", "pl-prod");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-labelledby", titleId);
  card.tabIndex = -1;
  card.dataset.testid = "pl-product-card";
  card.dataset.product = m.id;

  const x = el("button", "pl-prod__close");
  x.type = "button";
  x.setAttribute("aria-label", "Close");
  x.innerHTML =
    '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  x.addEventListener("click", close);
  card.appendChild(x);

  card.appendChild(el("p", "pl-prod__eyebrow", "On show"));
  const h = el("h2", "pl-prod__name", m.name);
  h.id = titleId;
  card.appendChild(h);

  if (m.price || m.size) {
    const meta = el("div", "pl-prod__meta");
    if (m.price) meta.appendChild(el("span", "pl-prod__price", m.price));
    if (m.size) meta.appendChild(el("span", "pl-prod__size", m.size));
    card.appendChild(meta);
  }
  if (m.details) card.appendChild(el("p", "pl-prod__details", m.details));

  const actions = el("div", "pl-prod__actions");
  if (m.action) {
    const a = el("a", "pl-btn pl-btn--primary pl-prod__buy", m.action.label);
    a.href = m.action.url;
    if (!m.action.mail) a.target = "_blank";
    a.rel = "noopener noreferrer";
    actions.appendChild(a);
  }
  if (m.askGuide) {
    const ask = el("button", "pl-btn pl-prod__ask", "Ask the guide");
    ask.type = "button";
    ask.addEventListener("click", () =>
      window.dispatchEvent(
        new CustomEvent(ASK_GUIDE_EVENT, { detail: { id: m.id } }),
      ),
    );
    actions.appendChild(ask);
  }
  if (actions.childElementCount > 0) card.appendChild(actions);
  if (!m.action)
    card.appendChild(
      el("p", "pl-prod__note", "This showroom is not connected to a shop yet."),
    );
  return card;
}
