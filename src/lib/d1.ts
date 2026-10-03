import { env } from "cloudflare:workers";

/** The slice of the Cloudflare D1 API this app uses. Keeps the DB code free of
 * any dependency on `@cloudflare/workers-types`. */

export interface D1Result<T> {
	results: T[];
	success: boolean;
	/** Row counts for writes. */
	meta?: { changes?: number };
}

export interface D1PreparedStatement {
	bind(...values: unknown[]): D1PreparedStatement;
	all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
	first<T = Record<string, unknown>>(): Promise<T | null>;
	run(): Promise<D1Result<Record<string, unknown>>>;
}

export interface D1Database {
	prepare(query: string): D1PreparedStatement;
}

/** The D1 handle for the current Worker request. */
export function database(): D1Database {
	const db = (env as unknown as { DB?: D1Database }).DB;
	if (!db)
		throw new Error('No D1 binding "DB" — is wrangler.jsonc configured?');
	return db;
}
