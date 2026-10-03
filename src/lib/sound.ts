/**
 * Sound.
 *
 * Ported from lichess (`ui/site/src/sound.ts`), pared to what the solver
 * needs: the board's move/capture/check and the key's right/wrong verdict.
 * Board cues and errors use Lichess's Standard set; success uses the SFX
 * set's `GenericNotify.mp3`, the cue Lichess plays when its game-start
 * countdown finishes. Samples are vendored under `public/sound`:
 *
 *     Move.mp3  Capture.mp3  Check.mp3  Confirmation.mp3  Error.mp3
 *     GenericNotify.mp3
 *
 * As in lichess, the AudioContext is created lazily and every buffer is
 * decoded once and replayed from memory. Browsers only start a context from a
 * user gesture, so `initSounds` primes it on the first pointer or key event.
 */
import { readSetting, writeSetting } from "./storage";

export type SoundName =
	| "move"
	| "capture"
	| "check"
	| "confirmation"
	| "error"
	| "genericNotify";

const FILE: Record<SoundName, string> = {
	move: "Move",
	capture: "Capture",
	check: "Check",
	confirmation: "Confirmation",
	error: "Error",
	genericNotify: "GenericNotify",
};

const ALL: SoundName[] = [
	"move",
	"capture",
	"check",
	"confirmation",
	"error",
	"genericNotify",
];

const VOLUME_KEY = "soundVolume";
/** Lichess's `Sound.getVolume` fallback (`ui/site/src/sound.ts`). */
const DEFAULT_VOLUME = 0.7;

let ctx: AudioContext | undefined;
const buffers = new Map<SoundName, AudioBuffer>();
const loading = new Map<SoundName, Promise<void>>();

/** Sound is on whenever the volume is above zero; zero is the mute toggle. */
function soundEnabled(): boolean {
	return getVolume() > 0;
}

/** The remembered volume, 0–1 (lila's `Sound.getVolume`). */
export function getVolume(): number {
	const raw = readSetting(VOLUME_KEY);
	if (raw === null || raw === "") return DEFAULT_VOLUME;
	const value = Number(raw);
	return Number.isFinite(value) && value >= 0 && value <= 1
		? value
		: DEFAULT_VOLUME;
}

/**
 * Remember the volume; the next sound plays at it. Zero is mute, so the slider
 * is the whole preference. Coming back off zero primes the context and the
 * samples.
 */
export function setVolume(volume: number): void {
	const clamped = Math.min(1, Math.max(0, volume));
	writeSetting(VOLUME_KEY, String(clamped));
	if (clamped > 0) {
		void makeContext()
			?.resume()
			.catch(() => {});
		preloadSounds();
	}
}

function makeContext(): AudioContext | undefined {
	if (ctx || typeof window === "undefined") return ctx;
	const Ctor =
		window.AudioContext ??
		(window as unknown as { webkitAudioContext?: typeof AudioContext })
			.webkitAudioContext;
	if (!Ctor) return undefined;
	ctx = new Ctor({ latencyHint: "interactive" });
	return ctx;
}

async function load(name: SoundName): Promise<void> {
	if (buffers.has(name)) return;
	const inFlight = loading.get(name);
	if (inFlight) return inFlight;
	const context = makeContext();
	if (!context) return;
	const promise = (async () => {
		const res = await fetch(`/sound/${FILE[name]}.mp3`);
		if (!res.ok) throw new Error(`sound ${name} failed (${res.status})`);
		const data = await res.arrayBuffer();
		buffers.set(name, await context.decodeAudioData(data));
	})()
		.catch(() => {
			// a missing or undecodable sample is not worth failing a move over
		})
		.finally(() => loading.delete(name));
	loading.set(name, promise);
	return promise;
}

/** Decode every sample ahead of the first move. */
function preloadSounds(): void {
	for (const name of ALL) void load(name);
}

/** Estimated delay from the AudioContext clock to audible output. */
export function getSoundOutputLatencyMs(): number {
	const context = ctx;
	if (!context) return 0;
	const outputLatency = (
		context as AudioContext & { outputLatency?: number }
	).outputLatency;
	const latency =
		typeof outputLatency === "number" &&
		Number.isFinite(outputLatency) &&
		outputLatency > 0
			? outputLatency
			: context.baseLatency;
	return Math.max(0, latency * 1000);
}

