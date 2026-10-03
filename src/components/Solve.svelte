<script lang="ts">
import { onMount, tick, untrack } from "svelte";
import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { Color, Dests, Key } from "@lichess-org/chessground/types";
import {
	addChild,
	buildSolutionTree,
	countChildrenAndComments,
	deleteNodeAt,
	findByPath,
	forceVariationAt,
	lastMainlineNode,
	mainlineEndPath,
	moveSan,
	newRoot,
	nodeFullName,
	pathIsForcedVariation,
	pathIsMainline,
	promoteAt,
	renderFork,
	renderMoveTree,
	type ListStyle,
	type MoveNode,
} from "../lib/chess/movetree";
import { restoreAnalysis, serializeAnalysis } from "../lib/chess/analysis";
import { boardGlyphShapes } from "../lib/board/boardglyph";
import { creditDetail, taskFor } from "../lib/display";
import { sideToMove } from "../lib/chess/fen";
import { licon } from "../lib/licon";
import { DEFAULT_BOARD_ZOOM } from "../lib/preferences";
import { sanKey } from "../lib/chess/notation";
import {
	addPointerListeners,
	blurIfPrimaryClick,
	isTouchDevice,
	repeater,
} from "../lib/pointer";
import {
	destsOf,
	fenOf,
	pieceAt,
	playBoardMove,
	positionFromFen,
} from "../lib/chess/rules";
import { buildSolutionDocument } from "../lib/chess/solution";
import {
	getSoundOutputLatencyMs,
	initSounds,
	playMoveSound,
	playSound,
} from "../lib/sound";
import {
	readBoolSetting,
	readSetting,
	writeBoolSetting,
	writeSetting,
} from "../lib/storage";
import { flagReasonLabel, levelLabel } from "../lib/display";
import {
	FLAG_REASONS,
	type FlagReason,
	type Level,
	LEVELS,
	type PublicComposition,
} from "../lib/types";

interface InitialProgress {
	state: "not-started" | "in-progress" | "solved";
	solution?: string;
}

let {
	composition,
	playNextHref,
	playNextLabel,
	initialProgress,
	initialAnalysis,
	initialBookmarked = false,
	signedIn = false,
	canRate = false,
	initialRating = null,
	initialFlagged = null,
	curatedRating = null,
}: {
	composition: PublicComposition;
	playNextHref: string | null;
	playNextLabel: string;
	initialProgress: InitialProgress;
	initialAnalysis?: unknown;
	initialBookmarked?: boolean;
	/** There is an account: bookmarking, curation and saving are all for one. */
	signedIn?: boolean;
	/** Admin: the Solution tab offers the rating levels and the flag. */
	canRate?: boolean;
	/** The admin's own rating, filled tile and all. */
	initialRating?: Level | null;
	/**
	 * Why the composition is flagged, if it is: `fix` or `drop`, or null for no
	 * flag. The page sends it to admins only.
	 */
	initialFlagged?: FlagReason | null;
	/**
	 * The corpus's curated `[Difficulty]`, which the row marks rather than
	 * fills. The page sends it to admins only, like the rest of the row.
	 */
	curatedRating?: Level | null;
} = $props();
// The composition, saved progress and analysis are fixed for this island. Read
// them once so SSR and hydration begin with the same personalized state.
const initialSavedProgress = untrack(() => initialProgress);
const initialSavedAnalysis = untrack(() => initialAnalysis);
let bookmarked = $state(initialBookmarked);
let bookmarkBusy = $state(false);
let bookmarkMessage = $state("");
let resetBusy = $state(false);
let resetMessage = $state("");
const startFen = untrack(() => composition.fen);
const restoredAnalysis = initialSavedAnalysis
	? restoreAnalysis(startFen, initialSavedAnalysis)
	: null;
const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
const PROMOTION_ROLES = ["queen", "knight", "rook", "bishop"] as const;
type PromotionRole = (typeof PROMOTION_ROLES)[number];
const STYLE_KEY = "moveListStyle";
const SHOW_FORK_KEY = "showFork";
const ZOOM_KEY = "boardZoom";
// lila's resize clamps `---zoom` to 100 (`ui/lib/src/chessgroundResize.ts`);
// at 100 the board-scale is 1, i.e. exactly the size `--sq` already fitted to
// the page. Allowing more made the board overrun the page.
const MAX_ZOOM = 100;
// A board nobody has resized opens at the default, not at the fitted maximum:
// lila's 100 is the whole viewport, which is too big for a first visit here.
const DEFAULT_ZOOM = DEFAULT_BOARD_ZOOM;

interface Promo {
	from: Key;
	to: Key;
	color: "w" | "b";
	file: string;
}

let boardEl: HTMLElement | undefined;
let jumpsEl: HTMLElement | undefined;
let navEl: HTMLElement | undefined;
let resizeEl: HTMLElement | undefined;
let listEl: HTMLDivElement | undefined;
let cg = $state<Api | null>(null);

// ── the two trees, and where the cursor stands in each ────────────────────
let analysisRoot = $state<MoveNode>(
	restoredAnalysis?.root ?? newRoot(startFen),
);
// A saved analysis reopens at the composition's first position: the snapshot
// stores the tree, never where the cursor was left.
let analysisPath = $state("");
function solutionTree(solution: string): MoveNode {
	const built = buildSolutionDocument(solution, startFen);
	return buildSolutionTree(built.moves, startFen, built.rootComments);
}

let solutionRoot = $state<MoveNode | null>(
	initialSavedProgress.state === "solved" && initialSavedProgress.solution
		? solutionTree(initialSavedProgress.solution)
		: null,
);
let solutionPath = $state("");
// bumped whenever a tree is mutated in place; the rendered list only depends
// on structure now, so it has to be told
let treeRev = $state(0);

/**
 * Every in-place tree mutation goes through here: the list has to be told, and
 * the Analysis tree has to arm its sync. One seam, so an edit cannot forget the
 * second half of what an edit means.
 */
function treeChanged(): void {
	treeRev++;
	markAnalysisDirty();
}

// ── the panel and the claim ───────────────────────────────────────────────
let tab = $state<"analysis" | "solution">("analysis");
let listStyle = $state<ListStyle>("inline");

let showFork = $state(false);
let menuOpen = $state(false);
let guess = $state("");
let keyInput: HTMLInputElement | undefined;
let keyButton: HTMLButtonElement | undefined;
let status = $state<"idle" | "wrong" | "right" | "checking">("idle");
// once a guess is submitted the field is locked against further submits until
// the feedback has fully played out: the quarter-turn and the micropause for
// a right key, the jam for a wrong one. Enter in between does nothing.
let locked = false;
// a wrong guess jams the key briefly, then the field returns to neutral
const WRONG_FLASH_MS = 500;
// after the key's actual `key-turn` animation ends, it rests at the turned
// angle for a beat so the lock reads even when the Worker answers instantly
const VERDICT_HOLD_MS = 400;
// On a correct guess the key has already held the turned angle through the
// wait above; the Solution tab takes the field's half as soon as the verdict
// lands. There is no second key animation to wait for.
const VERIFY_MS = 0;
let wrongTimer: ReturnType<typeof setTimeout> | undefined;
let verifyTimer: ReturnType<typeof setTimeout> | undefined;
let promo = $state<Promo | null>(null);

