import './style.css';
import { FixedStepClock } from './core/clock';
import { clamp } from './core/math';
import { paintScenery } from './render/scenery';
import { Scene } from './render/scene';
import type { Focus, WayChoice } from './render/scene';
import { waitedFor } from './sim/calls';
import { answerLock, boatPose, canChooseWay, castOffDay, chooseSpot, chooseWay, dayTimeline, eveningBegan, forkAhead, lightAt, needsYou, newDay, planDay, stepDay } from './sim/day';
import type { DayEvent, Fork } from './sim/day';
import { logLines } from './sim/logbook';
import type { OtherWay } from './sim/otherboat';
import { makeCanal } from './sim/playable';
import { loadGame, saveGame } from './sim/save';
import { PART_NAMES, callTitle, describeDay, forkWords, upcoming, waitedWords, wayWords } from './sim/status';
import { NO_CONTROLS, boatsAt, lockForYou, steersItselfHere, wantsPart } from './sim/trip';
import type { TripPlan } from './sim/trip';
import { planWalkers } from './sim/walkers';
import { planWeather, weatherAt } from './sim/weather';
import type { Weather, WeatherName } from './sim/weather';
import { GAME_TITLE, tabTitle } from './title';
import { Bell } from './ui/bell';
import { Closeup } from './ui/closeup';
import { Hud } from './ui/hud';
import type { Choice } from './ui/hud';
import { Keyboard } from './ui/input';
import { LogbookView } from './ui/logbook';
import { FollowCamera } from './view/camera';
import type { View } from './view/camera';
import { milesPerHour } from './world/dimensions';
import { HALLAM } from './world/hallam';
import { resolveStretch } from './world/stretch';
import type { StretchData } from './world/stretch';
import { towpathRuns } from './world/towpath';

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

/** `?lock=ready` or `?lock=against` picks how the other boat leaves the lock on a new day, for trying things out. */
function readOtherWay(search: string): OtherWay | null {
  const asked = new URLSearchParams(search).get('lock');
  return asked === 'ready' ? 'down' : asked === 'against' ? 'up' : null;
}

/** `?weather=mist`, `drizzle` or `clear` sets the weather for every day, for trying things out. */
function readWeather(search: string): WeatherName | null {
  const asked = new URLSearchParams(search).get('weather');
  return asked === 'mist' || asked === 'drizzle' || asked === 'clear' ? asked : null;
}

/** `?seed=N` plays the canal made from seed N, a whole number, for trying things out; without it, or with `?seed=hallam`, it's the Hallam Canal. */
function readSeed(search: string): number | null {
  const asked = new URLSearchParams(search).get('seed');
  const seed = asked === null || asked === '' ? NaN : Number(asked);
  return Number.isSafeInteger(seed) && seed >= 0 ? seed : null;
}

/** Where your place is kept in the browser between visits, on the Hallam Canal or on a canal made from a seed, so trying one never loses the other. */
const KEPT_KEY = 'towpath:place';
const MADE_KEPT_KEY = 'towpath:place:made';
/** How often your place is kept while you play, in milliseconds, besides when the tab is hidden or closed. */
const KEEP_EVERY = 5000;

/** Browser storage can be switched off or full, and the game carries on without it. */
function readKept(): string | null {
  try {
    return window.localStorage.getItem(keptKey);
  } catch {
    return null;
  }
}

