import type { APIRoute } from "astro";
import { database } from "../../lib/d1";
import { parseAccountPreferences } from "../../lib/preferences";
import { userIdFromHeaders } from "../../lib/progress";

export const prerender = false;

const MAX_BODY_BYTES = 8 * 1024;
const NO_STORE = { "Cache-Control": "private, no-store" };

/** Read the signed-in user's account-synced preferences. */
export const GET: APIRoute = async ({ request }) => {
	const userId = await userIdFromHeaders(request.headers);
	if (!userId) return json({ error: "unauthorized" }, 401);

	const row = await database()
		.prepare("SELECT preferences_json FROM user_preferences WHERE user_id = ?")
		.bind(userId)
		.first<{ preferences_json: string }>();
	if (!row) return json({ preferences: null });

	try {
		return json({
			preferences: parseAccountPreferences(JSON.parse(row.preferences_json)),
		});
	} catch {
		return json({ preferences: null });
	}
};

/** Replace the signed-in user's preference snapshot. */
export const PUT: APIRoute = async ({ request }) => {
	const userId = await userIdFromHeaders(request.headers);
	if (!userId) return json({ error: "unauthorized" }, 401);

	let body: unknown;
	try {
		body = await readJson(request);
	} catch (error) {
		return json(
			{ error: "bad request" },
			error instanceof BodyTooLarge ? 413 : 400,
		);
	}
	if (typeof body !== "object" || body === null || Array.isArray(body))
		return json({ error: "bad request" }, 400);
	const preferences = parseAccountPreferences(
		(body as Record<string, unknown>).preferences,
	);
	if (!preferences) return json({ error: "invalid preferences" }, 400);

	const now = new Date().toISOString();
	await database()
		.prepare(
			`INSERT INTO user_preferences (user_id, preferences_json, updated_at)
			 VALUES (?, ?, ?)
			 ON CONFLICT (user_id) DO UPDATE SET
			   preferences_json = excluded.preferences_json,
			   updated_at = excluded.updated_at`,
		)
		.bind(userId, JSON.stringify(preferences), now)
		.run();
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

class BodyTooLarge extends Error {}

function json(data: unknown, status = 200): Response {
	return Response.json(data, { status, headers: NO_STORE });
}