async function toggleBookmark(): Promise<void> {
	if (!signedIn || bookmarkBusy) return;
	const nextBookmarked = !bookmarked;
	bookmarked = nextBookmarked;
	bookmarkBusy = true;
	bookmarkMessage = "";
	try {
		const response = await fetch(
			`/api/bookmarks/${encodeURIComponent(composition.id)}`,
			{
				method: nextBookmarked ? "PUT" : "DELETE",
				credentials: "same-origin",
				headers: { Accept: "application/json" },
			},
		);
		if (!response.ok) throw new Error("Could not update bookmark");
	} catch {
		bookmarked = !nextBookmarked;
		bookmarkMessage = "Could not update bookmark. Please try again.";
	} finally {
		bookmarkBusy = false;
	}
}

// ── the admin's curation: a rating and a flag (Solution tab only) ─────────
// Both are one operator's judgement about the corpus row, so both live in
// `composition_curation` and neither rewrites the content. `canRate` comes from
// the server; the API route checks the admin row again on every write, so
// hiding the controls is the courtesy, not the gate. The flag is private: it
// reaches this component only when the server already knows the user is an
// admin, and it is never rendered for anyone else.
let rating = $state<Level | null>(untrack(() => initialRating));
let flagged = $state<FlagReason | null>(untrack(() => initialFlagged));
let curationBusy = $state(false);
// Only a refusal is reported. A save that lands needs no sentence: the pressed
// button is the answer, and a line of prose that appears and fades is more
// motion than a rating deserves.
let curationError = $state("");

// The two routes are named for the judgement, and the fields for what it
// holds: `rate` takes `rating`. Keeping the pair in one place stops the write
// from being posted to `/api/admin/rating`, which is a 404 that reads exactly
// like a server refusal.
const CURATION_ROUTES = {
	rating: "/api/admin/rate",
	flag: "/api/admin/flag",
} as const;