const askedSeed = readSeed(window.location.search);
// A seed that never makes a playable canal falls back to the Hallam Canal.
const canal: StretchData = askedSeed === null ? HALLAM : makeCanal(askedSeed).data;
const keptKey = canal === HALLAM ? KEPT_KEY : MADE_KEPT_KEY;
const stretch = resolveStretch(canal);
const dayPlan = planDay(stretch);
const runs = towpathRuns(stretch);
const walkers = planWalkers(runs, canal.seed);
const askedWay = readOtherWay(window.location.search);
// `?fresh` sets your kept place aside and starts a new day.
const kept = new URLSearchParams(window.location.search).has('fresh') ? null : loadGame(readKept(), dayPlan, canal);
// It's luck whether the other boat is coming down or going up ahead of you, and the next day gets the other.
let otherWay: OtherWay = kept?.other ?? askedWay ?? (Math.random() < 0.5 ? 'down' : 'up');
let day = kept?.day ?? newDay(dayPlan, { other: otherWay });
const askedWeather = readWeather(window.location.search);
// Each day's weather comes from the seed and the day's number, so a kept day comes back with the same sky.
let weather: Weather = planWeather(canal.seed, day.number, askedWeather);
const rate = readRate(window.location.search);
const clock = new FixedStepClock(STEP, MAX_CATCH_UP);
const camera = new FollowCamera(stretch.data.size);
const bell = new Bell(window);
bell.on = kept?.bell ?? true;

let keptAt = 0;
/** Keeps your place in the browser, so closing or reloading the tab carries on from here. */
function keepPlace(): void {
  keptAt = performance.now();
  try {
    window.localStorage.setItem(keptKey, saveGame({ day, other: otherWay, bell: bell.on }, canal));
  } catch {
    // No storage: the day goes on, but won't be kept.
  }
}

const found = document.getElementById('game');
if (!found) throw new Error('The page is missing #game');
const game: HTMLElement = found;
const scene = new Scene(
  game,
  stretch,
  paintScenery(stretch),
  dayPlan.ways[0].other,
  { runs, walkers },
  () => workLock(),
  (id) => pickWay(id),
  (index) => pickSpot(index),
);

const closeupRoot = document.getElementById('closeup');
if (!closeupRoot) throw new Error('The page is missing #closeup');
const closeup = new Closeup(closeupRoot, () => {
  game.classList.remove('closeup-open');
  // After the next frame has shown the call button again.
  requestAnimationFrame(() => hud.focusCall());
});
let lastView: View | null = null;

/** The next junction where the ways part, while there's one to choose at, and its question, made once so the panel can tell when it changes. */
let fork: Fork | null = null;
let wayChoice: Choice | null = null;

/** Today's route on the map, as far as it's decided, and the ways to choose from at the next fork, each as far as it goes before it parts again. */
function showRoute(): void {
  fork = forkAhead(day, dayPlan);
  scene.showRoute(day.plan.route, fork ? fork.s : day.plan.end);
  const at = fork;
  const choices: WayChoice[] | null = at
    ? at.options.map((o, i) => ({ id: o[0].way, route: o[0].route, from: at.s, to: forkAhead({ ways: o.map((w) => w.way), plan: o[0] }, dayPlan)?.s ?? o[0].end, label: String(i + 1) }))
    : null;
  scene.showChoices(choices);
  wayChoice = at
    ? {
        title: `Which way at ${at.name}?`,
        options: at.options.map((o) => {
          const words = forkWords(at, o, dayPlan);
          return { label: words.way, detail: words.to };
        }),
        onPick: (i) => pickWay(at.options[i][0].way),
      }
    : null;
}

/** Goes to the part of the lock that needs you and opens its close-up, or, in a close-up, does the next thing. */
function workLock(): void {
  if (closeup.isOpen) {
    closeup.press();
    return;
  }
  const yours = lockForYou(day.trip);
  if (!yours?.next || camera.mapOpen) return;
  const { lock, state, next } = yours;
  handle(answerLock(day));
  const at = scene.partPoint(lock.id, next.part, state);
  const from = at && lastView ? { x: ((at[0] - lastView.x) / lastView.width) * game.clientWidth, y: ((at[1] - lastView.y) / lastView.height) * game.clientHeight } : { x: game.clientWidth / 2, y: game.clientHeight / 2 };
  game.classList.add('closeup-open');
  closeup.open({ lockName: lock.name, lock: state, part: next.part, target: next.target, boats: () => boatsAt(day.trip, day.plan, lock), wanted: () => wantsPart(day.trip, lock.id, next.part, next.target), from });
}

