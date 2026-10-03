import { database } from "./d1";
import { userIdFromHeaders } from "./progress";

/**
 * Admin membership, and it is one row: the site has a single operator, so the
 * `admins` table is an allowlist granted and revoked with plain SQL against D1,
 * which beats a role column, a User-Agent check or a second identity provider.
 *
 *   npx wrangler d1 execute keymove --remote --command \
 *     "insert into admins (user_id, granted_at) values ('<user id>', datetime('now'))" -y
 *   npx wrangler d1 execute keymove --remote --command \
 *     "delete from admins where user_id = '<user id>'" -y
 *
 * Gate every admin route with one of the two functions below.
 */

/**
 * Is this account on the `admins` allowlist? One indexed primary-key lookup.
 *
 * Takes a user id rather than `Headers` on purpose. Every page that renders the
 * account menu has already resolved the session, because it needs the id for
 * progress, bookmarks and preferences. Asking by `Headers` would resolve it a
 * second time to answer a question the page already holds. That is a duplicate
 * Better Auth round trip on the heaviest pages, and two resolutions of one
 * session can in principle disagree.
 *
 * A route that holds only a request has no id to pass, and calls `adminUserId`
 * below instead, which resolves the session first. Two callers, one query.
 */
export async function isAdminUser(userId: string): Promise<boolean> {
	const row = await database()
		.prepare("SELECT 1 AS ok FROM admins WHERE user_id = ?")
		.bind(userId)
		.first();
	return row !== null;
}

/**
 * The signed-in admin's user id, or null when signed out or not an admin.
 *
 * For the routes that write: a curation row records who last rated or flagged a
 * composition, so they need the id rather than a yes.
 */
export async function adminUserId(headers: Headers): Promise<string | null> {
	const userId = await userIdFromHeaders(headers);
	if (userId === null || !(await isAdminUser(userId))) return null;
	return userId;
}