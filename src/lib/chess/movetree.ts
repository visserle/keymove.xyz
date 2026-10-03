import { sideToMove } from "./fen";
import { escapeHtml } from "../html";
import { NAG, NAG_NAME } from "./nag";
import type { SolNode } from "../types";

/**
 * The move tree, shaped like lichess's own tree so the renderer below can be a
 * close port of `lichess-org/lila`'s `ui/analyse/src/treeView/` (inline and
 * column views). A node is one move; its children are, in order, the main
 * continuation and then the alternatives (variations).
 *
 * Paths are the concatenation of two base-36 characters per node, exactly as
 * lichess does it, so a path can be sliced back to its parent in O(1).
 */
export interface MoveNode {
	/** unique among its siblings; two base-36 characters */
	id: string;
	/** root-relative path: the ids of this node and all its ancestors */
	path: string;
	/** half-move count from the starting position; the root is 0 (or 1 if Black starts) */
	ply: number;
	san: string;
	from: string;
	to: string;
	/** FEN after the move; if the SAN could not be replayed, the FEN before it */
	fen: string;
	nags: string[];
	comments: string[];
	/** Prose introducing this move when it begins a variation line. */
	beforeComments: string[];
	/**
	 * A main-line move that lichess renders as a side branch anyway. Set by the
	 * move list's "Force variation", cleared by "Make main line"; any path that
	 * contains one is off the main line (`pathIsForcedVariation`).
	 */
	forceVariation?: boolean;
	children: MoveNode[];
}

export type ListStyle = "column" | "inline";

/**
 * The next free sibling id. Lichess keeps node ids stable and free, so reorders
 * and deletes never reuse one; deriving from the highest id present does the
 * same without a separate counter (a fresh parent still starts at `01`).
 */
function nextChildId(parent: MoveNode): string {
	let max = 0;
	for (const child of parent.children)
		max = Math.max(max, parseInt(child.id, 36));
	return (max + 1).toString(36).padStart(2, "0");
}

/** The half-move count of the starting position. */
function rootPly(fen: string): number {
	return sideToMove(fen) === "black" ? 1 : 0;
}

export function newRoot(fen: string): MoveNode {
	return {
		id: "",
		path: "",
		ply: rootPly(fen),
		san: "",
		from: "",
		to: "",
		fen,
		nags: [],
		comments: [],
		beforeComments: [],
		children: [],
	};
}

export function addChild(
	parent: MoveNode,
	move: { san: string; from: string; to: string; fen: string },
	nags: string[] = [],
	comments: string[] = [],
	beforeComments: string[] = [],
): MoveNode {
	const id = nextChildId(parent);
	const child: MoveNode = {
		id,
		path: parent.path + id,
		ply: parent.ply + 1,
		san: move.san,
		from: move.from,
		to: move.to,
		fen: move.fen,
		nags: [...nags],
		comments: [...comments],
		beforeComments: [...beforeComments],
		children: [],
	};
	parent.children.push(child);
	return child;
}

/** Walk a path from the root; clamps to the deepest node that exists. */
export function findByPath(root: MoveNode, path: string): MoveNode {
	let node = root;
	for (let i = 0; i < path.length; i += 2) {
		const next = node.children.find(
			(child) => child.id === path.slice(i, i + 2),
		);
		if (!next) return node;
		node = next;
	}
	return node;
}

/** The path of the last move on the main line (children[0] all the way down). */
export function mainlineEndPath(root: MoveNode): string {
	let node = root;
	while (node.children[0]) node = node.children[0];
	return node.path;
}

/* ------------------------------------------------------- lichess's tree ops */
/** `ops.collect`: the root and every node named by `path`. */
function getNodeList(root: MoveNode, path: string): MoveNode[] {
	const nodes = [root];
	let node = root;
	for (let i = 0; i < path.length; i += 2) {
		const child = node.children.find((c) => c.id === path.slice(i, i + 2));
		if (!child) break;
		nodes.push(child);
		node = child;
	}
	return nodes;
}

/** lichess's `tree.pathIsMainline`: every step is the first child. */
export function pathIsMainline(root: MoveNode, path: string): boolean {
	let node = root;
	for (let i = 0; i < path.length; i += 2) {
		const child = node.children[0];
		if (!child || child.id !== path.slice(i, i + 2)) return false;
		node = child;
	}
	return true;
}

