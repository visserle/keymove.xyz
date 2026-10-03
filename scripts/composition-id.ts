// The content id of a composition: a short string derived from the diagram, so
// it stays stable when the stipulation or the solution notation is edited and
// reproducible when the corpus is re-imported.
//
// Node-only (node:crypto). `scripts/import-pgn.ts` derives the ids once and
// materialises them into `build/catalogue.json`, so neither the site nor the
// Worker computes one.

import { createHash } from "node:crypto";

/**
 * The alphabet an id is written in: the 62 characters of base 62, digits before
 * letters, and nothing else. Letters and digits are the whole alphabet because
 * an id is read, typed, copied and pasted by people as often as it is handled by
 * code, so no id can differ from another by a glyph that is only
 * another in a URL's percent-encoding.
 *
 * The order is ASCII order, so comparing two ids as strings compares them
 * numerically. The catalogue sorts by id to give collections a stable order, and
 * that order has to be the same everywhere it is rebuilt, so the alphabet is
 * part of the id's definition rather than a cosmetic choice.
 */
const ID_ALPHABET =
	"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * Every id is this many characters. The width is fixed, never the number of
 * digits the value happens to need: that is what makes all 62 characters equally
 * likely at every position, the leading one included, and what makes the first
 * character of an id as safe to bucket by as any other.
 */
const ID_LENGTH = 7;

const RADIX = 62n;
const ID_SPACE = RADIX ** BigInt(ID_LENGTH);

/** A word of the digest, the unit the value is reduced from. */
const WORD_BITS = 64n;
const WORD_SPACE = 1n << WORD_BITS;

/**
 * The part of a FEN that names the diagram: piece placement, side to move and
 * castling rights. The en-passant field is dropped (sources fill it
 * inconsistently, and no diagram here uses it) and the halfmove/fullmove clocks
 * are dropped (they are not part of the position). Castling is sorted into
 * FEN's canonical KQkq order so `Qk` and `kQ` hash alike.
 */
export function identityFen(fen: string): string {
	const [placement = "", side = "w", castling = "-"] = fen.trim().split(/\s+/);
	const rights = castling === "-" ? "-" : [...castling].sort().join("");
	return `${placement} ${side} ${rights}`;
}

/**
 * The stable id of a diagram: seven base-62 characters of SHA-256 over its
 * identity FEN.
 *
 * `62^7` = 3.5e12 diagrams, against a corpus of 12,715, which is about 277,000 times the
 * collection, and the chance of a collision stays under 1% until roughly 265,000
 * compositions. The import aborts naming the id if one ever happens, so a
 * collision is a loud build failure rather than two diagrams quietly sharing a
 * URL. The id space is not a whole number of bytes, and there is no reason it
 * should be: 7 characters of base 62 is 41.7 bits, and the digest it is cut from
 * is 256, so nothing has to be masked off to reach it.
 */
export function compositionId(fen: string): string {
	return contentId(identityFen(fen));
}

/**
 * A fixed-width base-62 id for any material. The two are the same function:
 * composition ids hash a diagram, and anything else that needs a stable opaque
 * id hashes whatever names it, so there is one id shape in the project rather
 * than one per caller.
 */
export function contentId(material: string): string {
	return render(uniformBelow(ID_SPACE, material));
}

/**
 * A value in `[0, space)`, uniform, by rejecting the words of the digest that
 * fall in the remainder above the largest multiple of `space` below 2^64.
 *
 * Rejection is what makes this uniform. 2^64 is not a multiple of 62^7: dividing
 * leaves a quotient of 5,238,149 and a remainder of 2,045,815,722,624. Taking the
 * word modulo 62^7 would therefore hand the first 2,045,815,722,624 outcomes one
 * preimage more than every other, making them one in 5,238,150 likelier.
 * a bias far too small for any id to show and too structural for a test on an
 * id's shape to ever catch. Rejecting costs a re-hash for about one diagram in
 * nine million, and 5,238,149 whole multiples of 62^7 fit in a word, so the loop
 * almost always settles on the first one.
 *
 * Rejection cannot exhaust the digest: it is 4 words and the chance all four land
 * in the remainder is 1.5e-28. The digest is rehashed anyway rather than left
 * with a branch that cannot be exercised, because a function that can be
 * exhausted is a function whose failure mode is untested.
 */
function uniformBelow(space: bigint, material: string): bigint {
	const limit = (WORD_SPACE / space) * space;
	let digest = createHash("sha256").update(material).digest();
	for (;;) {
		for (let offset = 0; offset + 8 <= digest.length; offset += 8) {
			const word = digest.readBigUInt64BE(offset);
			if (word < limit) return word % space;
		}
		digest = createHash("sha256").update(digest).digest();
	}
}

/** The value as exactly `ID_LENGTH` characters, most significant first. */
function render(value: bigint): string {
	let id = "";
	for (let i = 0; i < ID_LENGTH; i++) {
		id = ID_ALPHABET.charAt(Number(value % RADIX)) + id;
		value /= RADIX;
	}
	// Unreachable while `value < ID_SPACE`, which is the reduction's contract. A
	// guard rather than a comment, because a silently dropped leading digit is an
	// id that is stable, unique and one character too short, and every one of
	// those properties still holds.
	if (value > 0n) throw new Error("Content id does not fit in ID_LENGTH");
	return id;
}
