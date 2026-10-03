import type { APIRoute } from "astro";
import { answerFor } from "../../../lib/answers";
import { isCompositionId } from "../../../lib/corpus";
import { database } from "../../../lib/d1";
import { userIdFromHeaders } from "../../../lib/progress";

export const prerender = false;

/**
 * Return saved state; the solution is included only after this user solved it.
 *
 * One primary-key read on `composition_progress`, and one on
 * `composition_solution` only in the branch that is allowed to see it.
 */
export const GET: APIRoute = async ({ params, request }) => {
	const id = params.id?.trim() ?? "";
	if (!isCompositionId(id)) return json({ error: "bad request" }, 400);

	const userId = await userIdFromHeaders(request.headers);
	if (!userId) return json({ state: "not-started" });

	const row = await database()
		.prepare(
			`SELECT solved_at, COALESCE(analysis_node_count, 0) AS analysis_node_count
			   FROM composition_progress
			  WHERE user_id = ? AND composition_id = ?`,
		)
		.bind(userId, id)
		.first<{ solved_at: string | null; analysis_node_count: number }>();

	if (row?.solved_at) {
		const answer = await answerFor(id);
		if (!answer) return json({ error: "no answer for this composition" }, 500);
		return json({ state: "solved", solution: answer.solution });
	}
	if (row && row.analysis_node_count > 0) return json({ state: "in-progress" });
	return json({ state: "not-started" });
};

function json(data: unknown, status = 200): Response {
	return Response.json(data, {
		status,
		headers: { "Cache-Control": "private, no-store" },
	});
}