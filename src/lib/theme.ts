/**
 * Site theme.
 *
 * Ported from lichess (`ui/dasher/src/theme.ts`, `ui/lib/src/device.ts` and
 * `modules/pref/.../Pref.scala`): the preference is one of `system | light |
 * dark`; the *resolved* theme is the class `light` or `dark` on `<html>`,
 * which the stylesheet switches on (`html.dark`); and the raw preference is
 * mirrored to `document.body.dataset.theme` for scripts, which lichess also
 * reads (`currentTheme()`). `system` follows the device via
 * `prefers-color-scheme: light`, exactly as lila's `systemThemeScript` does.
 *
 * The preference lives in `localStorage` under `keymove.*` (see storage.ts).
 * The pre-paint script in Base.astro repeats the resolution inline so a
 * refresh never paints the wrong theme before the module runs.
 */
import { readSetting, writeSetting } from "./storage";

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

/** Lichess' default background preference (`Bg.SYSTEM`). */
const DEFAULT_THEME: Theme = "system";

const STORAGE_KEY = "theme";

/** `(prefers-color-scheme: light)`, as lila's `prefersLightThemeQuery()`. */
export const prefersLightThemeQuery = (): MediaQueryList =>
	window.matchMedia("(prefers-color-scheme: light)");

export function isTheme(value: unknown): value is Theme {
	return (
		typeof value === "string" && (THEMES as readonly string[]).includes(value)
	);
}

/** The remembered preference, or the default. */
export function storedTheme(): Theme {
	const saved = readSetting(STORAGE_KEY);
	return isTheme(saved) ? saved : DEFAULT_THEME;
}

/** The class `<html>` wears: `system` resolves against the device. */
function resolvedTheme(theme: Theme): "light" | "dark" {
	if (theme === "system")
		return prefersLightThemeQuery().matches ? "light" : "dark";
	return theme;
}

/** Paint the document: the html class is what the CSS reads, the body dataset is what JS reads. */
export function applyTheme(
	theme: Theme,
	root: HTMLElement = document.documentElement,
): void {
	const resolved = resolvedTheme(theme);
	root.classList.toggle("light", resolved === "light");
	root.classList.toggle("dark", resolved === "dark");
	if (document.body) document.body.dataset.theme = theme;
	const meta = document.querySelector('meta[name="theme-color"]');
	// read the painted value rather than duplicating the palette here
	const painted = getComputedStyle(root);
	if (meta)
		meta.setAttribute(
			"content",
			painted.getPropertyValue("--c-page-bg").trim(),
		);
	const maskIcon = document.querySelector<HTMLLinkElement>(
		'link[rel="mask-icon"]',
	);
	const brand = painted.getPropertyValue("--c-brand").trim();
	if (maskIcon && brand) maskIcon.setAttribute("color", brand);
}

/** Apply a preference and remember it. */
export function setTheme(theme: Theme): void {
	writeSetting(STORAGE_KEY, theme);
	applyTheme(theme);
}
