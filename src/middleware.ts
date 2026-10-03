import { defineMiddleware } from "astro:middleware";
import { SECURITY_HEADERS } from "./lib/security-headers";

/**
 * Label every response the Worker generates, and keep the personalized ones out
 * of shared caches.
 *
 * The headers themselves are declared once, in `src/lib/security-headers.ts`.
 * The middleware sends them here; `npm run headers` renders the same list into
 * `public/_headers` for everything served from the assets binding. That file is
 * the one Cloudflare reads for static responses and this is the only thing that
 * can label a page the Worker rendered, so the list is shared rather than
 * restated, so there is nothing here to keep in step with anything.
 *
 * HSTS is not in the list. It is set zone-wide in the Cloudflare dashboard, so
 * that one header also covers the `www` redirect, which never reaches the Worker.
 */
export const onRequest = defineMiddleware(async (context, next) => {
	const response = await next();
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
		response.headers.set(name, value);
	}

	const pathname =
		new URL(context.request.url).pathname.replace(/\/+$/, "") || "/";
	// The home page carries the day's composition, so it is the one page whose
	// content depends on when it is read. Nothing may hold it across the UTC
	// rollover, and nothing needs to: the catalogue is already in memory, so the
	// render costs a Map lookup and the answer is correct whenever it is asked for.
	//
	// `private` because the render now carries the account menu: the page says who
	// is asking, and a shared cache must never be handed a page that names someone.
	if (pathname === "/") {
		response.headers.set(
			"Cache-Control",
			"private, max-age=0, must-revalidate",
		);
	}
	// Everything personalized is per-user or per-request and must never enter a
	// shared cache: these three render this user's progress, bookmarks or solved
	// set, and each answers with the account menu as well.
	if (
		pathname === "/library" ||
		pathname === "/collections" ||
		pathname.startsWith("/compositions/")
	) {
		response.headers.set("Cache-Control", "private, no-store");
	}
	return response;
});
