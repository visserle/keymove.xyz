/**
 * The dasher: the header's gear.
 *
 * Ported from lila's `ui/dasher/`, but flattened. Lila opens a dropdown
 * (`#top .dasher .toggle` + `#dasher_app.dropdown`,
 * `modules/web/src/main/ui/layout.scala`) whose default pane lists sub-panes
 * (`ui/dasher/src/links.ts`), each opening behind a back header
 * (`ui/dasher/src/util.ts`); the toggle reopens on that list
 * (`DasherCtrl.close`). Keymove shows every control on one surface instead:
 * theme, piece set, board paint and sound. There are no modes to switch and no
 * back headers to return through.
 *
 * Lila renders its dasher with snabbdom from `/dasher` JSON, and gives sound an
 * on/off selector *beside* its volume (`ui/dasher/src/sound.ts`). Keymove has no
 * such round-trip. The panel is rendered from the build-time registries in
 * Base.astro and this module only wires it: the selection marks, the sliders, the
 * mute toggle and open/close. Sound is one volume preference whose zero is mute,
 * so the selector folded into the slider.
 *
 * Applying a stored setting is not this module's job. The pre-paint script in
 * Base.astro is the one place a stored value reaches the document; this one reads
 * the same values to paint its own controls, and writes through `setX` only when
 * the user changes one.
 */
import {
	setBoardGrain,
	setBoardPaint,
	storedBoardGrain,
	storedBoardPaint,
	type BoardPaint,
} from "./board/boardpaint";
import {
	PIECE_SETS,
	setPieceSet,
	storedPieceSet,
} from "./board/piecesets";
import { getVolume, playSound, setVolume } from "./sound";
import {
	applyTheme,
	isTheme,
	prefersLightThemeQuery,
	setTheme,
	storedTheme,
} from "./theme";

/** A selected option carries this class; the list shows a checkmark on it. */
const ACTIVE = "active";

/** How long a volume dart is held between samples, as lila's `SoundCtrl.volume`. */
const VOLUME_SAMPLE_MS = 150;

/** What the mute toggle restores when no audible level has been heard yet. */
const VOLUME_FALLBACK = 0.7;

export function initDasher(): void {
	// Nothing is applied to the document here. The pre-paint script in Base.astro
	// is the one place a stored setting reaches `<html>`. It runs before first
	// paint, on every load, and it covers theme, piece set, board paint and zoom.
	// This function reads the same stored values for one purpose only: painting
	// the panel's controls to match. `applyTheme` and friends below are reached
	// from the user's own clicks, which is the only thing that should apply a
	// setting after the pre-paint script has run.

	// `system` follows the device for as long as it stays selected (lila's
	// `ThemeCtrl.apply` + the `prefersLightThemeQuery` listener in topBar).
	prefersLightThemeQuery().addEventListener("change", () => {
		if (storedTheme() === "system") applyTheme("system");
	});

	const dasher = document.getElementById("dasher");
	const toggle = document.getElementById("dasher-toggle");
	const app = document.getElementById("dasher-app");
	if (!dasher || !toggle || !app) return;

	const isOpen = (): boolean => dasher.classList.contains("shown");

	const setOpen = (open: boolean): void => {
		dasher.classList.toggle("shown", open);
		toggle.setAttribute("aria-expanded", String(open));
	};

	// ── the selectors ────────────────────────────────────────────────────────
	/** Tick the row that stands for the current setting, as lila's panes do. */
	const mark = (selector: string, current: string): void => {
		for (const row of app.querySelectorAll<HTMLElement>(selector)) {
			const on = (row.dataset.theme ?? row.dataset.piece) === current;
			row.classList.toggle(ACTIVE, on);
			row.setAttribute("aria-pressed", String(on));
		}
	};

	// ── the sliders ──────────────────────────────────────────────────────────
	for (const paint of ["brightness", "contrast"] as BoardPaint[]) {
		const input = app.querySelector<HTMLInputElement>(`[data-board-${paint}]`);
		if (!input) continue;
		input.value = String(storedBoardPaint(paint));
		input.addEventListener("input", () =>
			setBoardPaint(paint, Number(input.value)),
		);
	}

	const grainInput = app.querySelector<HTMLInputElement>("[data-board-grain]");
	if (grainInput) {
		grainInput.checked = storedBoardGrain();
		grainInput.addEventListener("change", () =>
			setBoardGrain(grainInput.checked),
		);
	}

	// ── the volume: one slider, zero being mute ──────────────────────────────
	const volumeInput = app.querySelector<HTMLInputElement>(
		"[data-sound-volume]",
	);
	const volumeWrap = app.querySelector<HTMLElement>(".volume");
	const muteButton = app.querySelector<HTMLButtonElement>("[data-mute]");
	let lastVolume = getVolume() || VOLUME_FALLBACK;
	let lastVolumeSample = 0;

	const paintVolume = (): void => {
		const volume = getVolume();
		if (volume > 0) lastVolume = volume;
		if (volumeInput) volumeInput.value = String(volume);
		const muted = volume === 0;
		volumeWrap?.classList.toggle("is-muted", muted);
		muteButton?.setAttribute("aria-pressed", String(muted));
	};

	volumeInput?.addEventListener("input", () => {
		setVolume(Number(volumeInput.value));
		paintVolume();
		// hear the level while dragging, throttled, as lila's `SoundCtrl.volume`
		const now = performance.now();
		if (now - lastVolumeSample < VOLUME_SAMPLE_MS) return;
		lastVolumeSample = now;
		playSound("move");
	});

	toggle.addEventListener("click", () => setOpen(!isOpen()));

	app.addEventListener("click", (event) => {
		const row = (event.target as HTMLElement).closest<HTMLElement>(
			"[data-theme], [data-piece], [data-mute]",
		);
		if (!row) return;
		const { dataset } = row;
		if (isTheme(dataset.theme)) {
			setTheme(dataset.theme);
			mark("[data-theme]", storedTheme());
		} else if (
			dataset.piece &&
			PIECE_SETS.some((set) => set.id === dataset.piece)
		) {
			setPieceSet(dataset.piece);
			mark("[data-piece]", storedPieceSet());
		} else if (row.hasAttribute("data-mute")) {
			const unmuting = getVolume() === 0;
			setVolume(unmuting ? lastVolume : 0);
			paintVolume();
			// hear the choice, as lila's sound pane does (`SoundCtrl.set`)
			if (unmuting) playSound("confirmation");
		}
	});

	document.addEventListener("click", (event) => {
		if (
			isOpen() &&
			event.target instanceof Element &&
			!event.target.closest(".dasher")
		) {
			setOpen(false);
		}
	});

	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && isOpen()) {
			setOpen(false);
			toggle.focus();
		}
	});

	mark("[data-theme]", storedTheme());
	mark("[data-piece]", storedPieceSet());
	paintVolume();
}
