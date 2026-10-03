import type { LibraryProgressState } from "./progress";
import type { CompositionRow } from "./types";

export interface CollectionDefinition {
	id: string;
	title: string;
	matches: (composition: CompositionRow) => boolean;
}

/**
 * Premade collections are predicates over the deployed catalogue. Each build
 * picks up new and updated compositions on its own, with no seed or migration
 * step of its own.
 *
 * A collection's id is opaque, and stays opaque when its title is edited: the
 * site links to a collection as `?collection=<id>`, so an id derived from the
 * title would move every link the first time somebody renamed it. Each id below
 * is therefore generated with `contentId` from `scripts/composition-id.ts`, over
 * the seed named in its comment. That gives the same seven letters and digits a
 * composition id has. The shape is asserted at the bottom of this file, so a
 * wrong id is a load-time failure rather than a link that quietly 404s.
 */
export const COLLECTIONS = [
	{
		id: "o4FxbuY", // contentId("collection/endgame-studies")
		title: "Endgame Studies",
		matches: (composition) =>
			(composition.stipulation === "win" ||
				composition.stipulation === "draw") &&
			countFenPieces(composition.fen) <= 8,
	},
	{
		id: "t43Ne0R", // contentId("collection/mate-in-2")
		title: "Mate in 2",
		matches: (composition) =>
			composition.stipulation === "mate" && composition.mate_in === 2,
	},
	{
		id: "mCkUg5m", // contentId("collection/mate-in-3")
		title: "Mate in 3",
		matches: (composition) =>
			composition.stipulation === "mate" && composition.mate_in === 3,
	},
	{
		id: "uJhhGyC", // contentId("collection/mate-in-4-plus")
		title: "Mate in 4+",
		matches: (composition) =>
			composition.stipulation === "mate" &&
			composition.mate_in !== null &&
			composition.mate_in >= 4,
	},
] satisfies CollectionDefinition[];

/** Count both colours' pieces (including kings) from a FEN placement field. */
function countFenPieces(fen: string): number {
	return (fen.trim().split(/\s+/, 1)[0]?.match(/[pnbrqk]/gi) ?? []).length;
}

/**
 * The shape every collection id has to have: seven characters of letters and
 * digits, as `scripts/composition-id.ts` defines them. Spelled out rather than
 * imported because this module runs in the Worker, where the generator's
 * `node:crypto` is unavailable. The ids are literals here, and this check keeps
 * them honest.
 */
const COLLECTION_ID = /^[0-9A-Za-z]{7}$/;

if (
	new Set(COLLECTIONS.map((collection) => collection.id)).size !==
	COLLECTIONS.length
)
	throw new Error("Duplicate collection ID");

for (const { id, title } of COLLECTIONS)
	if (!COLLECTION_ID.test(id))
		throw new Error(
			`Collection id ${id} (${title}) is not seven letters and digits`,
		);

export function collectionById(id: string | null): CollectionDefinition | null {
	return COLLECTIONS.find((collection) => collection.id === id) ?? null;
}

/** Every matching composition in a stable order for collection navigation. */
export function collectionCompositions(
	catalogue: readonly CompositionRow[],
	collection: CollectionDefinition,
): CompositionRow[] {
	return catalogue
		.filter(collection.matches)
		.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The next position in the collection that is unsolved or in progress, wrapping
 * through the collection's stable order. A collection of one returns that one;
 * a null means every position in it is solved.
 */
export function nextUnsolvedCollectionComposition(
	compositions: readonly CompositionRow[],
	from: string,
	progress: ReadonlyMap<string, LibraryProgressState>,
): string | null {
	const ordered = [
		...compositions.filter((composition) => composition.id > from),
		...compositions.filter((composition) => composition.id <= from),
	];
	return (
		ordered.find((composition) => progress.get(composition.id) !== "solved")
			?.id ?? null
	);
}
