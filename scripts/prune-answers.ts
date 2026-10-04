/**
 * Prune D1's `composition_solution` of compositions the corpus no longer has.
 *
 *   npm run db:answers:prune:remote      # delete the withdrawn rows
 *   npm run db:answers:check:remote      # report them and write nothing
 *
 * `:local` is the same two commands against the dev database.
 *
 * `npm run corpus` writes two artefacts from `data/pgn/`: `build/catalogue.json`,
 * the public half the Worker reads, and `data/answers.sql`, the key and the
 * movetext. A deploy publishes the first and never the second, because a visitor
 * who could read the solution set would have no reason to type a key move. So the
 * private half is loaded by hand (`npm run db:answers:remote`). Pruning the
 * withdrawn rows is a separate command because its position in the pipeline is
 * not free:
 *
 *   load -> deploy -> prune
 *
 * A row the corpus has and D1 does not is fatal - `compositionWithProgress`
 * throws for anyone who has solved that composition - while a row D1 has and the
 * catalogue does not is unreachable and costs a few hundred bytes. Loading before
 * the deploy can therefore only ever leave extras; pruning before it would break
 * the version being served. Hence pruning after the deploy, and hence by diffing
 * against the *complete* catalogue rather than against what a load happened to
 * write: a half-finished load must never read as a withdrawal.
 *
 * It deletes by difference and prints what it deletes, so a wrong prune is
 * visible in the log rather than silent, and it is idempotent, so a failed deploy
 * is repaired by running the pipeline again. Nothing here records history: git
 * holds that, and D1 holds only the corpus's current state.
 *
 * The user tables are deliberately not touched. A withdrawn composition leaves a
 * reader's progress, bookmark or rating alone, because an id also changes when a
 * FEN is corrected, so "this left the corpus" is not the same statement as "delete
 * what the reader did". Those rows are inert and removable by hand.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * The id shape `scripts/composition-id.ts` produces: seven base-62 characters,
 * digits and both cases. Checked before an id is quoted into a statement, so a
 * strange row cannot become SQL.
 */
const ID = /^[0-9A-Za-z]{7}$/;

/** Enough ids per statement to stay well inside D1's 100 KB statement cap. */
const DELETE_CHUNK = 500;

const CATALOGUE_PATH = path.resolve("build/catalogue.json");
const PGN_DIR = path.resolve("data/pgn");

/**
 * The repo's own wrangler, called by path rather than through `npx`: `npx`
 * will fetch a different version when it decides the local one is not what it
 * wants, and the version that answers a production query should be the one in
 * `package.json`.
 */
const WRANGLER = path.resolve("node_modules/.bin/wrangler");

const args = process.argv.slice(2);
/** Usage stops here, so this is the one place that prints and exits. */
function fail(message: string): never {
	console.error(message);
	process.exit(2);
}
const where = args.includes("--remote")
	? "--remote"
	: args.includes("--local")
		? "--local"
		: fail("say which database: --local or --remote");
const known = ["--local", "--remote", "--check"];
const unknown = args.filter((arg) => !known.includes(arg));
if (unknown.length) fail(`unknown argument: ${unknown.join(" ")}`);

/** `--check` reports the difference and writes nothing. */
const check = args.includes("--check");
const target = where === "--local" ? "the local database" : "production";
const scope = where === "--local" ? "local" : "remote";

