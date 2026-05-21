# Sogni Protocol v2 — Changes Summary

Status: summary of additive schema changes landing on branch `v2-execution-plan`. Backwards compatible — no existing schema is altered.

For the full consumer integration contract (native, skill, public API params, charging model) see [`v2-consumer-contract.md`](./v2-consumer-contract.md).

For the consolidated v2 execution plan see [`sogni-chat/docs/superpowers/plans/2026-05-20-sogni-chat-v2-execution-architecture-plan-final.md`](../../sogni-chat/docs/superpowers/plans/2026-05-20-sogni-chat-v2-execution-architecture-plan-final.md).

---

## What changed in this branch

Eight new JSON Schemas were added under `schemas/`. Existing schemas, manifests, enums, prompts, and catalogs are untouched.

| Schema | Path | Purpose |
|---|---|---|
| **IntentInput** | `schemas/agent/intent-input.schema.json` | Compact context packet handed to the L1 IntentClassifier at the start of every user turn. Built deterministically by the host (browser or cloud runner) from explicit runtime state — never from transcript regex. |
| **TurnAnalysis** | `schemas/agent/turn-analysis.schema.json` | Structured output of the L1 IntentClassifier. Provenance enum intentionally omits `regex`; regex extracts bounded facts only. |
| **ToolMetadata** | `schemas/tools/tool-metadata.schema.json` | Per-tool catalog metadata: family, executionMode, costClass, latencyClass, retrySafety, requiresConfirmation, mutatesData, producesArtifacts, plus refs to input/output schemas. Drives tool surfacing, spend gating, retry, and observability. |
| **ArtifactNode** | `schemas/artifacts/artifact-node.schema.json` | One node in the v2 ArtifactGraph. Stable `art_*` ULID, typed `source` discriminator, typed `parents` edges, `versions[]` for retries/refinements/redos, per-model `modelRefs` map. Replaces positional URL arrays after Phase 5. |
| **ArtifactGraph** | `schemas/artifacts/artifact-graph.schema.json` | Durable serialization of the in-memory graph. Mirrors into chat run records and workflow run records. Carries optional `compatibilityProjections` for the Phase 1–4 transition. |
| **SpendGate** | `schemas/billing/spend-gate.schema.json` | Single shared spend-approval state machine. `scope: "tool_call"` for atomic paid tools, `scope: "workflow_run"` for the umbrella authorization. One state enum, one transition log. Authorizes spend; per-job settlement remains on the sogni-socket path. |
| **WorkflowAuthorization** | `schemas/billing/workflow-authorization.schema.json` | Umbrella ticket recorded once at workflow run start. Pauses for re-authorization if cumulative settled + reserved + next-estimate would exceed the authorized cap. Carries `stageSettlements[]` with sogni-socket `projectId` + `jobIds[]` per stage. |
| **RunEvent** | `schemas/events/run-event.schema.json` | Single event vocabulary across chat runs and workflow runs (distinguished by `runKind`). SSE replay key is `(runId, sequence)`. Covers lifecycle, LLM tokens, tool calls, artifacts, waiting, spend, audit, and workflow stages. |

Source commit: `7738002` — `feat(schemas): add v2 platform contracts`.

---

## Design principles preserved

- **Zero runtime dependencies.** Pure data. No compile step. Any language pulls down the schemas and reads them directly.
- **Backwards-compatible.** All v2 schemas are additive. Existing consumers continue to work against the v1 surface.
- **One source of truth.** `inputSchemaRef` / `outputSchemaRef` on `ToolMetadata` point at the canonical argument and result schemas, so validators and planners share one definition.
- **Regex demoted.** `TurnAnalysis.SignalProvenance` intentionally omits `regex`. Regex extracts bounded facts (dimensions, durations, file types). Decisions live in the LLM-backed classifier, typed planner, runtime state, artifact graph, or explicit user signals.
- **Charging model unchanged.** `WorkflowAuthorization` is an umbrella; per-job settlement stays on the existing sogni-socket "project + N identical jobs" path.

---

## Consumer impact

| Consumer | Impact |
|---|---|
| `@sogni-ai/sogni-client` (TS SDK) | Pick up new types after next install. No breaking change. |
| `@sogni/creative-agent` (shared brain) | Authoritative reader of the new schemas (validators, planner, classifier, artifact graph, runner). |
| `sogni-chat` (web) | Consumes via `@sogni/creative-agent`. Phase 0–6 implementation. |
| `sogni-api` (durable host) | Persists `ChatRunRecord` / `WorkflowRunRecord` against the new shapes; emits `RunEvent` SSE. |
| `sogni` (native Mac/iOS) | Migrates on its own timeline via SogniKit codegen. See `v2-consumer-contract.md` §3–§4. |
| `sogni-creative-agent-skill` | Type bump only required; planner swap is opportunistic. See `v2-consumer-contract.md` §5. |
| `SogniKit` | Regenerate `Sources/SogniKit/Models/Generated/SchemaTypes.swift` via `npm run codegen:schemas`. |

---

## Versioning

This branch will bump the protocol version on publish (minor — additive). See `version.json` and `README.md#versioning-policy`.
