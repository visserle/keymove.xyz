import { env } from "cloudflare:workers";
import type { CatalogueComposition } from "./catalogue";
import { dailyComposition } from "./daily";

/**
 * The corpus as the Worker sees it: the whole collection, loaded once from the
 * `/catalogue.json` static asset the build emits and kept for the life of the
 * isolate.
 *
 * Every public fact about a game is derived from `data/pgn/` at build time and
 * shipped as that asset: diagram, objective, byline, date, and the corpus's own
 * `[Theme]` and `[Difficulty]`. A request then reads a composition the way it
 * reads its own JavaScript bundle, from the edge once and from then on out of
 * memory. D1 holds only what belongs to a user (`data/schema.sql`).
 *
 * The asset ships as a single file because this module is its only reader. The
 * library and collections pages render from this object and a composition page
 * looks its row up in `byId`, so the catalogue never reaches a browser.
 */
export interface Corpus {
	/** Every composition, in id order, which is the order the build emitted them in. */
	readonly list: readonly CatalogueComposition[];
	/** The same rows by id, so a composition page is a lookup rather than a scan. */
	readonly byId: ReadonlyMap<string, CatalogueComposition>;
	/** Every composer name, alphabetical, for the library's dropdown. */
	readonly composers: readonly string[];
	/** The `easy` compositions in id order: `/solve`'s pool. */
	readonly easyIds: readonly string[];
	/** Compositions grouped by their first composer, for "more by this hand". */
	readonly byComposer: ReadonlyMap<string, readonly CatalogueComposition[]>;
	/** Today's featured composition, or null when nothing is rated `easy`. */
	dailyId(now?: Date): string | null;
}

let corpusPromise: Promise<Corpus> | undefined;

/**
 * The corpus for this request's origin, loaded on first use.
 *
 * The promise is cached per isolate rather than per request: parsing 12,715 rows
 * on every library page view would spend the Free plan's 10ms of CPU per request
 * on JSON alone. A failed load clears the cache, so a transient asset error costs
 * one retry rather than the isolate's remaining lifetime.
 */
export function runtimeCorpus(requestUrl: URL): Promise<Corpus> {
	corpusPromise ??= load(requestUrl).catch((error: unknown) => {
		corpusPromise = undefined;
		throw error;
	});
	return corpusPromise;
}

async function load(requestUrl: URL): Promise<Corpus> {
	const request = new Request(new URL("/catalogue.json", requestUrl));
	const response = await env.ASSETS.fetch(request);
	if (!response.ok)
		throw new Error(`Could not load the static catalogue: ${response.status}`);
	const data: unknown = await response.json();
	if (!Array.isArray(data))
		throw new Error("The static catalogue is not an array");
	return build(data as CatalogueComposition[]);
}

function build(list: CatalogueComposition[]): Corpus {
	// Deduplicate before indexing: the catalogue is generated, so a repeated id is a
	// build fault, and last-one-wins would hide it behind a plausible render.
	const byId = new Map<string, CatalogueComposition>();
	for (const composition of list) byId.set(composition.id, composition);
	const rows = [...byId.values()];

	const composers = new Set<string>();
	const byComposer = new Map<string, CatalogueComposition[]>();
	const easyIds: string[] = [];
	for (const composition of rows) {
		const { composer } = composition;
		if (!composer) continue;
		composers.add(composer);
		const group = byComposer.get(composer);
		if (group) group.push(composition);
		else byComposer.set(composer, [composition]);
		if (composition.difficulty === "easy") easyIds.push(composition.id);
	}

	return {
		list: rows,
		byId,
		composers: [...composers].sort((a, b) => a.localeCompare(b)),
		easyIds,
		byComposer,
		dailyId: (now = new Date()) => dailyComposition(rows, now)?.id ?? null,
	};
}

/** Is this a plausible composition id? Cheap enough to gate a route on. */
export function isCompositionId(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= 32;
}