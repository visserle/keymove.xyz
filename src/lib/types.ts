/** Shapes shared between the server and the Svelte island. */

/**
 * The objective kinds `[Stipulation]` may state. The corpus's `[Stipulation]`
 * tag, and the column it is read into, are closed over exactly these five, so
 * this is the whole vocabulary: there is no "unstated" member.
 */
export type Stipulation =
	| "mate"
	| "win"
	| "draw"
	| "helpmate"
	| "selfmate";

export interface PublicComposition {
	/**
	 * Opaque content id: seven base-62 characters of sha256 over the identity FEN,
	 * e.g. `mCkUg5m`. Every character is a letter or a digit, and every position,
	 * the first included, is uniform over all 62 of them, so an id can be typed,
	 * read aloud, and compared as a plain string.
	 */
	id: string;
	fen: string;
	/** Direct mate, helpmate, selfmate, win, or draw objective. */
	stipulation: Stipulation;
	/** Stipulated move count for mate/help-mate/selfmate, when known. */
	mate_in: number | null;
	composer: string | null;
	/**
	 * Further credited composers of a joint work, in credit order, assembled from
	 * the `[Composer2]` and `[Composer3]` columns: "Horwitz, Bernhard; Kling,
	 * Josef". It is a rendering, not a stored value. Shown beside the publication
	 * rather than in the byline, so that one work does not read as two people's.
	 */
	coauthors: string | null;
	/** The year, derived from the leading `YYYY` of `[Date]`. */
	year: number | null;
	/** Original publication/source citation, shown as a hover detail. */
	published_in: string | null;
	/**
	 * The publishing detail `[Event]` does not carry: the issue, page or EG number
	 * the study appeared on, or where a version was published: "Magyar
	 * Sakkvilág/12". Lifted out of the game's leading comment when the corpus was
	 * curated, and shown under the credit.
	 */
	source: string | null;
}

/** A catalogue row: everything a card or a listing may show. */
export interface CompositionRow extends PublicComposition {
	theme: string | null;
	difficulty: string | null;
}

/** The three named difficulty levels, in order. */
export const LEVELS = ["easy", "medium", "hard"] as const;
export type Level = (typeof LEVELS)[number];

/** Is this a stored level? Mirrors the CHECK on `composition_curation.rating`. */
export function isLevel(value: unknown): value is Level {
	return (
		typeof value === "string" && (LEVELS as readonly string[]).includes(value)
	);
}

/**
 * Why the operator flagged a composition for a second look. The two answers
 * the flag tile cycles through: `fix` for a row that wants correcting, `drop`
 * for a composition that should not be in the corpus at all. There is no
 * "unstated" member - an unflagged composition stores `NULL`, as the rating
 * does.
 */
export const FLAG_REASONS = ["fix", "drop"] as const;
export type FlagReason = (typeof FLAG_REASONS)[number];

/** Is this a stored flag reason? Mirrors the CHECK on `composition_curation.flagged`. */
export function isFlagReason(value: unknown): value is FlagReason {
	return (
		typeof value === "string" &&
		(FLAG_REASONS as readonly string[]).includes(value)
	);
}

/**
 * A move of the solution, with the position it reaches and its branches.
 * All coordinates are resolved on the server so the client only has to render.
 */
export interface SolVariation {
	/** Prose introducing the branch before its first move. */
	comments: string[];
	moves: SolNode[];
}

export interface SolNode {
	san: string;
	/** "1." / "1..."; empty for an unnumbered Black move in a variation. */
	no: string;
	nags: string[];
	comments: string[];
	from: string;
	to: string;
	/** FEN after the move. */
	fen: string;
	/** One line per branch; each branch is an alternative to this move. */
	variations: SolVariation[];
}