function pickWay(id: string): void {
  if (!canChooseWay(day, dayPlan)) return;
  handle(chooseWay(day, dayPlan, id));
  showRoute();
  camera.setMap(false);
}

let askingSpot = false;
function pickSpot(index: number): void {
  handle(chooseSpot(day, index));
  askingSpot = false;
}

/** The question for each way's mooring, made once so the panel can tell when it changes. */
const spotChoices = new Map<TripPlan, Choice>(
  dayPlan.ways.map((w) => [w, { title: `Where will you moor at ${w.endName}?`, options: w.spots.map((s) => ({ label: s.name })), onPick: (i) => pickSpot(i) }]),
);
showRoute();

/** The choice the boat is waiting on, while you're looking at it: the ways on the map, or the spots at dusk. */
function currentChoice(): Choice | null {
  if (closeup.isOpen) return null;
  if (day.phase === 'dusk' && askingSpot) return spotChoices.get(day.plan) ?? null;
  if (camera.mapOpen && needsYou(day, dayPlan) === 'way') return wayChoice;
  return null;
}

/** Answers the boat's call: goes to the lock, opens the map to choose a way, or asks where to moor. */
function answerCall(): void {
  const need = needsYou(day, dayPlan);
  if (closeup.isOpen || need === 'lock') workLock();
  else if (need === 'way') camera.setMap(true);
  else if (need === 'spot') askingSpot = true;
}

/** Picks an answer by its number, as the number keys do, whenever the boat is waiting on a choice. */
function choose(number: number): void {
  const need = needsYou(day, dayPlan);
  if (need === 'way') {
    const option = fork?.options[number - 1];
    if (option) pickWay(option[0].way);
  } else if (need === 'spot' && number <= day.plan.spots.length) pickSpot(number - 1);
}

const logbook = new LogbookView(document);
/** Opens the day's logbook once it's written up in the evening, or closes it. */
function toggleLogbook(): void {
  if (logbook.isOpen) logbook.close();
  else if (day.log.written && !closeup.isOpen) logbook.open({ day: `Day ${day.number} · ${canal.name}`, lines: logLines(day.log), seed: `Seed ${canal.seed}` });
}

function back(): void {
  if (logbook.isOpen) logbook.close();
  else if (closeup.isOpen) closeup.close();
  else if (askingSpot) askingSpot = false;
  else camera.setMap(false);
}

const toggleMap = (open = !camera.mapOpen) => {
  if (!closeup.isOpen) camera.setMap(open);
};
const dayMinutes = Math.max(...dayPlan.ways.map((w) => dayTimeline(dayPlan, w.way).end)) / 60;
const hud = new Hud(document, {
  startName: dayPlan.ways[0].startName,
  dayMinutes,
  rate,
  onCastOff: () => handle(castOffDay(day)),
  onStartAgain: () => {
    otherWay = askedWay ?? (otherWay === 'down' ? 'up' : 'down');
    day = newDay(dayPlan, { other: otherWay, number: day.number + 1 });
    weather = planWeather(canal.seed, day.number, askedWeather);
    logbook.close();
    hintedAt = -Infinity;
    askingSpot = false;
    camera.snap();
    camera.setMap(false);
    showRoute();
    handle(castOffDay(day));
    keepPlace();
  },
  onToggleMap: () => toggleMap(),
  onCall: () => answerCall(),
  onBell: (on) => {
    bell.on = on;
    keepPlace();
  },
  onLogbook: () => toggleLogbook(),
});
hud.setBell(bell.on);
const keyboard = new Keyboard(window, (command) => {
  // While the logbook is open, the keys only close it.
  if (logbook.isOpen && command !== 'back' && command !== 'logbook') return;
  if (command === 'logbook') toggleLogbook();
  else if (typeof command === 'object') choose(command.choose);
  else if (command === 'work') answerCall();
  else if (command === 'toggle-map') toggleMap();
  else back();
});

