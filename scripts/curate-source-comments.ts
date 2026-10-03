// Lift the source detail out of a leading comment and into the tag that holds it.
//
// Some games still open with a comment the tags already carry: a leading
// `{Shakhmaty v SSSR/11 EG#04531.}` sits in front of the moves of a game whose
// `[Source]` says the same thing. That is a curation step half done: the
// information was copied into a tag and left behind in the movetext, and it is
// visible in the catalogue, where `solution` is the movetext verbatim.
//
// What this moves, and where:
//
//   • a comment the game's tags already carry: dropped from the movetext, and
//     `[Source]` is rewritten to the fuller of the two texts, so nothing the
//     source wrote is lost
//   • a comment that names a publication, an issue, an EG number or a version
//     (`20.p Sweden champ 1960-1962.`, `= Walker=G g5e8.`) with no tag to hold
//     it, written to `[Source]`
//   • a theme description, mapped onto the corpus's curated `[Theme]`
//     vocabulary, the mapping written out in THEMES below rather than guessed
//   • a composition date (`composed 1926.`), written to `[Date]` when the game
//     has none, and dropped when it has one: `[Date]` is the publication, and a
//     game that already says when it appeared is not improved by a second date
//   • a bare marker (`#`, `Diagram #`) and a `[%cal …]` arrow set: dropped
//
// What it leaves alone: the judges' prose that some games open with. That is
// commentary, not provenance, it is not a judgement any tag states, and moving
// it into a tag would put a claim in the table that no tag in the corpus says.
//
// Dry run by default. Pass --apply to write the corpus files, then rebuild the
// artefacts with `npm run corpus`.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseSolutionDocument } from "../src/lib/chess/notation";
import { readGameBlocks } from "./pgn";

const APPLY = process.argv.includes("--apply");
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== "--apply");
if (unknownArgs.length)
	throw new Error(`Unknown argument(s): ${unknownArgs.join(", ")}`);

const pgnDir = path.resolve("data/pgn");

/**
 * Games whose leading comment is a theme description rather than a source
 * reference, and the curated `[Theme]` each one is. The mapping is a judgement,
 * so it is written out rather than pattern-matched: the corpus's theme
 * vocabulary is seven values, and a game's own words are not one of them.
 */
const THEMES: Record<string, string> = {
	"Antonini, David.pgn:17": "Stalemate",
	"Gurgenidze, David.pgn:913": "Other ideas and conjunction of ideas",
	"Mikitovics, Janos.pgn:328": "Other ideas and conjunction of ideas",
	"Sochniev, Aleksej.pgn:539": "Pawn promotion",
};

/**
 * Games whose leading comment is prose that is not to be touched, named so that
 * a new pattern cannot quietly start claiming them.
 */
const KEEP = new Set<string>([
	// A judge or a magazine describing the study: not provenance, not a theme.
	"Afek, Yochanan.pgn:322",
	"Akobia, Iuri.pgn:32",
	"Akobia, Iuri.pgn:248",
	"Akobia, Iuri.pgn:671",
	"Bazlov, Yuri Vasilyevich.pgn:548",
	"Didukh, Serhiy Ihorovych.pgn:706",
	"Didukh, Serhiy Ihorovych.pgn:751",
	"Gurgenidze, David.pgn:33",
	"Herbstman, Alexander Osipowitsj.pgn:458", // a correction to the diagram
	"Hlinka, Michal.pgn:574",
	"Keith, Daniel.pgn:1",
	"Letzelter, Jean-Claude.pgn:1", // a correction to the diagram
	"Mikitovics, Janos.pgn:221", // a dedication
	"Minski, Martin.pgn:750",
	"Pallier, Alain.pgn:224", // the tourney's condition
	"Pallier, Alain.pgn:763",
	"Pallier, Alain.pgn:884",
	"Pervakov, Oleg Viktorovič.pgn:185",
	"Pervakov, Oleg Viktorovič.pgn:615",
	"Timman, Jan Hendrik.pgn:124",
	"Timman, Jan Hendrik.pgn:290",
	"Timman, Jan Hendrik.pgn:365", // "Gewinn": the result, restated
	"Vysokosov, Andrey.pgn:16",
	"Vysokosov, Andrey.pgn:107",
	"Vysokosov, Andrey.pgn:137",
	"Vysokosov, Andrey.pgn:198",
	"Yarosh, Leonid Vladimirovich.pgn:46",
	"van der Heijden, Harold.pgn:706",
]);

