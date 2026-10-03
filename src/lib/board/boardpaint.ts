/**
 * Board paint: brightness and contrast, plus an optional Lichess grey board.
 *
 * Brightness and contrast filter the checkerboard layer only. Grain is a
 * boolean that switches that paint to Lichess's own `grey.jpg` board image;
 * no filter or noise effect is applied to pieces or tile boundaries.
 */
import {
	readBoolSetting,
	readSetting,
	writeBoolSetting,
	writeSetting,
} from "../storage";

export type BoardPaint = "brightness" | "contrast";

/** The brightness/contrast sliders' ranges, in percent. */
export const BOARD_RANGES: Record<BoardPaint, { min: number; max: number }> = {
	brightness: { min: 40, max: 105 },
	contrast: { min: 80, max: 120 },
};

/**
 * A first visitor lands on each slider's midpoint, so the thumb sits at
 * ~50% of its track and the board reads a touch darker than plain white. The
 * values are derived from the ranges, so re-ranging keeps them centred.
 */
export const DEFAULT_BOARD_PAINT: Record<BoardPaint, number> = {
	brightness: Math.round((BOARD_RANGES.brightness.min + BOARD_RANGES.brightness.max) / 2),
	contrast: Math.round((BOARD_RANGES.contrast.min + BOARD_RANGES.contrast.max) / 2),
};

/** Lichess's grey board image is enabled unless the reader turns it off. */
const DEFAULT_BOARD_GRAIN = true;

const STORAGE_KEY: Record<BoardPaint, string> = {
	brightness: "boardBrightness",
	contrast: "boardContrast",
};

function clamp(paint: BoardPaint, value: number): number {
	const { min, max } = BOARD_RANGES[paint];
	return Math.min(max, Math.max(min, Math.round(value)));
}

/** The remembered value for one paint, clamped to its range. */
export function storedBoardPaint(paint: BoardPaint): number {
	const raw = readSetting(STORAGE_KEY[paint]);
	if (raw === null || raw === "") return DEFAULT_BOARD_PAINT[paint];
	const value = Number(raw);
	return Number.isFinite(value) ? clamp(paint, value) : DEFAULT_BOARD_PAINT[paint];
}

/** Paint one value onto `<html>`; returns the clamped value. */
function applyBoardPaint(
	paint: BoardPaint,
	value: number,
	root: HTMLElement = document.documentElement,
): number {
	const clamped = clamp(paint, value);
	root.style.setProperty(`--board-${paint}`, String(clamped));
	return clamped;
}

export function storedBoardGrain(): boolean {
	return readBoolSetting("boardGrain", DEFAULT_BOARD_GRAIN);
}

/** Toggle the real Lichess grey board image on `<html>`. */
function applyBoardGrain(
	enabled: boolean,
	root: HTMLElement = document.documentElement,
): boolean {
	root.classList.toggle("board-grain", enabled);
	return enabled;
}

/** Apply a value and remember it. */
export function setBoardPaint(paint: BoardPaint, value: number): number {
	const clamped = applyBoardPaint(paint, value);
	writeSetting(STORAGE_KEY[paint], String(clamped));
	return clamped;
}

/** Toggle the Lichess board texture and remember the choice. */
export function setBoardGrain(enabled: boolean): boolean {
	const applied = applyBoardGrain(enabled);
	writeBoolSetting("boardGrain", applied);
	return applied;
}
