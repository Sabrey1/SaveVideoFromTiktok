# Cobalt integration guide

ClipSave can use [Cobalt](https://github.com/imputnet/cobalt) to retrieve TikTok media. Set `COBALT_API_URL` to select Cobalt; otherwise the app uses IGramAPI.

## What changes

Cobalt supports TikTok videos and slideshow images, but its [service support table](https://github.com/imputnet/cobalt/blob/main/api/README.md) lists TikTok metadata as unsupported. ClipSave hides the statistics and uses a fallback title when Cobalt is selected. Test the exact Cobalt version and TikTok posts you intend to support.

The frontend sends the full TikTok post URL and ID to the API. The existing `/api/resolve` route resolves supported short share links first.

## Set up an instance

Run your own Cobalt instance or obtain explicit access from an instance owner. The official hosted API is protected and is not intended for use by other projects without permission. Follow Cobalt's [instance setup guide](https://github.com/imputnet/cobalt/blob/main/docs/run-an-instance.md), which recommends Docker Compose, and its [environment variable reference](https://github.com/imputnet/cobalt/blob/main/docs/api-env-variables.md). Set `API_URL` to the externally reachable URL of the Cobalt instance, and protect a public instance with authentication and rate limits.

ClipSave's Cloudflare Worker or Pages Function must be able to reach that instance over HTTPS. `localhost` on your computer is not reachable from a deployed Worker. Cobalt runs as a separate service; it is not installed by the existing Vite build.

Configure the instance URL on the server, for example `COBALT_API_URL=https://cobalt.example.com/`, and store any API key as a server-side secret named `COBALT_API_KEY`. Never place the key in Vue code or a `VITE_` environment variable. Configure local values in `.env.local` for Vite or `.dev.vars` for Wrangler, and production secrets in your chosen Cloudflare deployment. Restart the local server after configuration changes.

## Try the API

With an instance you control or have permission to use, run this in PowerShell, replacing the URL and sample post. Add the authorization header only if the instance requires an API key:

```powershell
$cobaltUrl = 'https://cobalt.example.com/'
$headers = @{ Accept = 'application/json' }
# $headers.Authorization = 'Api-Key YOUR_API_KEY'
$body = @{ url = 'https://www.tiktok.com/@example/video/1234567890' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri $cobaltUrl -Headers $headers -ContentType 'application/json' -Body $body
```

The main endpoint is `POST /`; both `Accept: application/json` and `Content-Type: application/json` are required. An instance may instead use short-lived Bearer authentication, or no authentication, depending on its configuration. See the [Cobalt API reference](https://github.com/imputnet/cobalt/blob/main/docs/api.md) for options and the current response schema.

## Response handling

Inspect both the HTTP status and the JSON `status` field. Cobalt can return:

| Status | Integration behavior |
| --- | --- |
| `redirect` or `tunnel` | Use the returned `url` as a download link after validating it; tunnel links can expire. |
| `picker` | Read the `picker` array and its item `type` and `url`; map photo items to the slideshow UI. |
| `local-processing` | Requires client-side remuxing or transcoding; handle it explicitly or report it as unsupported. |
| `error` | Map `error.code` to a useful message without exposing credentials or internal details. |

`/api/download` returns the existing `{ downloadUrl }` shape for a single video link. Photo routes filter picker items to photos and cap them at 35; a fresh picker is requested for each photo download. Links can expire. Local HTTP tunnel links require that the visitor's browser can reach the Cobalt host; HTTPS deployments should use HTTPS links to avoid mixed-content restrictions.

Validate incoming TikTok URLs using an explicit host and path allowlist, as the current resolver does. Keep the configured Cobalt origin fixed on the server rather than accepting it from the user. Validate returned link schemes and destinations before returning or fetching them; if proxying links, protect against redirects to private or internal addresses. Handle timeouts, rate limits and upstream errors without leaking secrets. Avoid logging full URLs that may contain tokens.

## Verify an implementation

1. Test public video, slideshow, short share link, invalid link, unavailable/private post, and provider failure cases.
2. Check how the interface behaves when TikTok metadata is absent, when a link expires, and when Cobalt returns a picker or an unsupported processing result.
3. Run the project's tests and build, then test the deployed Worker or Pages Function against the configured instance. Confirm authentication and rate limits work without exposing the key.

Review the [Cobalt API license](https://github.com/imputnet/cobalt/blob/main/api/LICENSE) and hosting requirements for your intended deployment.