/**
 * Games where the comment and the existing `[Source]` each carry something the
 * other lacks, so neither text wins on its own. The value is the merged source.
 */
const SOURCES: Record<string, string> = {
	"Dolgov, Vasily Nikitich.pgn:683":
		"Ceskoslovensky Sach/9 (v): Rusz=A Tkachenko=SN 25-6-1938",
	"Kazantsev, Alexander Petrovich.pgn:319":
		"Shakhmaty v SSSR/2 4.p USSR overall champ II 1947-1948 (c): Rothwell=S EBUR=3 9/2006",
	"Kopnin, Alexey Grigoryevich.pgn:109":
		"EG#14960; Shakhmaty v SSSR/12 EG#04970 = Kopnin=A g3a7 1966",
	"Platov, Vasily Nikolaevic & Platov, Mikhael Nikolaevich.pgn:523":
		"(m): Platov=V Platov=M Düna Zeitung#181 Düna Zeitung=173 31-7-1909",
	"Wotawa, Alois.pgn:502": "Deutsche Schachzeitung/5 (c): Marwitz=J 12/1998",
};

/**
 * Games whose `[Theme]` holds a publication reference. `Thèmes 64/7-9` is the
 * magazine and its issues, not a theme, so the tag moves to `[Source]`.
 */
const THEME_IS_SOURCE = new Set<string>([
	"Gorgiev, Tigran Borisovich.pgn:757",
	"Krikheli, Iosif Mikhailovich.pgn:203",
]);

/** A publication, an issue, an EG number, a placing or a version note. */
const PUBLICATIONS =
	"La Strat|Shakhmaty|Shakhmatn|Shachend|Schack|Chach(?:zeitung|bulletinen|varden|werk)"
	+ "|Tidskrift|Magyar|Sakk(?:vilag|elet|let)|Sachov|Ceskoslovensky"
	+ "|Themes 64|Problemist|Chess Amateur|Revista|Ajedrez|Springaren|Problemas"
	+ "|Probleemblad|Bulletin|Buletin|Schaakmagazine|Schaakwerk|Isvestia"
	+ "|Journal de Geneve|Duna Zeitung|Pionneneindspelen|Man en Paard|Quartz|Suomen|0-0/";

const SOURCE_SHAPES: RegExp[] = [
	/EG\s*#\s*\d/i, // an Endgame Study number
	/^EG[\s/]/i,
	/^\(?[a-z]{1,2}\)?\s*:/i, // "(c): Kralin=N …": a version or correction
	/^=\s/, // "= Walker=G g5e8.": a corrected solution
	/^[A-Z][A-Za-z_]+=[A-Z]\b/, // "Ryabinin=N Tarasiuk=V Tkachenko=SN"
	/\bchamp\b.*\d{4}|\d{4}.*\bchamp\b/i, // "20.p Sweden champ 1960-1962."
	/^\d+[./]\s*(?:\d+\/?)*\s*(?:p|c|hm|sp|ea|comm|prize|prix|preis)?\b/i,
	/^(?:also|composed)\b/i,
	new RegExp(PUBLICATIONS, "i"),
];

