import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, root)));
const schema = read('schemas/tools/upscale_video.schema.json');

test('upscale_video offers RelayVSR by name and keeps FlashVSR the default', () => {
  assert.deepEqual(schema.properties.model.enum, ['flashvsr', 'relayvsr']);
  assert.deepEqual(schema.properties.targetResolution.enum, [1080, 1440, 2160]);
  assert.deepEqual(schema.required, []);
  assert.equal(schema.properties.model.default, undefined);
  assert.match(schema.description, /FlashVSR is the default/);
});

test('both hosted manifests carry the upscale_video schema verbatim', () => {
  for (const path of ['manifests/generation-tools.json', 'manifests/openai-tools.json']) {
    const tool = read(path).tools.find((candidate) => candidate.function.name === 'upscale_video').function;
    assert.equal(tool.description, schema.description);
    assert.deepEqual(tool.parameters.properties, schema.properties);
  }
});

test('the prompt contract limits the 4K refusal to FlashVSR and documents every parameter', () => {
  const prompt = read('prompts/tools/upscale_video.json');
  assert.deepEqual(Object.keys(prompt.parameterDocs).sort(), Object.keys(schema.properties).sort());
  assert.match(prompt.baseDescription.replace(/\s+/g, ' '), /FlashVSR cannot produce 4K/);
  assert.doesNotMatch(prompt.baseDescription.replace(/\s+/g, ' '), /[^R] It cannot produce 4K/);
});
