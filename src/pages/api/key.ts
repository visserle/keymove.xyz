import type { APIRoute } from "astro";
import { answerFor } from "../../lib/answers";
import { isKeyGuess } from "../../lib/chess/check";
import { isCompositionId } from "../../lib/corpus";
import {
	recordCorrectKeySubmission,
	recordKeyAttempt,
	userIdFromHeaders,
} from "../../lib/progress";

export const prerender = false;

/**
 * The on-demand key-check route; the other authorized solution path is the
 * Worker-rendered composition page for a user whose D1 progress says solved.
 *
 * The key and the raw solution notation live in `composition_solution`
 * (src/lib/answers.ts), the private half of the corpus and the only part of a
 * composition that cannot be a public asset. The check is one indexed read and a
 * string comparison; the Worker runs no rules engine, so it cannot compute the key
 * per request. The browser rebuilds the move tree from the notation.
 *
 * Every guess by a signed-in user is appended to `key_attempts`, right or wrong.
 * That table is a dataset for later analysis rather than a feature, so nothing
 * here depends on it and a failed write cannot fail a solve. Guests are not
 * recorded: there is no account to attribute a guess to.
 */
export const POST: APIRoute = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: "bad request" }, 400);
	}

	if (typeof body !== "object" || body === null)
		return json({ error: "bad request" }, 400);
	const { id, guess } = body as { id?: unknown; guess?: unknown };
	if (
		typeof id !== "string" ||
		!isCompositionId(id.trim()) ||
		typeof guess !== "string" ||
		!guess.trim()
	) {
		return json({ error: "bad request" }, 400);
	}
	const compositionId = id.trim();

	const answer = await answerFor(compositionId);
	if (!answer) return json({ error: "not found" }, 404);

	const correct = isKeyGuess(answer.key_san, guess);
	const userId = await userIdFromHeaders(request.headers);
	if (userId) {
		await recordKeyAttempt(userId, compositionId, guess, correct);
		if (correct) await recordCorrectKeySubmission(userId, compositionId);
	}

	if (!correct) return json({ correct: false }, 200);
	return json({ correct: true, solution: answer.solution }, 200);
};

function json(data: unknown, status: number): Response {
	return Response.json(data, {
		status,
		headers: { "Cache-Control": "private, no-store" },
	});
}
