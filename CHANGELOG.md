# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