/** Lower case and unaccented, with everything else left: what patterns match against. */
function plain(value: string): string {
	return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Normalised for comparison: accents, case and punctuation cannot change identity. */
function folded(value: string): string {
	return plain(value).replace(/[^a-z0-9]+/g, "");
}

type Action =
	| { kind: "source"; value: string }
	| { kind: "theme"; value: string }
	| { kind: "date"; value: string | null }
	| { kind: "drop" }
	| { kind: "keep" };

/** `composed 1926.` and `composed 19-3-1939.` as a `[Date]` value, or null. */
function composedDate(comment: string): string | null {
	const dated = /^composed\s+(\d{1,2})-(\d{1,2})-(\d{4})$/i.exec(comment);
	if (dated)
		return `${dated[3]}.${dated[2]!.padStart(2, "0")}.${dated[1]!.padStart(2, "0")}`;
	const year = /^composed\s+(\d{4})$/i.exec(comment);
	return year ? `${year[1]}.??.??` : null;
}

/**
 * A source comment as a tag value: the sentence's full stop and the stray spacing
 * a comment was written with are dropped, and a full stop the corpus ran into the
 * next word ("EG#06847.35/45.p") is put back as the sentence break it was.
 */
function asSource(comment: string): string {
	return comment
		.trim()
		.replace(/\s{2,}/g, " ")
		.replace(/(?<=[^\d])\.(?=\d)/g, ". ")
		.replace(/[\s.]+$/, "");
}

/**
 * What a game's leading comment should become, from its own text, the tags it
 * already has, and the tables above.
 */
function decide(
	where: string,
	comment: string,
	tags: Map<string, string>,
	isFirst: boolean,
): Action {
	if (isFirst && KEEP.has(where)) return { kind: "keep" };
	if (THEMES[where]) return { kind: "theme", value: THEMES[where]! };

	const text = comment.trim();
	// A bare marker, or an arrow set the notation carries for a renderer.
	if (/^(?:#+\s*|diagram\s*#+\s*)$/i.test(text)) return { kind: "drop" };
	if (text.includes("[%cal")) return { kind: "drop" };

	const date = composedDate(text.replace(/\.$/, ""));
	if (date) {
		// `[Date]` is the publication. A game that states one is not improved by
		// a second date, so the composition date only fills an empty tag.
		const published = tags.get("Date")?.trim();
		const empty = !published || /^\?*\.(\?*\.)?\?*$/.test(published);
		return { kind: "date", value: empty ? date : null };
	}

	const source = tags.get("Source")?.trim();
	if (SOURCES[where]) return { kind: "source", value: SOURCES[where]! };
	if (!SOURCE_SHAPES.some((shape) => shape.test(text) || shape.test(plain(text))))
		return { kind: "keep" };
	if (THEME_IS_SOURCE.has(where)) {
		// The tag is wrong, not the comment: move the whole thing to [Source].
		return { kind: "source", value: source ?? asSource(text) };
	}
	if (!source) return { kind: "source", value: asSource(text) };
	// The comment that holds the tag's own words is the fuller of the two.
	const [tag, said] = [folded(source), folded(text)];
	if (said.length >= tag.length && said.includes(tag))
		return { kind: "source", value: asSource(text) };
	return { kind: "source", value: source };
}

const files = readdirSync(pgnDir, { withFileTypes: true })
	.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".pgn"))
	.map((entry) => entry.name)
	.sort();

interface Edit {
	file: string;
	/** 1-based line of the game's `[Event` tag, as the corpus is read. */
	line: number;
	/** 0-based index of the first tag line. */
	from: number;
	tags: string[];
	tagMap: Map<string, string>;
	/** 0-based index of the movetext line. */
	bodyLine: number;
	/** Every comment the game opens with, in order, and what each becomes. */
	comments: { comment: string; action: Action }[];
}

const edits: Edit[] = [];
for (const file of files) {
	const lines = readFileSync(path.join(pgnDir, file), "utf8").split(/\r?\n/);
	for (const game of readGameBlocks(lines, file)) {
		const comments = parseSolutionDocument(game.notation).rootComments;
		if (!comments.length) continue;
		const where = `${file}:${game.from + 1}`;
		edits.push({
			file,
			line: game.from + 1,
			from: game.from,
			tags: game.tags,
			tagMap: game.tagMap,
			bodyLine: game.from + game.tags.length + 1,
			// A game may open with a judges' note and then an EG number; the note
			// is commentary and the number is a source, so each comment is judged.
			comments: comments.map((comment, at) => ({
				comment,
				action: decide(where, comment, game.tagMap, at === 0),
			})),
		});
	}
}

/** The line that carries a tag, or -1. */
function tagIndex(tags: string[], name: string): number {
	return tags.findIndex((line) => parseTagName(line) === name);
}

function parseTagName(line: string): string | null {
	return /^\[([^\s]+)\s+"/.exec(line)?.[1] ?? null;
}

/** A tag line, with a value escaped as the PGN standard requires. */
function tagLine(name: string, value: string): string {
	return `[${name} "${value.replace(/([\\"])/g, "\\$1")}"]`;
}

/** Where a tag goes when the game does not have it, so the file keeps its shape. */
function insertAt(tags: string[], name: string): number {
	if (name === "Source") return after(tags, "Event");
	// [Date] belongs with the publication, not with the byline or the diagram.
	if (name === "Date")
		return ["Event", "Source", "Site"].reduce(
			(at, neighbour) => Math.max(at, after(tags, neighbour)),
			0,
		);
	return after(tags, "Stipulation");
}

/** Just after a tag, or at the top of the game when it does not have it. */
function after(tags: string[], name: string): number {
	const at = tagIndex(tags, name);
	return at === -1 ? 0 : at + 1;
}

function applyEdit(lines: string[], edit: Edit, shift: number): void {
	const { tags } = edit;
	// Nothing to lift and nothing to drop: the file is written back byte for byte.
	if (edit.comments.every(({ action }) => action.kind === "keep")) return;
	// The tags as the corpus wrote them, which is how many lines this game has.
	const tagLines = tags.length;

	for (const { action } of edit.comments) {
		if (action.kind === "source" || action.kind === "theme") {
			const name = action.kind === "source" ? "Source" : "Theme";
			if (THEME_IS_SOURCE.has(`${edit.file}:${edit.line}`)) {
				const theme = tagIndex(tags, "Theme");
				if (theme !== -1) tags.splice(theme, 1);
			}
			const at = tagIndex(tags, name);
			if (at === -1)
				tags.splice(insertAt(tags, name), 0, tagLine(name, action.value));
			else tags[at] = tagLine(name, action.value);
		} else if (action.kind === "date" && action.value) {
			const at = tagIndex(tags, "Date");
			if (at === -1)
				tags.splice(insertAt(tags, "Date"), 0, tagLine("Date", action.value));
			else tags[at] = tagLine("Date", action.value);
		}
	}

	// The comments themselves, and nothing else, leave the movetext; the ones
	// kept stay in the order and the spelling the source wrote them in.
	const body = lines[edit.bodyLine + shift]!;
	const leading = /\s*\{[^}]*\}/g;
	const kept: string[] = [];
	let end = 0;
	for (const { action } of edit.comments) {
		const match = leading.exec(body);
		if (!match || match.index !== end)
			throw new Error(
				`${edit.file}:${edit.line}: the leading comment is not where it was read`,
			);
		end = leading.lastIndex;
		if (action.kind === "keep") kept.push(match[0].trim());
	}
	const rest = body.slice(end).trimStart();
	if (!rest.startsWith("1."))
		throw new Error(
			`${edit.file}:${edit.line}: movetext no longer starts with a move: ${rest.slice(0, 40)}`,
		);
	const next = kept.length ? `${kept.join(" ")} ${rest}` : rest;
	lines[edit.bodyLine + shift] = next;
	lines.splice(edit.from + shift, tagLines, ...tags);
}

const tally: Record<Action["kind"], number> = {
	source: 0,
	theme: 0,
	date: 0,
	drop: 0,
	keep: 0,
};
for (const edit of edits) {
	for (const { comment, action } of edit.comments) {
		tally[action.kind]++;
		const says =
			action.kind === "source" || action.kind === "theme"
				? `[${action.kind === "source" ? "Source" : "Theme"} ${JSON.stringify(action.value)}]`
				: action.kind === "date"
					? action.value
						? `[Date ${JSON.stringify(action.value)}]`
						: "[Date kept]"
					: action.kind;
		console.log(
			`${edit.file}:${edit.line}  ${action.kind.toUpperCase().padEnd(6)}  ${says}\n` +
				`    comment: ${JSON.stringify(comment)}\n` +
				`    source:  ${JSON.stringify(edit.tagMap.get("Source") ?? null)}`,
		);
	}
}

const comments = edits.flatMap((edit) => edit.comments);
const touched = edits.filter((edit) =>
	edit.comments.some(({ action }) => action.kind !== "keep"),
);
console.log(
	`\nLeading comments: ${comments.length} on ${edits.length} game(s) — ` +
		Object.entries(tally)
			.map(([kind, n]) => `${n} ${kind}`)
			.join(", "),
);
console.log(APPLY ? "Applying" : "Dry run only; pass --apply to write");

if (APPLY) {
	for (const file of files) {
		const filePath = path.join(pgnDir, file);
		const before = readFileSync(filePath, "utf8");
		const lines = before.split(/\r?\n/);
		// A game that gains or loses a tag line moves every game after it, so the
		// edits are applied in order and each one is offset by the lines so far.
		let shift = 0;
		for (const edit of edits.filter((candidate) => candidate.file === file)) {
			const before = lines.length;
			applyEdit(lines, edit, shift);
			shift += lines.length - before;
		}
		const after = lines.join("\n");
		if (after !== before) writeFileSync(filePath, after);
	}
	console.log(`Rewrote ${new Set(touched.map((edit) => edit.file)).size} file(s).`);
}
