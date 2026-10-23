# Towpath

A relaxing top-down browser game about travelling the UK canals on a narrowboat: steering, working locks, mooring at night. It's meant to be played in the background: the boat cruises by itself and calls you, with a soft bell and the tab's title, for the few moments it needs you.

It is built in TypeScript and SVG with Vite, with no game engine.

![The boat slowing past moored boats on the Hallam Canal](docs/screenshots/moorings.webp)

## What you can play

The first prototype is complete: all five build steps are in, so you can play a whole day, morning to morning, in about 20 minutes:

- **The canal and the boat.** The first canal, made by hand: the Hallam Canal at Wendle. Cast off at Kingsbridge and the boat cruises by itself: under Hollin Bridge, slowly past the visitor moorings, up through Brook Lock and under Mill Bridge to Wendle Junction. From there it goes the way you choose: right down the Wendle Arm to the basin by The Navigation pub, or straight on along the main line to a quiet bank by Coppice Wood. Either way takes about 16 minutes, plus however long you take over the lock.
- **A new canal every game.** A new game starts on a new canal, made from a random number from 0 to 4294967295, and the start card names it, as *Canal no. 2610 · The Hazelcombe Canal at Ockover*. **Start a new canal**, on the start card or the card at the end of the day, starts another: type a canal number in the box beside it to play that canal, or leave it empty for any. A day on the Hallam Canal kept from before canals had numbers finishes there, and its next days carry on from where it moored, as on any canal.
- **A new stretch every day.** At dawn, carry on from where you moored, or start a new canal. Carry on, and the next day is a new stretch of the canal, made from its number, the day's number and where you moored: it starts at that bank, basin or wharf, with the boats moored there and the pub beside it, and carries on along the canal you were on, by its own name, with new locks, junctions and moorings ahead. The same canal, day and mooring always make the same stretch.
- **The camera.** A close view follows the boat, looking a little ahead. Press <kbd>M</kbd> for a guidebook map of the whole stretch, and <kbd>M</kbd> again (or <kbd>Esc</kbd>) to come back.
- **Taking the tiller.** Steer with the arrow keys (or WASD) whenever you like. Up and down change the speed, up to the four miles an hour speed limit. Let go for a few seconds and the boat finds its line again by itself. Bumping the bank or a moored boat is soft and does no harm. Near the lock, the junction and the basin, the boat steers itself.
- **Working the lock.** The boat ties up below Brook Lock and waits for you. The part that needs you next glows: click it, or press <kbd>Space</kbd>, and its close-up fills the screen. At a paddle, drop your windlass on the spindle, wind it round in circles, and take it off again; to wind a paddle down, flick the red safety catch off first, and keep hold, because with the catch off it drops if you let go. At a gate, walk the heavy balance beam round. A gate won't open until the water is level on both sides, and won't close on the boat. Every close-up also works from the keyboard: <kbd>Space</kbd> does the next thing, and held down it winds or pushes. The boat glides in and out by itself, and the gates swing shut behind you.
- **The other boat.** Another boat uses Brook Lock just before you, so how you find the lock depends on it. Coming down, it empties the lock and leaves the gates open for you: three close-ups. Going up ahead of you, it leaves the lock full, so you empty it first: six close-ups. Which it is comes down to luck, and starting again gives you the other.
- **The boat calls you.** The boat needs you to cast off in the morning, at every lock, before every junction where the ways part to choose one, and at dusk to choose where to moor. On the Hallam Canal that's four calls a day: casting off, Brook Lock, Wendle Junction and dusk. Each time a soft bell rings (made in the browser, once you've clicked or pressed a key in the page) and the tab's title says what it wants, so you can leave the game in a background tab. Press <kbd>Space</kbd>, or the button at the bottom, to answer. If you don't come, the boat waits: tied up at the lock, pulled in before the junction, or at the mooring. It rings again a couple of times if you stay away, says how long it has waited, and the bell can be switched off.
- **Sound.** The game has sound, all made in the browser with no sound files. It's off until you turn it on, with the switch beside **Cast off** or the **Sound** button beside the bell. That button opens a panel with the volume and two switches: the boat and the locks, and nature. Your choice, on or off, with the volume and the two switches, is remembered on this browser, so the next game starts the way you left it.
  - **The boat.** The engine putters from casting off until you tie up, ticking over while it waits and beating faster as the boat speeds up, and the water laps at the hull. Bumps thud into the bank or knock on a moored boat.
  - **At a lock, your hands.** The windlass clunks on and clinks off. The safety catch clicks over the teeth as you wind a paddle up, and flicks off for you to wind it down. If you let a paddle drop, the gear whirrs and the paddle slams. The beam creaks and your feet sound on the setts as you walk a gate round, with a thump as it comes to rest.
  - **At a lock, the water.** It roars and boils in as the lock fills, and falls away below the gates as it empties, then settles.
  - **The mix.** Everything else steps back while you're in a close-up or on the map, and dips when the bell rings. The bell keeps its own button and rings with the sound off, and in a background tab only the bell rings.
