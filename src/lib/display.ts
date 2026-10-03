import { sideToMove } from "./chess/fen";
import type { FlagReason, PublicComposition } from "./types";

/** How a co-author credit is rendered beside a byline. */
const COAUTHOR_SEPARATOR = "; ";

/**
 * The co-authors of a joint work, from the `[Composer2]`, `[Composer3]`… columns
 * in credit order, or null when the work has only one composer.
 *
 * The columns are the corpus's own numbered tags, so the display string is
 * assembled here rather than stored: it is a rendering of two columns, not a
 * fact about the study. A fourth composer is an importer error naming the file,
 * not a format change (see `coauthorsOf` in `scripts/import-pgn.ts`).
 */
export function formatCoauthors(
	...names: (string | null | undefined)[]
): string | null {
	const present = names.filter((name): name is string => !!name?.trim());
	return present.length ? present.join(COAUTHOR_SEPARATOR) : null;
}

/** The headline a composition carries, from its stipulation. */
export function taskFor(
	p: Pick<PublicComposition, "fen" | "stipulation" | "mate_in">,
): string {
	const side = sideToMove(p.fen) === "white" ? "White" : "Black";
	if (p.stipulation === "draw") return `${side} to play and draw`;
	if (p.stipulation === "win") return `${side} to play and win`;
	if (p.stipulation === "mate") {
		return p.mate_in
			? `${side} to play and mate in ${p.mate_in}`
			: `${side} to play and mate`;
	}
	// A stipulation is one of the five kinds, so the two composed objectives are
	// what is left. The column is NOT NULL and the importer refuses a game that
	// does not state one, so there is no unstated case to handle here.
	const goal = p.stipulation === "helpmate" ? "helpmate" : "selfmate";
	return `${side} to play · ${goal}${p.mate_in ? ` in ${p.mate_in}` : ""}`;
}

/** The three stored levels are lowercase; the catalogue prints them capitalised. */
export function levelLabel(name: string | null): string {
	return name ? name[0]!.toUpperCase() + name.slice(1) : "Unassigned";
}

/**
 * A flag reason as the tile prints it. `drop` rather than `remove` because
 * nothing is removed by pressing the tile: it records a verdict, and the corpus
 * loses a composition by hand afterwards.
 */
export function flagReasonLabel(reason: FlagReason): string {
	return reason === "fix" ? "Fix" : "Drop";
}

/**
 * The hover on the credit line: where the study was published, and with whom.
 *
 * A joint work is credited to its first composer in the byline, so the
 * co-authors have nowhere else to go but here, next to the publication they were
 * published with. Both are absent for most studies, and the hover is then
 * the publication on its own.
 */
export function creditDetail(
	p: Pick<PublicComposition, "published_in" | "source" | "coauthors">,
): string | undefined {
	const parts: string[] = [];
	if (p.published_in) parts.push(`Published in ${p.published_in}`);
	if (p.source) parts.push(p.source);
	if (p.coauthors) parts.push(`With ${p.coauthors}`);
	return parts.length ? parts.join(" · ") : undefined;
}
