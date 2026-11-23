# ClipSave

A Vue application with a Cloudflare-compatible API for TikTok video details, video downloads, and photo downloads. Post IDs are sent to IGramAPI. Availability and credit usage depend on IGramAPI and TikTok.

## Local development

```powershell
npm install
npm run dev
```

Set `IGRAMAPI_KEY` in an ignored `.env.local` file for Vite local development, then restart Vite. Use an ignored `.dev.vars` file when testing locally with Wrangler. Never commit the key or put it in frontend code. Vite and Cloudflare use the same API implementation; Python and yt-dlp are not required.

Alternatively, set `COBALT_API_URL` to a Cobalt instance in `.env.local` and restart Vite. If the instance requires a key, also set `COBALT_API_KEY`. When configured, Cobalt takes precedence over IGramAPI. Cobalt does not provide TikTok statistics, so the app hides them. Video links are reused from the initial request and can expire; submit the post again if necessary. Photo links are requested again when each download is prepared. See [COBALT.md](COBALT.md) for setup and deployment details.

An address such as `http://192.168.56.102:9000/` is private to its network: a deployed Cloudflare Worker cannot connect to it. Production needs a reachable HTTPS Cobalt instance; its returned download links must also be reachable by the visitor. An HTTPS website cannot reliably use HTTP download links due to browser mixed-content restrictions.

The video details and photo list each use one successful metadata request. Each video download uses two credits and each photo download uses one. Photo previews do not automatically spend download credits. Anyone able to use the public website can consume the account's credits; configure appropriate Cloudflare rate limits or access restrictions before broad public use.

## Cloudflare Pages

Set the project root to this directory, the build command to `npm run build`, and the output directory to `dist`. Deploy the entire source project through Git integration or the Pages CLI: Cloudflare must compile the root `functions/` directory. Uploading only `dist` through the dashboard does not deploy Pages Functions.

## Cloudflare Workers with static assets

Configure the Worker entry point as `worker.js`, the assets directory as `dist`, the assets binding as `ASSETS`, and route `/api/*` to the Worker before static assets. Set SPA fallback for non-API paths. Build the assets with `npm run build`. `worker.js` and `server/api.js` must be included in the Worker deployment; uploading `dist` alone does not deploy the API.

Add `IGRAMAPI_KEY` as an encrypted secret in the production Worker or Pages environment and deploy the version containing the secret. The key must not be stored in `wrangler.jsonc` or committed to Git. If the secret is missing, the API responds with 503 rather than falling back to another provider.

The Pages Functions and Worker are alternative ways to serve the API. Select the one attached to your domain; do not route the same domain to two separate deployments. Full public TikTok video and photo URLs and TikTok mobile share links are supported.
