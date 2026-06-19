// deno-lint-ignore-file
/**
 * CortexPrism Video & Audio Processing Plugin
 *
 * Provides tools for video/audio transcription, translation, caption
 * generation, clip extraction, and highlight reel creation.
 *
 * Depends on:
 *   - ffmpeg / ffprobe (system-installed) for media processing
 *   - OpenAI Whisper API (configurable) for transcription
 *
 * All tools use the `shell:run` capability. The plugin constructs
 * ffmpeg commands and executes them via ctx.shell.run().
 */

import type { PluginContext, Tool, ToolCallResult, ToolContext } from './types.ts';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

interface VideoConfig {
  whisperApiKey: string;
  whisperBaseUrl: string;
  whisperModel: string;
  ffmpegPath: string;
  ffprobePath: string;
  defaultLanguage: string;
}

let config: VideoConfig = {
  whisperApiKey: '',
  whisperBaseUrl: 'https://api.openai.com/v1',
  whisperModel: 'whisper-1',
  ffmpegPath: 'ffmpeg',
  ffprobePath: 'ffprobe',
  defaultLanguage: 'en',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateFilePath(path: unknown, toolName: string, start: number): ToolCallResult | null {
  if (!path || typeof path !== 'string') {
    return {
      toolName,
      success: false,
      output: '',
      error: 'file_path must be a non-empty string',
      durationMs: Date.now() - start,
    };
  }
  return null;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${
    s.toString().padStart(2, '0')
  }`;
}

interface FfprobeData {
  duration: number;
  format: string;
  streams: Array<
    { codec_type: string; codec_name: string; channels?: number; sample_rate?: number }
  >;
}

/**
 * Probe a media file to get duration, format, and stream info.
 * Returns null if ffprobe is not available.
 */
async function probeMedia(filePath: string): Promise<FfprobeData | null> {
  try {
    const cmd = new Deno.Command(config.ffprobePath, {
      args: [
        '-v',
        'quiet',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        filePath,
      ],
      stdout: 'piped',
      stderr: 'piped',
    });
    const output = await cmd.output();
    if (!output.success) return null;

    const json = JSON.parse(new TextDecoder().decode(output.stdout)) as {
      format?: { duration?: string; format_name?: string };
      streams?: Array<
        { codec_type: string; codec_name: string; channels?: number; sample_rate?: number }
      >;
    };

    return {
      duration: parseFloat(json.format?.duration || '0'),
      format: json.format?.format_name || 'unknown',
      streams: (json.streams || []).map((s) => ({
        codec_type: s.codec_type,
        codec_name: s.codec_name,
        channels: s.channels,
        sample_rate: s.sample_rate,
      })),
    };
  } catch {
    return null;
  }
}

/**
 * Call OpenAI Whisper API for transcription.
 */
async function transcribeAudio(
  filePath: string,
  language: string,
  responseFormat: string,
): Promise<string> {
  if (!config.whisperApiKey) {
    return `[Whisper API key not configured. Install ffmpeg + whisper locally for offline transcription: ${filePath}]`;
  }

  // Read audio file as base64
  let fileBytes: Uint8Array;
  try {
    fileBytes = await Deno.readFile(filePath);
  } catch {
    return `[Could not read file: ${filePath}]`;
  }

  const b64 = btoa(String.fromCharCode(...fileBytes));

  const res = await fetch(`${config.whisperBaseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.whisperApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.whisperModel,
      file: b64,
      language,
      response_format: responseFormat === 'json' ? 'verbose_json' : responseFormat,
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const errText = await res.text();
    return `[Whisper API error ${res.status}: ${errText}]`;
  }

  const data = await res.json() as { text?: string };
  return data.text || '[No transcription returned]';
}

// ---------------------------------------------------------------------------
// Tool: video_transcribe
// ---------------------------------------------------------------------------

const video_transcribe: Tool = {
  definition: {
    name: 'video_transcribe',
    description: 'Transcribe video/audio to text using Whisper API or local ffmpeg extraction',
    params: [
      {
        name: 'file_path',
        type: 'string',
        description: 'Path to video or audio file',
        required: true,
      },
      { name: 'language', type: 'string', description: 'Language code (ISO 639-1)', default: 'en' },
      {
        name: 'output',
        type: 'string',
        description: 'Output format',
        default: 'text',
        enum: ['text', 'srt', 'vtt', 'json'],
      },
      {
        name: 'model',
        type: 'string',
        description: 'Transcription model or engine',
        default: 'whisper-1',
        enum: ['whisper-1', 'whisper-local', 'ffmpeg-extract'],
      },
    ],
    capabilities: ['shell:run', 'fs:read'],
  },
  execute: async (args: Record<string, unknown>, ctx: ToolContext): Promise<ToolCallResult> => {
    const start = Date.now();
    try {
      const filePath = args.file_path;
      if (!filePath || typeof filePath !== 'string') {
        return {
          toolName: 'video_transcribe',
          success: false,
          output: '',
          error: 'file_path must be a non-empty string',
          durationMs: Date.now() - start,
        };
      }

      const language = (typeof args.language === 'string' && args.language) ||
        config.defaultLanguage || 'en';
      const outputFmt = (typeof args.output === 'string' && args.output) || 'text';
      const model = (typeof args.model === 'string' && args.model) || 'whisper-1';

      // Probe media for context
      const probe = await probeMedia(filePath);

      // Option 1: Use Whisper API
      if (model === 'whisper-1' && config.whisperApiKey) {
        const transcription = await transcribeAudio(filePath, language, outputFmt);
        const result = {
          file: filePath,
          language,
          model,
          format: outputFmt,
          duration: probe ? formatDuration(probe.duration) : 'unknown',
          transcription,
        };
        return {
          toolName: 'video_transcribe',
          success: true,
          output: JSON.stringify(result, null, 2),
          durationMs: Date.now() - start,
        };
      }

      // Option 2: Extract audio with ffmpeg and use local whisper
      if (model === 'whisper-local') {
        try {
          const tempWav = `/tmp/cortexprism_transcribe_${Date.now()}.wav`;
          const extractCmd = new Deno.Command(config.ffmpegPath, {
            args: [
              '-i',
              filePath,
              '-vn',
              '-acodec',
              'pcm_s16le',
              '-ar',
              '16000',
              '-ac',
              '1',
              tempWav,
              '-y',
            ],
          });
          await extractCmd.output();

          const whisperCmd = new Deno.Command('whisper', {
            args: [
              tempWav,
              '--language',
              language,
              '--model',
              config.whisperModel,
              '--output_format',
              outputFmt,
            ],
            stdout: 'piped',
          });
          const whisperOut = await whisperCmd.output();
          const text = new TextDecoder().decode(whisperOut.stdout);

          // Cleanup temp file
          try {
            await Deno.remove(tempWav);
          } catch { /* ignore */ }

          return {
            toolName: 'video_transcribe',
            success: true,
            output: text,
            durationMs: Date.now() - start,
          };
        } catch (e) {
          return {
            toolName: 'video_transcribe',
            success: false,
            output: '',
            error: `Local whisper failed: ${
              e instanceof Error ? e.message : String(e)
            }. Ensure whisper is installed (pip install openai-whisper).`,
            durationMs: Date.now() - start,
          };
        }
      }

      // Option 3: ffmpeg stream extraction (just extract embedded subtitles or audio stream info)
      try {
        const probeData = await probeMedia(filePath);
        if (!probeData) {
          return {
            toolName: 'video_transcribe',
            success: false,
            output: '',
            error: `Could not probe media file: ${filePath}`,
            durationMs: Date.now() - start,
          };
        }
        const audioStreams = probeData.streams.filter((s) => s.codec_type === 'audio');
        const result = {
          file: filePath,
          language,
          format: outputFmt,
          duration: formatDuration(probeData.duration),
          streams: probeData.streams,
          note: audioStreams.length > 0
            ? `Found ${audioStreams.length} audio stream(s). Configure whisperApiKey for full transcription.`
            : 'No audio streams found. File may be video-only.',
        };
        return {
          toolName: 'video_transcribe',
          success: true,
          output: JSON.stringify(result, null, 2),
          durationMs: Date.now() - start,
        };
      } catch (e) {
        return {
          toolName: 'video_transcribe',
          success: false,
          output: '',
          error: `ffprobe failed: ${e instanceof Error ? e.message : String(e)}`,
          durationMs: Date.now() - start,
        };
      }
    } catch (error) {
      return {
        toolName: 'video_transcribe',
        success: false,
        output: '',
        error: `Failed to transcribe: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - start,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Tool: video_translate
// ---------------------------------------------------------------------------

const video_translate: Tool = {
  definition: {
    name: 'video_translate',
    description: 'Translate a transcript to another language using configured translation service',
    params: [
      {
        name: 'transcript',
        type: 'string',
        description: 'Transcript text to translate',
        required: true,
      },
      {
        name: 'target_language',
        type: 'string',
        description: 'Target language ISO 639-1 code',
        required: true,
      },
      {
        name: 'source_language',
        type: 'string',
        description: 'Source language ISO 639-1 code',
        default: 'en',
      },
    ],
    capabilities: ['network:fetch'],
  },
  execute: async (args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolCallResult> => {
    const start = Date.now();
    try {
      const transcript = args.transcript;
      const targetLang = args.target_language;
      if (!transcript || typeof transcript !== 'string') {
        return {
          toolName: 'video_translate',
          success: false,
          output: '',
          error: 'transcript is required',
          durationMs: Date.now() - start,
        };
      }
      if (!targetLang || typeof targetLang !== 'string') {
        return {
          toolName: 'video_translate',
          success: false,
          output: '',
          error: 'target_language is required',
          durationMs: Date.now() - start,
        };
      }

      const sourceLang = (typeof args.source_language === 'string' && args.source_language) ||
        config.defaultLanguage || 'en';

      // Use OpenAI-compatible translation if API key is configured
      if (config.whisperApiKey) {
        const res = await fetch(`${config.whisperBaseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.whisperApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content:
                  `You are a translator. Translate the following text from ${sourceLang} to ${targetLang}. Return ONLY the translated text, no explanations.`,
              },
              { role: 'user', content: transcript },
            ],
            max_tokens: Math.min(transcript.length * 2, 16000),
            temperature: 0.3,
          }),
          signal: AbortSignal.timeout(60000),
        });

        if (res.ok) {
          const data = await res.json() as { choices: Array<{ message: { content: string } }> };
          const translation = data.choices?.[0]?.message?.content || '[Translation returned empty]';
          return {
            toolName: 'video_translate',
            success: true,
            output: JSON.stringify(
              {
                sourceLanguage: sourceLang,
                targetLanguage: targetLang,
                originalLength: transcript.length,
                translation,
              },
              null,
              2,
            ),
            durationMs: Date.now() - start,
          };
        }
      }

      // Fallback: return structured metadata (real translation requires API key)
      return {
        toolName: 'video_translate',
        success: true,
        output: JSON.stringify(
          {
            sourceLanguage: sourceLang,
            targetLanguage: targetLang,
            originalLength: transcript.length,
            originalPreview: transcript.substring(0, 200) + (transcript.length > 200 ? '...' : ''),
            note:
              'Translation requires whisperApiKey config (uses OpenAI translation). Configure api key for full translation.',
          },
          null,
          2,
        ),
        durationMs: Date.now() - start,
      };
    } catch (error) {
      return {
        toolName: 'video_translate',
        success: false,
        output: '',
        error: `Failed to translate: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - start,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Tool: video_generate_captions
// ---------------------------------------------------------------------------

const video_generate_captions: Tool = {
  definition: {
    name: 'video_generate_captions',
    description: 'Generate subtitle captions for a video file using ffmpeg',
    params: [
      { name: 'file_path', type: 'string', description: 'Path to video file', required: true },
      { name: 'language', type: 'string', description: 'Language code', default: 'en' },
      {
        name: 'format',
        type: 'string',
        description: 'Subtitle output format',
        default: 'srt',
        enum: ['srt', 'vtt', 'ass'],
      },
    ],
    capabilities: ['shell:run', 'fs:read'],
  },
  execute: async (args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolCallResult> => {
    const start = Date.now();
    try {
      const filePath = args.file_path;
      if (!filePath || typeof filePath !== 'string') {
        return {
          toolName: 'video_generate_captions',
          success: false,
          output: '',
          error: 'file_path is required',
          durationMs: Date.now() - start,
        };
      }

      const language = (typeof args.language === 'string' && args.language) ||
        config.defaultLanguage || 'en';
      const fmt = (typeof args.format === 'string' && args.format) || 'srt';

      const probe = await probeMedia(filePath);

      // If whisper API key is available, transcribe and save as subtitle format
      if (config.whisperApiKey) {
        const transcription = await transcribeAudio(filePath, language, fmt);
        const baseName = filePath.replace(/\.[^.]+$/, '');
        const subtitlePath = `${baseName}.${fmt}`;

        try {
          await Deno.writeTextFile(subtitlePath, transcription);
        } catch {
          return {
            toolName: 'video_generate_captions',
            success: false,
            output: '',
            error: `Could not write subtitle file: ${subtitlePath}`,
            durationMs: Date.now() - start,
          };
        }

        return {
          toolName: 'video_generate_captions',
          success: true,
          output: JSON.stringify(
            {
              file: filePath,
              language,
              format: fmt,
              subtitleFile: subtitlePath,
              duration: probe ? formatDuration(probe.duration) : 'unknown',
              transcription,
            },
            null,
            2,
          ),
          durationMs: Date.now() - start,
        };
      }

      // Without API key: extract existing subtitle streams via ffmpeg
      try {
        const baseName = filePath.replace(/\.[^.]+$/, '');
        const subtitlePath = `${baseName}_extracted.${fmt}`;
        const cmd = new Deno.Command(config.ffmpegPath, {
          args: [
            '-i',
            filePath,
            '-map',
            '0:s:0?',
            '-c:s',
            fmt === 'ass' ? 'ass' : fmt,
            subtitlePath,
            '-y',
          ],
          stdout: 'piped',
          stderr: 'piped',
        });
        const result = await cmd.output();
        const stderr = new TextDecoder().decode(result.stderr);

        if (result.success) {
          return {
            toolName: 'video_generate_captions',
            success: true,
            output: JSON.stringify(
              {
                file: filePath,
                format: fmt,
                subtitleFile: subtitlePath,
                source: 'extracted from media container',
                note: 'Embedded subtitle stream extracted successfully',
              },
              null,
              2,
            ),
            durationMs: Date.now() - start,
          };
        }

        return {
          toolName: 'video_generate_captions',
          success: true,
          output: JSON.stringify(
            {
              file: filePath,
              format: fmt,
              duration: probe ? formatDuration(probe.duration) : 'unknown',
              note:
                'No embedded subtitles found and no whisperApiKey configured. Configure whisperApiKey for AI-powered caption generation, or use files with embedded subtitle tracks.',
              ffmpegOutput: stderr.substring(0, 500),
            },
            null,
            2,
          ),
          durationMs: Date.now() - start,
        };
      } catch (e) {
        return {
          toolName: 'video_generate_captions',
          success: true,
          output: JSON.stringify(
            {
              file: filePath,
              format: fmt,
              status: 'ffmpeg_not_available',
              note:
                'Install ffmpeg for embedded subtitle extraction, or configure whisperApiKey for AI transcription.',
            },
            null,
            2,
          ),
          durationMs: Date.now() - start,
        };
      }
    } catch (error) {
      return {
        toolName: 'video_generate_captions',
        success: false,
        output: '',
        error: `Failed: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - start,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Tool: video_extract_clip
// ---------------------------------------------------------------------------

const video_extract_clip: Tool = {
  definition: {
    name: 'video_extract_clip',
    description: 'Extract a clip from a video file using ffmpeg',
    params: [
      { name: 'file_path', type: 'string', description: 'Path to video file', required: true },
      {
        name: 'start_time',
        type: 'string',
        description: 'Start time (seconds or HH:MM:SS)',
        required: true,
      },
      {
        name: 'duration',
        type: 'string',
        description: 'Duration in seconds or HH:MM:SS',
        required: true,
      },
      { name: 'output_path', type: 'string', description: 'Output file path', required: true },
      {
        name: 'reencode',
        type: 'boolean',
        description: 'Whether to re-encode (slower but more accurate)',
        default: false,
      },
    ],
    capabilities: ['shell:run', 'fs:read'],
  },
  execute: async (args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolCallResult> => {
    const start = Date.now();
    try {
      const filePath = args.file_path;
      const startTime = args.start_time;
      const duration = args.duration;
      const outputPath = args.output_path;
      const reencode = args.reencode === true;

      if (!filePath || typeof filePath !== 'string') {
        return {
          toolName: 'video_extract_clip',
          success: false,
          output: '',
          error: 'file_path is required',
          durationMs: Date.now() - start,
        };
      }
      if (!startTime || typeof startTime !== 'string') {
        return {
          toolName: 'video_extract_clip',
          success: false,
          output: '',
          error: 'start_time is required',
          durationMs: Date.now() - start,
        };
      }
      if (!duration || typeof duration !== 'string') {
        return {
          toolName: 'video_extract_clip',
          success: false,
          output: '',
          error: 'duration is required',
          durationMs: Date.now() - start,
        };
      }
      if (!outputPath || typeof outputPath !== 'string') {
        return {
          toolName: 'video_extract_clip',
          success: false,
          output: '',
          error: 'output_path is required',
          durationMs: Date.now() - start,
        };
      }

      const probe = await probeMedia(filePath);

      try {
        const ffArgs = ['-ss', startTime, '-i', filePath];
        // Parse duration - handle both "5" (seconds) and "00:00:05" formats
        const durationNum = parseFloat(duration);
        if (!isNaN(durationNum)) {
          ffArgs.push('-t', String(durationNum));
        } else {
          ffArgs.push('-t', duration);
        }

        if (!reencode) {
          // Fast extraction: copy codecs without re-encoding
          ffArgs.push('-c', 'copy', '-avoid_negative_ts', 'make_zero');
        }
        ffArgs.push(outputPath, '-y');

        const cmd = new Deno.Command(config.ffmpegPath, {
          args: ffArgs,
          stdout: 'piped',
          stderr: 'piped',
        });
        const result = await cmd.output();

        if (result.success) {
          const resultData: Record<string, unknown> = {
            source: filePath,
            output: outputPath,
            startTime,
            duration,
            reencode,
            sourceInfo: probe
              ? { duration: formatDuration(probe.duration), format: probe.format }
              : null,
          };
          return {
            toolName: 'video_extract_clip',
            success: true,
            output: JSON.stringify(resultData, null, 2),
            durationMs: Date.now() - start,
          };
        }

        const stderr = new TextDecoder().decode(result.stderr);
        return {
          toolName: 'video_extract_clip',
          success: false,
          output: '',
          error: `ffmpeg error: ${stderr.substring(0, 500)}`,
          durationMs: Date.now() - start,
        };
      } catch (e) {
        return {
          toolName: 'video_extract_clip',
          success: false,
          output: '',
          error: `ffmpeg not available: ${
            e instanceof Error ? e.message : String(e)
          }. Install ffmpeg for clip extraction.`,
          durationMs: Date.now() - start,
        };
      }
    } catch (error) {
      return {
        toolName: 'video_extract_clip',
        success: false,
        output: '',
        error: `Failed: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - start,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Tool: video_extract_highlights
// ---------------------------------------------------------------------------

const video_extract_highlights: Tool = {
  definition: {
    name: 'video_extract_highlights',
    description: 'Extract highlight reel from video based on transcript analysis',
    params: [
      { name: 'file_path', type: 'string', description: 'Path to video file', required: true },
      {
        name: 'transcript',
        type: 'string',
        description: 'Transcript with timestamps for highlight detection',
        required: true,
      },
      {
        name: 'max_duration',
        type: 'number',
        description: 'Maximum highlight reel duration in seconds',
        default: 60,
      },
      {
        name: 'output_path',
        type: 'string',
        description: 'Output file path for the highlight reel',
        required: false,
      },
    ],
    capabilities: ['shell:run', 'fs:read'],
  },
  execute: async (args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolCallResult> => {
    const start = Date.now();
    try {
      const filePath = args.file_path;
      const transcript = args.transcript;
      if (!filePath || typeof filePath !== 'string') {
        return {
          toolName: 'video_extract_highlights',
          success: false,
          output: '',
          error: 'file_path is required',
          durationMs: Date.now() - start,
        };
      }
      if (!transcript || typeof transcript !== 'string') {
        return {
          toolName: 'video_extract_highlights',
          success: false,
          output: '',
          error: 'transcript is required',
          durationMs: Date.now() - start,
        };
      }

      const maxDuration = typeof args.max_duration === 'number' && args.max_duration > 0
        ? args.max_duration
        : 60;
      const baseName = filePath.replace(/\.[^.]+$/, '');
      const outputPath = typeof args.output_path === 'string' && args.output_path
        ? args.output_path
        : `${baseName}_highlights_${Date.now()}.mp4`;

      const probe = await probeMedia(filePath);

      // Parse transcript for timestamps
      // Supports formats: [00:00:05] text, (00:05) text, 00:00:05 text, etc.
      const timestampRegex =
        /(\[?\s*\(?\s*)(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?\s*\)?\]?\s*-?\s*/g;
      const segments: Array<{ start: number; text: string }> = [];
      let lastTime = 0;

      const lines = transcript.split('\n');
      for (const line of lines) {
        const match = timestampRegex.exec(line);
        timestampRegex.lastIndex = 0;
        if (match) {
          const hours = parseInt(match[2]) || 0;
          const mins = parseInt(match[3]) || 0;
          const secs = parseInt(match[4]) || 0;
          const totalSecs = hours * 3600 + mins * 60 + secs;
          if (totalSecs > lastTime) {
            segments.push({ start: totalSecs, text: line.replace(timestampRegex, '').trim() });
            lastTime = totalSecs;
          }
        }
      }

      if (segments.length === 0) {
        return {
          toolName: 'video_extract_highlights',
          success: true,
          output: JSON.stringify(
            {
              file: filePath,
              status: 'no_timestamps_found',
              note:
                'Transcript did not contain recognizable timestamps. Use a timestamped transcript (e.g., SRT format) for highlight extraction.',
              transcriptPreview: transcript.substring(0, 300),
            },
            null,
            2,
          ),
          durationMs: Date.now() - start,
        };
      }

      // Use ffmpeg concat demuxer for highlight extraction
      try {
        const concatList = segments.map((seg) => {
          const clipDuration = Math.min(10, maxDuration / segments.length);
          return `file '${filePath}'\ninpoint ${seg.start}\noutpoint ${seg.start + clipDuration}`;
        }).join('\n');

        const concatFilePath = `/tmp/cortexprism_concat_${Date.now()}.txt`;
        await Deno.writeTextFile(concatFilePath, concatList);

        const cmd = new Deno.Command(config.ffmpegPath, {
          args: [
            '-f',
            'concat',
            '-safe',
            '0',
            '-i',
            concatFilePath,
            '-c',
            'copy',
            '-t',
            String(maxDuration),
            outputPath,
            '-y',
          ],
          stdout: 'piped',
          stderr: 'piped',
        });
        const result = await cmd.output();

        // Cleanup
        try {
          await Deno.remove(concatFilePath);
        } catch { /* ignore */ }

        if (result.success) {
          return {
            toolName: 'video_extract_highlights',
            success: true,
            output: JSON.stringify(
              {
                source: filePath,
                output: outputPath,
                segmentsCount: segments.length,
                maxDuration,
                sourceDuration: probe ? formatDuration(probe.duration) : 'unknown',
                segments: segments.map((s) => ({
                  start: formatDuration(s.start),
                  text: s.text.substring(0, 100),
                })),
              },
              null,
              2,
            ),
            durationMs: Date.now() - start,
          };
        }

        const stderr = new TextDecoder().decode(result.stderr);
        return {
          toolName: 'video_extract_highlights',
          success: false,
          output: '',
          error: `ffmpeg concat error: ${stderr.substring(0, 500)}`,
          durationMs: Date.now() - start,
        };
      } catch (e) {
        return {
          toolName: 'video_extract_highlights',
          success: true,
          output: JSON.stringify(
            {
              file: filePath,
              status: 'ffmpeg_not_available',
              note: 'Install ffmpeg for highlight reel generation.',
              segmentsFound: segments.length,
              segments: segments.map((s) => ({
                start: formatDuration(s.start),
                text: s.text.substring(0, 100),
              })),
            },
            null,
            2,
          ),
          durationMs: Date.now() - start,
        };
      }
    } catch (error) {
      return {
        toolName: 'video_extract_highlights',
        success: false,
        output: '',
        error: `Failed: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - start,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Lifecycle hooks
// ---------------------------------------------------------------------------

export async function onLoad(ctx: PluginContext): Promise<void> {
  const cfg = await ctx.config.get();
  config = {
    whisperApiKey: (cfg.whisperApiKey as string) || '',
    whisperBaseUrl: (cfg.whisperBaseUrl as string) || 'https://api.openai.com/v1',
    whisperModel: (cfg.whisperModel as string) || 'whisper-1',
    ffmpegPath: (cfg.ffmpegPath as string) || 'ffmpeg',
    ffprobePath: (cfg.ffprobePath as string) || 'ffprobe',
    defaultLanguage: (cfg.defaultLanguage as string) || 'en',
  };
  ctx.logger.info(
    `[cortex-plugin-video-processor] Loaded with whisper model: ${config.whisperModel}`,
  );
}

export async function onUnload(ctx: PluginContext): Promise<void> {
  ctx.logger.info('[cortex-plugin-video-processor] Unloading...');
}

export const tools: Tool[] = [
  video_transcribe,
  video_translate,
  video_generate_captions,
  video_extract_clip,
  video_extract_highlights,
];
