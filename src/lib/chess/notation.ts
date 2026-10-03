/**
 * The tokeniser and parser for a composition's `solution` notation:
 *
 *     1. Nf6 (1. c3+ $2 Kc5 2. c4 $10) (1. Ng5 $2 Bg6 2. c3+) 1... Bg6 2. Nd7 ...
 *
 *     ( )    variations, nested; attached to the move before them
 *     $N     NAGs
 *     { }    prose comments; before a line's first move they belong to that position
 *     N.     move numbers, a token before the move they number; the corpus
 *            writes them apart (`1. Nf3`), and a glued `1.Nf3` still reads
 *            (a Black move with no number of its own is, as usual, omitted)
 */

export type Token =
	| { kind: "lparen" | "rparen"; value: string }
	| { kind: "cmt" | "nag" | "no" | "san"; value: string };

export interface RawLine {
	/** Comments at the position immediately before this line's first move. */
	comments: string[];
	moves: RawMove[];
}

export interface RawMove {
	san: string;
	/** "1." or "1..."; empty for a Black move in a variation. */
	no: string;
	nags: string[];
	comments: string[];
	variations: RawLine[];
}

export interface ParsedSolution {
	/** Comments before the first main-line move, attached to the initial position. */
	rootComments: string[];
	moves: RawMove[];
}

const SYMBOLIC_NAG: Record<string, string> = {
	"!": "1",
	"?": "2",
	"!!": "3",
	"??": "4",
	"!?": "5",
	"?!": "6",
};

function tokenise(text: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;
	while (i < text.length) {
		const ch = text[i]!;
		if (/\s/.test(ch)) {
			i += 1;
			continue;
		}
		if (ch === "(" || ch === ")") {
			tokens.push({ kind: ch === "(" ? "lparen" : "rparen", value: ch });
			i += 1;
			continue;
		}
		if (ch === "{") {
			const end = text.indexOf("}", i);
			if (end === -1) break;
			tokens.push({ kind: "cmt", value: text.slice(i + 1, end) });
			i = end + 1;
			continue;
		}
		if (ch === "$") {
			let end = i + 1;
			while (end < text.length && /\d/.test(text[end]!)) end += 1;
			tokens.push({ kind: "nag", value: text.slice(i + 1, end) });
			i = end;
			continue;
		}

		let end = i;
		while (
			end < text.length &&
			!/\s/.test(text[end]!) &&
			!"(){}".includes(text[end]!)
		) {
			end += 1;
		}
		const word = text.slice(i, end);
		i = end;

		// "1.Nf6" and "1...Bg6" arrive glued together
		const m = /^(\d+\.+)(.*)$/.exec(word);
		const san = m ? m[2]! : word;
		if (m) tokens.push({ kind: "no", value: m[1]! });
		const annotation = /([!?]+)$/.exec(san);
		const glyph = annotation ? SYMBOLIC_NAG[annotation[1]!] : undefined;
		if (annotation && glyph) {
			const move = san.slice(0, -annotation[1]!.length);
			if (move) tokens.push({ kind: "san", value: move });
			tokens.push({ kind: "nag", value: glyph });
		} else if (san) {
			tokens.push({ kind: "san", value: san });
		}
	}
	return tokens;
}

/** Parse one line, stopping at the ')' that closes it or at the end. */
function parseLine(tokens: Token[], start: number): [RawLine, number] {
	const line: RawLine = { comments: [], moves: [] };
	let pendingNo = "";
	let i = start;
	while (i < tokens.length) {
		const token = tokens[i]!;
		if (token.kind === "rparen") return [line, i + 1]; // consume the ')'
		if (token.kind === "lparen") {
			const [branch, next] = parseLine(tokens, i + 1);
			if (line.moves.length && branch.moves.length)
				line.moves[line.moves.length - 1]!.variations.push(branch);
			i = next;
			continue;
		}
		if (token.kind === "no") {
			pendingNo = token.value;
		} else if (token.kind === "nag") {
			if (line.moves.length) line.moves[line.moves.length - 1]!.nags.push(token.value);
		} else if (token.kind === "cmt") {
			if (line.moves.length)
				line.moves[line.moves.length - 1]!.comments.push(token.value);
			else line.comments.push(token.value);
		} else {
			line.moves.push({
				san: token.value,
				no: pendingNo,
				nags: [],
				comments: [],
				variations: [],
			});
			pendingNo = "";
		}
		i += 1;
	}
	return [line, i];
}

export function parseSolutionDocument(text: string): ParsedSolution {
	const [line] = parseLine(tokenise(text), 0);
	return { rootComments: line.comments, moves: line.moves };
}

export function parseSolution(text: string): RawMove[] {
	return parseSolutionDocument(text).moves;
}

/**
 * A SAN reduced to its equivalence key: check and mate marks dropped, castling
 * written with the letter O (either its zero or its letter spelling). Lets a
 * solution's moves, the rules engine's output and a typed key be compared.
 */
export function sanKey(san: string): string {
	return san.replace(/[+#]/g, "").replace(/[0o]/g, "O");
}

const GERMAN_PIECES: Record<string, string> = {
	D: "Q",
	T: "R",
	L: "B",
	S: "N",
};

/** SAN spellings to try when replaying a solution, including case-insensitive and German piece letters. */
export function sanCandidates(san: string): string[] {
	const candidates = new Set<string>([san]);
	const lower = san
		.toLowerCase()
		.replace(
			/=([qrbn])/gi,
			(_match, piece: string) => `=${piece.toUpperCase()}`,
		);
	candidates.add(lower);

	const castle = /^([o0]-[o0](?:-[o0])?)([+#]?)$/i.exec(san);
	if (castle)
		candidates.add(`${castle[1]!.replace(/[o0]/gi, "O")}${castle[2]}`);

	const piece = /^([kqrbndtls])(?=[a-hx1-8])/i.exec(san);
	if (piece) {
		const letter = piece[1]!.toUpperCase();
		const english = GERMAN_PIECES[letter] ?? letter;
		const rest = san
			.slice(1)
			.toLowerCase()
			.replace(
				/=([qrbn])/gi,
				(_match, promotion: string) => `=${promotion.toUpperCase()}`,
			);
		candidates.add(english + rest);
	}

	// Normalize promotion notation, including German promotion-piece letters.
	for (const candidate of [...candidates]) {
		const promotion = /^([a-h][18])=?([qrbndtls])([+#]?)$/i.exec(candidate);
		if (promotion) {
			const letter = promotion[2]!.toUpperCase();
			candidates.add(
				`${promotion[1]!.toLowerCase()}=${GERMAN_PIECES[letter] ?? letter}${promotion[3]}`,
			);
		}
	}
	return [...candidates];
}

/** Comparison key for guesses: ignore SAN letter case, check suffixes, and German piece initials. */
export function sanCompareKey(san: string): string {
	let key = san
		.trim()
		.replace(/[+#]/g, "")
		.replace(/[!?]+$/, "")
		.replace(/[0o]/gi, "O")
		.replace(/=/g, "")
		.toUpperCase();
	const first = key[0];
	if (first && GERMAN_PIECES[first]) key = GERMAN_PIECES[first] + key.slice(1);

	const promotion = /^([A-H][18])([QRBNDTLS])$/.exec(key);
	if (promotion) {
		const piece = promotion[2]!;
		key = promotion[1]! + (GERMAN_PIECES[piece] ?? piece);
	}
	return key;
}
