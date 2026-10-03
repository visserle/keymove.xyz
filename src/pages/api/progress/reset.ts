import type { APIRoute } from "astro";
import { isCompositionId, runtimeCorpus } from "../../../lib/corpus";
import { clearSolved, userIdFromHeaders } from "../../../lib/progress";

export const prerender = false;

/** Clear the solved marker while preserving any saved analysis for this user. */
export const POST: APIRoute = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: "bad request" }, 400);
	}
	if (typeof body !== "object" || body === null || Array.isArray(body))
		return json({ error: "bad request" }, 400);
	const { id } = body as { id?: unknown };
	if (typeof id !== "string" || !isCompositionId(id.trim()))
		return json({ error: "bad request" }, 400);

	const compositionId = id.trim();
	const corpus = await runtimeCorpus(new URL(request.url));
	if (!corpus.byId.has(compositionId)) return json({ error: "not found" }, 404);

	const userId = await userIdFromHeaders(request.headers);
	// Guests can solve in this session, but have no account-backed progress to clear.
	if (userId) {
		await clearSolved(userId, compositionId);
	}

	return new Response(null, { status: 204, headers: NO_STORE });
};

const NO_STORE = { "Cache-Control": "private, no-store" };

function json(data: unknown, status: number): Response {
	return Response.json(data, { status, headers: NO_STORE });
}