/**
 * Piece sets.
 *
 * A set is a directory of twelve SVGs under src/assets/piece/<id>/:
 *
 *     wP.svg wN.svg wB.svg wR.svg wQ.svg wK.svg
 *     bP.svg bN.svg bB.svg bR.svg bQ.svg bK.svg
 *
 * Dropping that directory in is all it takes to add a set, because the glob
 * below finds it. A set becomes selectable once it is listed in REGISTRY.
 *
 * Rendering is by indirection: styles/pieces.css paints every piece from a
 * custom property and never names a file, so applying a set is only ever a
 * matter of redefining the twelve ---<color>-<role> values. There is no
 * per-set stylesheet to keep in sync.
 *
 * This mirrors lichess (ui/lib/css/theme/_pieces.scss + ui/dasher/src/piece.ts).
 */

import { readSetting, writeSetting } from "../storage";

const files = import.meta.glob("../../assets/piece/*/*.svg", {
	eager: true,
	query: "?url",
	import: "default",
}) as Record<string, string>;

type Color = "white" | "black";
type Role = "pawn" | "knight" | "bishop" | "rook" | "queen" | "king";

const COLORS: Color[] = ["white", "black"];
const ROLES: Role[] = ["pawn", "knight", "bishop", "rook", "queen", "king"];
const FILE: Record<Color, string> = { white: "w", black: "b" };
const CODE: Record<Role, string> = {
	pawn: "P",
	knight: "N",
	bishop: "B",
	rook: "R",
	queen: "Q",
	king: "K",
};

export interface PieceSet {
	id: string;
	label: string;
	/** file URLs keyed `white-pawn` … `black-king` */
	urls: Record<string, string>;
}

/** The sets that are offered. The only hand-maintained list. */
const REGISTRY: { id: string; label: string }[] = [
	{ id: "leipzig", label: "Leipzig" },
	{ id: "alpha", label: "Alpha" },
	{ id: "caliente", label: "Caliente" },
];

export const DEFAULT_PIECE_SET = "alpha";

const STORAGE_KEY = "pieceSet";
/** The URLs of the last applied set, cached for the pre-paint script in Base.astro. */
const VARS_KEY = "pieceVars";

function load(id: string): Record<string, string> {
	const urls: Record<string, string> = {};
	for (const color of COLORS) {
		for (const role of ROLES) {
			const path = `../../assets/piece/${id}/${FILE[color]}${CODE[role]}.svg`;
			const url = files[path];
			if (!url) throw new Error(`piece set "${id}" is missing ${path}`);
			urls[`${color}-${role}`] = url;
		}
	}
	return urls;
}

export const PIECE_SETS: PieceSet[] = REGISTRY.map((set) => ({
	...set,
	urls: load(set.id),
}));

if (!PIECE_SETS.some((set) => set.id === DEFAULT_PIECE_SET)) {
	throw new Error(
		`default piece set "${DEFAULT_PIECE_SET}" is not in REGISTRY`,
	);
}

export function isPieceSet(id: string | null): boolean {
	return id != null && PIECE_SETS.some((set) => set.id === id);
}

/** Redefine the twelve ---<color>-<role> variables; the stylesheet does the rest. */
export function applyPieceSet(
	id: string,
	root: HTMLElement = document.documentElement,
): string {
	const set =
		PIECE_SETS.find((s) => s.id === id) ??
		PIECE_SETS.find((s) => s.id === DEFAULT_PIECE_SET)!;
	for (const [key, url] of Object.entries(set.urls)) {
		root.style.setProperty(`---${key}`, `url("${url}")`);
	}
	// cache the URLs so the pre-paint script can restore this set on the next load
	writeSetting(VARS_KEY, JSON.stringify(set.urls));
	return set.id;
}

/** The remembered set, or the default. */
export function storedPieceSet(): string {
	const saved = readSetting(STORAGE_KEY);
	return saved !== null && isPieceSet(saved) ? saved : DEFAULT_PIECE_SET;
}

/** Apply a set and remember it. Unknown ids fall back to the default. */
export function setPieceSet(id: string, root?: HTMLElement): string {
	const chosen = applyPieceSet(id, root);
	writeSetting(STORAGE_KEY, chosen);
	return chosen;
}