- **The junction.** Answer the junction call and the map opens with each way marked, as far as it goes before it parts again. Each says what's down it: where it leads, about how long it takes, and how many locks, or where you'll choose again. Pick one on the map, from the list, or with the number keys. Where the ways you can still take part again, the boat calls you again before that junction.
- **Dusk, night and morning.** The light goes as the boat nears its mooring. Choose one of the marked spots, and the boat glides in and ties up. Evening falls and the lamps come on in the boats, the houses and the pub, then night, then dawn, when you can carry on to the next day or start a new canal.
- **Life on the bank.** Walkers, joggers and dogs use the towpath all day: each comes on at a bridge or an end of the path, goes out a way, turns and goes back, keeping left as they pass. At Wendle Junction the towpath crosses the arm on the footbridge and carries on along the main line, and round the basin's quay to the pub garden. In the evening everyone still out turns for home, and the towpath is empty by the end of the night.
- **Life around the boat.** The boat leaves a wake of ripples behind it in the water, which spread to the banks and fade, with a faint trail along the way it has come. Ducks with their ducklings and pairs of swans swim slowly along the far bank and ease out of the way as a boat comes by, fish rise now and then, sheep and cows graze the meadows, and soft cloud shadows drift over the land and water.
- **The weather.** Each day has its own weather from the canal's seed and the day's number: some mornings are misty, and the mist lifts after you cast off and gathers again at dawn; some days a spell of drizzle comes and goes while you're underway. It changes only the look of the day, never how the boat goes.
- **The logbook.** The day is noted as it happens (casting off, each lock and how you found it, the way you took at each junction, where you moored, and how long the boat waited for you) and written up in the evening. Press <kbd>L</kbd>, or the Logbook button, to read it, and turn back through a page for every day before it. Each page is headed with the canal's number and the day's, as *Canal no. 2610 · day 3*, with the name of that day's stretch at the foot; on the Hallam Canal, the stretch's name heads the page and its seed is at the foot.
- **Keeping your place.** Close the tab or reload it whenever you like: the game keeps your place in the browser and carries on exactly where it was, whether mid-lock or at night. Time doesn't pass while the tab is closed, so the boat is waiting where you left it. It keeps one game at a time: the canal's number, today's whole stretch as it was made, and the day, so a later change to how canals are made never moves the map under your boat, and each earlier day's page of the logbook, but not its map, for the latest year of days.
- **Canals made from a seed.** Every canal but the Hallam Canal is made from its number, its seed. Add `?seed=` and a whole number from 0 to 4294967295 to the address, as `?seed=318`, to open a new game on that canal, or to carry on if your game is on it already. The number settles the shape of the day: none to three junctions, some of them three-way with branches north and south; none to four locks where the land rises, and one more above any mooring below a lock; and where each way moors for the night, at one of six kinds of mooring: a basin by a pub, an old wharf, a quiet bank by a wood, moorings in a village, outside a canalside pub, or below a lock. Branches end in a basin or at a lane, or run on off the map as other canals. Roads cross square at their bridges, every canal has a towpath, and every towpath ends at a bridge, a footbridge, a lock or the edge of the map. Villages, pubs, woods and farms go where there's room, and the places are named from parts, with a blocklist. Every canal is checked with the game's own rules before you play it: each way must make a whole day of 11 to 25 minutes, calling you at every junction where the ways part. A try that fails is set aside for the next, and a seed with no try that plays gives the Hallam Canal. The same number always makes the same canal, with the same scenery and life.
- **Time keeps running.** The game keeps time by the clock, so the boat carries on while the tab is in the background. Browsers slow a hidden tab's timers to once a minute after a while, so a call can ring up to a minute late; the boat still stops at the right place and says how long it has waited.

