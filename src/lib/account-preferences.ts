import { applyPieceSet, isPieceSet } from "./board/piecesets";
import {
	type AccountPreferences,
	DEFAULT_ACCOUNT_PREFERENCES,
	parseAccountPreferences,
} from "./preferences";
import {
	readBoolSetting,
	readSetting,
	writeBoolSetting,
	writeSetting,
} from "./storage";

const SYNCED_KEYS = new Set([
	"theme",
	"pieceSet",
	"boardBrightness",
	"boardContrast",
	"boardGrain",
	"soundVolume",
	"boardZoom",
	"moveListStyle",
	"showFork",
	"hideSolved",
]);
const SAVE_DELAY_MS = 400;
const VISUAL_PREFERENCE_KEYS = [
	"theme",
	"pieceSet",
	"boardBrightness",
	"boardContrast",
	"boardGrain",
	"soundVolume",
	"boardZoom",
	"moveListStyle",
	"showFork",
] as const;

let started = false;
let signedIn = false;
let ready = false;
let changedDuringLoad = false;
let hideSolvedChangedBeforeSession = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let applyingRemote = false;
let sessionGeneration = 0;
let readyResolvers: (() => void)[] = [];
let readyPromise = new Promise<void>((resolve) => readyResolvers.push(resolve));

/** Wire automatic account preference sync once; safe from both the layout and island. */
export function startAccountPreferenceSync(): void {
	if (started) return;
	started = true;
	window.addEventListener("keymove:setting-change", onSettingChange);
	window.addEventListener("pagehide", () => {
		if (!saveTimer) return;
		clearTimeout(saveTimer);
		saveTimer = undefined;
		void saveAccountPreferences(true);
	});
}

/**
 * Called by the account island after its authoritative session check.
 *
 * Two mechanisms paint these settings, and they do two different jobs. The
 * pre-paint script in Base.astro reads `localStorage` before the body is parsed,
 * which is the only thing that can make the first frame right: at prerender time
 * the server does not know who is asking, so nothing from the network can arrive
 * first. That script is the single writer of `<html>`'s settings; `initDasher`
 * leaves it alone.
 *
 * This module does the second job: catching up a copy from another device, once
 * the page has already painted correctly from local storage. On a new device that
 * costs one flash of the default theme, which is inherent to the pattern.
 *
 * A page that already holds the row passes it in and the fetch is skipped.
 * `/collections` does, because it reads `user_preferences` for `hideSolved`
 * anyway. The other pages take the fetch, which is cheaper than a server read
 * purely to hand over a blob the browser can ask for itself.
 *
 * `accountAdminSnapshot` in Base.astro looks similar and is not: it decides what
 * the page *sends*, so it is server-resolved only, and the browser has no second
 * path to it.
 */
export function setAccountPreferenceSession(
	isAuthenticated: boolean,
	initialPreferences?: AccountPreferences | null,
): void {
	startAccountPreferenceSync();
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = undefined;
	sessionGeneration += 1;
	signedIn = isAuthenticated;
	ready = false;
	for (const resolve of readyResolvers) resolve();
	readyResolvers = [];
	readyPromise = new Promise<void>((resolve) => readyResolvers.push(resolve));
	changedDuringLoad = isAuthenticated && hideSolvedChangedBeforeSession;
	hideSolvedChangedBeforeSession = false;
	if (!signedIn) {
		markReady();
		return;
	}
	if (initialPreferences === undefined)
		void loadAccountPreferences(sessionGeneration);
	else reconcileAccountPreferences(initialPreferences, sessionGeneration, true);
}

function onSettingChange(event: Event): void {
	if (applyingRemote) return;
	const detail = (event as CustomEvent<{ name?: string }>).detail;
	if (!detail?.name || !SYNCED_KEYS.has(detail.name)) return;
	if (!signedIn) {
		if (detail.name === "hideSolved") hideSolvedChangedBeforeSession = true;
		return;
	}
	if (!ready) {
		changedDuringLoad = true;
		return;
	}
	scheduleSave();
}

async function loadAccountPreferences(generation: number): Promise<void> {
	try {
		const response = await fetch("/api/preferences", {
			credentials: "same-origin",
			cache: "no-store",
		});
		if (!response.ok) {
			if (signedIn && generation === sessionGeneration) {
				markReady();
				if (changedDuringLoad) scheduleSave();
			}
			return;
		}
		const result: unknown = await response.json();
		if (!signedIn || generation !== sessionGeneration) return;
		const remote =
			typeof result === "object" && result !== null
				? parseAccountPreferences(
						(result as Record<string, unknown>).preferences,
					)
				: null;
		reconcileAccountPreferences(remote, generation);
	} catch {
		// Keep local settings usable if the network or account endpoint is down.
		if (signedIn && generation === sessionGeneration) {
			markReady();
			if (changedDuringLoad) scheduleSave();
		}
	}
}

