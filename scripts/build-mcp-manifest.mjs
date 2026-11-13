import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = path => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const catalog = read('catalogs/mcp-tools.json');
const tools = catalog.tools.map(({ name, description, metadata }) => {
  const { $schema, $id, title, ...inputSchema } = read(`schemas/mcp/${name}.schema.json`);
  // Each tool's declared result envelope; the original tools share catalog.outputSchemaRef.
  const { $schema: _, $id: __, title: ___, ...outputSchema } = read(metadata.outputSchemaRef);
  return { name, description, inputSchema, outputSchema, annotations: {
    readOnlyHint: !metadata.mutatesData && metadata.costClass === 'free',
    destructiveHint: metadata.requiresConfirmation === 'destructive',
    idempotentHint: metadata.retrySafety !== 'not_safe',
    openWorldHint: metadata.producesArtifacts,
  } };
});
const output = JSON.stringify({ version: catalog.version, tools }, null, 2) + '\n';
const target = new URL('manifests/mcp-tools.json', root);
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output) throw new Error('Run node scripts/build-mcp-manifest.mjs');
} else writeFileSync(target, output);
