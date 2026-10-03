import { answerFor } from "./answers";
import { getAuth } from "./auth/runtime";
import type { CatalogueComposition } from "./catalogue";
import type { Corpus } from "./corpus";
import { database } from "./d1";

/**
 * Per-user solving state, and the only thing D1 holds that a normal page reads.
 *
 * Every function here is a read or an upsert against a row that already exists,
 * so each composition costs one progress row, one bookmark row and one
 * preference blob per account however many times somebody opens it. A key guess
 * on a composition with no row writes nothing.
 */

export type CompositionProgressState = "not-started" | "in-progress" | "solved";
export type LibraryProgressState = Exclude<
	CompositionProgressState,
	"not-started"
>;

export interface CompositionWithProgress {
	composition: CatalogueComposition;
	state: CompositionProgressState;
	bookmarked: boolean;
	solution?: string;
	analysis?: unknown;
}

export interface RequestAccount {
	userId: string;
	/** Display name, for the account menu. */
	name: string;
}

export interface ResolvedAccount {
	account: RequestAccount | null;
	/**
	 * `Set-Cookie` values Better Auth produced while answering. There is no session
	 * cache, so the only one it produces is the expiry it sends when a cookie
	 * arrives for a session that no longer exists; a page that drops that header
	 * leaves a browser presenting a dead cookie until it is cleared by hand.
	 */
	cookies: string[];
}

/**
 * The signed-in account for this request, or null for a guest.
 *
 * Authoritative: one primary-key read of `session` joined to `user` per request
 * that asks. There is no cookie cache (see `src/lib/auth/config.ts` for the
 * arithmetic), so a session deleted on another device, or an account deleted,
 * stops resolving on the very next request rather than when a cookie ages out.
 */
export async function accountFromHeaders(
	headers: Headers,
): Promise<ResolvedAccount> {
	const result = await getAuth().api.getSession({ headers, returnHeaders: true });
	const user = result.response?.user;
	return {
		account: user ? { userId: user.id, name: user.name } : null,
		cookies: result.headers.getSetCookie(),
	};
}

/** Put the session cookies Better Auth produced on an outgoing response. */
export function applySessionCookies(
	target: Headers,
	cookies: readonly string[],
): void {
	for (const cookie of cookies) target.append("set-cookie", cookie);
}

/**
 * Just the id, for the routes that authorize rather than render. The same
 * authoritative read, and the same header drop: a page render is what clears a
 * dead cookie, and a JSON endpoint has no page to clear it on.
 */
export async function userIdFromHeaders(
	headers: Headers,
): Promise<string | null> {
	const result = await getAuth().api.getSession({ headers });
	return result?.user.id ?? null;
}

/**
 * One composition and this user's state on it.
 *
 * The composition comes from the in-isolate corpus, so a signed-in user pays two
 * small primary-key lookups and a guest pays none: a guest's solving page reaches
 * D1 only if they submit a key, and a guest guess has no account to record
 * against.
 *
 * The solution is fetched from `composition_solution` once this user has solved
 * the composition.
 */
export async function compositionWithProgress(
	corpus: Corpus,
	compositionId: string,
	userId: string | null,
): Promise<CompositionWithProgress | null> {
	const composition = corpus.byId.get(compositionId);
	if (!composition) return null;

	if (!userId)
		return { composition, state: "not-started", bookmarked: false };

	const db = database();
	const [progress, bookmark] = await Promise.all([
		db
			.prepare(
				`SELECT solved_at, analysis_json,
				        COALESCE(analysis_node_count, 0) AS analysis_node_count
				   FROM composition_progress
				  WHERE user_id = ? AND composition_id = ?`,
			)
			.bind(userId, compositionId)
			.first<{
				solved_at: string | null;
				analysis_json: string | null;
				analysis_node_count: number;
			}>(),
		db
			.prepare(
				"SELECT 1 AS ok FROM composition_bookmarks WHERE user_id = ? AND composition_id = ?",
			)
			.bind(userId, compositionId)
			.first<{ ok: number }>(),
	]);

	// In progress only while the Analysis tree holds moves; a wrong key guess on
	// its own never moves a composition off `not-started`.
	const state: CompositionProgressState = progress?.solved_at
		? "solved"
		: progress && progress.analysis_node_count > 0
			? "in-progress"
			: "not-started";

	let analysis: unknown;
	if (progress?.analysis_json) {
		try {
			analysis = JSON.parse(progress.analysis_json);
		} catch {
			// Ignore a malformed snapshot; the solver starts a fresh analysis.
		}
	}

	let solution: string | undefined;
	if (state === "solved") {
		const answer = await answerFor(compositionId);
		if (!answer)
			throw new Error(
				`Solved composition ${compositionId} has no stored solution; run \`npm run db:answers:remote\``,
			);
		solution = answer.solution;
	}

	return {
		composition,
		state,
		bookmarked: bookmark !== null,
		...(solution !== undefined ? { solution } : {}),
		...(analysis !== undefined ? { analysis } : {}),
	};
}

