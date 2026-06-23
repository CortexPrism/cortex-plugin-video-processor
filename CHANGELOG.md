# Changelog


## [1.1.1] — 2026-06-22

### Changed

- Migrated to CortexPrism v0.51.0 plugin API
- Renamed `ToolResult` → `ToolCallResult` to match SDK types
- Switched type imports from local `types.ts` to `cortex/plugins` module
- Updated `peerDependencies.cortex` to `>=0.51.0`
- Standardized UI settings: `default` → `defaultValue`, `enum` → `options` for select fields
- All code passes `deno fmt` and `deno lint`
## [Unreleased]

### Changed

- Renamed manifest file from `cortex.json` to `manifest.json` for consistency with Cortex standard
- Standardized UI section structure to `ui.settings` format
- Normalized parameter naming: `defaultValue` → `default`, `options` → `enum`
- Added `homepage` field with repository URL
- Added `dependencies` field to manifest

### Added (v1.1.0)

- Real ffmpeg integration for video/audio processing, clip extraction, and highlight generation
- OpenAI Whisper API integration for audio transcription
- ffprobe media file probing for duration, format, and stream analysis
- Subtitle extraction from media containers via ffmpeg
- Timestamp-based highlight reel generation from transcripts

## [1.0.1] — 2026-06-15

### Added

- Initial release

## [1.0.1] — 2026-06-17

### Added

- Initial project setup

## [1.0.0] — 2026-06-15

### Added

- Initial release of cortex-plugin-video-processor
- `video_transcribe` — Transcribe video/audio using Whisper (multiple model sizes)
- `video_translate` — Translate transcripts between languages
- `video_generate_captions` — Generate SRT, VTT, or ASS captions
- `video_extract_clip` — Extract clips by start time and duration
- `video_extract_highlights` — Extract highlight reels using transcript analysis
- UI settings for FFmpeg path and default Whisper model
