# Deploying

## The pipeline

Cloudflare Workers Builds runs the deploy command on a push to `main`. The build command is `npm run build`, and the deploy command is:

```sh
npm run db:answers:remote && npm run deploy:cloud && npm run db:answers:prune:remote
```

Because the corpus ships as a static asset, pushing an edit to `data/pgn/` publishes it in the same deploy. The two D1 steps around it are the private half: the key and the movetext are not in any public artefact, so a deploy that skipped them would publish compositions the solver cannot answer. `npm run deploy` runs the same three steps locally, in the same order.

Every step goes through `npm run`, never a bare `wrangler`: the build environment has no global wrangler, and the binary in `node_modules/.bin` reaches `PATH` only inside an npm script. A deploy command that calls `wrangler` directly fails with `/bin/sh: 1: wrangler: not found` after the load has already written, which leaves the answers moved on and the Worker un-deployed. The load refuses to be that unlucky on its own account: `db:answers:remote` begins with `scripts/check-build.ts`, which stops a checkout with no `dist/`, because that is what a mis-set build command leaves behind and `wrangler deploy` then fails on exactly the missing Worker.

A branch build reaches production only if its deploy command is the one above, so give the deploy command to `main` and leave a branch build on `npm run build` alone: that is what keeps a branch from rewriting production rows. Every step is idempotent, so a failed deploy is repaired by pushing again.

## Today's composition needs no schedule

The home page is rendered by the Worker rather than prerendered, because it carries the day's composition: `dailyComposition()` is asked for the request's own date, so the day rolls over at 00:00 UTC with nothing scheduled and nothing deployed. A build used to be what turned it over, through a cron Worker that was never deployed, and the hero could sit on yesterday's composition for a whole day. The catalogue is parsed once per isolate, so the render is a lookup; `/` is served `max-age=0, must-revalidate` so no cache can hold a page labelled "today" into the next day.

## Cloudflare settings that live in the dashboard

The `www` to apex redirect is a Cloudflare Redirect Rule, and HTTPS and HTTP Strict Transport Security (HSTS) are zone settings. Both sit in the dashboard rather than in Worker code, because Cloudflare's `_redirects` file cannot match on hostname.

Application response headers are version-controlled: `public/_headers` for static assets and `src/middleware.ts` for Worker responses, both generated from `src/lib/security-headers.ts`. HSTS stays in the zone settings so that one header also covers the `www` redirect.

## Secrets

`wrangler.jsonc` carries no secrets. The ones that matter are set through Wrangler:

```sh
npx wrangler secret put BETTER_AUTH_SECRET
```

For local work, copy `.dev.vars.example` to `.dev.vars` and fill in the same variable. That file is gitignored and should stay that way.