async function saveCuration(
	key: keyof typeof CURATION_ROUTES,
	value: Level | FlagReason | null,
): Promise<void> {
	if (!canRate || curationBusy) return;
	// Optimistic, and rolled back on a refusal: the write is one upsert, and a
	// failed one is rarer than a double click.
	const previous = key === "rating" ? rating : flagged;
	if (key === "rating") rating = value as Level | null;
	else flagged = value as FlagReason | null;
	curationBusy = true;
	curationError = "";
	try {
		const response = await fetch(CURATION_ROUTES[key], {
			method: "POST",
			credentials: "same-origin",
			headers: { "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify({ id: composition.id, [key]: value }),
		});
		if (!response.ok) throw new Error("Could not save");
	} catch {
		if (key === "rating") rating = previous as Level | null;
		else flagged = previous as FlagReason | null;
		curationError = "Could not save. Please try again.";
	} finally {
		curationBusy = false;
	}
}

/**
 * The flag tile's three states in press order: no flag, then one step to each
 * reason. One press is one step, so a mis-press is at most two presses back,
 * and there is no menu to aim at and nothing to close afterwards.
 */
const FLAG_STATES: (FlagReason | null)[] = [null, ...FLAG_REASONS];

/** Where one more press on the tile lands. */
function nextFlag(): FlagReason | null {
	return FLAG_STATES[(FLAG_STATES.indexOf(flagged) + 1) % FLAG_STATES.length];
}

/** The same step, written: the tile's label says where the flag is, this says
      where the tile goes. */
function nextFlagLabel(): string {
	const next = nextFlag();
	return next === null ? "clear the flag" : flagReasonLabel(next);
}

function cycleFlag(): void {
	void saveCuration("flag", nextFlag());
}

// ── the move list's context menu (lichess `treeView/contextMenu.ts`) ───────
let contextMenu = $state<{
	path: string;
	x: number;
	y: number;
	// a hold opened it: the finger that opened it is still down
	fromHold: boolean;
} | null>(null);
// the subtree a hover is about to delete, previewed in red
let pendingDeletionPath = $state("");
let menuTransparent = $state(false);
let menuEl: HTMLDivElement | undefined = $state();
// a long-press release can emit a click of its own; that click is not a choice
let swallowReleaseClick = $state(false);

const activeRoot = $derived(tab === "analysis" ? analysisRoot : solutionRoot);
const activePath = $derived(tab === "analysis" ? analysisPath : solutionPath);
const activeNode = $derived.by(() => {
	const root = activeRoot;
	return root ? findByPath(root, activePath) : null;
});
const moveListHtml = $derived.by(() => {
	void treeRev;
	const root = activeRoot;
	return root ? renderMoveTree(root, listStyle) : "";
});
// the fork: the current position's continuations as a row of buttons
const forkHtml = $derived(
	showFork && activeNode ? renderFork(activeNode.children) : "",
);
const atStart = $derived(activePath === "");
const canAdvance = $derived(!!activeNode?.children.length);
const atEnd = $derived.by(() => {
	const root = activeRoot;
	return !root || activePath === mainlineEndPath(root);
});

// ── the context menu's model, ported from lichess's `contextMenu.ts` ────────
const menu = $derived.by(() => {
	const state = contextMenu;
	const root = activeRoot;
	if (!state || !root) return null;
	const node = findByPath(root, state.path);
	const onMainline =
		pathIsMainline(root, state.path) &&
		!pathIsForcedVariation(root, state.path);
	// "Promote variation" climbs one branch point; it is hidden when a single
	// step would already make the move the main line ("Make main line" does).
	let canPromote = !onMainline;
	for (
		let iter = lastMainlineNode(root, state.path).children[1];
		canPromote && iter;
		iter = iter.children[0]
	) {
		if (iter === node) canPromote = false;
	}
	return {
		x: state.x,
		y: state.y,
		path: state.path,
		title: nodeFullName(node),
		canPromote,
		canMakeMainLine: !onMainline,
		canForceVariation: !!state.path && onMainline,
		canDelete: !!state.path,
	};
});

// clamp the menu to the viewport, as lichess's `positionMenu` does
$effect(() => {
	const state = contextMenu;
	const el = menuEl;
	if (!state || !el) return;
	const width = el.offsetWidth + 4;
	const height = el.offsetHeight + 4;
	const left =
		window.innerWidth - state.x < width ? window.innerWidth - width : state.x;
	// A hold opens the menu with the finger still down on the press point, and
	// the move list sits low on a phone, so the upward clamp usually bites: the
	// menu comes back up *over* the finger, and the release then lands on the
	// row the thumb was covering (measured on a 390x560 viewport: the press
	// clamped, and lifting the finger clicked "Delete from here"). A held menu
	// goes above the press point instead, so the finger rests in free space
	// either way; a right-click keeps lila's placement.
	const above = state.y - height;
	const top =
		window.innerHeight - state.y < height
			? state.fromHold && above >= 4
				? above
				: window.innerHeight - height
			: state.y;
	el.style.left = `${Math.max(4, left)}px`;
	el.style.top = `${Math.max(4, top)}px`;
});

// A click anywhere but a right-click closes the menu (lichess's `close`).
$effect(() => {
	if (!contextMenu) return;
	const onDocClick = (e: MouseEvent): void => {
		if (e.button === 2) return;
		closeContextMenu();
	};
	document.addEventListener("click", onDocClick, false);
	return () => document.removeEventListener("click", onDocClick, false);
});

// The hold's own release is not a choice. The menu opens with the finger still
// down, and a browser aims the click it synthesizes at release by hit-testing
// that finger once more, so whatever the thumb covers when it lifts is clicked.
// The list sits low on a phone, so that is usually a row: measured here, lifting
// a hold near the bottom edge ran "Delete from here". Swallow that one click at
// the window, in the capture phase, before it can reach a row; the next press
// re-arms, so the tap after the release — the one that chooses — counts as
// usual. Lila needs no such rule: it also opens the menu from a `dblclick`,
// where the finger has already lifted and nothing is left over a row.
$effect(() => {
	if (!swallowReleaseClick) return;
	const onRelease = (e: Event): void => {
		swallowReleaseClick = false;
		e.preventDefault();
		e.stopPropagation();
	};
	const rearm = (): void => {
		swallowReleaseClick = false;
	};
	window.addEventListener("click", onRelease, true);
	document.addEventListener("pointerdown", rearm, true);
	return () => {
		window.removeEventListener("click", onRelease, true);
		document.removeEventListener("pointerdown", rearm, true);
	};
});

// the target is gone (tab switch, deletion): the menu has nothing to act on
$effect(() => {
	const state = contextMenu;
	const root = activeRoot;
	if (state && (!root || findByPath(root, state.path).path !== state.path))
		closeContextMenu();
});

// ── positions ────────────────────────────────────────────────────────────
function currentFen(): string {
	return activeNode?.fen ?? startFen;
}
function currentLastMove(): Key[] | undefined {
	const node = activeNode;
	return node?.path ? [node.from as Key, node.to as Key] : undefined;
}
function currentTurn(): Color {
	return sideToMove(currentFen());
}
function currentCheck(): Color | false {
	const pos = positionFromFen(currentFen());
	return pos.isCheck() ? sideToMove(currentFen()) : false;
}
function currentDests(): Dests {
	return destsOf(positionFromFen(currentFen()));
}

function applyPosition(): void {
	if (!cg) return;
	const node = activeNode;
	cg.set({
		fen: currentFen(),
		turnColor: currentTurn(),
		lastMove: currentLastMove(),
		check: currentCheck(),
		movable: {
			color: "both",
			free: false,
			dests: currentDests(),
			showDests: true,
		},
		// the annotation badge(s) on the move the board stands on, as lichess shows them
		drawable: {
			autoShapes: node ? boardGlyphShapes(node.to, node.nags) : [],
		},
	});
}

$effect(applyPosition);

// lila patches these classes onto its tree with snabbdom; paint them onto the
// existing elements instead of re-rendering the `{@html}` string for them, so
// a tap never takes the move out from under the finger.
$effect(() => {
	void moveListHtml;
	const path = activePath;
	const context = contextMenu?.path ?? "";
	const pending = pendingDeletionPath;
	const list = listEl;
	if (!list) return;
	for (const el of list.querySelectorAll<HTMLElement>("move[data-path]")) {
		const p = el.dataset.path ?? "";
		el.classList.toggle("active", p === path);
		el.classList.toggle("context-menu", p === context);
		el.classList.toggle("pending-deletion", !!pending && p.startsWith(pending));
	}
});

// Lichess keeps the tapped move under the finger: its `treeView.ts` cancels
// the auto-scroll its own `jump()` requested when the navigation came from a
// tap on the list. Do the same: a tap must not recentre the list, or the
// move slides away before the next touch. Keyboard, board and fork
// navigation still scroll. `activePath` is read before the check so the
// effect keeps it as a dependency across the once-only skip.
let skipAutoScroll = false;

// keep the move the board stands on centred in the list, scrolling only it
$effect(() => {
	void moveListHtml; // re-run whenever the rendered tree changes
	const path = activePath;
	const list = listEl;
	if (skipAutoScroll) {
		skipAutoScroll = false;
		return;
	}
	if (!list) return;
	const target = path
		? list.querySelector<HTMLElement>(`move[data-path="${path}"]`)
		: null;
	if (!target) {
		list.scrollTop = 0;
		return;
	}
	const [listBox, moveBox] = [
		list.getBoundingClientRect(),
		target.getBoundingClientRect(),
	];
	const visible =
		Math.min(listBox.bottom, window.innerHeight) - Math.max(listBox.top, 0);
	list.scrollTo({
		top:
			list.scrollTop +
			moveBox.top -
			listBox.top -
			(visible - moveBox.height) / 2,
		behavior: "auto",
	});
});

// ── playing on the board ─────────────────────────────────────────────────
//
// The Analysis tree syncs to D1 on one condition: five seconds after it last
// changed. There is no second trigger and nothing counts moves, because both
// were ways of guessing when the user would stop.
//
// The timer is armed by an edit and disarmed by the sync itself, so a page left
// open and untouched costs nothing: no timer, no request, no row. And the sync
// sends only what the row does not already hold — the body is compared with the
// last one D1 acknowledged, so a window in which the tree came back to where it
// was ends in no request at all. Leaving the page flushes, because that is the
// one moment the tab may never come back from.
//
// Five seconds is shorter than the gap between a reader's moves, so for someone
// actually thinking about a position this costs one row per move either way;
// what it buys is the size of the hole a crash leaves. Lengthening it past the
// thinking gap is the only change that coalesces writes, and that lever is a
// change-count, not a longer wait.
const ANALYSIS_SYNC_MS = 5_000;

let analysisSyncTimer: ReturnType<typeof setTimeout> | undefined;
let analysisSyncing = false;
let analysisSyncRetries = 0;
// What D1 holds, so the first sync after a restore has something to compare
// against and an untouched page writes nothing.
let savedAnalysisBody: string | undefined = restoredAnalysis
	? JSON.stringify({
			id: composition.id,
			analysis: serializeAnalysis(restoredAnalysis.root),
		})
	: undefined;

function analysisRequestBody(): string {
	return JSON.stringify({
		id: composition.id,
		analysis: serializeAnalysis(analysisRoot),
	});
}

/** Arm the sync. Repeated edits keep the same ten seconds rather than pushing it out. */
function markAnalysisDirty(): void {
	// A guest's analysis goes nowhere: the route has no account to attach it to,
	// so the board asks for nothing.
	if (!signedIn || analysisSyncTimer) return;
	analysisSyncTimer = setTimeout(
		() => void syncAnalysis(),
		ANALYSIS_SYNC_MS,
	);
}

/** Write one snapshot, and remember it only if D1 took it. */
async function putAnalysis(body: string, keepalive: boolean): Promise<boolean> {
	try {
		const response = await fetch("/api/progress/analysis", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body,
			// Keepalive is what lets a write outlive the document that started it.
			// Past 60 KB a browser refuses the keepalive outright, so a very large
			// tree falls back to an ordinary fetch here and unload may cancel it;
			// the ten-second sync is what carries one that size.
			keepalive:
				keepalive && new TextEncoder().encode(body).byteLength <= 60 * 1024,
		});
		if (!response.ok) throw new Error("Could not save analysis");
		savedAnalysisBody = body;
		return true;
	} catch {
		return false;
	}
}