function reconcileAccountPreferences(
	remote: AccountPreferences | null,
	generation: number,
	serverRendered = false,
): void {
	if (!signedIn || generation !== sessionGeneration) return;
	if (remote) {
		if (changedDuringLoad) {
			if (serverRendered) {
				const localHideSolved = localPreferences().hideSolved;
				applyRemotePreferences({ ...remote, hideSolved: localHideSolved });
			}
			markReady();
			scheduleSave();
			return;
		}
		const local = localPreferences();
		const changed = JSON.stringify(local) !== JSON.stringify(remote);
		if (changed) applyRemotePreferences(remote);
		markReady();
		if (changed && visualPreferencesChanged(local, remote))
			window.location.reload();
		return;
	}

	markReady();
	if (changedDuringLoad || hasLocalPreferences()) scheduleSave();
}

function visualPreferencesChanged(
	left: AccountPreferences,
	right: AccountPreferences,
): boolean {
	return VISUAL_PREFERENCE_KEYS.some((key) => left[key] !== right[key]);
}

function markReady(): void {
	ready = true;
	for (const resolve of readyResolvers) resolve();
	readyResolvers = [];
}

export async function flushAccountPreferences(): Promise<boolean> {
	while (!ready) await readyPromise;
	if (!signedIn) return false;
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = undefined;
	return saveAccountPreferences();
}

function scheduleSave(): void {
	if (!signedIn || !ready) return;
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = setTimeout(() => {
		saveTimer = undefined;
		void saveAccountPreferences();
	}, SAVE_DELAY_MS);
}

async function saveAccountPreferences(keepalive = false): Promise<boolean> {
	try {
		const response = await fetch("/api/preferences", {
			method: "PUT",
			credentials: "same-origin",
			keepalive,
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ preferences: localPreferences() }),
		});
		return response.ok;
	} catch {
		// A later preference change retries; localStorage remains the fallback.
		return false;
	}
}

function hasLocalPreferences(): boolean {
	return [...SYNCED_KEYS].some((key) => readSetting(key) !== null);
}

function localPreferences(): AccountPreferences {
	const defaults = DEFAULT_ACCOUNT_PREFERENCES;
	const rawGrain = readSetting("boardGrain");
	const candidate = {
		theme: readSetting("theme") ?? defaults.theme,
		pieceSet: readSetting("pieceSet") ?? defaults.pieceSet,
		boardBrightness: numberSetting("boardBrightness", defaults.boardBrightness),
		boardContrast: numberSetting("boardContrast", defaults.boardContrast),
		boardGrain:
			rawGrain === "on"
				? true
				: rawGrain === "off"
					? false
					: defaults.boardGrain,
		soundVolume: numberSetting("soundVolume", defaults.soundVolume),
		boardZoom: numberSetting("boardZoom", defaults.boardZoom),
		moveListStyle: readSetting("moveListStyle") ?? defaults.moveListStyle,
		showFork: readBoolSetting("showFork", defaults.showFork),
		hideSolved: readBoolSetting("hideSolved", defaults.hideSolved),
	};
	return parseAccountPreferences(candidate) ?? { ...defaults };
}

function numberSetting(name: string, fallback: number): number {
	const raw = readSetting(name);
	if (raw === null || raw === "") return fallback;
	const value = Number(raw);
	return Number.isFinite(value) ? value : fallback;
}

function applyRemotePreferences(preferences: AccountPreferences): void {
	applyingRemote = true;
	try {
		writeSetting("theme", preferences.theme);
		writeSetting("pieceSet", preferences.pieceSet);
		if (isPieceSet(preferences.pieceSet)) applyPieceSet(preferences.pieceSet);
		writeSetting("boardBrightness", String(preferences.boardBrightness));
		writeSetting("boardContrast", String(preferences.boardContrast));
		writeSetting("boardGrain", preferences.boardGrain ? "on" : "off");
		writeSetting("soundVolume", String(preferences.soundVolume));
		writeSetting("boardZoom", String(preferences.boardZoom));
		writeSetting("moveListStyle", preferences.moveListStyle);
		writeBoolSetting("showFork", preferences.showFork);
		writeBoolSetting("hideSolved", preferences.hideSolved);
	} finally {
		applyingRemote = false;
	}
}
