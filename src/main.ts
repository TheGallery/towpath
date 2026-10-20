import './style.css';
import { FixedStepClock } from './core/clock';
import { clamp } from './core/math';
import { poseAt } from './core/track';
import { paintScenery } from './render/scenery';
import { Scene } from './render/scene';
import { describe, upcoming } from './sim/status';
import { castOff, newTrip, planTrip, steersItselfHere, stepTrip, tripDuration } from './sim/trip';
import type { TripEvent } from './sim/trip';
import { GAME_TITLE } from './title';
import { Hud } from './ui/hud';
import { Keyboard } from './ui/input';
import { FollowCamera } from './view/camera';
import { milesPerHour } from './world/dimensions';
import { HALLAM } from './world/hallam';
import { resolveStretch } from './world/stretch';

document.title = GAME_TITLE;

/** Seconds of game time per simulation step. */
const STEP = 1 / 30;
/** The most game time to catch up on at once, after the computer sleeps. */
const MAX_CATCH_UP = 10 * 60;

/** `?speed=N` runs the game N times faster, for trying things out. */
function readRate(search: string): number {
  const asked = Number(new URLSearchParams(search).get('speed'));
  return Number.isFinite(asked) && asked > 0 ? clamp(asked, 0.25, 60) : 1;
}

const stretch = resolveStretch(HALLAM);
const plan = planTrip(stretch);
let trip = newTrip(plan);
const rate = readRate(window.location.search);
const clock = new FixedStepClock(STEP, MAX_CATCH_UP);
const camera = new FollowCamera(stretch.data.size);

const found = document.getElementById('game');
if (!found) throw new Error('The page is missing #game');
const game: HTMLElement = found;
const scene = new Scene(game, stretch, paintScenery(stretch));

const toggleMap = (open = !camera.mapOpen) => camera.setMap(open);
const hud = new Hud(document, {
  startName: plan.startName,
  endName: plan.endName,
  tripMinutes: tripDuration(plan) / 60,
  rate,
  onCastOff: () => handle(castOff(trip)),
  onStartAgain: () => {
    trip = newTrip(plan);
    hintedAt = -Infinity;
    camera.snap();
    handle(castOff(trip));
  },
  onToggleMap: () => toggleMap(),
});
const keyboard = new Keyboard(window, (command) => toggleMap(command === 'toggle-map' ? undefined : false));

const HELM_TAKEN: Record<'lock' | 'junction' | 'mooring', string> = {
  lock: 'The boat takes itself through the lock.',
  junction: 'The boat takes the turn at the junction itself.',
  mooring: 'The boat brings itself in to moor.',
};

function handle(events: readonly TripEvent[]): void {
  for (const e of events) {
    if (e.kind === 'handed-back') hud.toast('The boat is steering itself again.');
    else if (e.kind === 'helm-taken') hud.toast(HELM_TAKEN[e.reason]);
    else if (e.kind === 'bump') hud.toast(e.what === 'bank' ? 'Bump! Boats nudge the bank all the time. No harm done.' : 'Bump! A gentle knock on a moored boat. Pass them slowly, and keep to the far side.');
  }
}

let hintedAt = -Infinity;
function simulate(now: number): void {
  const steps = clock.advance(now, rate);
  if (!steps) return;
  const controls = keyboard.controls();
  const events: TripEvent[] = [];
  for (let i = 0; i < steps; i++) events.push(...stepTrip(trip, plan, controls, STEP));
  handle(events);

  // Say why the tiller isn't answering where the boat steers itself.
  const touching = controls.rudder !== 0 || controls.throttle !== 0;
  const reason = trip.phase === 'in-lock' ? 'lock' : steersItselfHere(plan, trip.boat.s);
  if (touching && reason && trip.phase !== 'moored' && trip.phase !== 'arrived' && trip.time - hintedAt > 8) {
    hintedAt = trip.time;
    hud.toast(HELM_TAKEN[reason]);
  }
}

let lastFrame: number | null = null;
function frame(now: number): void {
  simulate(now);
  const dt = lastFrame === null ? 0 : Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;

  const { boat } = trip;
  const p = poseAt(plan.route, boat.s, boat.d);
  const viewport = { width: game.clientWidth, height: game.clientHeight };
  const view = camera.update(dt, { x: p.x, y: p.y, angle: p.angle + boat.psi }, viewport);
  scene.render(trip, view, viewport.width);
  hud.update({
    phase: trip.phase,
    status: describe(trip, plan),
    helm: trip.helm,
    mph: milesPerHour(boat.v),
    next: upcoming(plan.places, boat.s),
    mapOpen: camera.mapOpen,
  });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Browsers stop drawing hidden tabs, but the canal carries on: keep the
// game's clock running with a timer until the tab is back.
let hiddenTimer = 0;
document.addEventListener('visibilitychange', () => {
  window.clearInterval(hiddenTimer);
  if (document.hidden) hiddenTimer = window.setInterval(() => simulate(performance.now()), 1000);
  else {
    lastFrame = null;
    camera.snap();
  }
});
