// Search current White-win compositions with Stockfish and record only forced
// mates whose distance agrees with the stored principal line.
//
// Run with `npm run db:mates`. Each position gets a fixed UCI movetime (5s by
// default); a missing mate score is not evidence that no forced mate exists.
// Pass --apply to write the verified distance into the corpus as a
// `[Stipulation "#n"]` tag on the game, which is where every other judgement
// lives. Results are checkpointed outside the repository so a long run can
// resume if interrupted.

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { parseSolution } from "../src/lib/chess/notation";
import {
	isMatedBy,
	playSan,
	playUciMove,
	positionFromFen,
} from "../src/lib/chess/rules";
import { compositionId, identityFen } from "./composition-id";
import { normalizeFen, parseTag, readGameBlocks } from "./pgn";

const APPLY = process.argv.includes("--apply");
const MAX_ARG = process.argv.find((arg) => arg.startsWith("--max="));
const MAX_ROWS = MAX_ARG ? Number(MAX_ARG.slice("--max=".length)) : null;
const unknownArgs = process.argv
	.slice(2)
	.filter((arg) => arg !== "--apply" && !arg.startsWith("--max="));
if (unknownArgs.length)
	throw new Error(`Unknown argument(s): ${unknownArgs.join(", ")}`);
if (MAX_ROWS !== null && (!Number.isInteger(MAX_ROWS) || MAX_ROWS < 1))
	throw new Error("--max must be a positive integer");

const stockfish = process.env.STOCKFISH_PATH ?? "stockfish";
const budgetMs = Number(process.env.MATE_SEARCH_MS ?? 5000);
const workerCount = Math.max(
	1,
	Math.min(
		Number(process.env.MATE_SEARCH_WORKERS ?? availableParallelism()),
		8,
	),
);
const reportPath =
	process.env.MATE_SEARCH_REPORT ?? "/tmp/keymove-stockfish-mates.json";

interface Candidate {
	id: string;
	fen: string;
	solution: string;
}

interface SearchResult {
	status:
		| "no-mate-score"
		| "black-mates"
		| "white-mate-confirmed"
		| "mate-score-unverified";
	mate: number | null;
	mainlineMate: number | null;
	pv: string[];
	depth: number | null;
}

interface SearchReport {
	budgetMs: number;
	candidateIds: string[];
	results: Record<string, SearchResult>;
}

interface EngineInfo {
	kind: "cp" | "mate";
	score: number;
	bound: boolean;
	pv: string[];
	depth: number | null;
}

class UciEngine {
	private readonly child: ChildProcessWithoutNullStreams;
	private readonly lines: string[] = [];
	private waiting: ((line: string) => void) | null = null;
	private closedError: Error | null = null;

	constructor(command: string) {
		this.child = spawn(command, [], { stdio: ["pipe", "pipe", "pipe"] });
		const output = createInterface({ input: this.child.stdout });
		output.on("line", (line) => {
			if (this.waiting) {
				const resolve = this.waiting;
				this.waiting = null;
				resolve(line);
			} else {
				this.lines.push(line);
			}
		});
		this.child.stderr.on("data", () => {});
		this.child.on("error", (error) => {
			this.closedError = error;
			this.waiting?.("");
		});
		this.child.on("close", (code) => {
			if (code !== 0)
				this.closedError = new Error(`Stockfish exited (${code})`);
			this.waiting?.("");
		});
	}

	private send(command: string): void {
		if (!this.child.stdin.write(`${command}\n`))
			throw new Error("Could not write to Stockfish stdin");
	}

	private async nextLine(): Promise<string> {
		if (this.lines.length) return this.lines.shift()!;
		if (this.closedError) throw this.closedError;
		return new Promise((resolve, reject) => {
			this.waiting = (line) => {
				if (this.closedError) reject(this.closedError);
				else resolve(line);
			};
		});
	}

	private async waitFor(expected: string): Promise<void> {
		while (true) {
			const line = await this.nextLine();
			if (line === expected) return;
		}
	}

	async init(): Promise<void> {
		this.send("uci");
		await this.waitFor("uciok");
		this.send("setoption name Threads value 1");
		this.send("setoption name Hash value 16");
		this.send("isready");
		await this.waitFor("readyok");
	}

