# ClipSave

A Vue application with a Cloudflare-compatible API for TikTok video details, video downloads, and photo downloads. Post IDs are sent to the third-party TikWM service. Availability depends on that service and TikTok.

## Local development

```powershell
npm install
npm run dev
```

Vite uses the same API implementation as the Cloudflare handlers. The API no longer requires Python or yt-dlp.

## Cloudflare Pages

Set the project root to this directory, the build command to `npm run build`, and the output directory to `dist`. Deploy the entire source project through Git integration or the Pages CLI: Cloudflare must compile the root `functions/` directory. Uploading only `dist` through the dashboard does not deploy Pages Functions.

## Cloudflare Workers with static assets

Configure the Worker entry point as `worker.js`, the assets directory as `dist`, the assets binding as `ASSETS`, and route `/api/*` to the Worker before static assets. Set SPA fallback for non-API paths. Build the assets with `npm run build`. `worker.js` and `server/api.js` must be included in the Worker deployment; uploading `dist` alone does not deploy the API.

The Pages Functions and Worker are alternative ways to serve the API. Select the one attached to your domain; do not route the same domain to two separate deployments. Full public TikTok video and photo URLs are supported; short links are not.
