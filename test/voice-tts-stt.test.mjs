import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (path) => JSON.parse(readFileSync(new URL(path, root)));

test('generate_speech schema adds Fish Drama 3, Arabic, and 2000-char reference transcript', () => {
  const schema = read('schemas/tools/generate_speech.schema.json');
  const prompt = read('prompts/tools/generate_speech.json');

  const expectedPropertyKeys = [
    'creativity',
    'language',
    'model',
    'numberOfVariations',
    'outputFormat',
    'prompt',
    'seed',
    'voice',
    'voiceDescription',
    'voiceSourceIndex',
    'voiceTranscript',
    'voice_source_url',
  ];

  assert.deepEqual(schema.properties.model.enum, ['voice', 'clone', 'design', 'drama3']);
  assert.equal(schema.properties.prompt.maxLength, 5000);
  assert.match(schema.properties.prompt.description, /4096.*voice.*5000.*drama3/i);
  assert.ok(schema.properties.language.enum.includes('arabic'));
  assert.equal(schema.properties.language.enum.length, 12);
  assert.match(schema.properties.language.description, /arabic.*drama3|drama3.*arabic/i);
  assert.match(prompt.parameterDocs.language, /arabic.*drama3|drama3.*arabic/i);
  assert.equal(schema.properties.voiceTranscript.maxLength, 2000);
  assert.deepEqual(schema.required, ['prompt']);
  assert.deepEqual(Object.keys(schema.properties).sort(), expectedPropertyKeys);
  assert.deepEqual(Object.keys(prompt.parameterDocs).sort(), expectedPropertyKeys);

  for (const path of ['manifests/generation-tools.json', 'manifests/openai-tools.json']) {
    const tool = read(path).tools.find((candidate) => candidate.function.name === 'generate_speech').function;
    assert.equal(tool.description, schema.description);
    assert.deepEqual(tool.parameters.properties, schema.properties);
    assert.deepEqual(tool.parameters.required, schema.required);
  }
});

test('transcribe_audio schema, prompt contract, enums, workflows, and hosted manifests stay in sync', () => {
  const schema = read('schemas/tools/transcribe_audio.schema.json');
  const prompt = read('prompts/tools/transcribe_audio.json');
  const toolNames = read('enums/tool-names.json');
  const workflowSchema = read('schemas/workflows/durable-workflow-run.schema.json');
  const genManifest = read('manifests/generation-tools.json');

  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, []);
  assert.deepEqual(schema.properties.model.enum, ['parakeet', 'nemotron']);
  assert.equal(schema.properties.model.default, 'parakeet');
  assert.deepEqual(schema.properties.timestamps.enum, ['none', 'sentence', 'word']);
  assert.equal(schema.properties.timestamps.default, 'sentence');
  assert.equal(schema.properties.diarize.default, false);
  assert.equal(schema.properties.hotwords.maxLength, 1000);
  assert.equal(schema.properties.prompt.maxLength, 2000);
  assert.deepEqual(schema.properties.responseFormat.enum, ['json', 'text', 'srt', 'vtt']);
  assert.equal(schema.properties.responseFormat.default, 'json');
  assert.deepEqual(Object.keys(prompt.parameterDocs).sort(), Object.keys(schema.properties).sort());

  assert.ok(toolNames.hosted.includes('transcribe_audio'));
  assert.ok(toolNames.all.includes('transcribe_audio'));
  assert.ok(workflowSchema.properties.steps.items.properties.toolName.enum.includes('transcribe_audio'));
  assert.equal(genManifest.schemaRefs.transcribe_audio, '../schemas/tools/transcribe_audio.schema.json');

  for (const path of ['manifests/generation-tools.json', 'manifests/openai-tools.json']) {
    const tool = read(path).tools.find((candidate) => candidate.function.name === 'transcribe_audio').function;
    assert.equal(tool.description, schema.description);
    assert.deepEqual(tool.parameters.properties, schema.properties);
    assert.deepEqual(tool.parameters.required, []);
  }
});

