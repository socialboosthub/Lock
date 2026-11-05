import os
import json
import time
import uuid
import base64
import subprocess
import urllib.request
import urllib.error
import tempfile
import re
from pathlib import Path

API_BASE = "https://generativelanguage.googleapis.com/v1beta"
VIDEO_MODEL = os.getenv("GEMINI_VIDEO_MODEL", "gemini-omni-1.1-flash")
TTS_MODEL = os.getenv("GEMINI_TTS_MODEL", "gemini-3.8-flash-tts")
TTS_FALLBACK_MODEL = os.getenv("GEMINI_TTS_FALLBACK_MODEL", "gemini-3.8-flash-lite-tts")
TTS_VOICE = os.getenv("GEMINI_TTS_VOICE", "Charon")
MUSIC_MODEL = os.getenv("LYRIA_MODEL", "lyria-3.5")
OUTPUT_DIR = Path(os.getenv("AHM_OUTPUT_DIR", "/tmp/ahm-output"))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def log(message):
    print(f"[AHM] {message}", flush=True)


def api_request(path, method="GET", payload=None, timeout=900, raw=False):
    key = os.getenv("GEMINI_API_KEY", "")
    if not key:
        raise RuntimeError("GEMINI_API_KEY is missing in the RunPod worker environment.")
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        path if path.startswith("https://") else API_BASE + path,
        data=body,
        method=method,
        headers={
            "x-goog-api-key": key,
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = response.read()
            return data if raw else json.loads(data.decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(detail)
            detail = parsed.get("error", {}).get("message", detail)
        except Exception:
            pass
        raise RuntimeError(f"Gemini API HTTP {error.code}: {detail}") from error


def media_blocks(interaction, media_type):
    blocks = []
    for step in interaction.get("steps", []):
        if step.get("type") != "model_output":
            continue
        for block in step.get("content", []):
            if block.get("type") == media_type:
                blocks.append(block)
    return blocks


def wait_for_interaction(interaction, timeout=1200):
    if interaction.get("status") == "failed":
        raise RuntimeError("Gemini generation failed: " + json.dumps(interaction.get("errors", []))[:1000])
    if interaction.get("status") == "completed":
        return interaction
    interaction_id = interaction.get("id")
    if not interaction_id:
        raise RuntimeError("Gemini did not return an interaction ID or completed output.")
    started = time.time()
    while time.time() - started < timeout:
        time.sleep(8)
        interaction = api_request("/interactions/" + interaction_id)
        status = interaction.get("status")
        log(f"Gemini interaction {interaction_id}: {status}")
        if status == "completed":
            return interaction
        if status == "failed":
            raise RuntimeError("Gemini generation failed: " + json.dumps(interaction.get("errors", []))[:1000])
    raise TimeoutError("Gemini media generation timed out.")


def decode_media_block(block, destination):
    data = block.get("data")
    if data:
        Path(destination).write_bytes(base64.b64decode(data))
        return destination
    uri = block.get("uri")
    if uri:
        raw = api_request(uri, raw=True, timeout=900)
        Path(destination).write_bytes(raw)
        return destination
    raise RuntimeError("Gemini returned a media block without data or URI.")


def scene_duration(scene):
    try:
        value = float(scene.get("durationSec") or (float(scene.get("end", 0)) - float(scene.get("start", 0))))
    except (TypeError, ValueError):
        value = 6.0
    return max(3.0, min(10.0, value))


def expand_scene_segments(scenes):
    segments = []
    for scene in scenes:
        try:
            remaining = max(3.0, float(scene.get("durationSec") or (float(scene.get("end", 0)) - float(scene.get("start", 0)))))
        except (TypeError, ValueError):
            remaining = 6.0
        part = 0
        while remaining > 0.01:
            length = min(10.0, remaining)
            segment = dict(scene)
            segment["durationSec"] = length
            if part:
                segment["action"] = str(scene.get("action", "")) + " Continue the same action naturally from the previous segment; do not restart or change the subject."
            segment["segmentIndex"] = part
            segments.append(segment)
            remaining -= length
            part += 1
    return segments


def scene_prompt(story, scene, index, total):
    cast = "\n".join(
        f"{item.get('name', 'Character')}: {item.get('description', '')}"
        for item in story.get("characters", [])
    )
    environments = "\n".join(
        f"{item.get('name', 'Environment')}: {item.get('description', '')}"
        for item in story.get("environments", [])
    )
    props = "\n".join(
        f"{item.get('name', 'Prop')}: {item.get('description', '')}"
        for item in story.get("props", [])
    )
    return f"""
Create one self-contained {scene_duration(scene):.0f}-second vertical 9:16 cinematic 3D animated video clip.
This is scene {index + 1} of {total} in the same complete AHM Studio explainer.
VISUAL STYLE: polished stylized-realistic 3D cinema, expressive subject animation, premium materials,
dramatic motivated lighting, dimensional environments, strong composition, crisp detail and dynamic camera.
TOPIC: {story.get('topic') or story.get('title', '')}
SCENE ACTION: {scene.get('action', '')}
VISUAL DIRECTION: {scene.get('visualPrompt', '')}
CAMERA: {scene.get('camera') or scene.get('shot', '')}
EMOTION: {scene.get('emotion', '')}
ENVIRONMENT CONTINUITY:
{environments}
CHARACTER CONTINUITY:
{cast}
PROP CONTINUITY:
{props}
SOUND: create appropriate synchronized environmental ambience and precise sound effects for this action.
Do not add narration, spoken dialogue, background music, subtitles, captions, labels, logos or watermarks.
Do not introduce unrelated scenes or montage. One coherent continuous shot with clear visible action.
Maintain the exact recurring character designs, props, lighting logic and world continuity described above.
"""


def generate_video_clip(story, scene, index, total, destination):
    prompt = scene_prompt(story, scene, index, total)
    result = api_request("/interactions", "POST", {
        "model": VIDEO_MODEL,
        "input": prompt,
        "response_format": {
            "type": "video",
            "aspect_ratio": "9:16",
            "resolution": "720p",
            "delivery": "uri",
        },
    }, timeout=1200)
    result = wait_for_interaction(result, timeout=1200)
    blocks = media_blocks(result, "video")
    if not blocks:
        raise RuntimeError(f"Scene {index + 1}: Gemini completed without a video output.")
    return decode_media_block(blocks[-1], destination)


def audio_block_data(interaction):
    blocks = media_blocks(interaction, "audio")
    if blocks:
        return base64.b64decode(blocks[-1].get("data", ""))
    output_audio = interaction.get("output_audio")
    if isinstance(output_audio, dict) and output_audio.get("data"):
        return base64.b64decode(output_audio["data"])
    raise RuntimeError("Gemini returned no audio data.")


def write_tts_wav(script, destination):
    prompt = (
        "Read the following narration verbatim. Do not add, omit, paraphrase or repeat any words. "
        "Use a confident, warm, energetic documentary storyteller delivery with clear diction, "
        "natural pauses and expressive emphasis.\n\n" + script
    )
    errors = []
    for model in [TTS_MODEL, TTS_FALLBACK_MODEL]:
        try:
            interaction = api_request("/interactions", "POST", {
                "model": model,
                "input": prompt,
                "response_format": {"type": "audio"},
                "generation_config": {"speech_config": [{"voice": TTS_VOICE}]},
            }, timeout=300)
            interaction = wait_for_interaction(interaction, timeout=300)
            audio = audio_block_data(interaction)
            if audio[:4] == b"RIFF":
                Path(destination).write_bytes(audio)
            else:
                import wave
                with wave.open(str(destination), "wb") as wav:
                    wav.setnchannels(1)
                    wav.setsampwidth(2)
                    wav.setframerate(24000)
                    wav.writeframes(audio)
            return destination
        except Exception as error:
            errors.append(f"{model}: {error}")
            log(f"TTS model {model} failed: {error}")
    raise RuntimeError("Narration generation failed. " + " | ".join(errors))


def generate_music(story, destination):
    if os.getenv("LYRIA_ENABLED", "false").lower() != "true":
        return None
    prompt = (
        "Create an original instrumental cinematic underscore for a short vertical educational explainer. "
        "No vocals, no lyrics, no recognizable existing melody. Use a memorable motif, modern orchestral "
        "hybrid textures, subtle pulse, restrained percussion and emotional rises that support narration. "
        "Keep the midrange clear for speech. Match the subject and emotional arc of this video: "
        + str(story.get("topic") or story.get("title") or "curiosity and discovery")
        + ". Make a complete instrumental track around 90 seconds with a clean ending."
    )
    interaction = api_request("/interactions", "POST", {
        "model": MUSIC_MODEL,
        "input": prompt,
        "response_format": {"type": "audio"},
    }, timeout=600)
    interaction = wait_for_interaction(interaction, timeout=600)
    Path(destination).write_bytes(audio_block_data(interaction))
    return destination


def run_ffmpeg(args):
    result = subprocess.run(args, check=False, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError("FFmpeg failed: " + result.stderr[-2500:])
    return result


def make_srt(story, destination):
    def stamp(seconds):
        milliseconds = max(0, int(round(seconds * 1000)))
        hours, remainder = divmod(milliseconds, 3600000)
        minutes, remainder = divmod(remainder, 60000)
        seconds_part, millis = divmod(remainder, 1000)
        return f"{hours:02}:{minutes:02}:{seconds_part:02},{millis:03}"

    rows = []
    cue = 1
    for scene in story.get("scenes", []):
        text = str(scene.get("narration") or scene.get("action") or "").strip()
        if not text:
            continue
        phrases = scene.get("subtitlePhrases") or re.findall(r"[^.!?]+[.!?]?", text)
        phrases = [str(value).strip() for value in phrases if str(value).strip()]
        if not phrases:
            continue
        start = float(scene.get("start", 0))
        end = float(scene.get("end", start + 4))
        weights = [max(1, len(value.split())) for value in phrases]
        total = sum(weights)
        cursor = start
        for index, phrase in enumerate(phrases):
            next_cursor = end if index == len(phrases) - 1 else cursor + (end - start) * weights[index] / total
            rows.append(f"{cue}\n{stamp(cursor)} --> {stamp(next_cursor)}\n{phrase}\n")
            cue += 1
            cursor = next_cursor
    Path(destination).write_text("\n".join(rows), encoding="utf-8")
    return destination


def normalize_clip(source, destination, duration, ambience_path):
    run_ffmpeg([
        "ffmpeg", "-y", "-i", str(source),
        "-vf", "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,fps=24,setsar=1,tpad=stop_mode=clone:stop_duration=10",
        "-an", "-t", str(duration), "-c:v", "libx264", "-preset", "veryfast",
        "-crf", "21", "-pix_fmt", "yuv420p", str(destination),
    ])
    try:
        run_ffmpeg([
            "ffmpeg", "-y", "-i", str(source), "-vn",
            "-af", f"volume=0.32,apad,atrim=duration={duration}",
            "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", str(ambience_path),
        ])
    except RuntimeError:
        run_ffmpeg([
            "ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
            "-t", str(duration), "-c:a", "pcm_s16le", str(ambience_path),
        ])


def upload_to_supabase(file_path, job_id):
    base = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    bucket = os.getenv("SUPABASE_BUCKET", "ahm-videos")
    if not base or not key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for durable video downloads.")
    object_path = f"{job_id}/final.mp4"
    headers = {
        "Authorization": f"Bearer {key}",
        "apikey": key,
        "Content-Type": "video/mp4",
        "x-upsert": "true",
    }
    url = f"{base}/storage/v1/object/{bucket}/{object_path}"
    body = Path(file_path).read_bytes()
    request = urllib.request.Request(url, data=body, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=600) as response:
            response.read()
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Supabase video upload failed (HTTP {error.code}): {detail}") from error

    signed_url = f"{base}/storage/v1/object/sign/{bucket}/{object_path}"
    signed_request = urllib.request.Request(
        signed_url,
        data=json.dumps({"expiresIn": 604800}).encode("utf-8"),
        method="POST",
        headers={"Authorization": f"Bearer {key}", "apikey": key, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(signed_request, timeout=60) as response:
        signed = json.loads(response.read().decode("utf-8"))
    path = signed.get("signedURL") or signed.get("signedUrl")
    if not path:
        raise RuntimeError("Supabase did not return a signed download URL.")
    return path if path.startswith("http") else base + path


def process_job(event):
    payload = event.get("input", event) if isinstance(event, dict) else {}
    story = payload.get("story") or {}
    scenes = story.get("scenes") or []
    if not scenes:
        raise ValueError("The video job needs a complete AI Director scene plan.")
    scenes = expand_scene_segments(scenes)
    if not os.getenv("GEMINI_API_KEY"):
        raise RuntimeError("GEMINI_API_KEY is missing in the RunPod worker environment.")

    job_id = str(payload.get("job_id") or uuid.uuid4())
    log(f"Starting complete AHM production: {job_id} ({len(scenes)} scenes)")
    with tempfile.TemporaryDirectory(prefix="ahm-") as temp:
        work = Path(temp)
        normalized = []
        ambience = []
        total_duration = min(120, max(30, int(story.get("durationSec") or 45)))
        for index, scene in enumerate(scenes):
            duration = scene_duration(scene)
            raw = work / f"scene_{index + 1:02}.mp4"
            video = work / f"normalized_{index + 1:02}.mp4"
            fx = work / f"ambience_{index + 1:02}.wav"
            log(f"Generating cinematic scene {index + 1}/{len(scenes)}")
            generate_video_clip(story, scene, index, len(scenes), raw)
            normalize_clip(raw, video, duration, fx)
            normalized.append(video)
            ambience.append(fx)

        concat_file = work / "clips.txt"
        concat_file.write_text("".join(f"file '{path.as_posix()}'\n" for path in normalized), encoding="utf-8")
        video_only = work / "picture.mp4"
        run_ffmpeg(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_file), "-c", "copy", str(video_only)])

        ambience_list = work / "ambience.txt"
        ambience_list.write_text("".join(f"file '{path.as_posix()}'\n" for path in ambience), encoding="utf-8")
        ambience_all = work / "ambience.wav"
        run_ffmpeg(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(ambience_list), "-c", "copy", str(ambience_all)])

        voice = work / "narration.wav"
        write_tts_wav(str(story.get("narration") or ""), voice)
        music = generate_music(story, work / "music.mp3")
        subtitles = make_srt(story, work / "captions.srt")
        final = work / "final.mp4"

        filter_parts = [
            "[1:a]volume=1.0[voice]",
            "[2:a]volume=0.25[fx]",
        ]
        inputs = ["-i", str(video_only), "-i", str(voice), "-i", str(ambience_all)]
        labels = ["[voice]", "[fx]"]
        if music:
            inputs.extend(["-stream_loop", "-1", "-i", str(music)])
            filter_parts.append("[3:a]volume=0.16[music]")
            labels.append("[music]")
        filter_parts.append("".join(labels) + f"amix=inputs={len(labels)}:duration=longest:dropout_transition=2,loudnorm=I=-16:LRA=11:TP=-1.5[audio]")
        subtitle_filter = "subtitles=" + str(subtitles).replace(":", "\\:").replace("'", "\\'") + ":force_style='FontName=DejaVu Sans,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=3,Shadow=1,Alignment=2,MarginV=110'"
        command = ["ffmpeg", "-y", *inputs, "-filter_complex", ";".join(filter_parts),
                   "-vf", subtitle_filter, "-map", "0:v:0", "-map", "[audio]",
                   "-t", str(total_duration), "-c:v", "libx264", "-preset", "veryfast",
                   "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
                   "-movflags", "+faststart", str(final)]
        run_ffmpeg(command)

        final_url = upload_to_supabase(final, job_id)
        log(f"Production complete: {job_id}")
        return {
            "job_id": job_id,
            "status": "completed",
            "finalVideoUrl": final_url,
            "durationSec": total_duration,
            "sceneCount": len(scenes),
            "audio": {
                "narration": "generated",
                "sceneSoundEffects": "generated_with_video",
                "backgroundMusic": "generated" if music else "not_enabled",
            },
            "format": "mp4",
            "resolution": "720x1280",
        }


def handler(event):
    try:
        return process_job(event)
    except Exception as error:
        log(f"JOB FAILED: {error}")
        return {"status": "failed", "error": str(error)}


if __name__ == "__main__":
    import runpod
    runpod.serverless.start({"handler": handler})
