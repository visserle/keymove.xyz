import type { APIRoute } from "astro";
import {
	restoreAnalysis,
	serializeAnalysis,
} from "../../../lib/chess/analysis";
import { isCompositionId, runtimeCorpus } from "../../../lib/corpus";
import { saveCompositionAnalysis, userIdFromHeaders } from "../../../lib/progress";

export const prerender = false;

const MAX_BODY_BYTES = 256 * 1024;

/** Replace the signed-in user's latest analysis snapshot for a composition. */
export const PUT: APIRoute = async ({ request }) => {
	let body: unknown;
	try {
		body = await readJson(request);
	} catch (error) {
		return json(
			{ error: "bad request" },
			error instanceof BodyTooLarge ? 413 : 400,
		);
	}
	if (!isRecord(body)) return json({ error: "bad request" }, 400);
	const { id, analysis } = body;
	if (typeof id !== "string" || !isCompositionId(id.trim()))
		return json({ error: "bad request" }, 400);

	const userId = await userIdFromHeaders(request.headers);
	// Analysis still works for guests; it has nowhere account-backed to save.
	if (!userId) return new Response(null, { status: 204, headers: NO_STORE });

	// The composition comes from the static catalogue now, so the only work left on
	// this route is the one thing it cannot delegate: validating that the snapshot
	// replays from this diagram before it is stored.
	const corpus = await runtimeCorpus(new URL(request.url));
	const composition = corpus.byId.get(id.trim());
	if (!composition) return json({ error: "not found" }, 404);

	const restored = restoreAnalysis(composition.fen, analysis);
	if (!restored) return json({ error: "invalid analysis" }, 400);
	const snapshot = JSON.stringify(serializeAnalysis(restored.root));
	if (new TextEncoder().encode(snapshot).byteLength > MAX_BODY_BYTES)
		return json({ error: "analysis too large" }, 413);

	await saveCompositionAnalysis(userId, id.trim(), snapshot, restored.moveCount);
	return new Response(null, { status: 204, headers: NO_STORE });
};

async function readJson(request: Request): Promise<unknown> {
	const reader = request.body?.getReader();
	if (!reader) throw new Error("Missing request body");
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > MAX_BODY_BYTES) {
			await reader.cancel().catch(() => {});
			throw new BodyTooLarge();
		}
		chunks.push(value);
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return JSON.parse(new TextDecoder().decode(bytes));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

class BodyTooLarge extends Error {}

const NO_STORE = { "Cache-Control": "private, no-store" };

function json(data: unknown, status: number): Response {
	return Response.json(data, { status, headers: NO_STORE });
}
