import { readFileSync } from "node:fs";
import path from "node:path";
import { dailyComposition } from "./daily";
import type { CompositionRow } from "./types";

/**
 * The corpus as the **build** sees it, read from the one artefact
 * `npm run corpus` writes.
 *
 * There is no database here. `data/keymove.db` was a build-time SQLite copy of
 * `data/pgn/` that this module opened directly; it was a committed cache, so a
 * corpus edit and the thing derived from it could disagree silently. The importer
 * now writes `build/catalogue.json` in one pass and nothing else reads the corpus.
 *
 * `npm run build` runs the import first, so a build can never read a corpus that
 * has moved. `astro dev` does not, so after editing a game run:
 *
 *   npm run corpus
 *
 * This is the runtime's counterpart, not its twin: `src/lib/corpus.ts` reads the
 * same rows out of the deployed `/catalogue.json` asset inside the Worker.
 */

const CATALOGUE_PATH =
	process.env.CATALOGUE_PATH ??
	path.resolve(process.cwd(), "build/catalogue.json");

let rows: CompositionRow[] | undefined;

function catalogue(): CompositionRow[] {
	if (!rows) {
		let text: string;
		try {
			text = readFileSync(CATALOGUE_PATH, "utf8");
		} catch {
			throw new Error(
				`No corpus at ${path.relative(process.cwd(), CATALOGUE_PATH)}. ` +
					`Run \`npm run corpus\` to read data/pgn/ into it ` +
					`(\`npm run build\` does this for you).`,
			);
		}
		const parsed: unknown = JSON.parse(text);
		if (!Array.isArray(parsed))
			throw new Error(
				`${CATALOGUE_PATH} is not an array; re-run \`npm run corpus\``,
			);
		rows = parsed as CompositionRow[];
	}
	return rows;
}

/** Every composition, in id order. This is the public half, with no solutions. */
export function getCatalogue(): CompositionRow[] {
	return catalogue();
}

/**
 * The day's composition, for the prerendered home page.
 *
 * The choice itself is `dailyComposition()` in `src/lib/daily.ts`, shared with the
 * Worker's copy of the same catalogue, so the page and `/solve` can never
 * disagree about what today is.
 */
export function getDailyComposition(now = new Date()): CompositionRow {
	const selected = dailyComposition(catalogue(), now);
	if (!selected) throw new Error("No easy compositions to feature");
	return selected;
}