async function syncAnalysis(): Promise<void> {
	clearTimeout(analysisSyncTimer);
	analysisSyncTimer = undefined;
	// A sync is already in flight; it re-arms for whatever changed behind it.
	if (analysisSyncing) return;

	const body = analysisRequestBody();
	if (body === savedAnalysisBody) {
		// Nothing was pending, so the failure budget is whole again.
		analysisSyncRetries = 0;
		return;
	}

	analysisSyncing = true;
	try {
		if (await putAnalysis(body, false)) analysisSyncRetries = 0;
		else if (analysisSyncRetries < 2) {
			// A transient failure gets a couple of tries; further edits retry too.
			analysisSyncRetries++;
			analysisSyncTimer = setTimeout(
				() => void syncAnalysis(),
				analysisSyncRetries * 1000,
			);
		}
	} finally {
		analysisSyncing = false;
	}

	// An edit made while the request was in flight is still unsaved.
	if (analysisRequestBody() !== savedAnalysisBody) markAnalysisDirty();
}

/**
 * Leaving: write the pending tree now, with keepalive so the request outlives the
 * document.
 *
 * This deliberately ignores the in-flight guard the timed sync obeys. A sync
 * that is already on its way carries a body built before the last edit, and the
 * tab may never run the code that would notice; two writes to one row beat one
 * write of the wrong tree. The trade is that D1 does not order them, so in the
 * one window where both are in flight the older body can land second and the row
 * keeps it. Losing an edit outright is the worse of the two, and this narrows
 * that case to a single round trip.
 */
function flushAnalysisOnUnload(): void {
	clearTimeout(analysisSyncTimer);
	analysisSyncTimer = undefined;
	if (!signedIn) return;
	const body = analysisRequestBody();
	if (body === savedAnalysisBody) return;
	void putAnalysis(body, true);
}

function onBoardMove(orig: Key, dest: Key): void {
	const pos = positionFromFen(currentFen());
	const piece = pieceAt(pos, orig);
	const promotionRank = piece?.color === "white" ? "8" : "1";
	if (piece?.role === "pawn" && dest[1] === promotionRank) {
		promo = {
			from: orig,
			to: dest,
			color: piece.color === "white" ? "w" : "b",
			file: dest[0]!,
		};
		applyPosition(); // snap the pawn back until a piece is chosen
		return;
	}
	playMove(orig, dest);
}

/** A move played on the board goes into whichever tree is active. */
function playMove(orig: Key, dest: Key, promotion?: PromotionRole): void {
	const root = activeRoot;
	const node = activeNode;
	if (!root || !node) return;
	const pos = positionFromFen(node.fen);
	const move = playBoardMove(pos, orig, dest, promotion);
	if (!move) return;

	// an existing continuation is navigated to, not duplicated
	const existing = node.children.find(
		(child) => sanKey(child.san) === sanKey(move.san),
	);
	if (existing) {
		setActivePath(existing.path);
		return;
	}

	const child = addChild(node, {
		san: move.san,
		from: move.from,
		to: move.to,
		fen: fenOf(pos),
	});
	treeChanged();
	setActivePath(child.path);
}

function choosePromotion(role: PromotionRole): void {
	const pending = promo;
	promo = null;
	if (!pending) return;
	playMove(pending.from, pending.to, role);
}
function cancelPromotion(): void {
	promo = null;
	applyPosition();
}
function fileOffset(file: string): number {
	return Math.max(0, files.indexOf(file));
}

/** The one place the cursor moves. Every navigation - a board move, a tap
      on the move list or fork, the control bar, the wheel, a context-menu jump
      - writes through here, so the sound lives here too. It is lila's `jump`
      exactly: the board sounds only on a single move forward
      (`path.length === activePath.length + 2`); stepping back, jumping to the
      start or end, and a multi-move jump are silent. */
function setActivePath(path: string): void {
	if (path.length === activePath.length + 2) {
		const root = activeRoot;
		const node = root ? findByPath(root, path) : null;
		if (node?.san) playMoveSound(node.san);
	}
	// Moving the cursor is not an edit: the snapshot stores the tree, so the
	// sync below compares the body and finds nothing to send.
	if (tab === "analysis") analysisPath = path;
	else solutionPath = path;
}

// ── navigation, as in the lichess analysis board ──────────────────────────
function first(): void {
	setActivePath("");
}
function prev(): void {
	const path = activePath;
	setActivePath(path.length >= 2 ? path.slice(0, -2) : "");
}
function next(): void {
	const child = activeNode?.children[0];
	if (child) setActivePath(child.path);
}
function last(): void {
	const root = activeRoot;
	if (root) setActivePath(mainlineEndPath(root));
}

// ── the control bar, ported from lichess's controls.ts ─────────────────────
function controlAction(e: Event): string | null {
	return (
		(e.target as HTMLElement | null)?.closest<HTMLElement>("[data-act]")
			?.dataset.act ?? null
	);
}
function clickControl(e: PointerEvent): void {
	const action = controlAction(e);
	if (action === "first") first();
	else if (action === "prev") prev();
	else if (action === "next") next();
	else if (action === "last") last();
	blurIfPrimaryClick(e);
}
function holdControl(e: PointerEvent): void {
	const action = controlAction(e);
	if (action === "prev" || action === "next") {
		repeater(() => (action === "prev" ? prev() : next()));
	} else {
		clickControl(e);
	}
}

function setStyle(next: ListStyle): void {
	listStyle = next;
	writeSetting(STYLE_KEY, next);
}

function toggleStyle(): void {
	setStyle(listStyle === "inline" ? "column" : "inline");
}



function setShowFork(next: boolean): void {
	showFork = next;
	writeBoolSetting(SHOW_FORK_KEY, next);
}

function clearAnalysis(): void {
	if (!analysisRoot.children.length) return;
	menuOpen = false;
	analysisRoot = newRoot(startFen);
	analysisPath = "";
	treeChanged();
	closeContextMenu();
}

async function resetSolvedComposition(): Promise<void> {
	if (!solutionRoot || resetBusy) return;
	// No confirmation: a reset only drops the saved solution, and the key is
	// still there to be guessed again, so it is not the one-click-irreversible
	// action the move-list deletion dialog is there to guard.
	menuOpen = false;
	resetBusy = true;
	resetMessage = "";
	try {
		const response = await fetch("/api/progress/reset", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ id: composition.id }),
		});
		if (!response.ok) throw new Error("Could not reset progress");
		solutionRoot = null;
		solutionPath = "";
		tab = "analysis";
		guess = "";
		status = "idle";
		locked = false;
		clearTimeout(verifyTimer);
	} catch {
		resetMessage = "Could not reset this composition. Please try again.";
		menuOpen = true;
	} finally {
		resetBusy = false;
	}
}

