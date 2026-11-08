import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));

test('GIF edit controls agree across schemas and hosted manifests and remain opt-in', () => {
  const edit = read('schemas/tools/edit_image.schema.json');
  const generate = read('schemas/tools/generate_image.schema.json');
  for (const params of [edit, ...['generation-tools.json', 'openai-tools.json'].map(file => read(`manifests/${file}`).tools.find(tool => tool.function.name === 'edit_image').function.parameters)]) {
    assert.deepEqual(params.properties.outputFormat.enum, ['png', 'jpg', 'jpeg', 'webp', 'gif']);
    for (const field of ['gptImageFrameCount', 'gptImageFrameDurationMs']) {
      assert.deepEqual(params.properties[field], generate.properties[field]);
      assert.ok(!params.required.includes(field));
      assert.equal(params.properties[field].default, undefined);
    }
    assert.ok(!params.required.includes('outputFormat'));
    assert.match(params.properties.model.description, /use edit_image when reference images guide the animation/);
    assert.doesNotMatch(params.properties.model.description, /Do not use edit_image for GIFs/);
  }
});
