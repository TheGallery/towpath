// The camera: a close boat view that follows you, looking a little ahead, and
// a guidebook map of the whole stretch. M eases between the two.

import { clamp, easeInOutCubic, lerp, smoothstep } from '../core/math';

/** World units across the shorter side of the screen in the boat view. */
export const NEAR_SPAN = 480;
/** Seconds to ease between the boat view and the map. */
export const MAP_TIME = 1.1;
/** How far ahead of the boat the view looks, as a share of the view's width. */
const LOOK_AHEAD = 0.14;

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export interface View {
  /** The visible rectangle of the world. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** How far the map has faded in, 0 to 1. */
  readonly mapFade: number;
  /** How far the map's names and route have faded in, 0 to 1. */
  readonly labelFade: number;
  /** World units per screen pixel, for things drawn at a fixed size on screen. */
  readonly unitsPerPixel: number;
}

export class FollowCamera {
  private open = false;
  /** 0 in the boat view, 1 on the map. */
  private t = 0;
  private look: { x: number; y: number } | null = null;

  constructor(readonly world: { readonly width: number; readonly height: number }) {}

  get mapOpen(): boolean {
    return this.open;
  }

  setMap(open: boolean): void {
    this.open = open;
  }

  /** Jump straight to the boat next time, rather than easing, as after the tab was hidden. */
  snap(): void {
    this.look = null;
  }

  update(dt: number, boat: { readonly x: number; readonly y: number; readonly angle: number }, viewport: Viewport): View {
    this.t = clamp(this.t + (this.open ? dt : -dt) / MAP_TIME, 0, 1);
    const e = easeInOutCubic(this.t);
    const aspect = viewport.width / Math.max(1, viewport.height);
    const nearWidth = aspect >= 1 ? NEAR_SPAN * aspect : NEAR_SPAN;
    // A margin round the map keeps its edges clear of the panels.
    const farWidth = Math.max(this.world.width, this.world.height * aspect) * 1.12;
    const width = nearWidth * (farWidth / nearWidth) ** e;
    const height = width / aspect;

    // The look-ahead swings round smoothly at bends.
    const k = this.look ? 1 - Math.exp(-dt * 1.4) : 1;
    const look = this.look ?? { x: 0, y: 0 };
    look.x = lerp(look.x, Math.cos(boat.angle), k);
    look.y = lerp(look.y, Math.sin(boat.angle), k);
    this.look = look;
    const ahead = LOOK_AHEAD * nearWidth * (1 - e);
    let cx = lerp(boat.x + look.x * ahead, this.world.width / 2, e);
    let cy = lerp(boat.y + look.y * ahead, this.world.height / 2, e);
    cx = width >= this.world.width ? this.world.width / 2 : clamp(cx, width / 2, this.world.width - width / 2);
    cy = height >= this.world.height ? this.world.height / 2 : clamp(cy, height / 2, this.world.height - height / 2);

    return {
      x: cx - width / 2,
      y: cy - height / 2,
      width,
      height,
      mapFade: smoothstep(0.35, 0.85, this.t),
      labelFade: smoothstep(0.6, 1, this.t),
      unitsPerPixel: width / Math.max(1, viewport.width),
    };
  }
}
