// Check the corpus files and the rules seam.
//
//   npm run check:corpus
//
// Two things, both of which have failed silently before:
//
//   1. **The corpus files are shaped as the importer requires**: one game per block,
//      the movetext on a single line, a FEN on every game, and no diagram appearing
//      in two games.
//   2. **The rules seam behaves.** The board does not go through SAN, so replaying
//      notation never exercises castling's two conventions, the dests, or a rejected
//      move; `checkBoardMoves` below drives the board directly.
//
// Replaying every solution is the importer's job: it walks each game's notation
// with chessops before writing anything, so a corpus that cannot be replayed never
// reaches an artefact. What is left to check here is the shape of the source files
// and the board paths replay cannot reach.
//
// `chessops` is the only rules engine, the one the site ships, so a divergence
// between two engines can no longer hide a real disagreement. A failure is fatal
// (exit 1).

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
	destsOf,
	fenOf,
	pieceAt,
	playBoardMove,
	positionFromFen,
} from "../src/lib/chess/rules";
import { identityFen } from "./composition-id";
import { readGameBlocks } from "./pgn";

const pgnDir = path.resolve("data/pgn");

interface Report {
	/** Games read, for the summary line. */
	games: number;
	/** Board moves driven, for the summary line. */
	moves: number;
	problems: string[];
}

function checkBoardMoves(report: Report): void {
	const castling = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
	for (const to of ["g1", "h1"] as const) {
		const pos = positionFromFen(castling);
		const played = playBoardMove(pos, "e1", to);
		report.moves++;
		if (
			played?.san !== "O-O" ||
			played.from !== "e1" ||
			played.to !== "g1"
		)
			report.problems.push(
				`board: king e1->${to} should castle, got ${JSON.stringify(played)}`,
			);
		else if (pieceAt(pos, "g1")?.role !== "king")
			report.problems.push(`board: king e1->${to} did not reach g1`);
	}

	const dests = destsOf(positionFromFen(castling)).get("e1") ?? [];
	report.moves++;
	if (!dests.includes("g1") || !dests.includes("h1"))
		report.problems.push(
			`board: castling dests e1 = ${JSON.stringify(dests)} (want g1 and h1)`,
		);

	const promo = positionFromFen("8/P6k/8/8/8/8/8/7K w - - 0 1");
	const promoted = playBoardMove(promo, "a7", "a8", "queen");
	report.moves++;
	if (promoted?.san !== "a8=Q")
		report.problems.push(
			`board: a7->a8 promotion should be a8=Q, got ${JSON.stringify(promoted)}`,
		);

	const before = "7k/8/8/8/8/8/4P3/4K3 w - - 0 1";
	const stuck = positionFromFen(before);
	report.moves++;
	if (playBoardMove(stuck, "e1", "e3") || fenOf(stuck) !== before)
		report.problems.push(
			"board: an illegal move must be rejected without touching the position",
		);
}
/**
 * Every game in the corpus, checked for the shape the importer reads it in.
 *
 * `readGameBlocks` throws on a block the corpus forbids: no FEN, movetext not on
 * one line, or a game with no moves. Anything that gets past it is already well
 * formed. What is left to check is the one property no single file can: that no two
 * games share a diagram, because each diagram is one composition.
 */
function checkCorpusFiles(report: Report): void {
	const diagrams = new Map<string, string>();
	for (const file of readdirSync(pgnDir)
		.filter((name) => name.endsWith(".pgn"))
		.sort()) {
		for (const game of readGameBlocks(
			readFileSync(path.join(pgnDir, file), "utf8").split(/\r?\n/),
			file,
		)) {
			const fen = game.tagMap.get("FEN");
			if (!fen) {
				report.problems.push(`${file}:${game.from + 1}: no [FEN]`);
				continue;
			}
			const diagram = identityFen(fen);
			const earlier = diagrams.get(diagram);
			if (earlier)
				report.problems.push(
					`${file}:${game.from + 1}: diagram ${diagram} is also in ${earlier}`,
				);
			diagrams.set(diagram, file);
			report.games += 1;
		}
	}
}

const report: Report = { games: 0, moves: 0, problems: [] };
checkBoardMoves(report);
checkCorpusFiles(report);

if (report.problems.length) {
	console.error(`✗ ${report.problems.length} problem(s) in ${report.games} games\n`);
	console.error(report.problems.slice(0, 20).join("\n"));
	process.exit(1);
}

console.log(
	`✓ ${report.games} games shaped as the importer requires, rules seam sound (${report.moves} board moves)`,
);
