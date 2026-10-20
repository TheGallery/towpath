# Towpath

A relaxing top-down browser game about travelling the UK canals on a narrowboat: steering, working locks, mooring at night.

It is built in TypeScript and SVG with Vite, with no game engine.

![The boat slowing past moored boats on the Hallam Canal](docs/screenshots/moorings.webp)

## What you can play

The first prototype is being built in five steps, each ending with something you can play. Steps 1 and 2 are in:

- **The canal and the boat.** One hand-made stretch, the Hallam Canal at Wendle. Cast off at Kingsbridge and the boat cruises by itself: under Hollin Bridge, slowly past the visitor moorings, up through Brook Lock, under Mill Bridge, and right at Wendle Junction down the Wendle Arm to the basin by The Navigation pub. The whole trip takes about 16 minutes.
- **The camera.** A close view follows the boat, looking a little ahead. Press <kbd>M</kbd> for a guidebook map of the whole stretch, and <kbd>M</kbd> again (or <kbd>Esc</kbd>) to come back.
- **Taking the tiller.** Steer with the arrow keys (or WASD) whenever you like. Up and down change the speed, up to the four miles an hour speed limit. Let go for a few seconds and the boat finds its line again by itself. Bumping the bank or a moored boat is soft and does no harm. Near the lock, the junction and the basin, the boat steers itself.
- **Time keeps running.** The game keeps time by the clock, so the boat carries on while the tab is in the background.

For now the boat works Brook Lock by itself. Working it by hand, in close-ups, is the next step.

| Casting off | Brook Lock | The map |
| --- | --- | --- |
| ![The start card at Kingsbridge](docs/screenshots/start.webp) | ![The boat rising in Brook Lock](docs/screenshots/lock.webp) | ![The map of the whole stretch](docs/screenshots/map.webp) |

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

To try things out without waiting, add `?speed=10` to the address to run the game ten times faster (anything from 0.25 to 60 works).

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
- `src/world`: the stretch of canal, stored the way a map generator will make it: canals as points, a branch leaving its parent at a junction, features placed by distance along a canal, and a seed for the scenery.
- `src/sim`: the boat's steering, the trip with its lock passage, and the words for what's happening.
- `src/view`: the camera, as plain maths.
- `src/render` and `src/ui`: the SVG painting, the panels and the keyboard.

CI runs the same four checks on every pull request and every push to `main`, and zizmor audits the GitHub Actions workflows.

## Reporting problems

Open an issue for bugs and ideas. For a security problem, see [SECURITY.md](SECURITY.md) and report it privately instead.

## Licence

MIT, see [LICENSE](LICENSE).
