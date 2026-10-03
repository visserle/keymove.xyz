// Read data/pgn/ and write the two artefacts the site is built from.
//
//   npm run corpus                   # write build/catalogue.json + data/answers.sql
//   npm run db:import:pgn             # the same, as a dry run that only reports
//
// `npm run corpus` passes `--apply` for you, which is why it is the one every
// other script and the build reach for.
//
// The corpus is the ground truth and it is text. This script is the only thing
// that reads it, and it produces everything downstream from one parse:
//
//   build/catalogue.json   the public half, which becomes the static asset
//                          /catalogue.json, which the Worker serves and reads
//   data/answers.sql       the private half — the key and the movetext, loaded
//                          into D1's composition_solution table
//
// There is no intermediate database, and there is nothing that can go stale
// between the corpus and the two files regenerated from it.
//
// A composition is identified by its diagram (scripts/composition-id.ts), and each
// diagram appears in exactly one game: where two sources held the same study, their
// notations were merged into that one game by hand. A repeated diagram is therefore
// an error rather than a silent union.
//
// The judgements a game carries are tags: [Composer], [Stipulation] (with a mate
// distance), [Theme] and [Difficulty]. [Event] is the publication and [Source] the
// detail it does not carry. Every game in the corpus states its objective in
// [Stipulation]; there is no other source for a composition's `stipulation`, so a
// game without one is refused rather than classified from its [Result]. A joint work
// states one tag per composer, so [Composer2] and [Composer3] get a field each, the
// way the corpus writes them.
//
// Every solution is replayed here with chessops, down every variation, before
// anything is written, so a corpus that cannot be replayed never reaches an
// artefact.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
	parseSolutionDocument,
	type RawMove,
	sanKey,
} from "../src/lib/chess/notation";
import { buildSolution } from "../src/lib/chess/solution";
import { formatCoauthors } from "../src/lib/display";
import type {
	CompositionRow,
	SolNode,
	Stipulation,
} from "../src/lib/types";
import { compositionId, identityFen } from "./composition-id";
import { normalizeFen, type PgnGameBlock, readGameBlocks } from "./pgn";

const APPLY = process.argv.includes("--apply");
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== "--apply");
if (unknownArgs.length)
	throw new Error(`Unknown argument(s): ${unknownArgs.join(", ")}`);

const pgnDir = path.resolve("data/pgn");

/** The public half, read by `src/lib/build-corpus.ts` while prerendering. */
const CATALOGUE_PATH = path.resolve("build/catalogue.json");
/** The private half, loaded into D1 by `npm run db:answers:remote`. */
const ANSWERS_PATH = path.resolve("data/answers.sql");

interface PgnHeaders {
	[key: string]: string;
}

interface PgnGame {
	file: string;
	/** 1-based line of the game's first tag, for error messages. */
	line: number;
	headers: PgnHeaders;
	fen: string;
	identity: string;
	id: string;
	stipulation: Stipulation;
	mateIn: number | null;
	solution: string;
	rootComments: string[];
	tree: RawMove[];
}

interface Row {
	id: string;
	fen: string;
	stipulation: Stipulation;
	mate_in: number | null;
	composer: string | null;
	composer2: string | null;
	composer3: string | null;
	published_in: string | null;
	source: string | null;
	date: string | null;
	year: number | null;
	theme: string | null;
	difficulty: string | null;
	key_san: string;
	solution: string;
}

/**
 * The co-authors of a joint work, in credit order: [Composer2], [Composer3]…
 * after [Composer]. The corpus writes one tag per composer and the table has one
 * column per composer, which is why this is a loop over the tags rather than a
 * lookup of a fixed pair. A joint work is still the first composer's work, and
 * counting it twice would split their games in the catalogue and double them in
 * the composer total, which is why they are columns here and not more rows.
 *
 * The schema declares two, which is the most the corpus uses anywhere: 325 games
 * carry one co-author, 8 carry two, and none carries a third. The loop reads past
 * that on purpose, so a fourth composer is a loud refusal naming the file instead
 * of a credit that vanishes into a column that does not exist.
 */
