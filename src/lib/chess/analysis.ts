import { addChild, type MoveNode, newRoot } from "./movetree";
import { NAG } from "./nag";
import { fenOf, playSan, positionFromFen } from "./rules";

const MAX_NODES = 2048;
const MAX_DEPTH = 256;
const MAX_COMMENT_LENGTH = 4096;
const MAX_COMMENTS_PER_NODE = 16;
const MAX_NAGS_PER_NODE = 16;

export interface SavedAnalysisNode {
	id: string;
	san: string;
	nags: string[];
	comments: string[];
	forceVariation?: true;
	children: SavedAnalysisNode[];
}

/**
 * A compact analysis snapshot; FENs and paths are recomputed.
 *
 * What the cursor was looking at is deliberately not stored. Where somebody
 * stopped reading is a property of the session, not of their work: a reopen
 * starts at the composition's first position, and the row says nothing about
 * where it stopped.
 */
export interface SavedAnalysis {
	children: SavedAnalysisNode[];
}

export interface RestoredAnalysis {
	root: MoveNode;
	moveCount: number;
}

/** Drop derived chess state and copy only data required to recreate the tree. */
export function serializeAnalysis(root: MoveNode): SavedAnalysis {
	const serializeNode = (node: MoveNode): SavedAnalysisNode => ({
		id: node.id,
		san: node.san,
		nags: [...node.nags],
		comments: [...node.comments],
		...(node.forceVariation ? { forceVariation: true as const } : {}),
		children: node.children.map(serializeNode),
	});
	return { children: root.children.map(serializeNode) };
}

/**
 * Validate a stored/client-supplied snapshot and rebuild every position by
 * replaying legal SAN from the composition's starting FEN. Client FENs, paths and
 * ply counts are never trusted.
 */
export function restoreAnalysis(
	startFen: string,
	value: unknown,
): RestoredAnalysis | null {
	try {
		if (!isRecord(value) || !Array.isArray(value.children)) return null;

		const root = newRoot(startFen);
		const limits = { nodes: 0 };
		if (!restoreChildren(root, value.children, 1, limits)) return null;

		return { root, moveCount: limits.nodes };
	} catch {
		return null;
	}
}

function restoreChildren(
	parent: MoveNode,
	children: unknown[],
	depth: number,
	limits: { nodes: number },
): boolean {
	if (depth > MAX_DEPTH || children.length > MAX_NODES - limits.nodes)
		return false;
	const seenIds = new Set<string>();

	for (const value of children) {
		if (!isRecord(value)) return false;
		const { id, san, nags, comments, forceVariation, children: nested } = value;
		if (
			typeof id !== "string" ||
			!/^[0-9a-z]{2}$/.test(id) ||
			Number.parseInt(id, 36) < 1 ||
			seenIds.has(id) ||
			typeof san !== "string" ||
			!san ||
			san.length > 32 ||
			san.trim() !== san ||
			!Array.isArray(nags) ||
			nags.length > MAX_NAGS_PER_NODE ||
			!nags.every(
				(nag) => typeof nag === "string" && Object.hasOwn(NAG, nag),
			) ||
			!Array.isArray(comments) ||
			comments.length > MAX_COMMENTS_PER_NODE ||
			!comments.every(
				(comment) =>
					typeof comment === "string" && comment.length <= MAX_COMMENT_LENGTH,
			) ||
			(forceVariation !== undefined && typeof forceVariation !== "boolean") ||
			!Array.isArray(nested)
		)
			return false;

		const pos = positionFromFen(parent.fen);
		const played = playSan(pos, san);
		if (!played) return false;
		const child = addChild(
			parent,
			{ ...played, fen: fenOf(pos) },
			[...nags],
			[...comments],
		);
		child.id = id;
		child.path = parent.path + id;
		if (forceVariation) child.forceVariation = true;
		seenIds.add(id);
		limits.nodes++;
		if (!restoreChildren(child, nested, depth + 1, limits)) return false;
	}
	return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
