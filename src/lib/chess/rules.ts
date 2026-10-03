/**
 * The chess rules, through chessops, the engine lichess itself uses.
 *
 * Keymove's board is a port of lichess's analysis board, so the rules are too:
 * `chessops` reads and writes FEN and SAN, generates legal moves, and comes with
 * a `compat` module that speaks chessground's `Dests` format directly. This
 * module is the single seam between the two, so nothing else imports chessops or
 * needs to know its conventions.
 *
 * The one convention worth stating: chessops writes a castling move as the king
 * moving onto its rook (`e1h1`), while chessground and the stored move tree write
 * it as the king's two-square move (`e1g1`). `playSan`/`playBoardMove` normalise
 * to the latter on the way out.
 */

import type { Dests, Key } from "@lichess-org/chessground/types";
import { Chess, castlingSide, normalizeMove } from "chessops/chess";
import { chessgroundDests } from "chessops/compat";
import { makeFen, parseFen } from "chessops/fen";
import { makeSan, parseSan } from "chessops/san";
import { isDrop, type Move, type Piece, type Role } from "chessops/types";
import { kingCastlesTo, makeSquare, parseSquare } from "chessops/util";
import { sanCandidates } from "./notation";

/** Load a FEN into a position. Throws on an invalid FEN or an illegal setup. */
export function positionFromFen(fen: string): Chess {
	return Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
}

/** The FEN of a position, after any moves played on it. */
export function fenOf(pos: Chess): string {
	return makeFen(pos.toSetup());
}

/** True when `side` has just delivered checkmate: the other side to move, mated. */
export function isMatedBy(pos: Chess, side: "white" | "black"): boolean {
	return pos.turn !== side && pos.isCheckmate();
}

/** The legal destinations in chessground's shape, including the king-to-rook
    form of castling, so `movable.rookCastle` works. */
export function destsOf(pos: Chess): Dests {
	return chessgroundDests(pos) as Dests;
}

/** The piece standing on a square, if any. */
export function pieceAt(pos: Chess, key: Key): Piece | undefined {
	return pos.board.get(parseSquare(key)!);
}

/** A move as the board and the stored tree want it: canonical SAN, and both
    endpoints with castling written as the king's destination (`e1g1`). */
export interface PlayedMove {
	san: string;
	from: Key;
	to: Key;
}

/** A chessops move in keymove's coordinates, computed before it is played. */
function describe(pos: Chess, move: Move): PlayedMove {
	const from = isDrop(move) ? move.to : move.from;
	let to = move.to;
	if (!isDrop(move)) {
		const side = castlingSide(pos, move);
		if (side) to = kingCastlesTo(pos.turn, side);
	}
	return {
		san: makeSan(pos, move),
		from: makeSquare(from),
		to: makeSquare(to),
	};
}

/** Parse SAN, play it on `pos`, and describe it. `undefined` if it is not a
    legal move; `pos` is then left untouched. */
export function playSan(pos: Chess, san: string): PlayedMove | undefined {
	for (const candidate of sanCandidates(san)) {
		const move = parseSan(pos, candidate);
		if (!move) continue;
		const played = describe(pos, move);
		pos.play(move);
		return played;
	}
	return undefined;
}

/**
 * Build a move from a board drag, play it on `pos`, and describe it. The drag
 * gives the two squares and, for a promotion, the chosen piece. `normalizeMove` accepts
 * castling whether the king was dropped on its own square (`e1g1`) or on the
 * rook (`e1h1`). `undefined` if the move is not legal; `pos` is then untouched.
 */
export function playBoardMove(
	pos: Chess,
	from: Key,
	to: Key,
	promotion?: Role,
): PlayedMove | undefined {
	const move = normalizeMove(pos, {
		from: parseSquare(from)!,
		to: parseSquare(to)!,
		promotion,
	});
	if (!pos.isLegal(move)) return undefined;
	const played = describe(pos, move);
	pos.play(move);
	return played;
}

/** A move in the engine's own notation: `e2e4`, `e7e8q`. */
const UCI = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;
const PROMOTION: Record<string, Role> = {
	q: "queen",
	r: "rook",
	b: "bishop",
	n: "knight",
};

/**
 * Play a move given in UCI, the form Stockfish speaks, and describe it the way
 * the board wants it. `undefined` for a malformed token or an illegal move;
 * `pos` is then untouched. Separate from `playBoardMove` because a UCI token
 * carries its squares as text, and the board's `Key` type is there to catch a
 * mistyped square at compile time, which a string from an engine cannot give.
 * The squares are parsed, not cast, so a token can be checked without lying to
 * the type.
 */
export function playUciMove(pos: Chess, uci: string): PlayedMove | undefined {
	const match = UCI.exec(uci);
	if (!match) return undefined;
	const from = parseSquare(match[1]!);
	const to = parseSquare(match[2]!);
	if (!from || !to) return undefined;
	return playBoardMove(
		pos,
		makeSquare(from),
		makeSquare(to),
		match[3] ? PROMOTION[match[3]!] : undefined,
	);
}
