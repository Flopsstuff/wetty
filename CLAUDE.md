# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## Package manager

**Use pnpm exclusively.** The `packageManager` field pins pnpm@9.4 and CI /
Dockerfile / husky hooks all invoke `pnpm`. Running `npm install` is known to
fail because of the native `node-pty` / `node-gyp` dependency chain — and even
when it succeeds it generates a `package-lock.json` that conflicts with
`pnpm-lock.yaml`. If you see a stray `package-lock.json`, delete it before
running anything.

## Common commands

```
pnpm install            # install deps
pnpm build              # full build (client bundle + server tsc emit)
pnpm dev                # watch-mode build + nodemon, serves localhost:3000/wetty
pnpm start              # run production build from ./build (NODE_ENV=production)
pnpm test               # mocha against src/**/*.spec.ts via ts-node ESM loader
pnpm lint               # eslint src
pnpm lint:fix           # eslint --fix src
pnpm clean              # rm -rf build
```

Run a single test file:

```
pnpm exec mocha src/client/wetty/download.spec.ts
```

The `tsc` browser typecheck is wired into `build.js` as an esbuild plugin
(`typechecker`), so `pnpm build` will surface client-side type errors as build
warnings. To run a standalone typecheck without bundling:

```
pnpm exec tsc -p tsconfig.browser.json   # client (noEmit)
pnpm exec tsc -p tsconfig.node.json      # server (emits to build/)
```

Husky `pre-commit` runs `lint-staged` (eslint --fix on `*.{js,ts}`, prettier on
`*.{json,scss,md}`).

## Architecture

WeTTY is a web terminal: it serves a browser page that runs xterm.js, opens a
Socket.IO channel to the Node server, and the server spawns a `node-pty` process
running either a local login or an SSH client and pipes bytes back and forth.

### Build pipeline (`build.js`)

A single Node script orchestrates two parallel build flows — they are not
standard `tsc` projects:

- **Client** (`src/client`) — bundled by **esbuild** to
  `build/client/{wetty,dev}.js` (+ sourcemaps, + SCSS via
  `esbuild-sass-plugin`, + assets via `esbuild-plugin-copy`). The `typechecker`
  esbuild plugin shells out to `pnpm tsc -p tsconfig.browser.json` on every
  build, surfacing TS errors as build warnings (not failures — esbuild still
  emits a bundle).
- **Server** (`src/server`, `src/shared`) — emitted by
  `tsc -p tsconfig.node.json` to `build/`. ESM output (`"type": "module"`), so
  server imports use `.js` extensions even from `.ts` sources.

`pnpm build --watch` enables esbuild watch + `tsc --watch` for both halves.

### Three top-level source roots

- `src/server/` — Express + Socket.IO + `node-pty`. Entry: `src/main.ts` →
  `src/server.ts` → `src/server/socketServer.ts`. On socket connect,
  `command.ts` resolves the argv (login vs. ssh, plus URL params if
  `allowRemoteHosts`/`allowRemoteCommand` are enabled in config), `spawn.ts`
  opens a pty and bridges its stdio to socket events (`input` ↔ pty.write,
  pty.onData → socket emit, `resize`, `disconnect`). Flow control is implemented
  in `flowcontrol.ts` with a token-bucket on each side.
- `src/client/` — browser code. Entry: `src/client/wetty.ts` → on socket
  connect, `wetty/term.ts:terminal()` constructs a `Term` (subclass of xterm
  `Terminal`) with the fit/image/web-links addons, pipes socket data into
  `term.write` and user input into `socket.emit('input', …)`. Other client
  modules: `download.ts` (file-download via marker bytes), `flowcontrol.ts`
  (paired with server), `disconnect/`, `mobile.ts` (mobile keyboard hacks),
  `term/confiruragtion/` (settings UI).
- `src/shared/` — types and helpers used by both halves (`interfaces.ts`,
  `config.ts`, `defaults.ts`, `logger.ts`).

### Configuration

Runtime config is JSON5 (default `conf/config.json5`); CLI flags merge over file
values via `yargs`. Key fields: `ssh.{host,port,auth,user,pass,key,knownHosts}`,
`server.{base,port,host,title,bypassHelmet}`, `forceSSH`, `command` (`login` vs.
`ssh`), optional `ssl.{key,cert}`. `server.base` is the URL prefix (default
`/wetty/`) applied to every route and the `socket.io` path.

### TypeScript layout

- `tsconfig.json` — base (strict, ES2020 module / ES2019 target, ESM interop).
- `tsconfig.browser.json` — `lib: ["DOM"]`, `noEmit`, includes `src/client`
  only.
- `tsconfig.node.json` — emits to `./build`, excludes `src/client`.

Server code is ESM-emitted, so within `src/server` and `src/shared`, imports of
local modules must use the `.js` extension (e.g.
`import { logger } from '../shared/logger.js'`) — this is the file as it will
exist post-emit.

### Tests

Mocha with `ts-node/esm` loader (`.mocharc.json`). Specs live next to the code
as `*.spec.ts`. Currently only two suites: `src/client/wetty/download.spec.ts`
(file-download marker parsing) and `src/server/shared/shell.spec.ts`
(shell-escape safety).

## Local deployment

This checkout is the production deployment of `term.aignite.pl/wetty` (managed
by systemd). Read **[.deployment.md](./.deployment.md)** (gitignored) for the
unit file, request path, deploy/restart commands, and gotchas — most importantly
that systemd ignores `conf/config.json5` and passes everything via CLI flags.

## Git remotes

- `origin` → fork at `git@github.com:Flopsstuff/wetty.git`
- `upstream` → original `https://github.com/butlerx/wetty.git`, push disabled

To pull from upstream: `git fetch upstream && git merge upstream/main`.
