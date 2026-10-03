/**
 * Pointer handling ported from `lichess-org/lila`:
 * `ui/lib/src/pointer.ts` and `ui/lib/src/common.ts`.
 *
 * `addPointerListeners` lets a control bar both fire on a tap and repeat while
 * held, while still allowing the page to scroll when the finger moves
 * vertically. `repeater` is the accelerating repeat lila uses for its
 * previous/next buttons.
 */

export const isTouchDevice = (): boolean =>
	!window.matchMedia("(hover: hover) and (pointer: fine)").matches;

export type PointerListeners = {
	click?: (e: PointerEvent) => void;
	hold?: "click" | ((e: PointerEvent) => void);
	holdDuration?: number;
};

export function addPointerListeners(
	el: HTMLElement,
	listeners: PointerListeners,
): void {
	const { click, hold } = listeners;
	const g = { timer: 0, y: 0 };
	const holdDuration = listeners.holdDuration ?? 500;

	const reset = (e: PointerEvent): void => {
		clearTimeout(g.timer);
		el.releasePointerCapture(e.pointerId);
		el.removeEventListener("pointermove", pointermove);
		g.y = g.timer = 0;
	};

	const pointerdown = (e: PointerEvent): void => {
		g.y = e.clientY;
		g.timer = window.setTimeout(() => {
			if (!hold) return;
			if (hold === "click") click?.(e);
			else hold(e);
			reset(e);
		}, holdDuration);
		el.addEventListener("pointermove", pointermove, { passive: false });
	};

	const pointermove = (e: PointerEvent): void => {
		const dy = e.clientY - g.y;
		// biome-ignore lint/correctness/noVoidTypeReturn: lila writes `return reset(e)`; kept verbatim so this port stays diffable against upstream.
		if (Math.abs(dy) > 12) return reset(e); // the page is scrolling
	};

	const pointerup = (e: PointerEvent): void => {
		if (g.timer && click) click(e);
		reset(e);
		e.preventDefault();
	};

	el.addEventListener("pointerup", pointerup, { passive: false });
	el.addEventListener("pointerdown", pointerdown, { passive: true });
	el.addEventListener("pointercancel", reset, { passive: true });

	if (isTouchDevice() && hold) {
		el.addEventListener("contextmenu", (e) => e.preventDefault(), {
			passive: false,
		});
	}
}

/** Repeats `f` with lila's acceleration: 500ms, then ~350ms, then faster. */
export function repeater(
	f: () => void,
	additionalStopCond?: () => boolean,
): void {
	let timeout: number | undefined;
	const delay = (function* () {
		yield 500;
		for (let d = 350; ; ) {
			// biome-ignore lint/suspicious/noAssignInExpressions: lila writes the decay inside Math.max; kept verbatim so this port stays diffable against upstream.
			yield Math.max(100, (d *= 14 / 15));
		}
	})();
	const repeat = (): void => {
		f();
		timeout = window.setTimeout(repeat, delay.next().value);
		if (additionalStopCond?.()) clearTimeout(timeout);
	};
	repeat();
	document.addEventListener("pointerup", () => clearTimeout(timeout), {
		once: true,
	});
}

/** Keeps the clicked button from taking focus on a primary mouse click. */
export function blurIfPrimaryClick(e: Event): void {
	if (!(e instanceof MouseEvent)) return;
	const target = document.activeElement;
	if (
		target instanceof HTMLElement &&
		e.button === 0 &&
		(e.clientX || e.clientY)
	)
		requestAnimationFrame(() => target.blur());
}
