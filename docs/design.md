# Design notes

## Content ids are seven base-62 characters of a diagram hash

`scripts/composition-id.ts` derives each id from piece placement, side to move and castling rights. Editing a stipulation or a solution leaves the id alone, so composition URLs survive content edits. The hash is SHA-256, rendered as base 62.

Three properties make the id work as a URL and as something people type:

- **Letters and digits only**: people type these ids and paste them into chats. An alphabet of 62 characters means two ids never differ by a glyph that only differs once percent-encoded.
- **Always seven characters**: a fixed width makes all 62 characters equally likely in every position, the first included. Grouping ids by character then counts correctly. The alphabet is in ASCII order, so sorting ids as strings sorts them numerically.
- **Rejection sampling, not a modulo**: `2^64` is not a multiple of `62^7`, so `%` biases one outcome in 5,238,150. That bias is invisible in one id and too structural for a shape test to catch, so the reduction rejects and re-hashes.

`62^7` is about 3.5e12 diagrams against a corpus of 12,713. A collision stops the import and names the id.

Collection ids use the same function over a fixed seed, so editing a title leaves every `?collection=…` link intact.

## Collections are predicates

A collection is a `(composition) => boolean` test over the catalogue, so a new build picks up new material on its own. The four presets cover endgame studies of at most eight pieces, and exact mate in 2, 3 and 4 or more. `src/lib/collections.ts` checks their ids at load.

## The rules pass through one seam

`src/lib/chess/rules.ts` is the only module that imports chessops. It normalises chessops's castling convention, where the king moves onto its rook (`e1h1`), to chessground's two-square move (`e1g1`).

`src/lib/chess/check.ts` takes the opposite approach. It compares strings only, which lets the Worker check a guess without loading a rules engine. `Nf6`, `1.Nf6`, `nf6` and `Nf6+` all match.

`scripts/check-corpus.ts` replays the whole collection through that seam. It then drives the board directly for the paths replay can't reach: castling by either square, dests, promotion, and a rejected move.

## Accounts

Better Auth owns users and sessions in D1. Lichess is the only sign-in provider, over OAuth with Proof Key for Code Exchange (PKCE).

Keymove asks Lichess for a username and a stable account id. Better Auth requires an `email` column, so it holds a deterministic placeholder at the reserved, non-deliverable `.invalid` domain. The access token exists only long enough to fetch the identity, and it is revoked immediately afterwards. Account hooks clear the credential fields before every write. A failure to fetch the identity or confirm the revocation fails the sign-in.

Sessions last 400 days and roll forward as they're used. Visual preferences live in `localStorage` under `keymove.*` for guests and mirror into `user_preferences` once you sign in.

## Admins and curation

Admin membership is the `admins` table, a one-row allowlist granted and revoked with plain Structured Query Language (SQL). For a single operator that beats a role column or a second identity provider.

`src/lib/admin.ts` has two entry points, and the split carries the reason. `isAdminUser(userId)` takes an id because the pages that render the account menu already resolved the session for progress. `adminUserId(headers)` resolves the session itself, for the two write routes that need the id to record who rated something.

`composition_curation` is a table of its own because the corpus's own `[Difficulty]` is content. It lives in `data/pgn/`, and a rating written over it would be lost on the next import. The rating and the flag are independent, so a row exists while either is set and disappears when the last one clears.

The rating vocabulary is checked by a `CHECK` constraint in the table. The flag is one of two reasons rather than a yes or no, because the two answers call for different work: `fix` for a row that wants correcting, `drop` for a composition that should leave the corpus. Both reach admins only. Every value on the curation strip feeds an admin-gated property, so the read is gated too. That keeps this table off a visitor's solving page.

## Working agreements

Follow these when changing the site:

- **Port from lila**: find how lichess does it, port that code, then restyle it to this look. Read unclear behaviour in a headless browser rather than guessing.
- **Port artwork and data verbatim**, then check the encoding.
- **Put data where it changes**: content is a static asset, a secret is a row, and a user's state is one row per user.
- **Gate a read with whatever decides its result gets used**: the curation strip is why its lookup is admin-only.
- **Resolve a session once**: a helper taking `Headers` when the caller holds a user id buys a second lookup for an answered question.
- **Share a pattern while its reason holds**: every page reads the preference snapshot, while only the admin routes read admin membership.
- **Keep settings in the header's dasher**, stored under `keymove.*`.
- **Verify in a browser** and run `npm run check` and `npm run build` before you call a change done.