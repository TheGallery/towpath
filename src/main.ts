import './style.css';
import { FixedStepClock } from './core/clock';
import { clamp } from './core/math';
import { poseAt } from './core/track';
import { paintScenery } from './render/scenery';
import { Scene } from './render/scene';
import type { Focus } from './render/scene';
import type { OtherWay } from './sim/otherboat';
import { PART_NAMES, describe, upcoming } from './sim/status';
import { NO_CONTROLS, boatsAt, castOff, lockForYou, newTrip, planTrip, steersItselfHere, stepTrip, tripDuration } from './sim/trip';
import type { TripEvent } from './sim/trip';
import { GAME_TITLE } from './title';
import { Closeup } from './ui/closeup';
import { Hud } from './ui/hud';
import { Keyboard } from './ui/input';
import { FollowCamera } from './view/camera';
import type { View } from './view/camera';
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

/** `?lock=ready` or `?lock=against` picks how the other boat leaves the lock, for trying things out. */
function readOtherWay(search: string): OtherWay | null {
  const asked = new URLSearchParams(search).get('lock');
  return asked === 'ready' ? 'down' : asked === 'against' ? 'up' : null;
}

const stretch = resolveStretch(HALLAM);
const plan = planTrip(stretch);
const askedWay = readOtherWay(window.location.search);
// It's luck whether the other boat is coming down or going up ahead of you, and the next trip gets the other.
let otherWay: OtherWay = askedWay ?? (Math.random() < 0.5 ? 'down' : 'up');
let trip = newTrip(plan, { other: otherWay });
const rate = readRate(window.location.search);
const clock = new FixedStepClock(STEP, MAX_CATCH_UP);
const camera = new FollowCamera(stretch.data.size);

const found = document.getElementById('game');
if (!found) throw new Error('The page is missing #game');
const game: HTMLElement = found;
const scene = new Scene(game, stretch, paintScenery(stretch), plan.other, () => workLock());

const closeupRoot = document.getElementById('closeup');
if (!closeupRoot) throw new Error('The page is missing #closeup');
const closeup = new Closeup(closeupRoot, () => {
  game.classList.remove('closeup-open');
  // After the next frame has shown the work button again.
  requestAnimationFrame(() => hud.focusWork());
});
let lastView: View | null = null;

/** Goes to the part of the lock that needs you and opens its close-up, or, in a close-up, does the next thing. */
function workLock(): void {
  if (closeup.isOpen) {
    closeup.press();
    return;
  }
  const yours = lockForYou(trip);
  if (!yours?.next || camera.mapOpen) return;
  const { lock, state, next } = yours;
  const at = scene.partPoint(lock.id, next.part, state);
  const from = at && lastView ? { x: ((at[0] - lastView.x) / lastView.width) * game.clientWidth, y: ((at[1] - lastView.y) / lastView.height) * game.clientHeight } : { x: game.clientWidth / 2, y: game.clientHeight / 2 };
  game.classList.add('closeup-open');
  closeup.open({ lockName: lock.name, lock: state, part: next.part, target: next.target, boats: () => boatsAt(trip, plan, lock), from });
}

const toggleMap = (open = !camera.mapOpen) => {
  if (!closeup.isOpen) camera.setMap(open);
};
const hud = new Hud(document, {
  startName: plan.startName,
  endName: plan.endName,
  tripMinutes: tripDuration(plan) / 60,
  rate,
  onCastOff: () => handle(castOff(trip)),
  onStartAgain: () => {
    otherWay = askedWay ?? (otherWay === 'down' ? 'up' : 'down');
    trip = newTrip(plan, { other: otherWay });
    hintedAt = -Infinity;
    camera.snap();
    handle(castOff(trip));
  },
  onToggleMap: () => toggleMap(),
  onWork: () => workLock(),
});
const keyboard = new Keyboard(window, (command) => {
  if (command === 'work') workLock();
  else if (command === 'toggle-map') toggleMap();
  else if (closeup.isOpen) closeup.close();
  else toggleMap(false);
});

const HELM_TAKEN: Record<'lock' | 'junction' | 'mooring', string> = {
  lock: 'The boat steers itself at the lock, so you can work it.',
  junction: 'The boat takes the turn at the junction itself.',
  mooring: 'The boat brings itself in to moor.',
};

const lockName = (id: string): string => plan.locks.find((l) => l.id === id)?.name ?? 'The lock';

function handle(events: readonly TripEvent[]): void {
  for (const e of events) {
    if (e.kind === 'reached-lock' && e.waiting) {
      hud.toast(trip.other?.way === 'down' ? `Another boat is coming down through ${lockName(e.lock)}. Yours waits its turn.` : `The boat ahead is going up through ${lockName(e.lock)}. Yours waits its turn.`);
    } else if (e.kind === 'lock-yours') {
      const name = lockName(e.lock);
      if (e.ready) hud.toast(trip.other?.way === 'down' ? `The other boat left ${name} empty, with the gates open for you.` : `${name} is ready for you.`);
      else hud.toast(trip.other?.way === 'up' ? `The boat ahead left ${name} full, so you'll need to empty it first.` : `${name} is set against you, so you'll need to level it first.`);
    } else if (e.kind === 'lock' && e.event.kind === 'level') {
      hud.toast(e.event.full ? 'The lock is full.' : 'The lock is empty.');
    } else if (e.kind === 'cleared-lock') {
      hud.toast(`Through ${lockName(e.lock)}. The gates swing shut behind you.`);
    } else if (e.kind === 'handed-back') hud.toast('The boat is steering itself again.');
    else if (e.kind === 'helm-taken') hud.toast(HELM_TAKEN[e.reason]);
    else if (e.kind === 'bump') hud.toast(e.what === 'bank' ? 'Bump! Boats nudge the bank all the time. No harm done.' : 'Bump! A gentle knock on a moored boat. Pass them slowly, and keep to the far side.');
  }
}

let hintedAt = -Infinity;
function simulate(now: number): void {
  const steps = clock.advance(now, rate);
  if (!steps) return;
  // In a close-up the keys work the lock, not the tiller.
  const controls = closeup.isOpen ? NO_CONTROLS : keyboard.controls();
  const keys = keyboard.closeupKeys();
  const events: TripEvent[] = [];
  for (let i = 0; i < steps; i++) {
    closeup.step(STEP, keys);
    events.push(...stepTrip(trip, plan, controls, STEP));
  }
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
  lastView = view;
  // The part of the lock that needs you glows; while the water moves or the boat comes in, the gates you'll work next are marked too.
  const yours = closeup.isOpen ? null : lockForYou(trip);
  const focus: Focus | null = yours?.next ? { lock: yours.lock.id, part: yours.next.part, glow: yours.job.kind !== 'wait-water' && yours.job.kind !== 'boat-in' } : null;
  scene.render(trip, view, viewport.width, focus);
  closeup.render(dt);
  hud.update({
    phase: trip.phase,
    status: describe(trip, plan),
    helm: trip.helm,
    mph: milesPerHour(boat.v),
    next: upcoming(plan.places, boat.s),
    mapOpen: camera.mapOpen,
    work: focus ? `Go to the ${PART_NAMES[focus.part]}` : null,
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
