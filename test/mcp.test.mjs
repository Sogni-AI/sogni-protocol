import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifests/mcp-tools.json', root)));
test('MCP manifest is a deterministic projection of schemas and metadata', () => {
  execFileSync(process.execPath, ['scripts/build-mcp-manifest.mjs', '--check'], { cwd: root });
  assert.equal(manifest.tools.length, 13);
  assert.ok(Buffer.byteLength(JSON.stringify(manifest.tools)) < 32_000);
  for (const tool of manifest.tools) {
    const schema = JSON.parse(readFileSync(new URL(`schemas/mcp/${tool.name}.schema.json`, root)));
    assert.deepEqual(schema.properties, tool.inputSchema.properties);
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.deepEqual(tool.outputSchema.required, ['kind', 'data']);
    if (!tool.annotations.readOnlyHint && !['cancel_job', 'create_upload'].includes(tool.name)) assert.ok(schema.required.includes('request_id'));
  }
});

test('MCP tool metadata follows the shared metadata contract and references published schemas', () => {
  const catalog = JSON.parse(readFileSync(new URL('catalogs/mcp-tools.json', root)));
  const contract = JSON.parse(readFileSync(new URL('schemas/tools/tool-metadata.schema.json', root)));
  for (const { metadata } of catalog.tools) {
    for (const key of contract.required) assert.ok(Object.hasOwn(metadata, key), key);
    for (const [key, schema] of Object.entries(contract.properties)) {
      if (schema.enum) assert.ok(schema.enum.includes(metadata[key]), key);
    }
    assert.ok(readFileSync(new URL(metadata.inputSchemaRef, root)).length);
    assert.ok(readFileSync(new URL(metadata.outputSchemaRef, root)).length);
  }
});

test('the changelog tool is an additive read-only tool with its own result kind', () => {
  const read = path => JSON.parse(readFileSync(new URL(path, root)));
  const strip = ({ $schema, $id, title, ...schema }) => schema;
  const shared = strip(read('schemas/mcp/result.schema.json'));
  const original = manifest.tools.filter(tool => tool.name !== 'list_changelog');
  assert.equal(original.length, 12);
  for (const tool of original) assert.deepEqual(tool.outputSchema, shared, tool.name);
  assert.equal(manifest.tools.at(-1).name, 'list_changelog');
  const changelog = manifest.tools.at(-1);
  assert.deepEqual(changelog.outputSchema, strip(read('schemas/mcp/changelog_result.schema.json')));
  assert.deepEqual(changelog.outputSchema.properties.kind.enum, ['changelog']);
  assert.deepEqual(changelog.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  assert.deepEqual(changelog.inputSchema.required, []);
  const date = new RegExp(changelog.inputSchema.properties.since.pattern);
  for (const value of ['2026-11-01', '2026-11-01T17:00:00Z', '2026-11-01T09:00:00-08:00', '2026-11-01T09:00:00.125+05:30']) assert.ok(date.test(value), value);
  for (const value of ['2026-11', 'November 1', '2026-11-01T17:00:00', '2026-11-01 17:00Z']) assert.ok(!date.test(value), value);
});
