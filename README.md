# @sogni-ai/sogni-protocol

The language-neutral protocol artifacts for the [Sogni](https://sogni.ai) ecosystem.

This package ships pure data — JSON Schemas, OpenAI tool manifests, prompt contracts, and enums — that every Sogni SDK consumes so contracts stay in lockstep across languages.

## What's inside

| Path | What it is | Who consumes it |
|---|---|---|
| `schemas/tools/*.json` | JSON Schema for each hosted creative tool's arguments. | All SDKs (codegen types + runtime validation). |
| `schemas/errors/*.json` | Error envelope + repair-control shape. | All SDKs. |
| `schemas/events/*.json` | Chat-run + workflow event shapes. | All SDKs. |
| `schemas/workflows/*.json` | Durable workflow record + step shapes. | All SDKs. |
| `schemas/storyboards/*.json` | Storyboard planning contract. | TS SDK + chat product. |
| `schemas/prompt-contract.schema.json` | Shape every `prompts/tools/*.json` file validates against. | Editors of prompt prose. |
| `manifests/openai-tools.json` | Merged hosted-tool OpenAI function manifest (generation + composition). | TS SDK runtime, future agent SDKs. |
| `manifests/generation-tools.json` | Generation subset of the hosted manifest. | TS SDK. |
| `manifests/composition-tools.json` | Composition subset of the hosted manifest. | TS SDK. |
| `manifests/app-tools.json` | Chat-app local tools (analyze_image, manage_memory, etc.). | Chat product SDKs. |
| `prompts/tools/*.json` | Per-tool LLM-visible descriptions + parameter docstrings (`PromptContract`). | All SDKs that surface tools to an LLM. |
| `enums/tool-names.json` | Canonical tool name catalogs (hosted / app / all). | Validators, codegen. |
| `enums/chat-run-status.json` | Chat-run lifecycle states. | All SDKs. |
| `enums/chat-run-waiting-reasons.json` | Why a run is paused for user input. | All SDKs. |
| `enums/token-types.json` | Sogni billing token types (`sogni`, `spark`). | All SDKs. |
| `version.json` | Protocol version for compatibility checks. | All SDKs. |

## Why a separate package

Sogni ships SDKs in multiple languages (TypeScript `@sogni-ai/sogni-client`, Swift `SogniKit`, more on the way). Tool schemas, prompts, and enums need to be the same everywhere. Holding them in a TS-centric package would force non-TS SDKs to either reimplement them or depend on Node tooling just for codegen.

This package has **zero runtime dependencies**, no compile step, and no native binaries. Any language can pull it down (npm install, git submodule, or just `wget`-ing the tarball) and read the JSON directly.

## Consumer examples

**TypeScript (Node 20+):**

```ts
import manifest from '@sogni-ai/sogni-protocol/manifests/openai-tools.json' with { type: 'json' };
import statuses from '@sogni-ai/sogni-protocol/enums/chat-run-status.json' with { type: 'json' };

type ChatRunStatus = (typeof statuses.values)[number];
```

**Swift (codegen via `quicktype`):**

```bash
quicktype \
  --src-lang schema \
  --lang swift \
  --src node_modules/@sogni-ai/sogni-protocol/schemas/tools/*.schema.json \
  --out Sources/SogniKit/Models/Generated/ToolSchemas.swift
```

**Python (or any language) — direct JSON read:**

```python
import json, pathlib
manifest = json.loads(pathlib.Path("node_modules/@sogni-ai/sogni-protocol/manifests/openai-tools.json").read_text())
```

## Versioning policy

The package is versioned independently of any SDK. `version.json#protocolVersion` follows semver:

- **Major** — removing or renaming any schema / enum / manifest field. Breaks consumers.
- **Minor** — adding new optional fields, new tools, new manifests. Backwards-compatible.
- **Patch** — description / prose changes (prompt text, schema descriptions). No shape change.

SDKs may check `protocolVersion` at startup and refuse to run against an incompatible major.

## Editing prose

Tool prompt prose lives in `prompts/tools/*.json`. Each file is one [`PromptContract`](./schemas/prompt-contract.schema.json). Edit the JSON, bump `version.json#protocolVersion` patch, publish. SDKs pick up new prose on their next install — no code change required in any SDK.

## Editing schemas

The JSON Schema files under `schemas/` are the authoritative wire-spec shape. Any change here is a protocol bump (minor or major depending on compatibility). Consumers regenerate their language-specific types via their codegen step.
