import type { APIRoute } from "astro";
import { adminUserId } from "../../../lib/admin";
import { runtimeCorpus } from "../../../lib/corpus";
import { parseFlagWrite, setFlag } from "../../../lib/curation";

export const prerender = false;

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * Flag one composition for a second look, with the reason why.
 *
 *   POST /api/admin/flag  { "id": "MBAJ61O", "flag": "fix" }
 *   POST /api/admin/flag  { "id": "MBAJ61O", "flag": "drop" }
 *   POST /api/admin/flag  { "id": "MBAJ61O", "flag": null }   // clear
 *
 * The mirror of `rate.ts`, down to the gate: `adminUserId` first, so a
 * non-admin never reaches the write, and the body is one of the two closed
 * reasons - `fix` for a row that wants correcting, `drop` for a composition
 * that should leave the corpus - with `null` clearing the flag. It is the
 * operator's own judgement and is never rendered for a visitor, but it is stored
 * on the same row as the rating because it is the same judgement about the same
 * composition.
 */
export const POST: APIRoute = async ({ request }) => {
	const userId = await adminUserId(request.headers);
	if (!userId) return json({ error: "forbidden" }, 403);

	const parsed = await parseFlagWrite(request);
	if ("error" in parsed) return json(parsed, 400);

	const corpus = await runtimeCorpus(new URL(request.url));
	const composition = corpus.byId.get(parsed.id);
	if (!composition) return json({ error: "not found" }, 404);

	return json(await setFlag(composition, parsed.value, userId));
};

function json(data: unknown, status = 200): Response {
	return Response.json(data, { status, headers: NO_STORE });
}