function coauthorsOf(
	headers: PgnHeaders,
	where: string,
): { composer2: string | null; composer3: string | null } {
	const names: string[] = [];
	for (let n = 2; ; n++) {
		const name = headers[`Composer${n}`]?.trim();
		if (!name) break;
		names.push(name);
	}
	if (names.length > 2)
		throw new Error(
			`${where}: game has ${names.length} co-authors (${names.join(", ")}); the table declares composer2 and composer3, so add the next column to scripts/schema.ts`,
		);
	return { composer2: names[0] ?? null, composer3: names[1] ?? null };
}

/**
 * What the game asks the solver to find: its [Stipulation], with or without a
 * distance. That tag is the only thing a row's objective is read from: a
 * missing or unreadable one is a game that needs a human, not a value to
 * infer. [Result] is the source's own result and says nothing about the side to
 * move, so a rule built on it would put a judgement in the table that no tag in
 * the corpus states.
 */
function stipulationFrom(
	headers: PgnHeaders,
	where: string,
): {
	stipulation: Stipulation;
	mateIn: number | null;
} {
	const header = headers.Stipulation?.trim();
	if (!header)
		throw new Error(
			`${where}: game has no [Stipulation]; add one naming its objective (win, draw, or #n / h#n / s#n)`,
		);
	// "#7", "h#7", "s#7.5" and the bare names.
	const distance = /^(?:(h|s)\s*)?#\s*(\d+(?:\.5)?)$/i.exec(header);
	if (distance) {
		const kind = distance[1]?.toLowerCase();
		return {
			stipulation:
				kind === "helpmate"
					? "helpmate"
					: kind === "selfmate"
						? "selfmate"
						: "mate",
			mateIn: Number(distance[2]),
		};
	}
	const named = /^(helpmate|selfmate|win|draw|mate)$/i.exec(header);
	if (named)
		return {
			stipulation: named[1]!.toLowerCase() as Stipulation,
			mateIn: null,
		};
	throw new Error(`${where}: unreadable [Stipulation] "${header}"`);
}

function validateSolution(solution: string, fen: string, label: string): void {
	const visit = (line: SolNode[]): void => {
		for (const move of line) {
			if (!move.from || !move.to)
				throw new Error(`${label}: illegal or unrecognised SAN ${move.san}`);
			for (const branch of move.variations) visit(branch.moves);
		}
	};
	visit(buildSolution(solution, fen));
}

function parseGame(file: string, game: PgnGameBlock): PgnGame {
	const headers: PgnHeaders = Object.fromEntries(game.tagMap);
	const rawFen = headers.FEN;
	if (!rawFen) throw new Error(`${file}: game has no FEN`);
	const fen = normalizeFen(rawFen);
	const { stipulation, mateIn } = stipulationFrom(
		headers,
		`${file}:${game.from + 1}`,
	);
	const solution = game.notation;
	const parsed = parseSolutionDocument(solution);
	if (!parsed.moves.length) throw new Error(`${file}: empty solution tree`);
	validateSolution(solution, fen, file);
	const identity = identityFen(fen);
	return {
		file,
		line: game.from + 1,
		headers,
		fen,
		identity,
		id: compositionId(fen),
		stipulation,
		mateIn,
		solution,
		rootComments: parsed.rootComments,
		tree: parsed.moves,
	};
}

/** A tag's value, or null when the tag is absent or empty. */
function trimmed(value: string | undefined): string | null {
	return value?.trim() || null;
}

function yearFrom(value: string | undefined): number | null {
	const match = /^(\d{4})\./.exec(value ?? "");
	if (!match) return null;
	const year = Number(match[1]);
	return year >= 1000 && year <= 9999 ? year : null;
}