	async search(fen: string): Promise<EngineInfo | null> {
		this.send("ucinewgame");
		this.send(`position fen ${fen}`);
		this.send(`go movetime ${budgetMs}`);
		let latest: EngineInfo | null = null;
		while (true) {
			const line = await this.nextLine();
			if (line.startsWith("bestmove ")) return latest;
			if (!line.startsWith("info ")) continue;
			const score = /\bscore (cp|mate) (-?\d+)\b/.exec(line);
			if (!score) continue;
			const pvIndex = line.indexOf(" pv ");
			latest = {
				kind: score[1] as "cp" | "mate",
				score: Number(score[2]),
				bound: /\b(?:lowerbound|upperbound)\b/.test(line),
				pv:
					pvIndex < 0
						? []
						: line
								.slice(pvIndex + 4)
								.trim()
								.split(/\s+/),
				depth: Number(/\bdepth (\d+)\b/.exec(line)?.[1] ?? NaN) || null,
			};
		}
	}

	close(): void {
		this.send("quit");
		this.child.kill();
	}
}

/** The mate in `n` a Stockfish PV delivers for White, or null if it does not. */
function validateWhiteMatePv(fen: string, uciPv: string[]): number | null {
	const pos = positionFromFen(fen);
	let plies = 0;
	for (const token of uciPv) {
		if (!playUciMove(pos, token)) return null;
		plies++;
		if (isMatedBy(pos, "white"))
			return plies % 2 === 1 ? (plies + 1) / 2 : null;
	}
	return null;
}

/** The mate in `n` the stored main line reaches for White, or null. */
function mainlineMateDistance(fen: string, solution: string): number | null {
	const pos = positionFromFen(fen);
	let plies = 0;
	for (const raw of parseSolution(solution)) {
		if (!playSan(pos, raw.san)) return null;
		plies++;
		if (isMatedBy(pos, "white"))
			return plies % 2 === 1 ? (plies + 1) / 2 : null;
	}
	return null;
}

function readReport(): SearchReport | null {
	try {
		return JSON.parse(readFileSync(reportPath, "utf8")) as SearchReport;
	} catch {
		return null;
	}
}

function saveReport(report: SearchReport): void {
	const temp = `${reportPath}.tmp`;
	writeFileSync(temp, JSON.stringify(report));
	renameSync(temp, reportPath);
}

/**
 * The candidates: games the corpus says are a `win` with no mate distance, White to
 * move, read straight from `data/pgn/`.
 */
