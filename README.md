# AHM Studio V8

A clean-start automated short-form 3D storytelling app.

## What is already included

- Mobile-friendly AHM Studio UI
- AI story/script pipeline
- Natural 30-120 second duration selection
- Curiosity-loop prompt
- Character/environment/prop continuity manifest
- RunPod Serverless adapter
- Voice provider adapter for a saved cloned-voice ID
- Subtitle/music/SFX/edit requirements
- TikTok + YouTube publishing adapters
- Demo mode so the interface can be tested without spending GPU money
- No secrets stored in frontend code

## Start locally

1. Copy `.env.example` to `.env`.
2. Keep `DEMO_MODE=true` for the first UI test.
3. Run:
   npm install
   npm start
4. Open the shown local URL.

## Important

The app is intentionally honest about external dependencies. A real final MP4
requires a real video-generation worker on RunPod and a voice provider/account.
Automatic TikTok and YouTube posting also requires platform authorization/OAuth.
The app does not pretend those services are connected when they are not.

## Suggested production architecture

Browser -> Node orchestrator -> story AI -> RunPod GPU worker -> FFmpeg/edit ->
voice -> storage -> TikTok/YouTube APIs.

For production, replace the in-memory job map with a persistent database/queue and
store final videos in object storage rather than relying on the app filesystem.


## Review-before-posting workflow

Every generated job is saved in `data/<job-id>.json` and appears in **History**.
Generation never posts automatically. After the final video is ready, the UI shows:

- **DOWNLOAD VIDEO** — save it and post manually.
- **POST AUTOMATICALLY** — explicitly approve the reviewed video and trigger the
  connected TikTok/YouTube publishing adapters.

This review gate is deliberate: AHM should never publish a generated video to the
user's pages without the user approving it first.

For real production, the final MP4 should also be copied to durable object storage
and the history database should store its permanent URL. The starter keeps the
architecture simple until the RunPod worker and storage provider are connected.
