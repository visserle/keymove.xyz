import { sanCompareKey } from "./notation";

/**
 * The spellings of a move that all mean the same thing: case, German piece
 * initials, a leading move number, trailing annotations, castling zeros and
 * promotion syntax.
 *
 * Deliberately free of any rules engine, so the Worker can run it. Each
 * composition's canonical key is materialised as `key_san` at import time
 * (`scripts/import-pgn.ts`), and a guess is compared against it as a string.
 */
function keyCandidates(input: string): string[] {
	const cleaned = input
		.trim()
		.replace(/^\d+\.+\s*/, "") // leading move number
		.replace(/[!?]+$/, "") // annotation
		.trim();
	if (!cleaned) return [];

	const candidates = new Set<string>([cleaned, cleaned.replace(/0/g, "O")]);
	// A piece move typed in lower case: `nf6` for `Nf6`.
	if (/^[kqrbn]/.test(cleaned))
		candidates.add(cleaned[0]!.toUpperCase() + cleaned.slice(1));
	// A lower-case promotion, with or without the `=`: `e8=q`, `e8q` and `bxa8q`
	// for `e8=Q` and `bxa8=Q`. Only promotions end in a piece letter, so this is
	// safe for ordinary moves, which end in a rank digit.
	candidates.add(
		cleaned.replace(
			/=?([kqrbn])([+#]?)$/i,
			(_m, piece: string, suffix: string) => `=${piece.toUpperCase()}${suffix}`,
		),
	);
	return [...candidates];
}

/**
 * Does `guess` match the precomputed key of a composition? A string comparison, so
 * it costs the Worker almost nothing: no rules engine and no position.
 */
export function isKeyGuess(keySan: string, guess: string): boolean {
	return keyCandidates(guess).some(
		(candidate) => sanCompareKey(candidate) === sanCompareKey(keySan),
	);
}
