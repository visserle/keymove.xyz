// The PGN tag line, parsed once for every script that reads the corpus.
//
// Three commands walk data/pgn/, the import, the check and the mate search, and
// each of them needs to know where a game's tags stop and its movetext begins.
// Writing that rule three times is how `confirm-mates.ts` ended up with a regex
// that rejected a tag containing an escaped quote, and how a whole game then
// looked like it had no FEN. There is one definition, here, and it accepts what
// the PGN standard allows: a backslash-escaped quote inside a value.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** A `[Tag "value"]` line, capturing the tag name and its unescaped value. */
const TAG_LINE = /^\[([^\s]+)\s+"((?:\\.|[^"])*)"\]$/;

export interface Tag {
	name: string;
	value: string;
}

/**
 * A FEN as a PGN file states it, made usable. A source file has one fullmove
 * counter of 0; the counter is not part of composition identity, and FEN wants it
 * positive, so it is set to 1. Shared because the importer stores this form and
 * the check compares against it.
 */
export function normalizeFen(fen: string): string {
	const fields = fen.trim().split(/\s+/);
	if (fields.length !== 6) throw new Error(`Expected six FEN fields: ${fen}`);
	if (!/^\d+$/.test(fields[5]!) || Number(fields[5]) < 1) fields[5] = "1";
	return fields.join(" ");
}

/** The tag a line carries, or null if it is not a tag line. */
export function parseTag(line: string): Tag | null {
	const match = TAG_LINE.exec(line.trim());
	if (!match) return null;
	return { name: match[1]!, value: match[2]!.replace(/\\([\\"])/g, "$1") };
}

function isTagLine(line: string): boolean {
	return TAG_LINE.test(line.trim());
}

/**
 * A game's moves, without the result marker a PGN may repeat at the end of the
 * movetext. That marker is a game result, not a move, so nothing may try to play
 * it; the importer stores this form and the check compares against it.
 */
function notationOf(movetext: string): string {
	return movetext.replace(/\s+(?:1-0|0-1|1\/2-1\/2|\*)\s*$/, "").trim();
}

/**
 * A game in a PGN file: its tags in file order, and its notation. The corpus
 * keeps a game's movetext on one line, so that is what this is: a game whose
 * notation runs over several lines is refused, not silently joined, because that
 * is the one shape the import has to be able to rely on.
 */
export interface PgnGameBlock {
	/** 0-based line where the `[Event` tag sits, and where its tags start. */
	from: number;
	/** Tag lines, verbatim, in order. */
	tags: string[];
	tagMap: Map<string, string>;
	/** The movetext, as the single line the corpus keeps it on. */
	notation: string;
	/**
	 * The same movetext with nothing removed, so that a game can be written back
	 * out byte for byte. `notation` drops a trailing result marker, which a
	 * rewrite of the file must not do: the marker is what says the study was
	 * decided, and the corpus files keep it.
	 */
	body: string;
}

/** Every game in a PGN file, in order. Throws on a block the corpus forbids. */
export function readGameBlocks(lines: string[], file: string): PgnGameBlock[] {
	const games: PgnGameBlock[] = [];
	let i = 0;
	while (i < lines.length) {
		if (!lines[i]!.startsWith("[Event ")) {
			i++;
			continue;
		}
		const from = i;
		const tags: string[] = [];
		const tagMap = new Map<string, string>();
		while (i < lines.length && isTagLine(lines[i]!)) {
			tags.push(lines[i]!);
			const tag = parseTag(lines[i]!)!;
			tagMap.set(tag.name, tag.value);
			i++;
		}
		if (
			lines[i] !== undefined &&
			lines[i]!.trim() !== "" &&
			!isTagLine(lines[i]!)
		)
			throw new Error(
				`${file}:${i + 1}: expected a tag line or a blank line, got: ${lines[i]}`,
			);
		if (lines[i] === undefined)
			throw new Error(`${file}:${from + 1}: game has no movetext`);
		if (lines[i]!.trim() === "") i++;
		const body: string[] = [];
		while (i < lines.length && lines[i]!.trim() !== "")
			body.push(lines[i++]!.trim());
		if (body.length !== 1)
			throw new Error(
				`${file}:${from + 1}: movetext is ${body.length} lines, want 1 (a game is one line)`,
			);
		if (lines[i]?.trim() === "") i++;
		if (!tagMap.has("FEN"))
			throw new Error(`${file}:${from + 1}: game has no [FEN]`);
		games.push({ from, tags, tagMap, notation: notationOf(body.join(" ")), body: body.join(" ") });
	}
	return games;
}

/**
 * data/pgn/index.txt: every corpus file, one name per line.
 *
 * It is a listing of the directory, not a thing of its own. Renaming or merging
 * a file changes it, which is why it is written from the directory rather than
 * edited: a composer whose file is renamed is otherwise still listed under the
 * old name, and nothing notices until someone reads the index.
 */
function corpusIndex(pgnDir: string): string {
	return `${readdirSync(pgnDir)
		.filter((name) => name.toLowerCase().endsWith(".pgn"))
		.sort()
		.join("\n")}\n`;
}

/** Rewrite the index, and say what moved. */
export function syncCorpusIndex(
	pgnDir: string,
): { changed: boolean; added: string[]; removed: string[] } {
	const indexPath = path.join(pgnDir, "index.txt");
	const listing = corpusIndex(pgnDir);
	const before = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : "";
	if (before === listing) return { changed: false, added: [], removed: [] };
	const had = new Set(before.split("\n").filter(Boolean));
	const now = new Set(listing.split("\n").filter(Boolean));
	writeFileSync(indexPath, listing);
	return {
		changed: true,
		added: [...now].filter((name) => !had.has(name)),
		removed: [...had].filter((name) => !now.has(name)),
	};
}