test('add_subtitles enables auto_transcribe across schema, prompt contract, and hosted manifests', () => {
  const schema = read('schemas/tools/add_subtitles.schema.json');
  const prompt = read('prompts/tools/add_subtitles.json');

  assert.doesNotMatch(schema.description, /Do not use auto_transcribe|not enabled/i);
  assert.doesNotMatch(schema.properties.auto_transcribe.description, /Do not set|not yet enabled/i);
  assert.doesNotMatch(prompt.baseDescription, /Do not set auto_transcribe|not enabled/i);
  assert.match(schema.properties.auto_transcribe.description, /transcribe/i);

  for (const path of ['manifests/generation-tools.json', 'manifests/openai-tools.json']) {
    const tool = read(path).tools.find((candidate) => candidate.function.name === 'add_subtitles').function;
    assert.equal(tool.description, schema.description);
    assert.deepEqual(tool.parameters.properties, schema.properties);
  }
});

test('speech-models and transcription-models catalogs publish canonical model IDs and capabilities', () => {
  const speechCatalog = read('catalogs/speech-models.json');
  const sttCatalog = read('catalogs/transcription-models.json');
  const mcpTransform = read('schemas/mcp/transform_media.schema.json');

  assert.deepEqual(
    Object.values(speechCatalog.models).map((m) => m.id),
    [
      'qwen3_tts_1.7b_custom_voice_bf16',
      'qwen3_tts_1.7b_voice_clone_bf16',
      'qwen3_tts_1.7b_voice_design_bf16',
      'fish_drama_3_nvfp4',
    ],
  );
  for (const [key, entry] of Object.entries(speechCatalog.models)) {
    assert.equal(entry.pricingBasis, 'characters', `${key} pricingBasis`);
    assert.equal(entry.minimumBilledCharacters, 170, `${key} minimumBilledCharacters`);
    assert.equal(entry.maxCharacters, key === 'drama3' ? 5000 : 4096, `${key} maxCharacters`);
    assert.equal(
      entry.supportedLanguages.includes('arabic'),
      key === 'drama3',
      `${key} arabic support`,
    );
    assert.equal(
      entry.supportedLanguages.length,
      key === 'drama3' ? 12 : 11,
      `${key} supportedLanguages length`,
    );
  }
  const drama3 = speechCatalog.models.drama3;
  assert.equal(drama3.sampleRateHz, 44100);
  assert.equal(drama3?.creativity, undefined);
  assert.equal(drama3.inlineDirections, true);
  assert.equal(drama3.maxReferenceTextChars, 2000);
  assert.deepEqual(Object.keys(drama3).sort(), [
    'directionTagExamples',
    'id',
    'inlineDirections',
    'instruct',
    'maxCharacters',
    'maxReferenceTextChars',
    'minimumBilledCharacters',
    'name',
    'pricingBasis',
    'referenceAudio',
    'referenceSeconds',
    'referenceText',
    'sampleRateHz',
    'supportedLanguages',
    'voices',
  ]);

  assert.deepEqual(
    Object.values(sttCatalog.models).map((m) => m.id),
    ['parakeet_tdt_0.6b_v3_bf16', 'nemotron_3.5_transcribe_30b_a4b_nvfp4'],
  );
  const { parakeet, nemotron } = sttCatalog.models;
  assert.equal(parakeet.maxDurationSec, 7200);
  assert.equal(parakeet.diarization, false);
  assert.equal(parakeet.minimumBilledDurationSeconds, 10);
  assert.equal(parakeet.maxVariations, 1);
  assert.equal(nemotron.maxDurationSec, 3600);
  assert.equal(nemotron.diarization, true);
  assert.equal(nemotron.maxHotwordsChars, 1000);
  assert.equal(nemotron.minimumBilledDurationSeconds, 10);
  assert.equal(nemotron.maxVariations, 1);

  assert.ok(mcpTransform.properties.operation.enum.includes('transcribe_audio'));
  assert.ok(mcpTransform.properties.operation.enum.includes('add_subtitles'));
});
