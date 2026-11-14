import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, root)));
const schema = read('schemas/tools/upscale_video.schema.json');

test('upscale_video recommends explicit RelayVSR and preserves omitted-model compatibility', () => {
  assert.deepEqual(schema.properties.model.enum, ['flashvsr', 'relayvsr']);
  assert.deepEqual(schema.properties.targetResolution.enum, [1080, 1440, 2160]);
  assert.deepEqual(schema.required, []);
  assert.equal(schema.properties.model.default, undefined);
  assert.match(schema.description, /Explicitly set model to relayvsr for new upscales/);
  assert.match(schema.description, /Omitted model retains FlashVSR for compatibility/);
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
  assert.match(prompt.baseDescription.replace(/\s+/g, ' '), /2160p needs a source short edge of 540-768px or exactly 1080px/);
});

test('schema validation keeps alpha.61 FlashVSR answers: 2160 only with model relayvsr', () => {
  // alpha.61 allowed targetResolution 1080 or 1440 and nothing else. The if/else keeps that
  // for an omitted model or flashvsr, so a JSON Schema validator still refuses FlashVSR at 2160.
  assert.deepEqual(schema.if, { properties: { model: { const: 'relayvsr' } }, required: ['model'] });
  assert.deepEqual(schema.else, { properties: { targetResolution: { enum: [1080, 1440] } } });
  assert.equal(schema.then, undefined);
  const allowed = (args) =>
    args.model === 'relayvsr' ? schema.properties.targetResolution.enum : schema.else.properties.targetResolution.enum;
  assert.equal(allowed({}).includes(2160), false);
  assert.equal(allowed({ model: 'flashvsr' }).includes(2160), false);
  assert.equal(allowed({ model: 'relayvsr' }).includes(2160), true);
});
