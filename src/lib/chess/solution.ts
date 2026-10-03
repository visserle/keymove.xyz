import { parseSolutionDocument, type RawMove } from "./notation";
import { fenOf, playSan, positionFromFen } from "./rules";
import type { SolNode } from "../types";

/**
 * Turn a solution's notation into a tree of moves, each carrying the FEN of the
 * position it reaches. Branches are resolved against the position *before* the
 * move they replace, which is where a variation begins.
 */
export interface BuiltSolution {
	rootComments: string[];
	moves: SolNode[];
}

export function buildSolutionDocument(
	solution: string,
	startFen: string,
): BuiltSolution {
	const parsed = parseSolutionDocument(solution);
	return {
		rootComments: parsed.rootComments,
		moves: buildLine(parsed.moves, startFen),
	};
}

export function buildSolution(solution: string, startFen: string): SolNode[] {
	return buildSolutionDocument(solution, startFen).moves;
}

function buildLine(line: RawMove[], fenBefore: string): SolNode[] {
	const pos = positionFromFen(fenBefore);
	const out: SolNode[] = [];
	for (const raw of line) {
		const fenAtMove = fenOf(pos);

		const variations = raw.variations.map((branch) => ({
			comments: [...branch.comments],
			moves: buildLine(branch.moves, fenAtMove),
		}));

		let from = "";
		let to = "";
		let fenAfter = fenAtMove;
		// A move the notation cannot replay is shown but carries no destination
		// position: `from`/`to`/`fen` stay as the position before it, and the node
		// is kept so the record stays complete.
		const played = playSan(pos, raw.san);
		if (played) {
			from = played.from;
			to = played.to;
			fenAfter = fenOf(pos);
		}

		out.push({
			san: raw.san,
			no: raw.no,
			nags: raw.nags,
			comments: raw.comments,
			from,
			to,
			fen: fenAfter,
			variations,
		});
	}
	return out;
}