| Casting off | Brook Lock | The map |
| --- | --- | --- |
| ![The start card at Kingsbridge](docs/screenshots/start.webp) | ![The boat rising in Brook Lock](docs/screenshots/lock.webp) | ![The map of the whole stretch](docs/screenshots/map.webp) |
| **The boat ahead** | **Winding a paddle** | **Pushing a gate** |
| ![Waiting below Brook Lock while the boat ahead goes up through it](docs/screenshots/other-boat.webp) | ![The paddle close-up, half wound up, with the water dropping down the far wall](docs/screenshots/paddle.webp) | ![The gate close-up, with the balance beam walked half way round](docs/screenshots/gate.webp) |
| **Which way at the junction?** | **Choosing where to moor at dusk** | **Night in Wendle Basin** |
| ![The map with both ways from Wendle Junction marked, and the choice between them](docs/screenshots/junction.webp) | ![Dusk in Wendle Basin, with three spots to moor marked on the water](docs/screenshots/dusk.webp) | ![Night in the basin, with lamps lit in the boats and the pub](docs/screenshots/night.webp) |
| **On the towpath** | **The logbook** | |
| ![A walker with a dog and a jogger on the towpath beside the boat](docs/screenshots/towpath.webp) | ![The logbook of the day, with the canal's seed at the foot](docs/screenshots/logbook.webp) | |

## Run it locally

You need Node 24 (see `.nvmrc`) and [Socket Firewall](https://www.npmjs.com/package/sfw), which checks every package against known malware before it is installed. Install it once:

```sh
npm install --global sfw
```

Then run every install through it:

```sh
sfw npm ci                  # install the locked dependencies
sfw npm install <package>   # add a dependency
```

Run the game:

```sh
npm run dev      # open the printed local URL
```

To try things out without waiting, add `?speed=10` to the address to run the game ten times faster (anything from 0.25 to 60 works): a whole day then takes about two minutes, plus the lock. Add `?weather=mist`, `?weather=drizzle` or `?weather=clear` to choose the weather for every day (drizzle then falls from when you cast off until the evening). Add `?lock=ready` or `?lock=against` (or both, as `?speed=10&lock=against`) to choose how the other boat leaves Brook Lock, or the first lock on a canal made from a seed, on a new day. The game keeps your place between visits, so add `?fresh` to set it aside and start a new game, on a new canal or the one `?seed=` asks for. It keeps one game at a time, so opening another canal replaces the one you had.

While `npm run dev` is running, add `?gallery` to the address for a page of the canals made from seeds 1 to 24, each a small sketch that opens the game on that canal; `?gallery&from=100` starts at seed 100.

`npm run build` writes a static build to `dist/`, and `npm run preview` serves it.

## Development

```sh
npm run lint       # ESLint
npm run typecheck  # TypeScript
npm test           # Vitest
npm run build      # type check, then a Vite build
```

The game's rules are kept apart from the drawing, so they can be tested without a browser:

- `src/core`: tracks (smooth curves sampled by distance), the fixed-step clock and small maths helpers.
- `src/world`: the stretch of canal, stored the way the map generator makes it: canals as points, a branch leaving its parent at a junction, features placed by distance along a canal, the ways a day can go and the moorings they end at, a towpath along every canal and its ways on and off, and a seed for the scenery. The generator lays out a canal from a seed, or the next day's stretch from where the boat moored, names its places, and checks the rules for crossings.
- `src/sim`: the boat's steering, the lock's rules (water, gates and paddles, and the next job from any state), the hands-on paddle and gate in the close-ups, the other boat, the trip along one way, the boat's calls, the day from morning to morning (a choice at every junction where the ways part, mooring, and the light), the logbook, the people on the towpath, the day's weather and the clouds, the fish, birds and animals, the kept place (versioned, with the canal's number, today's whole stretch and each earlier day's logbook page: one from another version, or a broken one, is set aside for a new game, except a day from the version before, read back with no earlier pages, and a day on the Hallam Canal from the version before that, which finishes), the next morning's place on a new stretch, and the words for what's happening.
- `src/sim/playable.ts`: making a canal from a seed, or its next day from where the boat moored, that's sure to play: it times every way through a whole day with the game's own rules, tries again if one fails, and falls back to the Hallam Canal.
- `src/view`: the camera, as plain maths.
- `tests/fixtures`: a hand-made test stretch with two junctions, one of them three-way, and three locks, for days with more than one choice.
- `tests/seeds-*.test.ts`: the first 1,000 seeds, a quarter in each file so they run side by side, each of which must end in a playable day.
- `src/audio`: the sound.
  - `cues.ts` and `settings.ts` work out, as plain data, which sound plays for each event and for each change in your hands at a lock, how loud each steady sound is from moment to moment, the mix, and the sound settings. They're tested without a browser.
  - `voices.ts` makes the sounds with the Web Audio API.
  - `sound.ts` plays them, and the bell, through one AudioContext.
- `src/render` and `src/ui`: the SVG painting (including the lock close-ups, the night, the people on the towpath, the wake, and the life and weather around the boat), the panels, the full-screen close-up, the logbook page, the sound controls and the keyboard.

CI runs the same four checks on every pull request and every push to `main`, and zizmor audits the GitHub Actions workflows.

## Reporting problems

Open an issue for bugs and ideas. For a security problem, see [SECURITY.md](SECURITY.md) and report it privately instead.

## Licence

MIT, see [LICENSE](LICENSE).
