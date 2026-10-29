import os
import json
import time
import uuid
import subprocess
import urllib.request
import urllib.error

RUNPOD_API_KEY = os.getenv("RUNPOD_API_KEY", "")
COMFYUI_URL = os.getenv("COMFYUI_URL", "http://127.0.0.1:8188")

OUTPUT_DIR = "/workspace/outputs"
os.makedirs(OUTPUT_DIR, exist_ok=True)


def log(message):
    print(f"[AHM V8] {message}", flush=True)


def http_json(url, method="GET", data=None):
    body = None

    if data is not None:
        body = json.dumps(data).encode("utf-8")

    request = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers={
            "Content-Type": "application/json"
        }
    )

    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def check_comfyui():
    try:
        http_json(f"{COMFYUI_URL}/system_stats")
        return True
    except Exception as e:
        log(f"ComfyUI not ready: {e}")
        return False


def wait_for_comfyui(timeout=300):
    log("Waiting for ComfyUI...")

    start = time.time()

    while time.time() - start < timeout:
        if check_comfyui():
            log("ComfyUI is ready.")
            return True

        time.sleep(3)

    raise RuntimeError("ComfyUI did not become ready.")


def save_story(job_id, story):
    path = os.path.join(OUTPUT_DIR, f"{job_id}_story.json")

    with open(path, "w", encoding="utf-8") as file:
        json.dump(story, file, indent=2, ensure_ascii=False)

    return path


def create_manifest(job_id, story):
    return {
        "job_id": job_id,
        "project": "AHM Studio V8",
        "aspect_ratio": "9:16",
        "style": "stylized-realistic cinematic 3D",
        "story": story,
        "created_at": int(time.time())
    }


def create_placeholder_video(job_id, duration):
    """
    Temporary local render used only until the selected
    ComfyUI/WAN workflow is connected.

    This deliberately does NOT pretend to be the final
    AHM cinematic generation pipeline.
    """

    output = os.path.join(
        OUTPUT_DIR,
        f"{job_id}_preview.mp4"
    )

    duration = max(1, min(int(duration), 120))

    command = [
        "ffmpeg",
        "-y",
        "-f", "lavfi",
        "-i",
        "color=c=black:s=720x1280:r=30",
        "-t",
        str(duration),
        "-pix_fmt",
        "yuv420p",
        output
    ]

    subprocess.run(
        command,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )

    return output


def process_job(event):
    job_id = event.get("job_id") or str(uuid.uuid4())

    story = event.get("story", {})

    duration = story.get(
        "durationSec",
        event.get("duration_sec", 30)
    )

    log(f"Starting job: {job_id}")
    log(f"Requested duration: {duration}s")

    wait_for_comfyui()

    story_path = save_story(
        job_id,
        story
    )

    manifest = create_manifest(
        job_id,
        story
    )

    manifest_path = os.path.join(
        OUTPUT_DIR,
        f"{job_id}_manifest.json"
    )

    with open(
        manifest_path,
        "w",
        encoding="utf-8"
    ) as file:
        json.dump(
            manifest,
            file,
            indent=2,
            ensure_ascii=False
        )

    log(f"Story saved: {story_path}")

    # ---------------------------------------------------------
    # IMPORTANT
    # ---------------------------------------------------------
    # The actual WAN/ComfyUI generation workflow will be
    # connected here after the exact workflow/model is chosen.
    #
    # We intentionally do not fake a generated cinematic video.
    # ---------------------------------------------------------

    preview = create_placeholder_video(
        job_id,
        duration
    )

    log(f"Worker finished: {preview}")

    return {
        "job_id": job_id,
        "status": "completed",
        "video_path": preview,
        "manifest_path": manifest_path,
        "note": (
            "Worker infrastructure is working. "
            "Connect the selected WAN/ComfyUI workflow "
            "for real cinematic generation."
        )
    }


def handler(event):
    try:
        return process_job(event)

    except Exception as error:
        log(f"JOB FAILED: {error}")

        return {
            "status": "failed",
            "error": str(error)
        }


if __name__ == "__main__":
    # Local test
    test_event = {
        "job_id": "ahm-test",
        "story": {
            "title": "The Golden Fish",
            "durationSec": 30,
            "narration": "This is an AHM Studio test."
        }
    }

    print(
        json.dumps(
            handler(test_event),
            indent=2
        )
    )
