import type { APIRoute } from "astro";
import { runtimeCorpus } from "../lib/corpus";
import { database } from "../lib/d1";
import { solvedCompositionIds, userIdFromHeaders } from "../lib/progress";

export const prerender = false;

/**
 * Resume recent work or start a random `easy` composition, preferring unsolved ones.
 *
 * The pools are the ones `Corpus` already built, the id-sorted `easy` list and
 * the daily pick. Choosing a composition is then array indexing over work done
 * once per isolate, rather than a filter and a shuffle per request.
 */
export const GET: APIRoute = async ({ request, url }) => {
	const [corpus, userId] = await Promise.all([
		runtimeCorpus(url),
		userIdFromHeaders(request.headers),
	]);
	const dailyId = corpus.dailyId();
	const pick = (ids: readonly string[]): string | null =>
		ids.length ? (ids[Math.floor(Math.random() * ids.length)] ?? null) : null;

	if (userId) {
		const inProgress = await database()
			.prepare(
				`SELECT composition_id AS id FROM composition_progress
				 WHERE user_id = ? AND solved_at IS NULL AND analysis_node_count > 0
				 ORDER BY analysis_updated_at DESC, started_at DESC
				 LIMIT 1`,
			)
			.bind(userId)
			.first<{ id: string }>();
		if (inProgress) return redirectToComposition(inProgress.id, url);
	}

	if (dailyId && userId) {
		const solved = await solvedCompositionIds(userId);
		const unsolved = pick(
			corpus.easyIds.filter((id) => id !== dailyId && !solved.has(id)),
		);
		if (unsolved) return redirectToComposition(unsolved, url);
	}

	if (dailyId) {
		const randomEasy = pick(corpus.easyIds.filter((id) => id !== dailyId));
		if (randomEasy) return redirectToComposition(randomEasy, url);

		// If there is no other `easy` puzzle, use another composition before falling
		// back to the daily one (which may be the only composition in the library).
		const randomOther = pick(
			corpus.list
				.filter((composition) => composition.id !== dailyId)
				.map((composition) => composition.id),
		);
		if (randomOther) return redirectToComposition(randomOther, url);
		return redirectToComposition(dailyId, url);
	}

	const randomComposition = pick(corpus.list.map((composition) => composition.id));
	if (!randomComposition)
		return new Response("No compositions available", {
			status: 404,
			headers: { "Cache-Control": "no-store" },
		});
	return redirectToComposition(randomComposition, url);
};

function redirectToComposition(id: string, url: URL): Response {
	return new Response(null, {
		status: 303,
		headers: {
			Location: new URL(`/compositions/${encodeURIComponent(id)}`, url).href,
			"Cache-Control": "no-store",
		},
	});
}