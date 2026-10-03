import type { APIRoute } from "astro";
import { libraryProgress, userIdFromHeaders } from "../../lib/progress";

export const prerender = false;

/** JSON access to the signed-in user's states; page rendering loads them server-side. */
export const GET: APIRoute = async ({ request, url }) => {
	const userId = await userIdFromHeaders(request.headers);
	if (!userId) return json({ compositions: [] });

	const idsParam = url.searchParams.get("ids");
	let requestedIds: string[] | undefined;
	if (idsParam !== null) {
		const suppliedIds = idsParam.split(",").map((id) => id.trim());
		if (
			suppliedIds.length > 24 ||
			suppliedIds.some((id) => !id || id.length > 32)
		)
			return json({ error: "bad request" }, 400);
		requestedIds = [...new Set(suppliedIds)];
	}

	const states = await libraryProgress(userId, requestedIds);
	return json({
		compositions: [...states].map(([id, state]) => ({ id, state })),
	});
};

function json(data: unknown, status = 200): Response {
	return Response.json(data, {
		status,
		headers: { "Cache-Control": "private, no-store" },
	});
}