function onKeydown(e: KeyboardEvent): void {
	const target = e.target as HTMLElement | null;
	if (
		target &&
		(target.tagName === "INPUT" ||
			target.tagName === "TEXTAREA" ||
			target.isContentEditable)
	) {
		return;
	}
	if (e.shiftKey && (e.key === "I" || e.key === "i")) {
		toggleStyle();
		e.preventDefault();
		return;
	}
	switch (e.key) {
		case "ArrowLeft":
		case "k":
			prev();
			break;
		case "ArrowRight":
		case "j":
			next();
			break;
		case "ArrowUp":
		case "0":
		case "Home":
			first();
			break;
		case "ArrowDown":
		case "$":
		case "End":
			last();
			break;
		case "Escape":
			if (promo) cancelPromotion();
			menuOpen = false;
			closeContextMenu();
			return;
		default:
			return;
	}
	e.preventDefault();
}

/** Make the move under the pointer or keys active. A tap on the move list
      passes `suppressAutoScroll`, as lila's `treeView.ts` cancels its own
      auto-scroll request; the fork and the keyboard keep it. */
function activateMove(
	target: EventTarget | null,
	suppressAutoScroll = false,
): void {
	const move = (target as HTMLElement | null)?.closest<HTMLElement>(
		"[data-path]",
	);
	if (!move) return;
	const path = move.dataset.path ?? "";
	if (suppressAutoScroll && path !== activePath) skipAutoScroll = true;
	setActivePath(path);
}
function onMoveListClick(e: MouseEvent): void {
	activateMove(e.target);
}
function onMoveListKeydown(e: KeyboardEvent): void {
	if (e.key !== "Enter" && e.key !== " ") return;
	activateMove(e.target);
	e.preventDefault();
}

// ── the move list context menu (lichess `treeView/contextMenu.ts`) ─────────
function openContextMenu(
	e: MouseEvent,
	target: EventTarget | null,
	fromHold = false,
): void {
	const move = (target as HTMLElement | null)?.closest<HTMLElement>(
		"[data-path]",
	);
	// `fromHold` says the finger is still down: the menu is placed clear of it,
	// and the click its release emits is swallowed (see the swallow effect).
	contextMenu = {
		path: move?.dataset.path ?? "",
		x: e.clientX,
		y: e.clientY,
		fromHold,
	};
	pendingDeletionPath = "";
	menuTransparent = false;
	swallowReleaseClick = fromHold;
}

function closeContextMenu(): void {
	contextMenu = null;
	pendingDeletionPath = "";
	menuTransparent = false;
	swallowReleaseClick = false;
}

function promoteVariation(path: string, toMainline: boolean): void {
	const root = activeRoot;
	if (!root) return;
	promoteAt(root, path, toMainline);
	treeChanged();
	setActivePath(path);
	closeContextMenu();
}

function forceVariation(path: string): void {
	const root = activeRoot;
	if (!root) return;
	forceVariationAt(root, path, true);
	treeChanged();
	setActivePath(path);
	closeContextMenu();
}

function plural(noun: string, nb: number): string {
	return `${nb} ${nb === 1 ? noun : `${noun}s`}`;
}

async function deleteFromHere(path: string): Promise<void> {
	const root = activeRoot;
	if (!root || !path) return;
	const count = countChildrenAndComments(findByPath(root, path));
	if (count.nodes >= 10 || count.comments > 0) {
		const message =
			`Delete ${plural("move", count.nodes)}` +
			(count.comments ? ` and ${plural("comment", count.comments)}` : "") +
			"?";
		if (!(await askConfirm(message))) return;
	}
	const current = activePath;
	deleteNodeAt(root, path);
	treeChanged();
	if (current.startsWith(path)) setActivePath(path.slice(0, -2));
	closeContextMenu();
}

/** Hovering a menu row previews the moves it would affect (desktop only). */
function previewDeletion(path: string | null): void {
	if (isTouchDevice()) return;
	pendingDeletionPath = path ?? "";
	menuTransparent = path !== null;
}

// ── lichess's confirmation dialog, as a native `<dialog class="alert">` ────
let confirmMessage = $state("");
let confirmDialog: HTMLDialogElement | undefined;
let confirmResolve: ((ok: boolean) => void) | null = null;

function askConfirm(message: string): Promise<boolean> {
	confirmMessage = message;
	return new Promise<boolean>((resolve) => {
		confirmResolve = resolve;
		void tick().then(() => confirmDialog?.showModal());
	});
}

function answerConfirm(ok: boolean): void {
	confirmDialog?.close();
	const resolve = confirmResolve;
	confirmResolve = null;
	resolve?.(ok);
}

// ── claiming the key ──────────────────────────────────────────────────────
function waitForKeyTurnEnd(): Promise<number> {
	const button = keyButton;
	if (!button) return Promise.resolve(performance.now());
	return new Promise((resolve) => {
		const onAnimationEnd = (event: AnimationEvent): void => {
			if (event.animationName !== "key-turn") return;
			button.removeEventListener("animationend", onAnimationEnd);
			resolve(performance.now());
		};
		button.addEventListener("animationend", onAnimationEnd);
	});
}

function waitUntil(time: number): Promise<void> {
	const delay = time - performance.now();
	return delay > 0
		? new Promise((resolve) => setTimeout(resolve, delay))
		: Promise.resolve();
}

function markWrong(): void {
	clearTimeout(wrongTimer);
	status = "wrong";
	// the lock is held for the whole jam, not only while the class is on
	wrongTimer = setTimeout(() => {
		if (status === "wrong") status = "idle";
		locked = false;
	}, WRONG_FLASH_MS);
}

async function submitKey(e: SubmitEvent): Promise<void> {
	e.preventDefault();
	// one submit at a time: while a check is in flight or its feedback is still
	// playing, Enter is inert
	if (locked) return;
	const value = guess.trim();
	if (!value) return;
	// the reply is in: drop the caret so the box stops looking editable while
	// the verdict plays out
	keyInput?.blur();
	locked = true;
	const keyTurnEndedAt = waitForKeyTurnEnd();
	status = "checking";
	try {
		const res = await fetch("/api/key", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ id: composition.id, guess: value }),
		});
		if (!res.ok) throw new Error(`key check failed (${res.status})`);
		const data = (await res.json()) as { correct?: boolean; solution?: string };
		// Use the actual CSS animation end as the clock, then hold for the
		// existing 400 ms beat. If the Worker is slower, the verdict waits for it.
		const verdictAt = (await keyTurnEndedAt) + VERDICT_HOLD_MS;
		const isCorrect = Boolean(data.correct && data.solution);
		// Schedule the cue early by the output device's reported latency so it
		// becomes audible at the same instant the verdict is shown.
		await waitUntil(verdictAt - getSoundOutputLatencyMs());
		playSound(isCorrect ? "genericNotify" : "error");
		await waitUntil(verdictAt);
		if (isCorrect && data.solution) {
			// the key proves right: finish the turn, hold through the micropause,
			// then hand the half to the Solution tab. `solutionRoot` staying null
			// is what keeps the field mounted while the animation runs.
			const root = solutionTree(data.solution);
			solutionPath = "";
			status = "right";
			clearTimeout(verifyTimer);
			verifyTimer = setTimeout(() => {
				solutionRoot = root;
				tab = "solution";
			}, VERIFY_MS);
		} else {
			markWrong();
		}
	} catch {
		status = "idle";
		locked = false;
	}
}