const HELM_TAKEN: Record<'lock' | 'junction' | 'mooring', string> = {
  lock: 'The boat steers itself at the lock, so you can work it.',
  junction: 'The boat takes the turn at the junction itself.',
  mooring: 'The boat brings itself in to moor.',
};

const lockName = (id: string): string => day.plan.locks.find((l) => l.id === id)?.name ?? 'The lock';
const inSentence = (name: string): string => name.charAt(0).toLowerCase() + name.slice(1);

function handle(events: readonly DayEvent[]): void {
  let ring = false;
  for (const e of events) {
    if (e.kind === 'call') {
      // A reminder rings only if you're not looking at the game.
      if (!e.again || document.hidden || !document.hasFocus()) ring = true;
      if (e.again) continue;
      if (e.call === 'junction') hud.toast(`${e.place ?? 'The junction'} is coming up. Which way will you go? Press Space to choose on the map.`);
      else if (e.call === 'dusk') hud.toast(`The light is going. Choose a spot to moor for the night at ${day.plan.endName}.`);
    } else if (e.kind === 'held') {
      hud.toast(`The boat waits before ${e.junction} until you choose a way.`);
    } else if (e.kind === 'chose-way') {
      const words = wayWords(day.plan, e.junction);
      const next = forkAhead(day, dayPlan);
      hud.toast(next ? `${words.way}, on to ${next.name}, where you'll choose again.` : `${words.way}, ${words.to}.`);
    } else if (e.kind === 'tied-up') {
      hud.toast(`Tied up ${inSentence(e.spot)} for the night.`);
    } else if (e.kind === 'phase' && e.phase === 'evening') {
      hud.toast('Evening falls and the lamps are lit. The day is written up in the logbook.');
    } else if (e.kind === 'reached-lock' && e.waiting) {
      hud.toast(day.trip.other?.way === 'down' ? `Another boat is coming down through ${lockName(e.lock)}. Yours waits its turn.` : `The boat ahead is going up through ${lockName(e.lock)}. Yours waits its turn.`);
    } else if (e.kind === 'lock-yours') {
      const name = lockName(e.lock);
      if (e.ready) hud.toast(day.trip.other?.way === 'down' ? `The other boat left ${name} empty, with the gates open for you.` : `${name} is ready for you.`);
      else hud.toast(day.trip.other?.way === 'up' ? `The boat ahead left ${name} full, so you'll need to empty it first.` : `${name} is set against you, so you'll need to level it first.`);
    } else if (e.kind === 'lock' && e.event.kind === 'level') {
      hud.toast(e.event.full ? 'The lock is full.' : 'The lock is empty.');
    } else if (e.kind === 'cleared-lock') {
      hud.toast(`Through ${lockName(e.lock)}. The gates swing shut behind you.`);
    } else if (e.kind === 'handed-back') hud.toast('The boat is steering itself again.');
    else if (e.kind === 'helm-taken') hud.toast(HELM_TAKEN[e.reason]);
    else if (e.kind === 'bump') hud.toast(e.what === 'bank' ? 'Bump! Boats nudge the bank all the time. No harm done.' : 'Bump! A gentle knock on a moored boat. Pass them slowly, and keep to the far side.');
  }
  // However many calls a hidden tab catches up on at once, the bell rings once.
  if (ring) bell.ring();
  const open = day.calls.open;
  const title = tabTitle(open ? callTitle(open.kind, day, dayPlan) : null);
  if (document.title !== title) document.title = title;
}

