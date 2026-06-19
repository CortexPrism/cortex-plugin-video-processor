// deno-lint-ignore-file require-await
import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { tools } from '../../mod.ts';
import type { PluginContext, ToolContext } from '../../types.ts';

// Mock PluginContext
const mockContext: PluginContext & ToolContext = {
  pluginId: 'cortex-plugin-video-processor',
  pluginDir: '/tmp/plugins/cortex-plugin-video-processor',
  state: {
    get: async () => null,
    set: async () => {},
    delete: async () => {},
    list: async () => ({}),
  },
  config: {
    get: async () => null,
    set: async () => {},
    getAll: async () => ({}),
  },
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
  host: {
    registerTool: () => {},
    unregisterTool: () => {},
  },
  sessionId: 'test-session',
  workingDir: '/tmp',
  agentId: 'test-agent',
  workspaceDir: '/tmp',
};

function findTool(name: string) {
  const tool = tools.find((t) => t.definition.name === name);
  if (!tool) throw new Error(`Tool "${name}" not found`);
  return tool;
}

Deno.test('tools array — exports all tools', () => {
  assertEquals(tools.length, 5);
  assertEquals(tools[0].definition.name, 'video_transcribe');
  assertEquals(tools[1].definition.name, 'video_translate');
  assertEquals(tools[2].definition.name, 'video_generate_captions');
  assertEquals(tools[3].definition.name, 'video_extract_clip');
  assertEquals(tools[4].definition.name, 'video_extract_highlights');
});

Deno.test('video_transcribe — rejects empty file_path', async () => {
  const tool = findTool('video_transcribe');
  const result = await tool.execute({ 'file_path': '' }, mockContext);
  assertEquals(result.success, false);
  assertStringIncludes(result.error ?? '', 'non-empty string');
});

Deno.test('video_translate — rejects empty transcript', async () => {
  const tool = findTool('video_translate');
  const result = await tool.execute({ 'transcript': '' }, mockContext);
  assertEquals(result.success, false);
  assertStringIncludes(result.error ?? '', 'non-empty string');
});

Deno.test('video_generate_captions — rejects empty file_path', async () => {
  const tool = findTool('video_generate_captions');
  const result = await tool.execute({ 'file_path': '' }, mockContext);
  assertEquals(result.success, false);
  assertStringIncludes(result.error ?? '', 'non-empty string');
});

Deno.test('video_extract_clip — rejects empty file_path', async () => {
  const tool = findTool('video_extract_clip');
  const result = await tool.execute({ 'file_path': '' }, mockContext);
  assertEquals(result.success, false);
  assertStringIncludes(result.error ?? '', 'non-empty string');
});

Deno.test('video_extract_highlights — rejects empty file_path', async () => {
  const tool = findTool('video_extract_highlights');
  const result = await tool.execute({ 'file_path': '' }, mockContext);
  assertEquals(result.success, false);
  assertStringIncludes(result.error ?? '', 'non-empty string');
});

Deno.test('all tools return durationMs', async () => {
  for (const tool of tools) {
    const args: Record<string, unknown> = {};
    const result = await tool.execute(args, mockContext);
    assertEquals(typeof result.durationMs, 'number');
    assertEquals(result.durationMs >= 0, true);
  }
});