function restoreSettings(): void {
	const savedStyle = readSetting(STYLE_KEY);
	if (savedStyle === "inline" || savedStyle === "column")
		listStyle = savedStyle;
	
	showFork = readBoolSetting(SHOW_FORK_KEY, showFork);
}

/** The board scale lives on `<html>` so CSS can reach it from `--sq`. */
function applyZoom(zoom: number): void {
	document.documentElement.style.setProperty("--board-zoom", String(zoom));
}

/** The board resize handle, ported from lichess's `chessgroundResize.ts`:
      dragging adds `(dx + dy) / 10` to `---zoom`. We keep that number as the
      `keymove.boardZoom` setting and let CSS turn it into a board scale. Lila
      clamps it to 0..100, so the board never grows past the size `--sq` fitted
      to the page. */
function bindResize(): (() => void) | undefined {
	const el = resizeEl;
	if (!el) return;
	// `Number(null)` is 0, which would pass the guards below and collapse the
	// board to `--board-scale`'s floor; an unset zoom has to fall back to the
	// default, the same number `--board-zoom` carries for the first paint.
	const savedZoom = readSetting(ZOOM_KEY);
	let zoom = savedZoom === null || savedZoom === "" ? NaN : Number(savedZoom);
	if (!Number.isFinite(zoom) || zoom < 0) zoom = DEFAULT_ZOOM;
	zoom = Math.min(MAX_ZOOM, zoom);
	applyZoom(zoom);

	const onDown = (e: PointerEvent): void => {
		if (e.button !== 0) return;
		e.preventDefault();
		const startX = e.clientX;
		const startY = e.clientY;
		const initial = zoom;
		document.body.classList.add("resizing");
		el.setPointerCapture(e.pointerId);

		const onMove = (m: PointerEvent): void => {
			const delta = m.clientX - startX + (m.clientY - startY);
			zoom = Math.round(Math.max(0, Math.min(MAX_ZOOM, initial + delta / 10)));
			applyZoom(zoom);
		};
		const onUp = (): void => {
			el.removeEventListener("pointermove", onMove);
			document.body.classList.remove("resizing");
			writeSetting(ZOOM_KEY, String(zoom));
		};
		el.addEventListener("pointermove", onMove);
		el.addEventListener("pointerup", onUp, { once: true });
	};

	el.addEventListener("pointerdown", onDown);
	return () => el.removeEventListener("pointerdown", onDown);
}

onMount(() => {
	restoreSettings();
	const unbindSounds = initSounds();

	const board = boardEl;
	if (!board) {
		unbindSounds();
		return;
	}

	const api = Chessground(board, {
		fen: startFen,
		orientation: "white",
		coordinates: true, // lichess-style coords inside the board, always shown
		// chessground rounds the board to whole 8-device-pixel squares and writes
		// that true size to `---cg-width`/`---cg-height` on this element. Lichess
		// points it at `document.body` and sizes the move box from it
		// (`ui/analyse/src/ground.ts`, `ui/analyse/css/_layout.scss`).
		addDimensionsCssVarsTo: document.body,
		disableContextMenu: true,
		// the corner grip is appended into chessground's `cg-container`, whose
		// size is the board's real (rounded) size, so it always sits on the
		// board's corner, not the unrounded wrapper's. This is how lila does it:
		// `ui/analyse/src/ground.ts` calls `lib/chessgroundResize.ts` from the
		// chessground `events.insert` hook, which appends `cg-resize` to
		// `elements.container`.
		events: {
			insert(elements) {
				const grip = document.createElement("div");
				grip.className = "board-resize";
				grip.title = "Resize board";
				grip.setAttribute("aria-hidden", "true");
				elements.container.appendChild(grip);
				resizeEl = grip;
			},
		},
		// lichess sets this so a small finger movement still counts as a tap
		touchIgnoreRadius: 0,
		highlight: { lastMove: true, check: true },
		animation: { enabled: true, duration: 200 },
		movable: {
			color: "both",
			free: false,
			dests: currentDests(),
			showDests: true,
			rookCastle: true,
			events: { after: onBoardMove },
		},
		premovable: { enabled: false },
		draggable: { enabled: true, showGhost: true },
		selectable: { enabled: true },
		drawable: { enabled: true, visible: true },
		trustAllEvents: true,
	});
	cg = api;

	// chessground observes its own wrap (ResizeObserver) and realigns the
	// pieces when the fluid board changes size. api.redrawAll() is a full DOM
	// rebuild, because calling it on resize tore the board down on every load.

	// the corner grip that resizes the board
	const unbindResize = bindResize();

	// the jump buttons: tap to step, hold to repeat (lichess's pointer.ts)
	if (jumpsEl)
		addPointerListeners(jumpsEl, { click: clickControl, hold: holdControl });

	// A real click listener on the bar is a hit-test marker, not a handler:
	// the buttons are driven by pointerup. WebKit arms double-tap-zoom from
	// the node that responds to click events: a disabled button is skipped and
	// pointer listeners do not count, so without this the search climbs out of
	// `.nav` to Astro's `display: contents` `astro-island`, whose empty box
	// leaves the gesture armed. With it, the search stops inside `.nav`'s
	// touch-action and disarms the gesture, as it does for the Analysis tab.
	if (navEl) navEl.addEventListener("click", () => {});

	// the move list: right-click opens the context menu, and a primary
	// pointerup navigates, as lila's treeView does. On touch a long press
	// opens it (`addPointerListeners`); Android's native `contextmenu` from
	// that same long press is caught here too. Lichess also binds `dblclick`,
	// but that event is mouse-only in WebKit and the first tap of a pair moves
	// the list under the second (navigation, the continuation row reflowing),
	// so this port keeps the hold gesture alone.
	const list = listEl;
	const onListPointerUp = (e: PointerEvent): void => {
		if (!(e.target instanceof HTMLElement) || e.button !== 0) return;
		activateMove(e.target, true); // a tap must not scroll (lila's treeView)
	};
	if (list) {
		// lila's `ctxMenuCallback`: it returns false, which cancels the event's
		// default action: the native context menu on desktop, and on touch the
		// one Android raises from the long press.
		const openCtxMenu = (e: MouseEvent): void => {
			e.preventDefault();
			// on touch this came from a press whose release may emit a click
			openContextMenu(e, e.target, isTouchDevice());
		};
		list.oncontextmenu = openCtxMenu;
		list.addEventListener("pointerup", onListPointerUp);
		if (isTouchDevice()) {
			// unlike lila's list this one runs `touch-action: manipulation`, whose
			// long-press release can emit a click that would close the menu again
			addPointerListeners(list, {
				hold: (e: PointerEvent) => openContextMenu(e, e.target, true),
			});
		}
	}

	// Wheel over the board always steps through the moves, as lichess does (lila's `stepwiseScroll`).
	const mac =
		navigator.userAgent.toLowerCase().includes("macintosh") &&
		!("ontouchstart" in window);
	let accumulated = 0;
	const onWheel = (e: WheelEvent): void => {
		if (e.ctrlKey) return; // trackpad pinch-zoom
		const tag = (e.target as HTMLElement | null)?.tagName ?? "";
		if (!["PIECE", "SQUARE", "CG-BOARD"].includes(tag)) return;
		e.preventDefault();
		if (e.deltaMode === 0) {
			accumulated += e.deltaY;
			if (mac && Math.abs(accumulated) < 10) return;
		}
		accumulated = 0;
		if (e.deltaY > 0) next();
		else if (e.deltaY < 0) prev();
	};
	board.addEventListener("wheel", onWheel, { passive: false });

	const onKey = (e: KeyboardEvent) => onKeydown(e);
	// The timed sync is the only condition while the page lives. Leaving is
	// the second: a hidden tab and a closing tab are both moments this code may
	// never run again from, so the pending tree goes at once.
	const onPageHide = () => flushAnalysisOnUnload();
	const onVisibilityChange = () => {
		if (document.visibilityState === "hidden") flushAnalysisOnUnload();
	};
	window.addEventListener("keydown", onKey);
	window.addEventListener("pagehide", onPageHide);
	document.addEventListener("visibilitychange", onVisibilityChange);
	return () => {
		window.removeEventListener("keydown", onKey);
		window.removeEventListener("pagehide", onPageHide);
		document.removeEventListener("visibilitychange", onVisibilityChange);
		flushAnalysisOnUnload();
		board.removeEventListener("wheel", onWheel);
		if (list) list.removeEventListener("pointerup", onListPointerUp);
		clearTimeout(wrongTimer);
		clearTimeout(verifyTimer);
		unbindResize?.();
		unbindSounds();
		api.destroy();
	};
});
</script>

