<div align="center">
  <p>
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="docs/images/keymove-light.svg">
      <img alt="keymove" src="docs/images/keymove-dark.svg" width="44" height="89">
    </picture>
  </p>

  <h1>
    <a href="https://keymove.xyz">keymove.xyz</a>
  </h1>

  <p><em>Chess Compositions for Connoisseurs</em></p>
</div>

keymove.xyz is a website for solving chess compositions. A chess composition is a puzzle created by a composer using the rules of chess. Rather than representing a position from a real game, it is a work of art designed to showcase a beautiful and surprising sequence of moves. The first move of the solution is called the key move.

keymove.xyz draws extensively from the [lichess.org codebase](https://github.org/lichess-org/lila).

## Running it locally

You need [Node](https://nodejs.org) 22.12 or newer. The database runs inside `workerd` on your own machine, so there is no Cloudflare account to create and no remote service to reach.

```sh
git clone https://github.com/visserle/keymove.xyz
cd keymove.xyz
npm install
cp .dev.vars.example .dev.vars
npm run db:init:local      # create the local database
npm run corpus             # read the studies into a catalogue
npm run db:answers:local   # load the answers
npm run dev
```

Open <http://localhost:4321>.

`.dev.vars` needs one real value, and the placeholder will not do. Generate a secret and put it in `BETTER_AUTH_SECRET`:

```sh
openssl rand -base64 32
```

Lichess sign-in only works against the live site, so locally you are a guest. Everything else behaves the same way.

### Commands

| Command           | What it does                                                     |
|-------------------|------------------------------------------------------------------|
| `npm run dev`     | Dev server, with the local database                              |
| `npm run build`   | Type-check, lint, rebuild the catalogue, write `_headers`, build |
| `npm run preview` | Build, then serve the result locally                             |
| `npm run check`   | `astro check` plus Biome                                         |
| `npm run corpus`  | Rebuild the catalogue from `data/pgn/`                           |
| `npm run deploy`  | Build, load the answers, deploy, prune                           |

Other commands cover mate verification, pruning and icon generation. [docs/architecture.md](docs/architecture.md) has the full table.

## Architecture

Astro prerenders every page that does not depend on who is asking. Svelte drives the parts that have to respond to a click: the board, the move list, the key field. [Chessground](https://github.com/lichess-org/chessground) draws the board, [chessops](https://github.com/niklasf/chessops) applies the rules, and [Better Auth](https://www.better-auth.com/) handles accounts. Pages that need a session run on a Cloudflare Worker against D1.

The studies are plain PGN text in `data/pgn/`. A single build step reads them and writes two artefacts: a catalogue the Worker reads at the edge, and the answers it checks a guess against.

[docs/architecture.md](docs/architecture.md) covers every route, every table, and the reasoning behind the split.

## Contributing

Issues and pull requests are welcome.

## Licence

AGPL-3.0-or-later
