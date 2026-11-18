# ClipSave

A local TikTok video downloader built with Vue and Vite. The download endpoint runs as Vite middleware, so the static `dist` directory alone cannot download videos.

## Setup (Windows)

```powershell
npm install
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm run dev
```

Open the local address printed by Vite. For a production build served locally, run `npm run build` and then `npm run preview`. On macOS or Linux, use `.venv/bin/python -m pip install -r requirements.txt` instead.

The app accepts full public TikTok video and photo-post links. Post IDs are sent to the third-party TikWM service to load video details and find photos. The downloader depends on TikTok, yt-dlp, and the media service; some posts or requests may be unavailable, and no specific quality or watermark status is guaranteed. Short links are not supported. This server is intended for local use, not public deployment.