const files = readdirSync(pgnDir, { withFileTypes: true })
	.filter(
		(entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".pgn"),
	)
	.map((entry) => entry.name)
	.sort();

const games: PgnGame[] = [];
for (const file of files) {
	const lines = readFileSync(path.join(pgnDir, file), "utf8").split(/\r?\n/);
	for (const game of readGameBlocks(lines, file))
		games.push(parseGame(file, game));
}

const seen = new Map<string, PgnGame>();
for (const game of games) {
	const earlier = seen.get(game.identity);
	if (earlier)
		throw new Error(
			`Diagram ${game.identity} (${game.id}) appears twice: ${earlier.file} and ${game.file}. A composition is one diagram, so one game; merge the two notations into a single game.`,
		);
	seen.set(game.identity, game);
}

const rows: Row[] = [];
let jointWorks = 0;
let coauthorCount = 0;
for (const game of games) {
	const coauthors = coauthorsOf(game.headers, `${game.file}:${game.line}`);
	if (coauthors.composer2) {
		jointWorks++;
		coauthorCount += coauthors.composer3 ? 2 : 1;
	}
	rows.push({
		id: game.id,
		fen: game.fen,
		stipulation: game.stipulation,
		mate_in: game.mateIn,
		composer: trimmed(game.headers.Composer),
		composer2: coauthors.composer2,
		composer3: coauthors.composer3,
		published_in: trimmed(game.headers.Event),
		source: trimmed(game.headers.Source),
		date: trimmed(game.headers.Date),
		year: yearFrom(game.headers.Date),
		theme: trimmed(game.headers.Theme),
		difficulty: trimmed(game.headers.Difficulty),
		key_san: sanKey(game.tree[0]!.san),
		solution: game.solution,
	});
}

const ids = new Map<string, string>();
for (const row of rows) {
	const previous = ids.get(row.id);
	if (previous && previous !== row.fen)
		throw new Error(
			`Composition id collision ${row.id}: ${previous} / ${row.fen}`,
		);
	ids.set(row.id, row.fen);
}

/**
 * `composition_solution`, the only corpus table in D1.
 *
 * Declared here rather than shared because there is exactly one consumer: this
 * script writes the text and `wrangler d1 execute --file` loads it. `data/schema.sql`
 * is the statement of the schema; this is the statement of what to insert.
 */
const ANSWERS_DDL = `CREATE TABLE IF NOT EXISTS composition_solution (
  composition_id TEXT PRIMARY KEY,   -- 7 base-62 chars of sha256(identity FEN)
  key_san        TEXT NOT NULL,      -- the solution's first move, canonical SAN
  solution       TEXT NOT NULL       -- the movetext, verbatim
);`;

/** The answers file, in batches small enough for D1's 100 KB statement cap. */
function answersSql(list: Row[]): string {
	/**
	 * Batches are measured in **bytes of rendered values**, not in a row count.
	 * Solutions range from a few characters to over five thousand, so a count that is
	 * safe today is not safe after the corpus grows.
	 */
	const STATEMENT_BUDGET = 64 * 1024;
	const chunks: string[] = [ANSWERS_DDL];
	let batch: string[] = [];
	let size = 0;

	const render = (row: Row): string =>
		`('${row.id}','${row.key_san.replace(/'/g, "''")}','${row.solution.replace(/'/g, "''")}')`;

	for (const row of list) {
		const rendered = render(row);
		if (size && size + rendered.length > STATEMENT_BUDGET) {
			chunks.push(
				`INSERT INTO composition_solution (composition_id, key_san, solution) VALUES\n${batch.join(",\n")}\n${UPSERT};`,
			);
			batch = [];
			size = 0;
		}
		batch.push(rendered);
		size += rendered.length;
	}
	if (batch.length)
		chunks.push(
			`INSERT INTO composition_solution (composition_id, key_san, solution) VALUES\n${batch.join(",\n")}\n${UPSERT};`,
		);
	return `${chunks.join("\n\n")}\n`;
}

