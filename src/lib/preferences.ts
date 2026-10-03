import { BOARD_RANGES, DEFAULT_BOARD_PAINT } from "./board/boardpaint";
import { DEFAULT_PIECE_SET, PIECE_SETS } from "./board/piecesets";
import { THEMES } from "./theme";

/** The signed-in account's saved preferences. */
export interface AccountPreferences {
	theme: (typeof THEMES)[number];
	pieceSet: string;
	boardBrightness: number;
	boardContrast: number;
	boardGrain: boolean;
	soundVolume: number;
	boardZoom: number;
	moveListStyle: "inline" | "column";
	showFork: boolean;
	hideSolved: boolean;
}

/**
 * The zoom a first visit opens the solving board at, on lila's 0..100 scale.
 *
 * Lila's own default is 100: the board exactly as `--sq` fitted it, which fills
 * the viewport and reads a shade too big for a first look here. The home page's
 * board is 85% of that fit (`--sq` in layout.css), so 75 lands just under it —
 * the same board, a touch smaller, and the resize grip still reaches 100.
 *
 * `--board-zoom` in styles/tokens.css carries the same number for the first
 * paint, before any script runs; keep the two in step.
 */
export const DEFAULT_BOARD_ZOOM = 75;

export const DEFAULT_ACCOUNT_PREFERENCES: AccountPreferences = {
	theme: "system",
	pieceSet: DEFAULT_PIECE_SET,
	boardBrightness: DEFAULT_BOARD_PAINT.brightness,
	boardContrast: DEFAULT_BOARD_PAINT.contrast,
	boardGrain: true,
	soundVolume: 0.7,
	boardZoom: DEFAULT_BOARD_ZOOM,
	moveListStyle: "inline",
	showFork: false,
	hideSolved: false,
};

/**
 * Validate a stored or submitted preference blob.
 *
 * `showFork` and `hideSolved` postdate the first snapshots, so they fall back to
 * `false` when a snapshot predates them.
 */
export function parseAccountPreferences(
	value: unknown,
): AccountPreferences | null {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return null;
	const record = value as Record<string, unknown>;
	const brightness = record.boardBrightness;
	const contrast = record.boardContrast;
	const volume = record.soundVolume;
	const zoom = record.boardZoom;
	// a snapshot saved before one of these preferences existed keeps its default
	const showFork = record.showFork ?? false;
	const hideSolved = record.hideSolved ?? false;
	if (
		typeof record.theme !== "string" ||
		!(THEMES as readonly string[]).includes(record.theme) ||
		typeof record.pieceSet !== "string" ||
		!PIECE_SETS.some((pieceSet) => pieceSet.id === record.pieceSet) ||
		typeof brightness !== "number" ||
		!Number.isInteger(brightness) ||
		brightness < BOARD_RANGES.brightness.min ||
		brightness > BOARD_RANGES.brightness.max ||
		typeof contrast !== "number" ||
		!Number.isInteger(contrast) ||
		contrast < BOARD_RANGES.contrast.min ||
		contrast > BOARD_RANGES.contrast.max ||
		typeof record.boardGrain !== "boolean" ||
		typeof volume !== "number" ||
		!Number.isFinite(volume) ||
		volume < 0 ||
		volume > 1 ||
		typeof zoom !== "number" ||
		!Number.isInteger(zoom) ||
		zoom < 0 ||
		zoom > 100 ||
		(record.moveListStyle !== "inline" && record.moveListStyle !== "column") ||
		typeof showFork !== "boolean" ||
		typeof hideSolved !== "boolean"
	)
		return null;

	return {
		theme: record.theme as AccountPreferences["theme"],
		pieceSet: record.pieceSet,
		boardBrightness: brightness,
		boardContrast: contrast,
		boardGrain: record.boardGrain,
		soundVolume: volume,
		boardZoom: zoom,
		moveListStyle: record.moveListStyle,
		showFork,
		hideSolved,
	};
}
