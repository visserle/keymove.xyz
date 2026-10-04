import { betterAuth, type BetterAuthOptions } from "better-auth";
import { genericOAuth } from "better-auth/plugins";

export interface AuthSettings {
	database: NonNullable<BetterAuthOptions["database"]>;
	baseURL: string;
	secret: string;
	lichessClientId: string;
	logger?: BetterAuthOptions["logger"];
}

interface LichessProfile {
	id?: string;
	username?: string;
}

function placeholderEmail(lichessId: string): string {
	// Lichess IDs are stable username-shaped identifiers. The reserved .invalid
	// domain makes this unique Better Auth placeholder explicitly non-deliverable.
	return `lichess-${lichessId.toLowerCase()}@users.invalid`;
}

async function lichessUserInfo(accessToken: string) {
	const headers = {
		Authorization: `Bearer ${accessToken}`,
		Accept: "application/json",
		"User-Agent": "Keymove/0.1 (+https://keymove.xyz)",
	};
	let userInfo: {
		id: string;
		name: string;
		email: string;
		emailVerified: false;
	} | null = null;

	// The token is used only to establish identity. Lichess exposes the public
	// account ID and username without requesting a private email permission.
	// Attempt revocation even if the profile request or JSON parsing fails.
	try {
		const profileResponse = await fetch("https://lichess.org/api/account", {
			headers,
		});
		if (profileResponse.ok) {
			const profile = (await profileResponse.json()) as LichessProfile;
			if (
				typeof profile.id === "string" &&
				typeof profile.username === "string"
			) {
				userInfo = {
					id: profile.id,
					name: profile.username,
					// Better Auth requires an email field. This deterministic .invalid
					// address is not a real mailbox and cannot be used for recovery.
					email: placeholderEmail(profile.id),
					emailVerified: false,
				};
			}
		}
	} catch {
		// Still revoke the token below if fetching the identity failed.
	}

	try {
		const revokeResponse = await fetch("https://lichess.org/api/token", {
			method: "DELETE",
			headers,
		});
		if (!revokeResponse.ok) return null;
	} catch {
		// Fail sign-in closed if we cannot confirm the grant was revoked.
		return null;
	}

	return userInfo;
}

// Better Auth normally persists provider tokens on its account record. Keymove
// only needs a Lichess token long enough to fetch identity, so clear credential
// material before any account insert/update as defense in depth.
const discardOAuthCredentials = async () => ({
	data: {
		accessToken: null,
		refreshToken: null,
		idToken: null,
		accessTokenExpiresAt: null,
		refreshTokenExpiresAt: null,
		scope: null,
	},
});

/** Build Better Auth from explicit bindings, keeping Worker env access out of
 * the shared provider configuration. */
export function createAuth(settings: AuthSettings) {
	return betterAuth({
		baseURL: settings.baseURL,
		secret: settings.secret,
		database: settings.database,
		logger: settings.logger,
		// Keep users signed in across long stretches of inactivity. Better Auth
		// rolls the expiry forward as the session is used; 400 days is the longest
		// broadly supported persistent-cookie lifetime in browsers.
		session: {
			modelName: "auth_session",
			expiresIn: 400 * 24 * 60 * 60,
			updateAge: 24 * 60 * 60,
			// Off, deliberately. A session cache turns each identity lookup into a
			// cookie read instead of a D1 read, and it costs nothing in rows
			// written: a cache hit writes nothing, and the one write in the session
			// path fires only in the last day of a 400-day session. So it buys reads
			// and nothing else, and reads are not the scarce resource — the Free
			// plan allows 5 million a day against 100,000 rows written.
			//
			// What the cache would cost is an hour of stale identity: a session
			// deleted here, an account deleted, a sign-out on another device, all
			// of them still answered "signed in" until the cookie ages out. Paying
			// an hour of that for rows nobody is short of is the wrong trade, so
			// every request that authorizes reads the session row instead.
			cookieCache: { enabled: false },
		},
		trustedOrigins: [settings.baseURL],
		emailAndPassword: { enabled: false },
		// `auth_` is Keymove's prefix, set by `modelName`, which is what keeps
		// these tables apart from this app's own `user_preferences` and `admins`.
		//
		// These names and data/schema.sql have to agree: this says where Better
		// Auth looks, that says where the tables are. The columns stay Better
		// Auth's; only the names are ours.
		user: { modelName: "auth_user", deleteUser: { enabled: true } },
		account: {
			modelName: "auth_account",
			accountLinking: { disableImplicitLinking: true },
		},
		verification: { modelName: "auth_verification" },
		databaseHooks: {
			account: {
				create: { before: discardOAuthCredentials },
				update: { before: discardOAuthCredentials },
			},
		},
		rateLimit: {
			modelName: "auth_rate_limit",
			enabled: true,
			storage: "database",
			window: 60,
			max: 60,
			customRules: {
				// Reading the session back is not an attack surface: the cookie is
				// already signed, there is nothing to guess and nothing to
				// brute-force, and the endpoint only ever returns the caller's own
				// row. Counting it would spend a row read and a row write on every
				// page view to slow down a request that costs the attacker a Worker
				// invocation. Everything that can be guessed stays limited.
				"/get-session": false,
				"/sign-in/social": { window: 60, max: 10 },
				"/callback/lichess": { window: 60, max: 20 },
				"/delete-user": { window: 60, max: 5 },
			},
		},
		advanced: {
			useSecureCookies: settings.baseURL.startsWith("https://"),
			ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
			database: { validateSchema: false },
		},
		plugins: [
			genericOAuth({
				config: [
					{
						providerId: "lichess",
						name: "Lichess",
						clientId: settings.lichessClientId,
						authorizationUrl: "https://lichess.org/oauth",
						tokenUrl: "https://lichess.org/api/token",
						userInfoUrl: "https://lichess.org/api/account",
						pkce: true,
						getUserInfo: async ({ accessToken }) =>
							accessToken ? lichessUserInfo(accessToken) : null,
					},
				],
			}),
		],
	});
}