/**
 * Load progress states for a page of the catalogue.
 *
 * "Sparse" is the point: the query returns only rows that say something, so a
 * visitor with no progress gets an empty result. Pass `compositionIds` to narrow
 * it to the cards actually on screen.
 */
export async function libraryProgress(
	userId: string | null,
	compositionIds?: readonly string[],
): Promise<Map<string, LibraryProgressState>> {
	if (!userId || (compositionIds && compositionIds.length === 0))
		return new Map();

	type ProgressRow = {
		composition_id: string;
		solved_at: string | null;
		analysis_node_count: number;
	};
	const db = database();
	let rows: ProgressRow[];
	if (!compositionIds) {
		const result = await db
			.prepare(
				`SELECT composition_id, solved_at, analysis_node_count FROM composition_progress
				 WHERE user_id = ? AND (solved_at IS NOT NULL OR analysis_node_count > 0)`,
			)
			.bind(userId)
			.all<ProgressRow>();
		rows = result.results;
	} else {
		// Keep well below SQLite/D1's bound-variable limit for large bookmark sets.
		const uniqueIds = [...new Set(compositionIds)];
		const chunks: string[][] = [];
		for (let i = 0; i < uniqueIds.length; i += 90)
			chunks.push(uniqueIds.slice(i, i + 90));
		const results = await Promise.all(
			chunks.map((ids) =>
				db
					.prepare(
						`SELECT composition_id, solved_at, analysis_node_count
						 FROM composition_progress
						 WHERE user_id = ? AND composition_id IN (${ids.map(() => "?").join(",")})
						   AND (solved_at IS NOT NULL OR analysis_node_count > 0)`,
					)
					.bind(userId, ...ids)
					.all<ProgressRow>(),
			),
		);
		rows = results.flatMap((result) => result.results);
	}

	return new Map(
		rows.map((row) => [
			row.composition_id,
			row.solved_at ? "solved" : "in-progress",
		]),
	);
}

/** Solved IDs, so `/solve` and Next can prefer something this user has not seen. */
export async function solvedCompositionIds(
	userId: string | null): Promise<Set<string>> {
	if (!userId) return new Set();
	const result = await database()
		.prepare(
			`SELECT composition_id FROM composition_progress
			 WHERE user_id = ? AND solved_at IS NOT NULL`,
		)
		.bind(userId)
		.all<{ composition_id: string }>();
	return new Set(result.results.map((row) => row.composition_id));
}

/** Replace this user's latest analysis snapshot without changing solved state. */
export async function saveCompositionAnalysis(
	userId: string,
	compositionId: string,
	analysisJson: string,
	moveCount: number,
): Promise<void> {
	const now = new Date().toISOString();
	await database()
		.prepare(
			`INSERT INTO composition_progress
       (user_id, composition_id, started_at, solved_at, analysis_json, analysis_updated_at, analysis_node_count)
       VALUES (?, ?, ?, NULL, ?, ?, ?)
       ON CONFLICT (user_id, composition_id) DO UPDATE SET
         analysis_json = excluded.analysis_json,
         analysis_updated_at = excluded.analysis_updated_at,
         analysis_node_count = excluded.analysis_node_count`,
		)
		.bind(userId, compositionId, now, analysisJson, now, moveCount)
		.run();
}

/**
 * Record one submitted key guess for a signed-in user.
 *
 * This writes `key_attempts` on every guess, right or wrong, because what a
 * person actually tried in the order they tried it is the part worth keeping.
 * The table is a dataset for asking questions later rather than a feature, so the
 * request path leaves it alone and a failed write costs a solve nothing. See the
 * `key_attempts` section of `data/schema.sql`.
 *
 * Guests are not recorded: there is no account to attribute a guess to.
 */
export async function recordKeyAttempt(
	userId: string,
	compositionId: string,
	guess: string,
	isCorrect: boolean,
): Promise<void> {
	await database()
		.prepare(
			`INSERT INTO key_attempts
       (user_id, composition_id, guess, is_correct, attempted_at)
     VALUES (?, ?, ?, ?, ?)`,
		)
		.bind(
			userId,
			compositionId,
			// The key field caps input at 7 characters; trimming here keeps a
			// hand-rolled request from putting arbitrary length in the dataset.
			guess.trim().slice(0, 64),
			isCorrect ? 1 : 0,
			new Date().toISOString(),
		)
		.run();
}

/** Only a verified correct key submission creates or marks solved progress. */
export async function recordCorrectKeySubmission(
	userId: string,
	compositionId: string,
): Promise<void> {
	const now = new Date().toISOString();
	await database()
		.prepare(
			`INSERT INTO composition_progress
       (user_id, composition_id, started_at, solved_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, composition_id) DO UPDATE SET
         solved_at = COALESCE(composition_progress.solved_at, excluded.solved_at)`,
		)
		.bind(userId, compositionId, now, now)
		.run();
}

/** Clear the solved marker while preserving any saved analysis for this user. */
export async function clearSolved(
	userId: string,
	compositionId: string,
): Promise<void> {
	await database()
		.prepare(
			"UPDATE composition_progress SET solved_at = NULL WHERE user_id = ? AND composition_id = ?",
		)
		.bind(userId, compositionId)
		.run();
}