/** lichess's `tree.pathIsForcedVariation`. */
export function pathIsForcedVariation(root: MoveNode, path: string): boolean {
	return getNodeList(root, path).some((node) => node.forceVariation);
}

/** The deepest node on `path` that is still mainline. */
export function lastMainlineNode(root: MoveNode, path: string): MoveNode {
	let node = root;
	for (let i = 0; i < path.length; i += 2) {
		const child = node.children[0];
		if (!child || child.id !== path.slice(i, i + 2)) return node;
		node = child;
	}
	return node;
}

/** `ops.countChildrenAndComments`: the node itself, its subtree and its comments. */
export function countChildrenAndComments(node: MoveNode): {
	nodes: number;
	comments: number;
} {
	const count = {
		nodes: 1,
		comments: node.comments.length + node.beforeComments.length,
	};
	for (const child of node.children) {
		const c = countChildrenAndComments(child);
		count.nodes += c.nodes;
		count.comments += c.comments;
	}
	return count;
}

/** lichess's `tree.deleteNodeAt`: detach the node (and its subtree) from its parent. */
export function deleteNodeAt(root: MoveNode, path: string): void {
	if (!path) return;
	const parent = findByPath(root, path.slice(0, -2));
	const index = parent.children.findIndex(
		(child) => child.id === path.slice(-2),
	);
	if (index >= 0) parent.children.splice(index, 1);
}

/**
 * lichess's `tree.promoteAt`: move the node ahead of its siblings. Without
 * `toMainline` it climbs one branch point and stops; with it, all the way to
 * the head of the main line. A forced variation it passes is unforced.
 */
export function promoteAt(
	root: MoveNode,
	path: string,
	toMainline: boolean,
): void {
	const nodes = getNodeList(root, path);
	for (let i = nodes.length - 2; i >= 0; i--) {
		const node = nodes[i + 1]!;
		const parent = nodes[i]!;
		if (parent.children[0] !== node) {
			parent.children.splice(parent.children.indexOf(node), 1);
			parent.children.unshift(node);
			if (!toMainline) break;
		} else if (node.forceVariation) {
			node.forceVariation = false;
			if (!toMainline) break;
		}
	}
}

/** `tree.forceVariationAt`: at most one node is forced at a time. */
export function forceVariationAt(
	root: MoveNode,
	path: string,
	force: boolean,
): void {
	const clear = (node: MoveNode): void => {
		node.forceVariation = false;
		for (const child of node.children) clear(child);
	};
	clear(root);
	if (path) findByPath(root, path).forceVariation = force;
}

/** The move-list context menu title: `12. Nf6`, `12... Nf6` or `Initial position`. */
export function nodeFullName(node: MoveNode): string {
	return node.san
		? `${plyToTurn(node.ply)}${node.ply % 2 === 1 ? "." : "..."} ${node.san}`
		: "Initial position";
}

/**
 * Turn the parsed solution back into a tree. A node's `variations` are the
 * alternatives to that move, so they become its siblings: children of the same
 * parent, at the same ply, rendered after it.
 */
export function buildSolutionTree(
	mainline: SolNode[],
	startFen: string,
	rootComments: string[] = [],
): MoveNode {
	const root = newRoot(startFen);
	root.comments = [...rootComments];
	attachLine(root, mainline);
	return root;
}

function attachLine(
	parent: MoveNode,
	line: SolNode[],
	beforeComments: string[] = [],
): void {
	const first = line[0];
	if (!first) return;
	const main = addChild(
		parent,
		{ san: first.san, from: first.from, to: first.to, fen: first.fen },
		first.nags,
		first.comments,
		beforeComments,
	);
	for (const branch of first.variations)
		attachLine(parent, branch.moves, branch.comments);
	attachLine(main, line.slice(1));
}

/* ------------------------------------------------------------------ render */

/**
 * Comment text the way lichess displays it: escaped, with bare URLs turned into
 * links and newlines kept as line breaks. Ported from `lichess-org/lila`'s
 * `ui/lib/src/richText.ts` (`enrichText`).
 */
