// @ts-check
import cloudflare from "@astrojs/cloudflare";
import svelte from "@astrojs/svelte";
import { defineConfig } from "astro/config";

// Svelte 5's component HMR wrapper can break Astro island hydration in dev
// (`first_child_getter is undefined`, sveltejs/svelte#17483). Disable that
// compiler wrapper, not Vite HMR globally: CSS and other modules keep HMR, and
// the plugin below turns Svelte edits into full page reloads. Production
// disables the Svelte HMR wrapper regardless.
/** @type {import('vite').Plugin} */
const svelteFullReload = {
	name: "keymove:svelte-full-reload",
	enforce: "post",
	hotUpdate({ file }) {
		if (this.environment.name !== "client" || !file.endsWith(".svelte")) return;
		this.environment.hot.send({ type: "full-reload", path: "*" });
		return [];
	},
};

// Most public content remains prerendered and served as Static Assets. The
// personalized composition and library pages, plus /api/* routes, run on demand in
// the Worker so they can read Better Auth sessions and per-user progress from
// D1 before sending HTML. Other build-time content reads build/catalogue.json,
// which `npm run corpus` generates from data/pgn/ (and `npm run build` runs first,
// so a build can never read a corpus that has moved).
export default defineConfig({
	output: "static",
	session: false,
	// Bind the dev server to every interface, not just IPv6 `localhost`. Node
	// resolves `localhost` to `::1` first, which leaves `127.0.0.1:4321`
	// unreachable for browsers that prefer IPv4.
	server: { host: true },
	vite: {
		plugins: [svelteFullReload],
	},
	adapter: cloudflare({
		prerenderEnvironment: "node",
		// There are no <Image> components; keep Astro from provisioning the
		// Cloudflare Images binding we would never use.
		imageService: "compile",
	}),
	integrations: [svelte({ compilerOptions: { hmr: false } })],
});
