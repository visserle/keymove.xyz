<script lang="ts">
import { onMount } from "svelte";
import { createAuthClient } from "better-auth/client";
import {
	setAccountPreferenceSession,
	startAccountPreferenceSync,
} from "../lib/account-preferences";
import type { AccountPreferences } from "../lib/preferences";

/** The page's answer to "who is asking": an id is not needed to greet them. */
export interface InitialAccount {
	name: string;
}

let {
	initialPreferences,
	hasInitialPreferences = false,
	initialAccount,
	hasInitialAccount = false,
}: {
	initialPreferences?: AccountPreferences | null;
	hasInitialPreferences?: boolean;
	initialAccount?: InitialAccount | null;
	hasInitialAccount?: boolean;
} = $props();

/** All this menu ever shows of a session: that there is one, and the name. */
type Account = { user: { name: string } };

const client = createAuthClient();
const ACCOUNT_HINT_KEY = "keymove.accountSignedIn";
/**
 * The page resolved the session before it sent this HTML, so a Worker page knows
 * who is asking without asking again: that fetch would cost a round trip, a
 * `rateLimit` row and a session read on every page view to learn what the page
 * already rendered. A prerendered page has no such answer, so it passes nothing
 * and the fetch below is the only way to learn it.
 */
let session = $state<Account | null>(
	hasInitialAccount && initialAccount ? { user: initialAccount } : null,
);

function setHeaderAccountIcon(signedIn: boolean): void {
	const value = String(signedIn);
	document.documentElement.dataset.accountSignedIn = value;
	try {
		localStorage.setItem(ACCOUNT_HINT_KEY, value);
	} catch {
		// The icon still updates in this tab if storage is unavailable.
	}
}
/**
 * Whether the menu is still finding out. Only a page that could not resolve the
 * session itself has to ask, so a Worker page renders the account straight away
 * instead of flashing a "Checking account…" line it does not need.
 */
let loading = $state(!hasInitialAccount);
let busy = $state(false);
let message = $state("");

async function refreshSession(useInitialPreferences = false): Promise<void> {
	try {
		const result = await client.getSession();
		if (result.error) throw new Error(result.error.message);
		session = result.data;
		setAccountPreferenceSession(
			Boolean(session),
			useInitialPreferences && hasInitialPreferences
				? (initialPreferences ?? null)
				: undefined,
		);
		setHeaderAccountIcon(Boolean(session));
	} catch {
		session = null;
		setAccountPreferenceSession(false);
		// Keep the last-known icon hint on transport/API errors. A successful
		// getSession() returning no session is what authoritatively clears it.
	} finally {
		loading = false;
	}
}

async function signIn(): Promise<void> {
	busy = true;
	message = "";
	try {
		const result = await client.signIn.social({
			provider: "lichess",
			callbackURL: `${window.location.pathname}${window.location.search}`,
		});
		if (result.error) throw new Error(result.error.message);
	} catch {
		message = "Could not start Lichess sign-in. Please try again.";
		busy = false;
	}
}

async function signOut(): Promise<void> {
	busy = true;
	message = "";
	try {
		const result = await client.signOut();
		if (result.error) throw new Error(result.error.message);
		session = null;
		setAccountPreferenceSession(false);
		setHeaderAccountIcon(false);
	} catch {
		message = "Could not sign out. Please try again.";
	} finally {
		busy = false;
	}
}

onMount(() => {
	const syncAccountHint = (event: StorageEvent): void => {
		if (event.key !== ACCOUNT_HINT_KEY && event.key !== null) return;
		if (event.newValue === "true" || event.newValue === "false") {
			document.documentElement.dataset.accountSignedIn = event.newValue;
		} else {
			delete document.documentElement.dataset.accountSignedIn;
		}
		void refreshSession();
	};
	window.addEventListener("storage", syncAccountHint);
	startAccountPreferenceSync();
	if (hasInitialAccount) {
		// The page's answer is the answer; only the account-icon hint and the
		// preference session still have to be told.
		setAccountPreferenceSession(
			Boolean(session),
			hasInitialPreferences ? (initialPreferences ?? null) : undefined,
		);
		setHeaderAccountIcon(Boolean(session));
	} else void refreshSession(true);
	return () => window.removeEventListener("storage", syncAccountHint);
});
</script>

{#if loading}
	<p class="account-menu__status" aria-live="polite">Checking account…</p>
{:else if session}
	<div class="account-menu__identity">
		<span class="account-menu__name">{session.user.name}</span>
		<button
			class="account-menu__action account-menu__logout"
			type="button"
			onclick={signOut}
			disabled={busy}
			aria-label="Sign out"
			title="Sign out"
		>
			<svg
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.7"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<path d="M10 17l5-5-5-5M15 12H3" />
				<path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" />
			</svg>
		</button>
	</div>
{:else}
	<button class="account-menu__signin" type="button" onclick={signIn} disabled={busy}>
		{busy ? "Opening Lichess…" : "Sign in with Lichess to save progress"}<svg
			class="account-menu__external-icon"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.8"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d="M14 4h6v6M20 4l-9 9" />
			<path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6" />
		</svg>
	</button>
{/if}

{#if message}
	<p class="account-menu__message" role="status">{message}</p>
{/if}
