import { database } from "./d1";
import { parseAccountPreferences, type AccountPreferences } from "./preferences";

/**
 * The D1 half of the account preferences: one row per account, read whole.
 *
 * It lives apart from `preferences.ts` because that module is imported by the
 * client and by prerendered pages, and reaching D1 from either of them pulls in
 * `cloudflare:workers`, which they cannot load. A layout that renders the account
 * menu reads the row through here.
 */
export async function readAccountPreferences(
	userId: string,
): Promise<{ preferences: AccountPreferences | null }> {
	const row = await database()
		.prepare("SELECT preferences_json FROM user_preferences WHERE user_id = ?")
		.bind(userId)
		.first<{ preferences_json: string }>();
	if (!row) return { preferences: null };
	try {
		return {
			preferences: parseAccountPreferences(JSON.parse(row.preferences_json)),
		};
	} catch {
		// A malformed blob is not an error: localStorage is the fallback and the
		// client writes a good one back on the next change.
		return { preferences: null };
	}
}
