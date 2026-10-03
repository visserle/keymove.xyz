import { database } from "./d1";

/**
 * The key move and the solution: the only two facts about a composition that
 * D1 keeps.
 *
 * Everything else a page shows ships as the static `/catalogue.json` asset and
 * is already in the isolate's memory by the time a route runs: diagram,
 * objective, byline, date, and the corpus's own `[Theme]` and `[Difficulty]`.
 * These two stay in D1 because a visitor who could read the whole solution set
 * would have no reason to type a key move.
 *
 * The table is deliberately narrow: two columns, one primary key, and a reader
 * that runs when a key has actually been submitted or when a page is rendering a
 * composition this user has already solved.
 *
 * The corpus is a file, so this table keys on the composition id alone. A row
 * whose composition has left `data/pgn/` goes unreferenced rather than wrong.
 * `npm run db:answers:remote` only ever adds and updates, so the table grows
 * until the collection is re-imported.
 */

export interface CompositionAnswer {
	/** The solution's first move in canonical SAN, normalised for comparison. */
	key_san: string;
	/** The movetext, verbatim, exactly as the corpus writes it. */
	solution: string;
}

/**
 * The answer to one composition, or null when there is none.
 *
 * A null here for an id the catalogue still holds means the corpus moved ahead of
 * `npm run db:answers:remote`: editing a FEN gives the composition a new id, and
 * the old id's answer row is still on its way. `POST /api/key` turns that null
 * into a 404 rather than guessing an answer.
 */
export async function answerFor(
	compositionId: string,
): Promise<CompositionAnswer | null> {
	const row = await database()
		.prepare(
			"SELECT key_san, solution FROM composition_solution WHERE composition_id = ?",
		)
		.bind(compositionId)
		.first<CompositionAnswer>();
	return row ?? null;
}