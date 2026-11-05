import json
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, "/app")
from handler import assemble_final_video, fit_voice_clip, make_srt, normalize_clip, probe_audio_duration, run_ffmpeg


def main():
    with tempfile.TemporaryDirectory(prefix="ahm-ffmpeg-smoke-") as temp:
        work = Path(temp)
        normalized = []
        ambience = []
        for index, color in enumerate(("blue", "orange"), start=1):
            raw = work / f"raw_{index}.mp4"
            video = work / f"video_{index}.mp4"
            fx = work / f"fx_{index}.wav"
            run_ffmpeg([
                "ffmpeg", "-y",
                "-f", "lavfi", "-i", f"color=c={color}:s=360x640:r=24:d=2",
                "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2",
                "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                "-c:a", "aac", str(raw),
            ])
            normalize_clip(raw, video, 2, fx)
            normalized.append(video)
            ambience.append(fx)

        raw_voice_1 = work / "raw_voice_1.wav"
        raw_voice_2 = work / "raw_voice_2.wav"
        run_ffmpeg([
            "ffmpeg", "-y", "-f", "lavfi", "-i",
            "sine=frequency=660:sample_rate=24000:duration=3",
            "-c:a", "pcm_s16le", "-ar", "24000", "-ac", "1", str(raw_voice_1),
        ])
        run_ffmpeg([
            "ffmpeg", "-y", "-f", "lavfi", "-i",
            "sine=frequency=550:sample_rate=24000:duration=1",
            "-c:a", "pcm_s16le", "-ar", "24000", "-ac", "1", str(raw_voice_2),
        ])
        voice_part_1 = work / "voice_part_1.wav"
        voice_part_2 = work / "voice_part_2.wav"
        fit_voice_clip(raw_voice_1, voice_part_1, 2)
        fit_voice_clip(raw_voice_2, voice_part_2, 2)
        assert abs(probe_audio_duration(voice_part_1) - 2) < 0.1
        assert abs(probe_audio_duration(voice_part_2) - 2) < 0.1
        voice_list = work / "voice_list.txt"
        voice_list.write_text(
            f"file '{voice_part_1.as_posix()}'\n" + f"file '{voice_part_2.as_posix()}'\n",
            encoding="utf-8",
        )
        voice = work / "voice.wav"
        run_ffmpeg([
            "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(voice_list),
            "-c", "copy", str(voice),
        ])
        subtitles = work / "captions.srt"
        make_srt({
            "scenes": [
                {"start": 0, "end": 2, "narration": "This is the first test scene.", "subtitlePhrases": ["This is the first test scene."]},
                {"start": 2, "end": 4, "narration": "This is the second test scene.", "subtitlePhrases": ["This is the second test scene."]},
            ]
        }, subtitles)
        final = work / "final.mp4"
        assemble_final_video(normalized, ambience, voice, None, subtitles, 4, work, final)

        probe = subprocess.run([
            "ffprobe", "-v", "error", "-show_entries",
            "stream=codec_type,codec_name,width,height", "-show_entries",
            "format=duration", "-of", "json", str(final),
        ], check=True, capture_output=True, text=True)
        result = json.loads(probe.stdout)
        video_stream = next(stream for stream in result["streams"] if stream["codec_type"] == "video")
        audio_stream = next(stream for stream in result["streams"] if stream["codec_type"] == "audio")
        duration = float(result["format"]["duration"])
        assert video_stream["codec_name"] == "h264", video_stream
        assert video_stream["width"] == 720 and video_stream["height"] == 1280, video_stream
        assert audio_stream["codec_name"] == "aac", audio_stream
        assert 3.8 <= duration <= 4.2, duration
        assert final.stat().st_size > 10000
        print("AHM FFmpeg smoke test passed:", video_stream, audio_stream, "duration", duration)


if __name__ == "__main__":
    main()
