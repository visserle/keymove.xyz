import type { APIRoute } from "astro";
import { adminUserId } from "../../../lib/admin";
import { runtimeCorpus } from "../../../lib/corpus";
import { parseRatingWrite, setRating } from "../../../lib/curation";

export const prerender = false;

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * Record (or clear) the admin's difficulty rating for one composition.
 *
 *   POST /api/admin/rate  { "id": "MBAJ61O", "rating": "medium" }
 *   POST /api/admin/rate  { "id": "MBAJ61O", "rating": null }   // clear
 *
 * Gate first and gate with `adminUserId`, so a non-admin costs one indexed
 * primary-key lookup on `admins` and no write. The composition then comes from
 * the static catalogue, which is where it is validated to exist. The
 * level vocabulary is closed to the corpus's three in both `isLevel` and the
 * table's CHECK; `null` is the only way past it, and it clears the rating without
 * touching the flag.
 */
export const POST: APIRoute = async ({ request }) => {
	const userId = await adminUserId(request.headers);
	if (!userId) return json({ error: "forbidden" }, 403);

	const parsed = await parseRatingWrite(request);
	if ("error" in parsed) return json(parsed, 400);

	const corpus = await runtimeCorpus(new URL(request.url));
	const composition = corpus.byId.get(parsed.id);
	if (!composition) return json({ error: "not found" }, 404);

	return json(await setRating(composition, parsed.value, userId));
};

function json(data: unknown, status = 200): Response {
	return Response.json(data, { status, headers: NO_STORE });
}