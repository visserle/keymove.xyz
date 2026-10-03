import type { APIRoute } from "astro";
import type { CatalogueComposition as CorpusComposition } from "../../../lib/catalogue";
import {
	collectionById,
	collectionCompositions,
	nextUnsolvedCollectionComposition,
} from "../../../lib/collections";
import {
	libraryProgress,
	solvedCompositionIds,
	userIdFromHeaders,
} from "../../../lib/progress";
import { runtimeCorpus } from "../../../lib/corpus";

export const prerender = false;

/** Continue the active collection, or choose an unsolved composition by the same author. */
export const GET: APIRoute = async ({ request, url }) => {
	const from = url.searchParams.get("from")?.trim() ?? "";
	const collectionParam = url.searchParams.get("collection");
	if (!from || from.length > 32)
		return Response.json({ error: "bad request" }, { status: 400 });

	const collection =
		collectionParam === null ? null : collectionById(collectionParam);
	if (collectionParam !== null && !collection)
		return Response.json({ error: "bad collection" }, { status: 400 });

	const [corpus, userId] = await Promise.all([
		runtimeCorpus(url),
		userIdFromHeaders(request.headers),
	]);
	if (collection) {
		const compositions = collectionCompositions(corpus.list, collection);
		if (!compositions.some((composition) => composition.id === from))
			return Response.json(
				{ error: "composition is not in collection" },
				{ status: 400 },
			);

		// The collection can be large, so load sparse user progress once rather
		// than issuing a chunked D1 query for every matching ID.
		const progress = await libraryProgress(userId);
		const nextId = nextUnsolvedCollectionComposition(
			compositions,
			from,
			progress,
		);
		const destination = nextId
			? `/compositions/${encodeURIComponent(nextId)}?collection=${collection.id}`
			: `/collections?collection=${collection.id}`;
		return redirect(destination, url);
	}

	const current = corpus.byId.get(from);
	if (!current) return Response.json({ error: "not found" }, { status: 404 });

	const solved = await solvedCompositionIds(userId);
	const pick = (candidates: CorpusComposition[]): string | null => {
		const available = candidates.filter(
			(composition) => composition.id !== from && !solved.has(composition.id),
		);
		return available.length
			? (available[Math.floor(Math.random() * available.length)]?.id ?? null)
			: null;
	};
	// `byComposer` is grouped once per isolate, so "more by this hand" is a bucket
	// rather than a filter over the whole collection.
	const nextByAuthor = current.composer
		? pick([...(corpus.byComposer.get(current.composer) ?? [])])
		: null;
	if (nextByAuthor)
		return redirect(`/compositions/${encodeURIComponent(nextByAuthor)}`, url);

	const randomUnsolved = pick([...corpus.list]);
	if (!randomUnsolved)
		return Response.json({ error: "not found" }, { status: 404 });
	return redirect(`/compositions/${encodeURIComponent(randomUnsolved)}`, url);
};

function redirect(path: string, url: URL): Response {
	return new Response(null, {
		status: 303,
		headers: {
			Location: new URL(path, url).href,
			"Cache-Control": "no-store",
		},
	});
}
