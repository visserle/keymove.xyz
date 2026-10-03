/**
 * The Worker bindings the app uses, declared by hand.
 *
 * `wrangler types` would generate a full `@cloudflare/workers-types` file, but
 * those types conflict with the DOM types the client catalogue script needs
 * (two different `Element`s). A one-line ambient module avoids the clash.
 *
 */
declare module "cloudflare:workers" {
	export const env: {
		DB: import("better-auth").D1Database & import("./lib/d1").D1Database;
		ASSETS: { fetch(request: Request): Promise<Response> };
		BETTER_AUTH_URL: string;
		BETTER_AUTH_SECRET: string;
		LICHESS_CLIENT_ID: string;
	};
}