/** Run one statement and hand back its rows. */
function d1(sql: string): Record<string, unknown>[] {
	const stdout = execFileSync(
		WRANGLER,
		["d1", "execute", "keymove", where, "--command", sql],
		{ encoding: "utf8", maxBuffer: 1 << 28 },
	);
	const batches = parseResult(stdout);
	if (!Array.isArray(batches))
		throw new Error(`unexpected result for: ${sql}`);
	return batches.flatMap((batch) => {
		if (!isRecord(batch) || batch.success !== true)
			throw new Error(`D1 refused \`${sql}\`: ${JSON.stringify(batch)}`);
		return Array.isArray(batch.results)
			? (batch.results as Record<string, unknown>[])
			: [];
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Refuse to prune from a catalogue older than the corpus it claims to describe.
 *
 * The catalogue is a build artefact, so editing `data/pgn/` and pruning straight
 * afterwards would delete the answers of every composition edited in that edit -
 * compositions the catalogue has not read yet, so they read as withdrawn. This
 * is the one way to run this script wrong, and it is checked rather than trusted.
 */
function refuseIfCatalogueIsStale(): void {
	const catalogue = path.relative(process.cwd(), CATALOGUE_PATH);
	let newest = 0;
	for (const entry of readdirSync(PGN_DIR, { withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".pgn")) continue;
		newest = Math.max(newest, statSync(path.join(PGN_DIR, entry.name)).mtimeMs);
	}
	if (newest > statSync(CATALOGUE_PATH).mtimeMs)
		fail(
			`data/pgn/ has been edited since ${catalogue} was written. Run \`npm run corpus\` first: pruning against a catalogue that predates the edit would delete answers for compositions the corpus still has.`,
		);
}

/**
 * wrangler prints its own banners before the result, so the JSON is found by
 * trying each `[` in turn rather than by counting lines.
 */
function parseResult(stdout: string): unknown {
	for (let at = stdout.indexOf("["); at !== -1; at = stdout.indexOf("[", at + 1)) {
		try {
			const value: unknown = JSON.parse(stdout.slice(at));
			if (Array.isArray(value)) return value;
		} catch {
			// not the start of the payload; try the next bracket
		}
	}
	throw new Error("could not find D1's result in wrangler's output");
}

/** Every composition the corpus currently has, from the build artefact. */
function catalogueIds(): Set<string> {
	const parsed: unknown = JSON.parse(readFileSync(CATALOGUE_PATH, "utf8"));
	if (!Array.isArray(parsed))
		throw new Error(
			`${path.relative(process.cwd(), CATALOGUE_PATH)} is not an array; re-run \`npm run corpus\``,
		);
	const ids = parsed.map((row) => {
		const id = (row as { id?: unknown }).id;
		if (typeof id !== "string" || !ID.test(id))
			throw new Error(`unexpected id ${JSON.stringify(id)} in the catalogue`);
		return id;
	});
	if (!ids.length)
		throw new Error(
			`${path.relative(process.cwd(), CATALOGUE_PATH)} holds no compositions; run \`npm run corpus\` first`,
		);
	return new Set(ids);
}

/** Every id D1 holds, which is the corpus as this database last saw it. */
function storedIds(): Set<string> {
	return new Set(
		d1("SELECT composition_id FROM composition_solution").map((row) => {
			const id = row.composition_id;
			if (typeof id !== "string" || !ID.test(id))
				throw new Error(`unexpected composition_id ${JSON.stringify(id)}`);
			return id;
		}),
	);
}

refuseIfCatalogueIsStale();
const wanted = catalogueIds();
const stored = storedIds();
const withdrawn = [...stored].filter((id) => !wanted.has(id)).sort();

console.log(
	`${target}: composition_solution holds ${stored.size} rows, the corpus has ${wanted.size}` +
		(withdrawn.length
			? `, ${withdrawn.length} of them withdrawn`
			: ", none withdrawn"),
);
for (const id of withdrawn) console.log(`  withdrawn: ${id}`);

if (check) {
	if (withdrawn.length) {
		console.error(
			`\n${target} still holds compositions the corpus has dropped. Run \`npm run db:answers:prune:${scope}\` once the deploy that removed them is live.`,
		);
		process.exit(1);
	}
} else if (!withdrawn.length) {
	console.log("nothing to prune");
} else {
	for (let at = 0; at < withdrawn.length; at += DELETE_CHUNK) {
		const ids = withdrawn
			.slice(at, at + DELETE_CHUNK)
			.map((id) => `'${id}'`)
			.join(",");
		d1(`DELETE FROM composition_solution WHERE composition_id IN (${ids})`);
	}
	console.log(`pruned ${withdrawn.length} withdrawn row(s) from ${target}`);
}