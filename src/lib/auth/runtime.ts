import { env } from "cloudflare:workers";
import { createAuth } from "./config";

let instance: ReturnType<typeof createAuth> | undefined;

/** Lazily read Worker bindings so prerendering never touches runtime secrets. */
export function getAuth() {
	instance ??= createAuth({
		database: env.DB,
		baseURL: env.BETTER_AUTH_URL,
		secret: env.BETTER_AUTH_SECRET,
		lichessClientId: env.LICHESS_CLIENT_ID,
	});
	return instance;
}