/**
 * Rewrites a row only when the movetext changed. Everything else about a
 * composition is `build/catalogue.json`, which the deploy publishes as a static
 * asset, so a push that edited only tags still used to rewrite all 12,713 rows to
 * store the two columns it already had. Deletions are `scripts/prune-answers.ts`'s
 * half of the same drift, and stay after the deploy for the reason its header
 * gives.
 */
const UPSERT = `ON CONFLICT(composition_id) DO UPDATE SET
  key_san  = excluded.key_san,
  solution = excluded.solution
WHERE key_san IS NOT excluded.key_san OR solution IS NOT excluded.solution`;

/**
 * The public projection: everything about a composition a visitor may read, and
 * nothing else.
 *
 * It drops `composer2`/`composer3` in favour of the rendered credit the page shows,
 * drops `date` in favour of the derived `year`, and drops `key_san` and `solution`
 * outright — those two are the private half and go to `data/answers.sql` instead.
 */
function publicRow(row: Row): CompositionRow {
	return {
		id: row.id,
		fen: row.fen,
		stipulation: row.stipulation,
		mate_in: row.mate_in,
		composer: row.composer,
		coauthors: formatCoauthors(row.composer2, row.composer3),
		year: row.year,
		published_in: row.published_in,
		source: row.source,
		theme: row.theme,
		difficulty: row.difficulty,
	};
}

// ---------------------------------------------------------------- reporting

/**
 * What changed since the last import, read from the catalogue this run is about to
 * replace.
 *
 * Editing a FEN re-keys a composition, so the old id leaves and a new one arrives;
 * a bookmark or a solving row keyed by the old id is then an orphan, and one is
 * inert rather than wrong, but it is worth seeing. Read against the file this run
 * is about to replace.
 */
function diffAgainstPrevious(
	list: Row[],
): { added: string[]; removed: string[] } {
	let previous: { id: string }[] = [];
	try {
		const parsed: unknown = JSON.parse(readFileSync(CATALOGUE_PATH, "utf8"));
		if (Array.isArray(parsed)) previous = parsed as { id: string }[];
	} catch {
		// No previous import: everything is new, which the counts already show.
		return { added: [], removed: [] };
	}
	const before = new Set(previous.map((row) => row.id));
	const after = new Set(list.map((row) => row.id));
	return {
		added: list.map((row) => row.id).filter((id) => !before.has(id)),
		removed: [...before].filter((id) => !after.has(id)),
	};
}

const { added, removed } = diffAgainstPrevious(rows);

console.log(`PGN files: ${files.length}`);
console.log(`Games read: ${games.length}`);
console.log(`Compositions: ${rows.length}`);
console.log(
	`Co-authors: ${coauthorCount} on ${jointWorks} joint work(s) (composer2, composer3)`,
);
if (added.length || removed.length) {
	if (added.length)
		console.log(
			`New since the last import: ${added.slice(0, 5).join(", ")}${added.length > 5 ? ", …" : ""}`,
		);
	if (removed.length)
		console.log(
			`Gone since the last import: ${removed.slice(0, 5).join(", ")}${removed.length > 5 ? ", …" : ""}${
				removed.length ? "  (a FEN edit re-keys; bookmarks and progress on those ids are now orphans)" : ""
			}`,
		);
}
console.log(APPLY ? "Applying" : "Dry run only; pass --apply to write");

if (APPLY) {
	mkdirSync(path.dirname(CATALOGUE_PATH), { recursive: true });
	const catalogue = rows.map(publicRow);
	writeFileSync(CATALOGUE_PATH, JSON.stringify(catalogue));
	writeFileSync(ANSWERS_PATH, answersSql(rows));
	console.log(
		`Wrote ${path.relative(process.cwd(), CATALOGUE_PATH)} (${catalogue.length} rows) and ${path.relative(process.cwd(), ANSWERS_PATH)}`,
	);
}
