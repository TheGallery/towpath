# Towpath

A relaxing top-down browser game about travelling the UK canals on a narrowboat: steering, working locks, mooring at night.

Towpath is at the very start: this is the project skeleton, and the first playable prototype comes next. It is built in TypeScript and SVG with Vite, with no game engine.

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

`npm run build` writes a static build to `dist/`, and `npm run preview` serves it.

## Development

```sh
npm run lint       # ESLint
npm run typecheck  # TypeScript
npm test           # Vitest
npm run build      # type check, then a Vite build
```

CI runs the same four checks on every pull request and every push to `main`, and zizmor audits the GitHub Actions workflows.

## Reporting problems

Open an issue for bugs and ideas. For a security problem, see [SECURITY.md](SECURITY.md) and report it privately instead.

## Licence

MIT, see [LICENSE](LICENSE).
