/**
 * Settings live in `localStorage` under `keymove.*`.
 */
const PREFIX = "keymove.";

/** The saved value for a setting, or null. */
export function readSetting(name: string): string | null {
	try {
		return localStorage.getItem(PREFIX + name);
	} catch {
		return null;
	}
}

/** Remember a setting; failures (private mode, storage disabled) are ignored. */
export function writeSetting(name: string, value: string): void {
	try {
		localStorage.setItem(PREFIX + name, value);
	} catch {
		// storage unavailable; the setting still applies for this session
	}
	if (typeof window !== "undefined") {
		window.dispatchEvent(
			new CustomEvent("keymove:setting-change", { detail: { name, value } }),
		);
	}
}

/** Boolean settings are stored as "on"/"off"; read one with a fallback. */
export function readBoolSetting(name: string, fallback: boolean): boolean {
	const value = readSetting(name);
	if (value === "on") return true;
	if (value === "off") return false;
	return fallback;
}

/** Store a boolean setting as "on"/"off". */
export function writeBoolSetting(name: string, value: boolean): void {
	writeSetting(name, value ? "on" : "off");
}
