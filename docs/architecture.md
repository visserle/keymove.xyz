# Architecture

How keymove is built, where everything lives, and why the corpus is split in two.

## The stack

Astro prerenders the pages that don't depend on who's asking. Svelte 5 handles the one interactive island. `@lichess-org/chessground` draws the board, and `chessops` — the rules engine lichess runs — applies the chess rules. Cloudflare Workers with Static Assets and the D1 database serve every page that depends on who you are. The codebase is TypeScript throughout.

## The corpus produces two artefacts

One public and one private:

```text
data/pgn/*.pgn                     the corpus, as text, in git
  │  npm run corpus  (scripts/import-pgn.ts --apply)
  ├─► build/catalogue.json ──► static /catalogue.json   the public half
  │                                 │ ASSETS binding, once per isolate
  │                                 └─► prerenderer + every Worker route
  └─► data/answers.sql ──► npm run db:answers:* ──► D1 composition_solution
                                                          the private half
```

`scripts/import-pgn.ts` is the only script that reads `data/pgn/`, and it replays every solution through chessops before it writes a file. `npm run build` runs it first, so a build always reads a corpus matching the commit.

To change the corpus, edit `data/pgn/` and push. The deploy then loads the private half (`npm run db:answers:remote`) and, once the new catalogue is live, prunes what the corpus has dropped (`npm run db:answers:prune:remote`). That order is the point: a row the corpus has and D1 lacks breaks the page of anyone who has solved that composition, while a row D1 has and the catalogue lacks is unreachable. Loading before the deploy can only leave extras; pruning before it would break the version being served. `npm run db:answers:check:remote` reports the difference and writes nothing, which is the one command worth running when the site and `data/pgn/` seem to disagree.

The Worker fetches `/catalogue.json` through its `ASSETS` binding, parses it once, and keeps the result for the life of the isolate. A composition page then reads a `Map`, and a guest's page runs zero D1 queries.

## Routes

Personalized pages render on the Worker because they read your session before sending HTML. Every other page ships as a static asset.

| Route                                          | Rendering   | What it does                                                                          |
|------------------------------------------------|-------------|---------------------------------------------------------------------------------------|
| `/`                                            | Worker      | Today's composition                                                                   |
| `/library`                                     | Worker      | The whole collection, filtered and paged from the URL                                 |
| `/collections`                                 | Worker      | Predicate-derived presets, plus your bookmarks, solved and in-progress sets           |
| `/compositions/[id]`                           | Worker      | The solving screen, loaded with your progress and saved Analysis tree                 |
| `/solve`                                       | Worker      | Resumes your latest in-progress composition, else redirects to an unsolved `easy` one |
| `/about`, `/blog`, `/blog/[slug]`              | prerendered | Static content                                                                        |
| `/catalogue.json`                              | prerendered | The public catalogue. The Worker reads it; browsers never download it                 |
| `POST /api/key`                                | Worker      | Checks a key guess, logs it, and returns the solution on success                      |
| `PUT /api/progress/analysis`                   | Worker      | Replaces your saved Analysis snapshot                                                 |
| `POST /api/progress/reset`                     | Worker      | Clears the solved marker and keeps your analysis                                      |
| `GET /api/progress`, `GET /api/progress/[id]`  | Worker      | Your saved state; the solution only after you solve it                                |
| `PUT`, `DELETE /api/bookmarks/[id]`            | Worker      | Bookmarks a composition, or removes it                                                |
| `GET /api/compositions/next`                   | Worker      | Next position: continues the collection, else finds another by the same composer      |
| `GET`, `PUT /api/preferences`                  | Worker      | Your account preference snapshot                                                      |
| `POST /api/admin/rate`, `POST /api/admin/flag` | Worker      | Admin-only curation: a level, or a flag reason                                        |
| `/api/auth/*`                                  | Worker      | Better Auth: Lichess OAuth, sessions, sign-out, account deletion                      |

## Where data lives

Data is split across three stores by how often each kind changes.

| Data                 | Store                            | Changes when                     |
|----------------------|----------------------------------|----------------------------------|
| Corpus, public half  | `data/pgn/` to `/catalogue.json` | you push                         |
| Corpus, private half | D1 `composition_solution`        | the deploy loads it, then prunes |
| Solving state        | D1 `composition_progress`        | you open or solve a composition  |
| Bookmarks            | D1 `composition_bookmarks`       | you bookmark one                 |
| Preferences          | D1 `user_preferences`            | you change a setting             |
| Guess history        | D1 `key_attempts`                | you guess, right or wrong        |
| Operator judgement   | D1 `composition_curation`        | an admin rates or flags          |

Four properties follow from that split, and each one shapes the code:

- **One copy of the corpus**: `data/pgn/` is the source and `/catalogue.json` is a build artefact regenerated by every build. The two can't disagree.
- **Lookup happens in memory**: the Worker builds its indexes once per isolate. `/solve` picks from a sorted pool, and a composition page reads a `Map`.
- **Orphan rows in the answers are pruned, in the rest they are inert**: `composition_solution` is a projection of a file, so `db:answers:prune:remote` deletes what the corpus no longer has. The four user tables are left alone: an id also changes when a FEN is corrected, so "this left the corpus" is not the same statement as "delete what the reader did". The importer reports which ids moved.
- **Nothing records a history but git**: neither half keeps a ledger, a tombstone or a stamp. Each step compares the current corpus against the current database and deletes the difference, so a missed run is repaired by the next one rather than by archaeology.

A table's row count should track what a user has seen. `key_attempts` is the one exception, and it earns that: it records what people tried in the order they tried it. The request path leaves it alone.

`/catalogue.json` is about 3.2 MB and ships as one file, because the Worker is its only reader. It gets a five-minute cache with a one-hour stale window, since a deploy is the only thing that changes it.

`data/schema.sql` states the current schema and drops every table before recreating it. Each table has a paragraph in that file explaining its own shape.

A migration chain earns its keep when several environments must stay in step and a schema must move under live data. Keymove has one operator and one database. The trade is the opposite: changing the schema means recreating the database, and dropping one column means losing every row.

## Every command

| Command                                     | What it does                                                           |
|---------------------------------------------|------------------------------------------------------------------------|
| `npm run dev`                               | Astro dev server, local D1                                             |
| `npm run build`                             | check, regenerate the corpus, write `_headers`, build                  |
| `npm run preview`                           | build, then serve the built output                                     |
| `npm run deploy`                            | build, load the answers, deploy, then prune                            |
| `npm run check`                             | `astro check` plus biome lint                                          |
| `npm run corpus`                            | rebuild `build/catalogue.json` and `data/answers.sql` from `data/pgn/` |
| `npm run check:corpus`                      | replay the whole corpus through the rules seam                         |
| `npm run db:mates`                          | verify mate distances with Stockfish; `--apply` writes them back       |
| `npm run db:init:local`, `:remote`          | apply `data/schema.sql`; the remote run drops every table first        |
| `npm run db:answers:local`, `:remote`       | load `data/answers.sql` into `composition_solution`                    |
| `npm run db:answers:prune:local`, `:remote` | delete the rows the corpus has dropped; `--check` only reports them    |
| `npm run icons`                             | regenerate favicons and app icons                                      |
| `npm run headers`                           | write `public/_headers` from `src/lib/security-headers.ts`             |

`npm run db:init:remote` destroys every row in the deployed database. Take an export first if anything in it matters:

```sh
npx wrangler d1 export keymove --remote --output ../keymove-backup.sql
```

`astro dev` skips the corpus step, so after you edit a game in `data/pgn/` run `npm run corpus` yourself. `npm run build` runs it for you.