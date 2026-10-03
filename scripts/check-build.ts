/**
 * Refuse to load answers into a checkout that has not been built.
 *
 * `wrangler deploy` reads the config the Cloudflare adapter writes at the end of a
 * build, and falls back to `wrangler.jsonc` when there is none - where it finds an
 * assets binding and no Worker script, and refuses. That refusal lands *after* this
 * load has already written, which is the one ordering `docs/deploy.md` warns about.
 * A deploy that fails is repaired by pushing again; a load that ran first is a
 * production database holding answers nothing is deployed to serve. So the check
 * belongs here, on the step that writes, rather than in `deploy:cloud`.
 */
import { existsSync } from "node:fs";
import path from "node:path";

/** Where the adapter leaves the resolved config `wrangler deploy` redirects to. */
const buildConfig = path.resolve("dist/server/wrangler.json");

if (!existsSync(buildConfig)) {
	console.error(
		`No build here: ${path.relative(process.cwd(), buildConfig)} is missing, so \`wrangler deploy\` has no Worker to deploy and would fail after this load has written. Run \`npm run build\` first.`,
	);
	process.exit(2);
}