function readCandidates(): Candidate[] {
	const out: Candidate[] = [];
	for (const file of readdirSync(pgnDir)
		.filter((name) => name.endsWith(".pgn"))
		.sort()) {
		for (const game of readGameBlocks(
			readFileSync(path.join(pgnDir, file), "utf8").split(/\r?\n/),
			file,
		)) {
			const stipulation = game.tagMap.get("Stipulation")?.trim() ?? "";
			// A distance is already stated, whatever its kind: `#7`, `h#7`, `s#7.5`.
			// Only a bare `win` or `draw` is still undecided.
			if (stipulation !== "win") continue;
			const rawFen = game.tagMap.get("FEN")!;
			const fen = normalizeFen(rawFen);
			if (fen.split(/\s+/)[1] !== "w") continue;
			out.push({
				id: compositionId(fen),
				fen,
				solution: game.notation,
			});
		}
	}
	return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const rows = readCandidates();
const candidates = MAX_ROWS === null ? rows : rows.slice(0, MAX_ROWS);

let report = readReport();
const ids = candidates.map((row) => row.id);
if (
	!report ||
	report.budgetMs !== budgetMs ||
	JSON.stringify(report.candidateIds) !== JSON.stringify(ids)
) {
	report = { budgetMs, candidateIds: ids, results: {} };
}

const pending = candidates.filter((row) => !report!.results[row.id]);
let next = 0;
let completed = Object.keys(report.results).length;
console.log(
	`Stockfish ${stockfish}: ${candidates.length} win positions, ${pending.length} pending, ${budgetMs} ms each, ${workerCount} worker(s)`,
);

async function worker(): Promise<void> {
	const engine = new UciEngine(stockfish);
	await engine.init();
	try {
		while (next < pending.length) {
			const row = pending[next++]!;
			const info = await engine.search(row.fen);
			const mainlineMate = mainlineMateDistance(row.fen, row.solution);
			let result: SearchResult;
			if (info?.kind !== "mate" || info.bound) {
				result = {
					status: "no-mate-score",
					mate: null,
					mainlineMate,
					pv: [],
					depth: info?.depth ?? null,
				};
			} else if (info.score < 0) {
				result = {
					status: "black-mates",
					mate: info.score,
					mainlineMate,
					pv: info.pv,
					depth: info.depth,
				};
			} else {
				const pvMate = validateWhiteMatePv(row.fen, info.pv);
				result = {
					status:
						pvMate === info.score
							? "white-mate-confirmed"
							: "mate-score-unverified",
					mate: info.score,
					mainlineMate,
					pv: info.pv,
					depth: info.depth,
				};
			}
			report!.results[row.id] = result;
			completed++;
			if (completed % 25 === 0 || completed === candidates.length) {
				saveReport(report!);
				console.log(`  ${completed}/${candidates.length} searched`);
			}
		}
	} finally {
		engine.close();
	}
}

try {
	await Promise.all(
		Array.from({ length: Math.min(workerCount, pending.length) }, () =>
			worker(),
		),
	);
} catch (error) {
	saveReport(report);
	throw error;
}

saveReport(report);
const confirmed = Object.entries(report.results).filter(
	([, result]) => result.status === "white-mate-confirmed",
);
const aligned = confirmed.filter(
	([, result]) => result.mate === result.mainlineMate,
);
const mismatched = confirmed.filter(
	([, result]) => result.mate !== result.mainlineMate,
);
console.log(`Stockfish-confirmed White mates: ${confirmed.length}`);
console.log(`Stored main line agrees exactly: ${aligned.length}`);
console.log(`Engine mate differs from stored line: ${mismatched.length}`);
console.log(`Report: ${reportPath}`);

const pgnDir = path.resolve("data/pgn");

interface Edit {
	/** 0-based line in the file. */
	at: number;
	/** Tag lines to drop before writing the new one. */
	remove: number;
	tag: string;
}

/**
 * Record a verified mate distance on the game's own `[Stipulation]` tag, which is
 * where the import reads a composition's objective from. One diagram is one game,
 * so the file to edit is found by the diagram and there is nothing to choose
 * between. Returns how many tags were written, which must equal the number of
 * confirmed mates, or the run fails rather than leaving the corpus half-updated.
 */
function writeStipulations(updates: { id: string; mate: number }[]): number {
	const wanted = new Map(updates.map((row) => [row.id, row.mate]));
	const edits = new Map<string, Edit[]>();
	const editsIn = (file: string): Edit[] => {
		const list = edits.get(file) ?? [];
		edits.set(file, list);
		return list;
	};
	let written = 0;

	for (const file of readdirSync(pgnDir)
		.filter((name) => name.endsWith(".pgn"))
		.sort()) {
		const target = path.join(pgnDir, file);
		const lines = readFileSync(target, "utf8").split(/\r?\n/);
		let changed = false;
		for (const game of readGameBlocks(lines, file)) {
			const id = compositionId(identityFen(game.tagMap.get("FEN")!));
			const mate = wanted.get(id);
			if (mate === undefined) continue;
			// The tag's own line, or the spot just after [Result] where it belongs.
			const at = game.tags.findIndex(
				(line) => parseTag(line)?.name === "Stipulation",
			);
			const afterResult = game.tags.findIndex(
				(line) => parseTag(line)?.name === "Result",
			);
			editsIn(file).push({
				at: at >= 0 ? game.from + at : game.from + afterResult + 1,
				remove: at >= 0 ? 1 : 0,
				tag: `[Stipulation "#${mate}"]`,
			});
			changed = true;
			written++;
		}
		if (!changed) continue;
		// Highest line first, so an earlier splice cannot move a later one.
		for (const edit of editsIn(file).sort((a, b) => b.at - a.at))
			lines.splice(edit.at, edit.remove, edit.tag);
		writeFileSync(target, lines.join("\n"), "utf8");
	}
	return written;
}

if (APPLY) {
	if (
		MAX_ROWS !== null ||
		Object.keys(report.results).length !== candidates.length
	)
		throw new Error("Refusing to apply a partial mate search");
	const updates = aligned.map(([id, result]) => ({ id, mate: result.mate! }));
	const written = writeStipulations(updates);
	if (written !== updates.length)
		throw new Error(
			`Expected ${updates.length} [Stipulation] tags, wrote ${written}`,
		);
	console.log(`Wrote ${written} [Stipulation] tag(s) into the corpus.`);
	console.log(
		"Regenerate the static catalogue with `npm run build` before deploying.",
	);
}
