import type { APIRoute } from "astro";
import { isCompositionId, runtimeCorpus } from "../../../lib/corpus";
import { database } from "../../../lib/d1";
import { userIdFromHeaders } from "../../../lib/progress";

export const prerender = false;

const NO_STORE = { "Cache-Control": "private, no-store" };

/** Bookmark one composition for the signed-in user. */
export const PUT: APIRoute = async ({ params, request }) =>
	setBookmarked(params.id, request, true);

/** Remove one composition from the signed-in user's bookmarks. */
export const DELETE: APIRoute = async ({ params, request }) =>
	setBookmarked(params.id, request, false);

async function setBookmarked(
	requestedId: string | undefined,
	request: Request,
	bookmarked: boolean,
): Promise<Response> {
	const id = requestedId?.trim() ?? "";
	if (!isCompositionId(id)) return json({ error: "bad request" }, 400);

	const userId = await userIdFromHeaders(request.headers);
	if (!userId) return json({ error: "unauthorized" }, 401);

	const corpus = await runtimeCorpus(new URL(request.url));
	if (!corpus.byId.has(id)) return json({ error: "not found" }, 404);

	const db = database();
	if (bookmarked) {
		await db
			.prepare(
				`INSERT OR IGNORE INTO composition_bookmarks (user_id, composition_id, bookmarked_at)
				 VALUES (?, ?, ?)`,
			)
			.bind(userId, id, new Date().toISOString())
			.run();
	} else {
		await db
			.prepare(
				"DELETE FROM composition_bookmarks WHERE user_id = ? AND composition_id = ?",
			)
			.bind(userId, id)
			.run();
	}
	return new Response(null, { status: 204, headers: NO_STORE });
}

function json(data: unknown, status: number): Response {
	return Response.json(data, { status, headers: NO_STORE });
}