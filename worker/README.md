# AHM V8 RunPod Worker

This folder is the GPU boundary for the project.

The Node app sends a `job_type: "ahm_v8_video"` payload containing:
- the story/narration
- 9:16 target
- character/environment/prop roster
- visual annotation rules
- subtitle/edit requirements

Your RunPod worker should:
1. Generate/reuse character reference sheets.
2. Generate environment/prop references.
3. Render short animated blocks from those references.
4. Assemble blocks with FFmpeg.
5. Add narration, subtitles, music and SFX.
6. Apply timed punch-in zooms and impact shakes.
7. Return a public `finalVideoUrl`.

Do not hardcode API keys in this folder. Use RunPod secrets/environment variables.

The included Node app deliberately does not fake a finished MP4 when the GPU worker
is not connected.
