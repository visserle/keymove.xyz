import type { APIRoute } from "astro";
import { getAuth } from "../../../lib/auth/runtime";
import {
	AUTH_SESSION_LOOKUP_TIMEOUT_MS,
	withSessionLookupTimeout,
} from "../../../lib/auth/timeout";

export const prerender = false;

/** Better Auth's handler for OAuth, sessions, sign-out, and account deletion. */
export const ALL: APIRoute = async ({ request }) => {
	const pathname = new URL(request.url).pathname.replace(/\/+$/, "");
	if (
		pathname !== "/api/auth/get-session" ||
		(request.method !== "GET" && request.method !== "POST")
	)
		return getAuth().handler(request);

	const lookup = await withSessionLookupTimeout(() =>
		getAuth().handler(request),
	);
	if (!lookup.timedOut) return lookup.value;

	console.warn(
		`[auth] /get-session exceeded ${AUTH_SESSION_LOOKUP_TIMEOUT_MS}ms; returning 503`,
	);
	return Response.json(
		{ error: "session_lookup_timeout", message: "Session lookup timed out" },
		{
			status: 503,
			headers: {
				"Cache-Control": "private, no-store",
				"Retry-After": String(Math.ceil(AUTH_SESSION_LOOKUP_TIMEOUT_MS / 1000)),
			},
		},
	);
};
