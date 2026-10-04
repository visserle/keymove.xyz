-- Keymove's schema, in full.
--
--   npm run db:init:local     # the .wrangler D1 that `astro dev` uses
--   npm run db:init:remote    # THE DEPLOYED DATABASE: destroys everything in it
--
-- This file states the current schema. It does not describe how the site came to
-- have it, and it is not a path from any earlier shape. Every table is dropped
-- first, so running it twice, or on a database that already looks right, lands in
-- the same place.
--
-- That is a deliberate choice for a project with one operator and one database.
-- A migration chain earns its keep when there are environments to keep in step,
-- such as staging, preview branches or other people's forks, and when the schema
-- has to evolve under live data without pausing. Keymove has none of those.
-- What the reader needs is the shape and the reason for it, and that is what
-- the comments below carry.
--
-- **To change the schema:** edit this file, and run `db:init:remote` when you mean
-- to. D1 has no migration ledger to reconcile; the schema is whatever this file
-- says it is.
--
-- Drop order follows the foreign keys: children before parents. (`_cf_KV` is
-- Cloudflare's own and is never touched.)

-- ───────────────────────────────────────────────── auth ──────────────────────────────────
--
-- Better Auth's tables, generated rather than authored: `npx @better-auth/cli
-- generate` writes these. Keymove configures the library in
-- src/lib/auth/config.ts and does not hand-edit the columns; if Better Auth
-- changes its schema, regenerate and copy the result back here.
--
-- The names are the exception. `auth_` is Keymove's prefix, set by `modelName` in
-- src/lib/auth/config.ts, which is what keeps these tables apart from this app's
-- own `user_preferences` and `admins`. The two files have to agree: config.ts
-- says where Better Auth looks, this file says where the tables are. The columns
-- are Better Auth's; the names are ours.
--
-- There is no email sign-in, and `email` is never a real address: the Lichess
-- OAuth flow has no need for one, and Better Auth requires the column. The app
-- stores a deterministic placeholder at the reserved, non-deliverable `.invalid`
-- domain (src/lib/auth/config.ts). `auth_account` holds a Lichess account id
-- and no credential. The access token is used during the callback and revoked
-- immediately, and a database hook clears the fields before any write.

DROP TABLE IF EXISTS "auth_verification";
DROP TABLE IF EXISTS "auth_account";
DROP TABLE IF EXISTS "auth_session";
DROP TABLE IF EXISTS "auth_rate_limit";
DROP TABLE IF EXISTS "auth_user";

CREATE TABLE "auth_user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null);

CREATE TABLE "auth_session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "auth_user" ("id") on delete cascade);

CREATE TABLE "auth_account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "auth_user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);

CREATE TABLE "auth_verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);

CREATE TABLE "auth_rate_limit" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);

CREATE INDEX IF NOT EXISTS "auth_session_userId_idx" ON "auth_session" ("userId");
CREATE INDEX IF NOT EXISTS "auth_account_userId_idx" ON "auth_account" ("userId");
CREATE INDEX IF NOT EXISTS "auth_verification_identifier_idx" ON "auth_verification" ("identifier");

-- ──────────────────────────────────────────────── admins ──────────────────────────────────
--
-- Admin membership, and it is one row: the site has a single operator, so an
-- allowlist granted and revoked with plain SQL is smaller and easier to audit than
-- a role column, a User-Agent check or a second identity provider.
--
--   npx wrangler d1 execute keymove --remote --command \
--     "insert into admins (user_id, granted_at) values ('<user id>', datetime('now'))" -y
--
-- `user_id` is the primary key, so the check every admin route makes is a single
-- indexed lookup, and the cascade removes the row if the account is deleted.

DROP TABLE IF EXISTS "admins";

CREATE TABLE admins (
  user_id    TEXT PRIMARY KEY REFERENCES "auth_user" ("id") ON DELETE CASCADE,
  granted_at TEXT NOT NULL
);

-- ─────────────────────────────────────── composition_solution ───────────────────────────────
--
-- The private half of a composition, and the only corpus table in D1.
--
-- Everything public about a game ships as the static `/catalogue.json` asset the
-- build emits from data/pgn/: diagram, objective, byline, date, and the corpus's
-- own `[Theme]` and `[Difficulty]`. There is nothing to sync and nothing that can
-- drift from the corpus. The key and the movetext cannot be in a public asset: a
-- visitor who could read the solution set would have no reason to type a key move
-- at all.
--
-- So `key_san` is materialised rather than computed. The Worker compares a
-- submitted key against it by string and runs no rules engine, so it cannot
-- derive it per request. `solution` is the movetext verbatim, replayed in the
-- browser by chessops to build the solution tree.
--
-- There is no compositions table to reference, because the corpus is a file. A
-- row whose composition has left data/pgn/ is unreachable rather than dangling:
-- nothing links to it and no query joins it. db:answers:prune:remote deletes
-- exactly those rows, by diffing this table against build/catalogue.json, so the
-- private half converges on the corpus instead of accumulating every composition
-- the corpus has ever had.
--
-- Written by `npm run corpus` into data/answers.sql; loaded by db:answers:local /
-- db:answers:remote. Loading and pruning are separate commands because they sit
-- either side of the deploy: a row this table lacks breaks a solved composition's
-- page, while an extra row costs nothing, so the load goes first and the prune
-- waits for the catalogue that no longer references them.

DROP TABLE IF EXISTS "composition_solution";

CREATE TABLE composition_solution (
  composition_id TEXT PRIMARY KEY,  -- 7 base-62 chars of sha256(identity FEN)
  key_san        TEXT NOT NULL,     -- the solution's first move, canonical SAN
  solution       TEXT NOT NULL      -- the movetext, verbatim
);

-- ──────────────────────────────────────── composition_progress ──────────────────────────────
--
-- One row per user per composition, however much the user does: the size of this
-- table is a function of what they have *seen*, not of how often.
--
-- A composition is `in-progress` only while `analysis_node_count` is positive,
-- which means the saved Analysis tree holds moves. It is `solved` only once the
-- Worker has accepted the key. A wrong key guess moves neither: it is counted in
-- key_attempts and nowhere else.
--
-- `analysis_json` is a snapshot of the latest tree; FENs and paths in it are
-- recomputed from the composition's diagram on restore and are never trusted.
-- The cursor is not part of it: the snapshot holds the moves, and a composition
-- reopens at its start position rather than wherever the last session stopped.
-- The column holds the user's own work, not the canonical Solution tree.
--
-- No foreign key to a compositions table, for the reason above.

DROP TABLE IF EXISTS "composition_progress";

CREATE TABLE composition_progress (
  user_id             TEXT NOT NULL REFERENCES "auth_user" ("id") ON DELETE CASCADE,
  composition_id      TEXT NOT NULL,
  started_at          TEXT NOT NULL,
  solved_at           TEXT,
  analysis_json       TEXT,
  analysis_updated_at TEXT,
  analysis_node_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, composition_id)
);

CREATE INDEX composition_progress_solved_idx ON composition_progress (solved_at);

-- ────────────────────────────────────── composition_bookmarks ───────────────────────────────
--
-- A personal set, separate from solving progress: a composition can be bookmarked
-- without being attempted, and solved without being bookmarked.

DROP TABLE IF EXISTS "composition_bookmarks";

CREATE TABLE composition_bookmarks (
  user_id        TEXT NOT NULL REFERENCES "auth_user" ("id") ON DELETE CASCADE,
  composition_id TEXT NOT NULL,
  bookmarked_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, composition_id)
);

-- ───────────────────────────────────────── key_attempts ───────────────────────────────────
--
-- The key-guess history: one row per guess, right or wrong, for signed-in users.
-- Guests are not recorded, because there is no account to attribute a guess to.
--
-- This is a **dataset**, kept for asking questions of later. Nothing on the
-- request path reads it, no endpoint exposes it, and nothing depends on it being
-- there. `guess` is the column that earns its keep: not how many times somebody was
-- wrong, but what they actually tried, in the order they tried it.
--
-- It is therefore the one table here whose size grows with what a user *does*. D1's
-- Free plan allows 100,000 rows written per day and 5 GB total; a signed-in user
-- working through 200 compositions writes roughly 600 rows for that session. The
-- rollup that would replace it if that ever stops being true is a daily table
-- written by a Cron Trigger, with this one pruned on a retention window. Build it
-- when a query needs it, not before.
--
-- Three indexes, one per question, and they are the only ones:
--
--   (user_id, attempted_at DESC)       what did this person try, in what order
--   (composition_id, attempted_at DESC) how hard is this study, has that changed
--   (attempted_at DESC)                how the site's difficulty moves over time

DROP TABLE IF EXISTS "key_attempts";

CREATE TABLE key_attempts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        TEXT NOT NULL REFERENCES "auth_user" ("id") ON DELETE CASCADE,
  composition_id TEXT NOT NULL,
  guess          TEXT NOT NULL,
  is_correct     INTEGER NOT NULL CHECK (is_correct IN (0, 1)),
  attempted_at   TEXT NOT NULL
);

CREATE INDEX key_attempts_user_time_idx ON key_attempts (user_id, attempted_at DESC);
CREATE INDEX key_attempts_composition_time_idx ON key_attempts (composition_id, attempted_at DESC);
CREATE INDEX key_attempts_time_idx ON key_attempts (attempted_at DESC);

-- ──────────────────────────────────── composition_curation ─────────────────────────────────
--
-- The operator's own judgement about a composition: a difficulty rating and a flag
-- for "this one wants a second look", with the reason why. One row per composition,
-- written by whichever judgement changed last.
--
-- It is a table of its own because the corpus's own `[Difficulty]` is *content*:
-- it lives in data/pgn/, is regenerated by `npm run corpus`, and a rating written
-- over it would be lost on the next import and would relabel the corpus by
-- accident. The rating and the flag are also independent: either can be set with
-- the other unset, and clearing one leaves the other alone. A row therefore exists
-- only while one of them is set.
--
-- The rating vocabulary is closed to the corpus's three levels and the CHECK is the
-- only gate; `src/lib/curation.ts` `isLevel()` repeats it for a request body, and
-- the table is the final word. The flag is one of two reasons rather than a yes/no,
-- because the two answers call for different work: `fix` for a row that wants
-- correcting, `drop` for a composition that should leave the corpus. Those two are
-- the whole vocabulary, checked here and repeated by `isFlagReason()`; unflagged is
-- NULL, the rating's own way of saying nothing.
--
-- `flagged` is private: rendered to admins only, and no visitor can learn a
-- composition is flagged.
--
-- No foreign key to a compositions table. When there was one, ON DELETE CASCADE
-- deleted a rating silently whenever a composition left the corpus or a FEN edit
-- re-keyed it, which is the wrong way to lose one. Nothing deletes this row now;
-- an orphan is inert and removable by hand with plain SQL. The same is true of
-- composition_progress, composition_bookmarks and key_attempts: a withdrawn
-- composition leaves a reader's work alone, which is why db:answers:prune:remote
-- prunes the answers table and none of these.

DROP TABLE IF EXISTS "composition_curation";

CREATE TABLE composition_curation (
  composition_id TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES "auth_user" ("id") ON DELETE CASCADE,
  rating         TEXT CHECK (rating IS NULL OR rating IN ('easy', 'medium', 'hard')),
  flagged        TEXT CHECK (flagged IS NULL OR flagged IN ('fix', 'drop')),
  updated_at     TEXT NOT NULL
);

-- ───────────────────────────────────────── user_preferences ─────────────────────────────────
--
-- The account-synced visual preferences as one JSON blob: theme, piece set,
-- board paint and size, move-list presentation, glyphs, the variation row, and
-- sound volume. It is written only when a setting changes, debounced on the client.
--
-- A blob rather than columns because it is a snapshot of a settings object that
-- grows a key when a preference is added, and reading it back is one row.
-- localStorage remains the guest and offline fallback.

DROP TABLE IF EXISTS "user_preferences";

CREATE TABLE user_preferences (
  user_id          TEXT PRIMARY KEY REFERENCES "auth_user" ("id") ON DELETE CASCADE,
  preferences_json TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