<div class="work">
  <div class="boardcol">
  <figure class="diagram">
    <div class="board-frame">
      <div class="cg-wrap" bind:this={boardEl}></div>

      {#if promo}
        <button class="promo-backdrop" type="button" aria-label="Cancel promotion" onclick={cancelPromotion}></button>
        <div class="promo cg-wrap">
          {#each PROMOTION_ROLES as role, i}
            <button
              class="promo__piece"
              type="button"
              aria-label={role}
              style="top: {promo.color === 'w'
                ? i * 12.5
                : (7 - i) * 12.5}%; left: {fileOffset(promo.file) * 12.5}%"
              onclick={() => choosePromotion(role)}
            >
              <piece class="{role} {promo.color === 'w' ? 'white' : 'black'}"></piece>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </figure>
  </div>

  <div class="movecol">
    <div class="tools">
      <div class="panel">
      <!-- One strip for both states. Before the key it splits in the middle:
           the Analysis tab on the left, the one-move field in the half the
           Solution tab will take. On a correct guess the field fades out and
           the Solution tab fades in, each keeping its half, so the divider
           never moves. -->
      <div class="tabbar" class:tabbar--solved={!!solutionRoot}>
        <button class="tab" class:tab--on={tab === 'analysis'} type="button" onclick={() => (tab = 'analysis')}>
          Analysis
        </button>
        <form
          class="key key--tab"
          class:key--wrong={status === 'wrong'}
          class:key--checking={status === 'checking'}
          class:key--verify={status === 'right'}
          inert={!!solutionRoot}
          onsubmit={submitKey}
        >
          <div class="key__field">
            <input
              class="key__input"
              id="key"
              bind:this={keyInput}
              value={guess}
              oninput={(e) => (guess = e.currentTarget.value)}
              autocomplete="off"
              spellcheck="false"
              maxlength="7"
              placeholder="Key move"
              aria-label="Key move"
            />
          </div>
          <!-- The mark is the submit button, but a click lands the caret in the
               field: at rest that is what you want from it, and with a move
               typed the form still submits. Preventing the mousedown default
               keeps the button itself from taking focus. -->
          <button
            class="key__go"
            type="submit"
            bind:this={keyButton}
            aria-label="Check the key move"
            disabled={status === 'checking' || status === 'right'}
            onmousedown={(e) => e.preventDefault()}
            onclick={() => keyInput?.focus()}
          >
            <!-- U+26B7 CHIRON, the key whose bit is a K, mirrored so the bow
                 sits at the top and the K forms the bit; the same vector as
                 public/keymark.svg. -->
            <svg class="km" viewBox="45 -705 410 830" aria-hidden="true">
              <path
                transform="translate(0,-582) scale(1,-1)"
                fill="currentColor"
                d="M236 115C334 115 414 36 414 -63C414 -151 350 -226 266 -240V-432L415 -334L445 -381L266 -497V-500L445 -616L415 -663L266 -565V-697H208V-241C119 -228 55 -152 55 -63C55 36 135 115 236 115ZM236 57C167 57 113 3 113 -63C113 -132 167 -186 236 -186C301 -186 356 -132 356 -63C356 4 302 57 236 57Z"
              />
            </svg>
          </button>
        </form>
        <button
          class="tab tab--sol"
          class:tab--on={tab === 'solution'}
          type="button"
          onclick={() => (tab = 'solution')}
        >
          Solution
        </button>
      </div>

      <div class="ml" bind:this={listEl} onkeydown={onMoveListKeydown}>
        <!-- eslint-disable-next-line svelte/no-at-html-tags -- our own rendered tree -->
        {@html moveListHtml}
      </div>

      {#if forkHtml}
        <div
          class="analyse__fork"
          role="group"
          aria-label="Continuations"
          onclick={onMoveListClick}
          onkeydown={onMoveListKeydown}
        >
          <!-- eslint-disable-next-line svelte/no-at-html-tags -- our own rendered fork -->
          {@html forkHtml}
        </div>
      {/if}

      {#if tab === 'solution' && solutionRoot && canRate}
        <!-- Four buttons and nothing else. The Solution tab is where a rating
             can be judged: the notation is on screen and the key is known good,
             so the strip is here and never on the Analysis tab. Pressing the
             level that is already set clears it, so there is no fifth button
             whose only job is undoing, and the selected button is the record:
             there is no value printed beside the row. The tile carrying the
             corpus's own curated level is marked underneath, so the two ratings
             can be compared without a word: the mark is the corpus, the fill is
             the admin. Admin-only, and the only thing on the page that shows a
             rating or a flag.

             The flag leads the row, at the very left, and is not one of the
             three: it has no levels to choose among, only the three states a
             flag can be in, so it is a cycle rather than a choice. The label
             names the state and the tooltip names the next one, because a tile
             that only said where it is would make every press a guess. Flagged,
             it turns grey: the quietest signal in the row, since a flag is a
             note to self rather than a difficulty. -->
        <div class="rate" role="group" aria-label="Composition curation">
          <button
            class="rate__flag"
            class:rate__flag--on={!!flagged}
            type="button"
            disabled={curationBusy}
            aria-pressed={!!flagged}
            title={flagged
              ? `Flagged as “${flagReasonLabel(flagged)}” — press to ${nextFlagLabel()}`
              : `No flag — press to ${nextFlagLabel()}`}
            onclick={cycleFlag}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M14.4 6 14 4H5v17h2v-7h5.6l.4 2h7V6Z" />
            </svg>
            <span>{flagged ? flagReasonLabel(flagged) : 'Flag'}</span>
          </button>
          {#each LEVELS as level (level)}
            <button
              class="rate__level"
              class:rate__level--easy={level === 'easy'}
              class:rate__level--medium={level === 'medium'}
              class:rate__level--hard={level === 'hard'}
              class:rate__level--curated={curatedRating === level}
              class:rate__level--on={rating === level}
              type="button"
              disabled={curationBusy}
              aria-pressed={rating === level}
              aria-label={curatedRating === level
                ? `${levelLabel(level)} — the corpus rates this ${level}`
                : undefined}
              title={curatedRating === level
                ? `Rate this composition ${level} (the corpus rates it ${level})`
                : `Rate this composition ${level}`}
              onclick={() => void saveCuration('rating', rating === level ? null : level)}
            >
              {levelLabel(level)}
            </button>
          {/each}
          {#if curationError}<p class="rate__status" role="status">{curationError}</p>{/if}
        </div>
      {/if}

      <div class="puzzle">
        <div class="puzzle__goal-row">
          <p class="puzzle__goal">{taskFor(composition)}</p>
          {#if signedIn}
            <button
              class="puzzle__bookmark"
              class:puzzle__bookmark--on={bookmarked}
              type="button"
              aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark this composition'}
              aria-pressed={bookmarked}
              title={bookmarked ? 'Remove bookmark' : 'Bookmark this composition'}
              disabled={bookmarkBusy}
              onclick={() => void toggleBookmark()}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m12 2.5 2.9 5.88 6.49.94-4.7 4.58 1.11 6.47L12 17.31l-5.8 3.06 1.11-6.47-4.7-4.58 6.49-.94L12 2.5Z" />
              </svg>
            </button>
          {/if}
        </div>
        {#if bookmarkMessage}<p class="puzzle__bookmark-status" role="status">{bookmarkMessage}</p>{/if}
        <p class="puzzle__credit" title={creditDetail(composition)}>
          {#if composition.composer}<b>{composition.composer}</b>{:else}<i>Anonymous</i>{/if}
          {composition.year ? ` · ${composition.year}` : ''}
        </p>
      </div>
      </div>
    </div>

    <div class="nav" bind:this={navEl}>
        <div class="jumps" bind:this={jumpsEl}>
          <button
            class="fbt move"
            type="button"
            data-act="first"
            data-icon={licon.JumpFirst}
            title="First move"
            disabled={atStart}
          ></button>
          <button
            class="fbt move"
            type="button"
            data-act="prev"
            data-icon={licon.LessThan}
            title="Previous move"
            disabled={atStart}
          ></button>
          <button
            class="fbt move"
            type="button"
            data-act="next"
            data-icon={licon.GreaterThan}
            title="Next move"
            disabled={!canAdvance}
          ></button>
          <button
            class="fbt move"
            type="button"
            data-act="last"
            data-icon={licon.JumpLast}
            title="Last move"
            disabled={atEnd}
          ></button>
        </div>
        <span class="nav__spacer"></span>
        <button
          class="fbt nav__burger"
          class:active={menuOpen}
          type="button"
          data-icon={licon.Hamburger}
          title="Settings"
          aria-label="Settings"
          aria-expanded={menuOpen}
          onclick={() => (menuOpen = !menuOpen)}
        ></button>

        {#if menuOpen}
          <button
            class="menu-backdrop"
            type="button"
            aria-label="Close settings"
            onclick={() => (menuOpen = false)}
          ></button>
          <div class="menu" role="dialog" aria-label="Settings">
            {#if playNextHref}
              <a
                class="menu__row menu__action menu__link"
                href={playNextHref}
                aria-label={playNextLabel}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 3.5v17L20 12z" fill="currentColor" />
                </svg>
                <span>{playNextLabel}</span>
              </a>
            {:else}
              <button
                class="menu__row menu__action"
                type="button"
                disabled
                aria-label="Next composition unavailable: all compositions in this collection are solved"
                title="All compositions in this collection are solved"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 3.5v17L20 12z" fill="currentColor" />
                </svg>
                <span>{playNextLabel}</span>
              </button>
            {/if}
            <div class="menu__separator" aria-hidden="true"></div>
            
            <label class="menu__row">
              <input
                type="checkbox"
                checked={listStyle === 'inline'}
                onchange={(e) => setStyle(e.currentTarget.checked ? 'inline' : 'column')}
              />
              <span>Inline moves</span>
            </label>
            <label class="menu__row">
              <input
                type="checkbox"
                checked={showFork}
                onchange={(e) => setShowFork(e.currentTarget.checked)}
              />
              <span>Variation row</span>
            </label>
            {#if tab === 'analysis'}
              <button
                class="menu__row menu__action"
                type="button"
                data-icon={licon.Trash}
                disabled={!analysisRoot.children.length}
                onclick={() => void clearAnalysis()}
              >
                Clear all moves
              </button>
            {:else if solutionRoot}
              <button
                class="menu__row menu__action"
                type="button"
                disabled={resetBusy}
                onclick={() => void resetSolvedComposition()}
              >
                <svg class="menu__reset-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 12a9 9 0 1 0 2.64-6.36L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
                <span>Reset to unsolved</span>
              </button>
              {#if resetMessage}<p class="menu__message" role="status">{resetMessage}</p>{/if}
            {/if}
          </div>
        {/if}
      </div>
  </div>

  {#if menu}
    {@const path = menu.path}
    <div
      id="analyse-cm"
      class:transparent={menuTransparent}
      bind:this={menuEl}
      style="left: {menu.x}px; top: {menu.y}px"
      role="menu"
      tabindex="-1"
      aria-label={menu.title}
      oncontextmenu={(e) => e.preventDefault()}
    >
      <p class="title">
        <!-- eslint-disable-next-line svelte/no-at-html-tags -- our own SAN -->
        {@html moveSan(menu.title)}
      </p>
      {#if menu.canPromote}
        <button
          class="context-menu__item"
          role="menuitem"
          type="button"
          data-icon={licon.UpTriangle}
          onclick={() => promoteVariation(path, false)}
        >
          Promote variation
        </button>
      {/if}
      {#if menu.canMakeMainLine}
        <button
          class="context-menu__item"
          role="menuitem"
          type="button"
          data-icon={licon.Checkmark}
          onclick={() => promoteVariation(path, true)}
        >
          Make main line
        </button>
      {/if}
      {#if menu.canForceVariation}
        <button
          class="context-menu__item"
          role="menuitem"
          type="button"
          data-icon={licon.InternalArrow}
          onclick={() => forceVariation(path)}
        >
          Convert to variation
        </button>
      {/if}
      {#if menu.canDelete}
        <button
          class="context-menu__item"
          role="menuitem"
          type="button"
          data-icon={licon.Trash}
          onclick={() => void deleteFromHere(path)}
          onmouseenter={() => previewDeletion(path)}
          onmouseleave={() => previewDeletion(null)}
        >
          Delete from here
        </button>
      {/if}
    </div>
  {/if}

  <dialog class="alert" bind:this={confirmDialog} oncancel={() => answerConfirm(false)}>
    <div class="dialog-content alert">
      <p>{confirmMessage}</p>
      <span>
        <button class="fbt" type="button" onclick={() => answerConfirm(false)}>Cancel</button>
        <button class="fbt" type="button" onclick={() => answerConfirm(true)}>OK</button>
      </span>
    </div>
  </dialog>
</div>