/**
 * Bring a context that is not running yet to running, if this cue can.
 *
 * Browsers only unlock audio from a user gesture, so scrolling the moves of a
 * freshly opened composition - the wheel is not a gesture - finds the context
 * suspended. Waiting for it there would be worse than silence: `resume()` stays
 * pending until some later click, key or drag settles it, so every move
 * scrolled through in the meantime would then start its sample in that one
 * instant and the unlocking gesture would land as a burst of overlapping cues,
 * far louder than the move it belongs to. Those cues are dropped instead, as
 * lila drops the ones asked for before its context exists. A cue that arrives
 * with a gesture is worth waiting for: it is the gesture doing the unlocking.
 */
async function unlock(context: AudioContext): Promise<boolean> {
	if (context.state === "running") return true;
	if (!navigator.userActivation?.isActive) return false;
	try {
		await context.resume();
	} catch {
		return false;
	}
	// `state` is a live getter and `resume()` is what changed it; the narrowing
	// from the check above is the compiler's, not the browser's.
	return (context.state as string) === "running";
}

async function playBuffer(name: SoundName, volume: number): Promise<void> {
	if (!soundEnabled()) return;
	const context = makeContext();
	if (!context) return;
	if (!(await unlock(context))) return;
	await load(name);
	const buffer = buffers.get(name);
	if (!buffer) return;
	const gain = context.createGain();
	gain.gain.value = volume;
	gain.connect(context.destination);
	const source = context.createBufferSource();
	source.buffer = buffer;
	source.connect(gain);
	source.onended = () => {
		source.disconnect();
		gain.disconnect();
	};
	source.start(0);
}

/** Fire and forget; sound never blocks or cancels a move. The remembered
    volume scales the caller's own (a move sound is quiet relative to its max). */
export function playSound(name: SoundName, volume = 1): void {
	void playBuffer(name, getVolume() * volume);
}

// Lichess's `site.sound.move()` routes move, capture and check through
// `throttle(100, ...)`: play the first cue immediately, then retain only the
// latest cue requested during each 100 ms window for playback at its end.
const MOVE_SOUND_THROTTLE_MS = 100;
type MoveSoundName = Extract<SoundName, "move" | "capture" | "check">;
let moveSoundTimer: ReturnType<typeof setTimeout> | undefined;
let queuedMoveSound: { name: MoveSoundName; volume: number } | undefined;

function playThrottledMoveSound(name: MoveSoundName, volume: number): void {
	if (moveSoundTimer !== undefined) {
		queuedMoveSound = { name, volume };
		return;
	}
	playSound(name, volume);
	moveSoundTimer = setTimeout(playQueuedMoveSound, MOVE_SOUND_THROTTLE_MS);
}

function playQueuedMoveSound(): void {
	const queued = queuedMoveSound;
	queuedMoveSound = undefined;
	if (!queued) {
		moveSoundTimer = undefined;
		return;
	}
	playSound(queued.name, queued.volume);
	moveSoundTimer = setTimeout(playQueuedMoveSound, MOVE_SOUND_THROTTLE_MS);
}

/**
 * The board's cue, as lichess's `site.sound.move()`: a capture or a plain
 * move, then the check on top when the SAN carries one. Those cues share
 * lichess's 100 ms throttle; direct UI sounds such as volume previews do not.
 */
export function playMoveSound(san: string, volume = 1): void {
	playThrottledMoveSound(san.includes("x") ? "capture" : "move", volume);
	if (san.includes("+")) playThrottledMoveSound("check", volume);
}

/**
 * Prime the AudioContext from the first user gesture, as browsers require;
 * returns the cleanup for the listeners it added. Called once from Solve.
 */
export function initSounds(): () => void {
	const events = ["pointerdown", "keydown", "touchend"] as const;
	const primer = (): void => {
		void makeContext()
			?.resume()
			.catch(() => {});
		preloadSounds();
		for (const event of events) window.removeEventListener(event, primer, true);
	};
	for (const event of events) window.addEventListener(event, primer, true);
	return () => {
		for (const event of events) window.removeEventListener(event, primer, true);
	};
}