const LINK_RE =
	/(^|[\s\n(]|<[A-Za-z]*\/?>)((?:(?:https?|ftp):\/\/|lichess\.org)[-A-Z0-9+\u0026\u2019@#/%?=()~_|!:,.;*$']*[-A-Z0-9+\u0026@#/%=~()_|][-A-Z0-9+\u0026@#/%=~(_|])/gi;

function toLink(url: string): string {
	const href = /^[A-Za-z]+:\/\//.test(url) ? url : `https://${url}`;
	return `<a target="_blank" rel="nofollow noreferrer" href="${href}">${url.replace(/https?:\/\//, "")}</a>`;
}

function enrichText(text: string): string {
	return escapeHtml(text)
		.replace(
			LINK_RE,
			(_match, space: string, url: string) => space + toLink(url),
		)
		.replace(/\n/g, "<br>");
}

const plyToTurn = (ply: number): number => Math.floor((ply - 1) / 2) + 1;

const indexTag = (ply: number, dots: boolean): string =>
	`<index>${plyToTurn(ply)}${dots ? (ply % 2 === 1 ? "." : "...") : ""}</index>`;

/**
 * Render a SAN with its piece letters as figurines, the way lichess's `%san`
 * chess font does. Every `K/Q/R/B/N` becomes a figurine, not only the leading
 * one, so a promotion such as `h1=Q` or `e8=N+` shows the promoted piece too.
 * SAN only uses those capitals for pieces: files are lower-case and castling uses
 * `O`, so a global replace is safe.
 */
export function moveSan(san: string): string {
	return escapeHtml(san).replace(
		/[KQRBN]/g,
		(letter) => `<span class="fig">${letter}</span>`,
	);
}

/**
 * How far down a sideline a choice counts against folding it into the text.
 * Lila's number: an alternative six plies in is still "a line the reader has
 * to hold in their head", not a glance.
 */
const BRANCH_PLIES = 6;

/**
 * How long a sideline may be and still be folded into the text, when it asks
 * no choice. Lila has no such number; its `hasBranching` walked six plies and
 * then reported a branch, so a straight forced line of seven moves or more was
 * given a row of its own for being long rather than for being complicated. In
 * a study those lines are the content. An eight-move forced sequence with a note
 * on it is the point of the composition, not an aside to it, and on a
 * phone a row of its own is a screenful. So the two questions are asked
 * separately: `BRANCH_PLIES` for the shape, this for the size.
 */
const INLINE_MAX_PLY = 12;

/** Is there a real alternative at this node, or within `plies` plies of it? */
function branchesWithin(node: MoveNode, plies: number): boolean {
	return (
		!!node.children[1] ||
		(plies > 0 && !!node.children[0] && branchesWithin(node.children[0], plies - 1))
	);
}

/** The moves of a sideline's own line, down its first child each time. */
function lineLength(node: MoveNode): number {
	let n = 0;
	for (let cur: MoveNode | undefined = node; cur; cur = cur.children[0]) n++;
	return n;
}

interface Args {
	isMainline: boolean;
	parentNode: MoveNode;
	parenthetical?: boolean;
	/** already inside a `<inline>` group: a nested variation must not open a second pair of brackets */
	inParens?: boolean;
	/** the first move of a group that opens a bracket; carries it (see `lines()`) */
	opens?: boolean;
	/**
	 * Nothing before this move in the flow carries its number: it opens the
	 * list, or a comment or a variation was written between it and the move
	 * that would normally share its number. Set in the inline view, where the
	 * list reads as prose and there is no gutter to fall back on.
	 */
	unpaired?: boolean;
}

class Renderer {
	constructor(readonly inline: boolean) {}

	private commentMarkup(comments: string[]): string {
		return comments
			.map(
				(comment) => `<comment><span>${enrichText(comment)}</span></comment>`,
			)
			.join("");
	}

	commentNodes(node: MoveNode): string {
		return this.commentMarkup(node.comments);
	}

	renderNodes(children: MoveNode[], args: Args): string {
		return this.inline
			? this.inlineNodes(children, args)
			: this.columnNodes(children, args);
	}

	/** The inline view: everything flows like prose, variations in parentheses. */
	private inlineNodes(children: MoveNode[], args: Args): string {
		const [child, ...siblings] = children;
		if (!child) return "";
		// a forced variation is rendered as a branch even though it is the first child
		if (child.forceVariation && args.isMainline) {
			return `<interrupt>${this.lines([child, ...siblings], args)}</interrupt>`;
		}
		const parts = [this.moveNode(child, args)];
		const comments = this.commentNodes(child);
		if (comments || siblings.length) {
			parts.push(comments);
			if (siblings.length)
				parts.push(`<interrupt>${this.lines(siblings, args)}</interrupt>`);
		}
		// lila numbers a mainline move when it is White's, and leaves Black's
		// bare on the assumption that the White move beside it carries the
		// number. In prose that assumption breaks: a comment or a bracketed
		// variation can sit between the pair, and what the reader meets is
		// `(… ♕c3= …) ♕xf7 6. ♔g7`: a Black move with no number anywhere, and
		// one that reads as if it belonged to the brackets it just came out of.
		// So a mainline move with nothing numbered in front of it numbers
		// itself, and the column view is untouched: there the number is in the
		// gutter for every move. The flag describes what this move left behind,
		// not its own state: a move that just numbered itself is the number the
		// next one shares.
		parts.push(
			this.inlineNodes(child.children, {
				...this.childArgs(child, true),
				unpaired: !!comments || siblings.length > 0,
			}),
		);
		return parts.join("");
	}

	/** The column view (lichess's default): numbered rows, variations full-width. */
	private columnNodes(children: MoveNode[], args: Args): string {
		const [child, ...siblings] = children;
		if (!child) return "";
		if (child.forceVariation && args.isMainline) {
			return `<interrupt>${this.lines([child, ...siblings], args)}</interrupt>`;
		}
		const isWhite = child.ply % 2 === 1;
		const comments = this.commentNodes(child);
		const parts: string[] = [];
		if (isWhite) parts.push(indexTag(child.ply, false));
		parts.push(this.moveNode(child, args));
		if (siblings.length || comments) {
			if (isWhite) parts.push('<move class="empty">...</move>');
			parts.push(
				`<interrupt>${comments}${siblings.length ? this.lines(siblings, args) : ""}</interrupt>`,
			);
			if (isWhite && child.children.length)
				parts.push(
					indexTag(child.ply, false),
					'<move class="empty">...</move>',
				);
		}
		parts.push(this.columnNodes(child.children, this.childArgs(child, true)));
		return parts.join("");
	}

	/**
	 * A set of sibling alternatives. Short, unbranched ones render parenthetically
	 * inline; the rest become full-width `lines`.
	 */
	private lines(nodes: MoveNode[], args: Args): string {
		if (!nodes.length) return "";
		const lineArgs: Args = { isMainline: false, parentNode: args.parentNode };
		// One pair of brackets per sideline. A second one inside the first is
		// unreadable in the inline view. The inner group is set in the same italic,
		// dimmed face as the outer one, so `(… (…))` reads as noise,
		// so a variation inside a parenthetical is laid out as `lines` instead.
		const paren =
			(!args.isMainline || this.inline) &&
			args.parenthetical &&
			!(this.inline && args.inParens);
		if (paren) {
			// The opening bracket is carried by the group's first move, not by
			// `inline::before` as in lila: a pseudo-element is a text atom of its
			// own, so the line may break right after it and leave a lone `(` at
			// the end of a line, its variation a line below. Inside the move, which is
			// one `nowrap` box, no such break exists and the group itself stays
			// wrappable, so a long variation no longer pushes the mainline move
			// before it onto a line of its own.
			return `<inline>${this.sidelineNodes(nodes, { ...lineArgs, inParens: true, opens: true })}</inline>`;
		}
		const body = nodes
			.map(
				(node) =>
					`<line><branch></branch>${this.sidelineNodes([node], lineArgs)}</line>`,
			)
			.join("");
		return `<lines>${body}</lines>`;
	}

	private sidelineNodes(nodes: MoveNode[], args: Args): string {
		const [child, ...siblings] = nodes;
		if (!child) return "";
		const childArgs = this.childArgs(child, false, args.inParens);
		const parts = [
			this.commentMarkup(child.beforeComments),
			this.moveNode(child, args),
			this.commentNodes(child),
		];
		if (args.parenthetical) parts.push(this.lines(siblings, args));
		parts.push(
			child.children.length < 2 || childArgs.parenthetical
				? this.sidelineNodes(child.children, childArgs)
				: this.lines(child.children, childArgs),
		);
		if (!args.parenthetical) parts.push(this.lines(siblings, args));
		return parts.join("");
	}

	private moveNode(node: MoveNode, args: Args): string {
		const withIndex =
			(!args.isMainline || this.inline) &&
			(node.ply % 2 === 1 ||
				!!args.unpaired ||
				(!args.isMainline &&
					args.parentNode.children.length > 1 &&
					(!args.parenthetical || args.parentNode.children[0] !== node)));
		const classes: string[] = [];
		if (args.isMainline && this.inline) classes.push("mainline");
		const glyphs = node.nags
			.map(
				(nag) =>
					`<glyph title="${escapeHtml(NAG_NAME[nag] ?? "")}">${escapeHtml(NAG[nag] ?? `$${nag}`)}</glyph>`,
			)
			.join("");
		return (
			`<move data-path="${node.path}"${classes.length ? ` class="${classes.join(" ")}"` : ""} role="button" tabindex="0">` +
			(args.opens ? "<open>(</open>" : "") +
			(withIndex ? indexTag(node.ply, true) : "") +
			`<san>${moveSan(node.san)}</san>${glyphs}</move>`
		);
	}

	private childArgs(
		child: MoveNode,
		isMainline: boolean,
		inParens = false,
	): Args {
		return {
			isMainline,
			parentNode: child,
			parenthetical: this.parenthetical(child),
			inParens,
		};
	}

	/**
	 * Whether this position's alternatives are folded back into the text in
	 * brackets. Lila's test, with its two questions pulled apart: exactly one
	 * alternative, no choice within `BRANCH_PLIES` of it, and the line short
	 * enough to read as an aside (`INLINE_MAX_PLY`) if it is straight.
	 */
	private parenthetical(node: MoveNode): boolean {
		const second = node.children[1];
		if (node.children[2] || !second) return false;
		if (branchesWithin(second, BRANCH_PLIES)) return false;
		return lineLength(second) <= INLINE_MAX_PLY;
	}
}

/**
 * Render the whole tree as lichess markup. The caller drops the string into the
 * scrolling panel with `{@html}`; clicks are delegated on `[data-path]`. Only
 * structure is rendered here. The per-move state classes (`active`,
 * `context-menu`, `pending-deletion`) are painted onto the existing elements by
 * `Solve.svelte`, so navigating or opening the menu never re-creates the move
 * under the finger. That is the stability lila gets from patching its vdom.
 */
export function renderMoveTree(root: MoveNode, style: ListStyle): string {
	const renderer = new Renderer(style === "inline");
	const blackStarts = root.ply === 1;
	const empty =
		blackStarts && style === "column"
			? `${indexTag(root.ply, false)}<move class="empty">...</move>`
			: "";
	const rootComments = renderer.commentNodes(root);
	const initialComments =
		style === "column" && rootComments
			? `<interrupt>${rootComments}</interrupt>`
			: rootComments;
	const inner =
		initialComments +
		empty +
		renderer.renderNodes(root.children, {
			isMainline: true,
			parentNode: root,
			// the list opens here, so a first move that is Black's (a study
			// with Black to move) has no number in front of it either
			unpaired: true,
		});
	return `<div class="tview2 tview2-${style}">${inner}</div>`;
}

/**
 * lichess's `analyse__fork` (`ui/analyse/src/fork.ts`, `_fork.scss`): when a
 * position has more than one continuation, its children are shown as a row of
 * buttons, the main line marked as the default selection. Clicking one jumps
 * into that variation. Lichess lifts it above the move list on a phone
 * (`ui/analyse/css/_tools-mobile.scss`).
 */
export function renderFork(children: MoveNode[]): string {
	if (children.length < 2) return "";
	const moves = children
		.map((child, i) => {
			const glyphs = child.nags
				.map(
					(nag) =>
						`<glyph title="${escapeHtml(NAG_NAME[nag] ?? "")}">${escapeHtml(NAG[nag] ?? `$${nag}`)}</glyph>`,
				)
				.join("");
			return (
				`<move data-path="${child.path}" data-it="${i}" class="${i === 0 ? "selected" : ""}" role="button" tabindex="0">` +
				indexTag(child.ply, true) +
				`<san>${moveSan(child.san)}</san>${glyphs}</move>`
			);
		})
		.join("");
	return moves;
}
