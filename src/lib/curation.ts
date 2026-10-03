import type { CatalogueComposition } from "./catalogue";
import { database } from "./d1";
import {
	type FlagReason,
	isFlagReason,
	isLevel,
	type Level,
} from "./types";

/**
 * The operator's curation of a composition: a difficulty rating and a flag.
 *
 * Both are judgements about a game rather than content, so both live in
 * `composition_curation` and neither rewrites the corpus. One row per
 * composition, written by whichever judgement changed last.
 *
 * Rows outlive the compositions they point at. The corpus is a file, so there is
 * nothing to cascade from, and an orphan is recoverable by hand where a
 * silently deleted rating is gone. The corpus's own `[Difficulty]` is read
 * from the in-isolate corpus to compare against the operator's, and it is never
 * written here.
 */

/** What the operator has said about one composition, and what the corpus says. */
export interface Curation {
	rating: Level | null;
	/**
	 * Why the operator flagged the composition, or `null` for no flag. Private:
	 * shown to admins only, never to a visitor.
	 */
	flagged: FlagReason | null;
	/**
	 * The corpus's own curated `[Difficulty]`. It rides along because the rating
	 * strip is the only place either value appears, and setting the strip against
	 * the corpus value is the point of the marker. Read from the corpus, never
	 * written.
	 */
	curated: Level | null;
}

/** The stored rating and flag for one composition, with the corpus's level beside
 * them. A curation row may be absent entirely, so this is a point lookup rather
 * than a join, and for a composition with no row it is still one primary-key
 * lookup that finds nothing. */
export async function curationFor(
	composition: CatalogueComposition,
): Promise<Curation> {
	const row = await database()
		.prepare(
			"SELECT rating, flagged FROM composition_curation WHERE composition_id = ?",
		)
		.bind(composition.id)
		.first<{ rating: string | null; flagged: string | null }>();
	return {
		rating: row?.rating && isLevel(row.rating) ? row.rating : null,
		flagged: isFlagReason(row?.flagged) ? row.flagged : null,
		curated:
			composition.difficulty && isLevel(composition.difficulty)
				? composition.difficulty
				: null,
	};
}

/**
 * Record a rating, replacing the composition's, and return the new curation.
 * `null` clears it, which leaves the flag alone.
 */
export async function setRating(
	composition: CatalogueComposition,
	rating: Level | null,
	userId: string,
): Promise<Curation> {
	return write(composition, { rating }, userId);
}

/**
 * Flag the composition for a second look, with the reason why: `fix` for a row
 * that wants correcting, `drop` for a composition that should leave the corpus.
 * `null` clears the flag, which leaves the rating alone.
 */
export async function setFlag(
	composition: CatalogueComposition,
	flagged: FlagReason | null,
	userId: string,
): Promise<Curation> {
	return write(composition, { flagged }, userId);
}

/** A parsed write: the composition id and the value, or the reason it was refused. */
export type ParsedWrite<T> = { error: string } | { id: string; value: T };

/** Parse `{ id, rating }` from a request body; `null` clears the rating. */
export async function parseRatingWrite(
	request: Request,
): Promise<ParsedWrite<Level | null>> {
	const body = await readJson(request);
	if ("error" in body) return body;
	if (body.rating === null) return { id: body.id, value: null };
	if (!isLevel(body.rating)) return { error: "bad request" };
	return { id: body.id, value: body.rating };
}

/**
 * Parse `{ id, flag }` from a request body, where `flag` is one of the two
 * stored reasons. `null` clears it, which is what the rating does the same way.
 */
export async function parseFlagWrite(
	request: Request,
): Promise<ParsedWrite<FlagReason | null>> {
	const body = await readJson(request);
	if ("error" in body) return body;
	if (body.flag === null) return { id: body.id, value: null };
	if (!isFlagReason(body.flag)) return { error: "bad request" };
	return { id: body.id, value: body.flag };
}

/**
 * The body both admin routes take: a composition id and one value. The key
 * must be present, because a missing value and a value of `null` mean opposite
 * things for both judgements: one is a bad request, the other clears it.
 */
async function readJson(
	request: Request,
): Promise<
	{ error: string } | { id: string; rating?: unknown; flag?: unknown }
> {
	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		return { error: "bad request" };
	}
	const body = (raw ?? {}) as Record<string, unknown>;
	const id = typeof body.id === "string" ? body.id.trim() : "";
	if (!id || id.length > 32) return { error: "bad request" };
	return { id, rating: body.rating, flag: body.flag };
}

/**
 * Upsert the composition's curation row, changing only the named field.
 *
 * The caller has already established that `userId` is in `admins` and has resolved
 * `composition` from the corpus, so this only writes. `curated` is read-only
 * context: the corpus keeps it, and it travels back on the return value so the
 * caller can re-render without a second read.
 */
async function write(
	composition: CatalogueComposition,
	change: { rating?: Level | null; flagged?: FlagReason | null },
	userId: string,
): Promise<Curation> {
	const db = database();
	const current = await curationFor(composition);
	const next = { ...current, ...change };
	const now = new Date().toISOString();

	if (next.rating === null && next.flagged === null) {
		// A row exists only while at least one judgement is set, so the last one
		// going takes the row with it rather than leaving an empty shell behind.
		await db
			.prepare("DELETE FROM composition_curation WHERE composition_id = ?")
			.bind(composition.id)
			.run();
	} else {
		await db
			.prepare(
				`INSERT INTO composition_curation
				   (composition_id, user_id, rating, flagged, updated_at)
				 VALUES (?, ?, ?, ?, ?)
				 ON CONFLICT (composition_id) DO UPDATE SET
				   user_id    = excluded.user_id,
				   rating     = excluded.rating,
				   flagged    = excluded.flagged,
				   updated_at = excluded.updated_at`,
			)
			.bind(
				composition.id,
				userId,
				next.rating,
				next.flagged,
				now,
			)
			.run();
	}
	return next;
}
