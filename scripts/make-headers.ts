// Write `public/_headers` from `src/lib/security-headers.ts`.
//
//   npm run headers
//
// The headers have to reach two kinds of response, static assets and the pages
// the Worker generates, and Cloudflare's `_headers` file and the Worker have no
// shared list between them. Rather than keep two copies and a comment asking
// people to sync them, the declaration is a module: the middleware sends it, and
// this renders it into the file.
//
// Run as part of `npm run build`, before `astro build`, because the Astro
// Cloudflare adapter prepends its own `/_astro/*` rule to this file afterwards.

import { writeFileSync } from "node:fs";
import path from "node:path";
import { securityHeadersFile } from "../src/lib/security-headers";

const out = path.resolve("public/_headers");
writeFileSync(out, securityHeadersFile());
console.log(`wrote ${path.relative(process.cwd(), out)}`);
