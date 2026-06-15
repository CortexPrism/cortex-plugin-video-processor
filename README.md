# Cortex Plugin: Video & Audio Processor

Transcribe, translate, caption, clip video/audio files using FFmpeg and Whisper.

## Installation

```bash
cortex plugin install github:CortexPrism/cortex-plugin-video-processor
```

## Tools

### video_transcribe
Transcribe video or audio to text/subtitles.
- `file_path` (string, required) — Path to video or audio file
- `language` (string, default: "en") — Language code
- `output` (enum) — Output format: text, srt, vtt, json
- `model` (enum) — Whisper model: tiny, base, small, medium, large

### video_translate
Translate a transcript to another language.
- `transcript` (string, required) — Transcript text to translate
- `target_language` (string, required) — Target language ISO code
- `source_language` (string, default: "en") — Source language ISO code

### video_generate_captions
Generate subtitle captions for a video file.
- `file_path` (string, required) — Path to video file
- `language` (string, default: "en") — Caption language
- `format` (enum) — Subtitle format: srt, vtt, ass

### video_extract_clip
Extract a clip from a video.
- `file_path` (string, required) — Path to video file
- `start_time` (string, required) — Start timestamp (HH:MM:SS)
- `duration` (string, required) — Duration in seconds or HH:MM:SS
- `output_path` (string, required) — Output file path

### video_extract_highlights
Extract a highlight reel from a video.
- `file_path` (string, required) — Path to video file
- `transcript` (string, required) — Transcript for highlight detection
- `max_duration` (number, default: 60) — Max highlight reel duration in seconds

## Configuration

| Key | Type | Description |
|-----|------|-------------|
| `ffmpegPath` | text | Path to ffmpeg executable (default: "ffmpeg") |
| `whisperModel` | select | Default Whisper model: tiny, base, small, medium, large |

## Development

```bash
deno task test
deno fmt
deno lint
```

## License

MIT