let hintedAt = -Infinity;
function simulate(now: number): void {
  const steps = clock.advance(now, rate);
  if (!steps) return;
  // In a close-up the keys work the lock, not the tiller.
  const controls = closeup.isOpen ? NO_CONTROLS : keyboard.controls();
  const keys = keyboard.closeupKeys();
  const events: DayEvent[] = [];
  for (let i = 0; i < steps; i++) {
    closeup.step(STEP, keys);
    events.push(...stepDay(day, dayPlan, controls, STEP));
  }
  handle(events);
  if (now - keptAt > KEEP_EVERY) keepPlace();

  // Say why the tiller isn't answering where the boat steers itself.
  const { trip } = day;
  const touching = controls.rudder !== 0 || controls.throttle !== 0;
  const reason = trip.phase === 'in-lock' ? 'lock' : steersItselfHere(day.plan, trip.boat.s);
  if (touching && reason && day.phase === 'underway' && trip.time - hintedAt > 8) {
    hintedAt = trip.time;
    hud.toast(HELM_TAKEN[reason]);
  }
}

let lastFrame: number | null = null;
function frame(now: number): void {
  simulate(now);
  const dt = lastFrame === null ? 0 : Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;

  const { trip } = day;
  const pose = boatPose(day);
  const viewport = { width: game.clientWidth, height: game.clientHeight };
  const view = camera.update(dt, pose, viewport);
  lastView = view;
  // The part of the lock that needs you glows; while the water moves or the boat comes in, the gates you'll work next are marked too.
  const yours = closeup.isOpen ? null : lockForYou(trip);
  const focus: Focus | null = yours?.next ? { lock: yours.lock.id, part: yours.next.part, glow: yours.job.kind !== 'wait-water' && yours.job.kind !== 'boat-in' } : null;
  scene.render({ time: day.time, homeFrom: eveningBegan(day), trip, boat: pose, along: trip.boat.s, focus, light: lightAt(day), spots: day.phase === 'dusk' ? day.plan.spots : null, route: day.plan.route, weather, weatherNow: weatherAt(day, weather) }, view, viewport.width);
  closeup.render(dt);

  const need = needsYou(day, dayPlan);
  const call = need === 'way' && fork ? `Choose a way at ${fork.name}` : need === 'spot' ? 'Choose where to moor' : focus ? `Go to the ${PART_NAMES[focus.part]}` : null;
  hud.showChoice(currentChoice());
  hud.update({
    phase: day.phase,
    status: describeDay(day, dayPlan),
    helm: trip.helm,
    mph: day.phase === 'underway' ? milesPerHour(trip.boat.v) : 0,
    next: upcoming(day.plan.places, trip.boat.s),
    mapOpen: camera.mapOpen,
    logbook: day.log.written,
    call,
    waited: day.calls.open && call ? waitedWords(waitedFor(day.calls, day.time)) : null,
    endTitle: `Morning at ${day.plan.endName}`,
    endText: "The sun is up on a new day, and the boat is ready to cast off again. That's the end of the prototype day.",
  });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
handle([]);
if (kept && day.phase !== 'morning') {
  const leg = [...day.plan.legs].reverse().find((l) => day.trip.boat.s >= l.from);
  hud.toast(day.phase === 'underway' ? `Back on the ${leg?.name ?? 'canal'}, where you left off.` : `Back at ${day.plan.endName}, where you left off.`);
}

// Browsers stop drawing hidden tabs, but the canal carries on: keep the
// game's clock running with a timer until the tab is back. Browsers slow
// that timer too after a while, to once a minute, so a call can ring up to
// a minute late; the boat still stops and waits at the right moment, and
// says how long it has waited.
let hiddenTimer = 0;
document.addEventListener('visibilitychange', () => {
  window.clearInterval(hiddenTimer);
  if (document.hidden) {
    keepPlace();
    hiddenTimer = window.setInterval(() => simulate(performance.now()), 1000);
  } else {
    lastFrame = null;
    camera.snap();
  }
});
// Keep your place as the tab closes or reloads, as well as every few seconds.
window.addEventListener('pagehide', () => keepPlace());
