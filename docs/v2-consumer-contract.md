# Sogni Platform v2 — Consumer Contract

Status: published contract for native `sogni` (Mac/iOS) and `sogni-creative-agent-skill` consumers of the v2 platform. Source-grounded against the consolidated v2 plan: `sogni-chat/docs/superpowers/plans/2026-05-20-sogni-chat-v2-execution-architecture-plan-final.md` (§15 Phase 7).

This is a **contract specification**, not a migration deadline. v2 does **not** implement migration in `sogni` or `sogni-creative-agent-skill` in this branch. Each consumer team migrates on its own schedule against this surface. The v2 server APIs maintain backward compatibility throughout.

---

## 1. Overview

The v2 architecture collapses three parallel chat-turn implementations (browser loop, hosted `/v1/chat/completions`, durable `/v1/chat/runs`) into **one shared brain**: `CreativeTurnRuntime` inside `@sogni/creative-agent`. Browser, Managed Agent, native, and skill become **thin transports** over that brain.

Practical consequence for downstream consumers:

- **One classifier**, one planner, one validator, one repair recipe surface, one artifact graph, one spend gate, one event model.
- **No client-side intent or routing**. Native and skill receive `TurnAnalysis` from the server runtime — they render decisions, they do not make them.
- **Per-model token formatting** for asset references is owned by `@sogni/creative-agent`'s asset helpers via the `ArtifactNode.modelRefs` map. Consumers never hand-format `@Image1` / `Image 1` / `context_image_0` tokens.

Recommended call pattern:

```
native (SogniKit)   ─┐
sogni-chat (web)    ─┼─► POST /v1/chat/runs ─► sogni-api ─► CreativeTurnRuntime
skill (sogni-agent) ─┘                          │            (shared brain)
                                                ├─► /v1/chat/completions (thin transport, same brain)
                                                └─► /v1/creative-agent/workflows (durable workflow runner, same brain)
```

---

## 2. Schema map

All schemas are JSON Schema 2020-12 and live in `@sogni-ai/sogni-protocol` under `schemas/`. Eight new schemas land in v2:

### 2.1 `schemas/agent/intent-input.schema.json` — IntentInput

**Purpose.** Compact context packet handed to the L1 IntentClassifier at the start of every user turn. Built deterministically by the host (browser or cloud runner) from explicit runtime state. The schema's contract is that it never re-derives semantics from transcript regex — `activeState`, `artifactState`, and `referencedArtifacts` come from the artifact graph and workflow runner, not from prose scraping.

**Key fields.**

- `currentMessage: string` — raw user message, verbatim.
- `activeState: { activeArtifactId?, activeArtifactType?, pendingAction?, awaitingConfirmation?, lastToolResult?, activeWorkflowRunId? }` — runtime-resolved focus state.
- `artifactState: { selectedArtifactIds[], artifactIds[], lastGeneratedArtifactId?, lastEditedArtifactId? }` — stable ids owned by `ArtifactGraph`. Unbounded by default; Qwen3 256k context handles 16-reference-image generations comfortably.
- `recentTurns: { role, content, sequence }[]` — unbounded by default; trimmed only under measured token pressure, with the trimmed prefix folded into `conversationSummary`.
- `conversationSummary: string`.
- `userPreferences: object (open shape)`.
- `availableCapabilitiesSummary: string[]` — capability tags the planner can quote when answering capability questions with no tool call.

**Example.**

```json
{
  "currentMessage": "Make the second image cinematic.",
  "activeState": {
    "activeArtifactId": "art_01HXYZABCDEFGHJKMNPQRSTVWX",
    "activeArtifactType": "image",
    "awaitingConfirmation": false
  },
  "artifactState": {
    "selectedArtifactIds": ["art_01HXYZABCDEFGHJKMNPQRSTVWX"],
    "artifactIds": [
      "art_01HXYZ0000000000000000A",
      "art_01HXYZABCDEFGHJKMNPQRSTVWX"
    ],
    "lastGeneratedArtifactId": "art_01HXYZABCDEFGHJKMNPQRSTVWX"
  },
  "recentTurns": [
    { "role": "user", "content": "Two stylish neon Tokyo alleys.", "sequence": 0 },
    { "role": "assistant", "content": "Generated two images.", "sequence": 1 }
  ],
  "conversationSummary": "",
  "availableCapabilitiesSummary": ["image_generation", "image_edit", "video_generation"]
}
```

### 2.2 `schemas/agent/turn-analysis.schema.json` — TurnAnalysis

**Purpose.** Structured output of the L1 IntentClassifier. Produced by an LLM-backed classifier, typed planner, runtime state inspection, the artifact graph, or an explicit user signal — never by regex. The `SignalProvenance` enum intentionally omits `regex`: regex extracts bounded facts only and never decides intent, tool surface, or routing.

**Key fields.**

- `domain: chat | image | video | audio | analysis | workflow | memory | settings | unknown`.
- `intent: generate | edit | analyze | transform | question | capability | continue | reference | configure | clarify | unknown`.
- `executionMode: none | tool | multi_tool | workflow`.
- `userWantsExecution: boolean`.
- `isCapabilityQuestion`, `isFutureInstruction`, `isReferenceOnly`, `needsPriorContext`, `needsClarification: boolean`.
- `referencedArtifacts: string[]` — resolved to stable ids by the artifact graph before the analysis is emitted.
- `requiredCapabilities: string[]` — free-form capability tags (e.g. `"image_generation"`, `"video_stitch"`).
- `confidence: number (0..1)`.
- `provenance: classifier | planner | runtime_state | artifact_graph | user_explicit`.

**Example.**

```json
{
  "domain": "image",
  "intent": "edit",
  "executionMode": "tool",
  "userWantsExecution": true,
  "isCapabilityQuestion": false,
  "isFutureInstruction": false,
  "isReferenceOnly": false,
  "needsPriorContext": true,
  "needsClarification": false,
  "referencedArtifacts": ["art_01HXYZABCDEFGHJKMNPQRSTVWX"],
  "requiredCapabilities": ["image_edit"],
  "confidence": 0.94,
  "provenance": "classifier"
}
```

### 2.3 `schemas/tools/tool-metadata.schema.json` — ToolMetadata

**Purpose.** Per-tool metadata that accompanies each definition in the v2 catalog. Drives tool surfacing (which family/execution mode is visible this turn), spend gating (`costClass` + `requiresConfirmation`), retry behavior (`retrySafety`), and durable-run observability (`mutatesData`, `producesArtifacts`). `inputSchemaRef` / `outputSchemaRef` point at the canonical `sogni-protocol` argument and result schemas, so the validator and the planner share one source of truth.

**Key fields.**

- `name`, `family: creative | composition | artifact | memory | settings | analysis | control`.
- `executionMode: hosted | client | app | workflow | internal` — `hosted` = sogni-api runner, `client` = browser, `app` = native shell, `workflow` = synthetic tool creating a `WorkflowRun`, `internal` = runtime-only (never surfaced to LLM).
- `inputSchemaRef`, `outputSchemaRef: string` (URI or repo-relative path).
- `costClass: free | low | medium | high | variable`, `latencyClass: inline | interactive | long_running`.
- `mutatesData`, `producesArtifacts: boolean`.
- `requiresConfirmation: never | paid | destructive | always` (`paid` defers to SpendGate).
- `retrySafety: idempotent | dedupe_key_required | not_safe`.
- `hiddenFromModel?: boolean` for L1 hidden resolver tools.

**Example.**

```json
{
  "name": "edit_image",
  "family": "creative",
  "executionMode": "hosted",
  "inputSchemaRef": "schemas/tools/edit_image.schema.json",
  "outputSchemaRef": "schemas/tools/tool-result-envelope.schema.json",
  "costClass": "medium",
  "latencyClass": "interactive",
  "mutatesData": false,
  "producesArtifacts": true,
  "requiresConfirmation": "paid",
  "retrySafety": "dedupe_key_required"
}
```

### 2.4 `schemas/artifacts/artifact-node.schema.json` — ArtifactNode

**Purpose.** One node in the v2 ArtifactGraph. Replaces the positional URL arrays (`resultUrls`, `videoResultUrls`, `audioResultUrls`) deleted in plan Phase 5. Every tool result auto-registers one node. Lineage edges resolve continuation (`"use the second image"`, `"make it cinematic"`) without transcript scraping. Per-model token shape lives in `modelRefs`.

**Key fields.**

- `artifactId: string` — ULID-style, pattern `^art_[A-Z0-9]{26}$`.
- `kind: image | video | audio | text | workflow | collection`.
- `uri: string`, `mimeType?: string`, `userLabel?: string`.
- `modelRefs: { [modelId: string]: string }` — per-model formatter map. Examples: gpt-image-2 → `"Image 1"`, seedance-2 → `"@Image1"`, ltx-2.3 → `"context_image_0"`. Use `@sogni/creative-agent` asset helpers rather than hand-formatting.
- `source: { type: "upload", uploadId } | { type: "tool_result", runId?, toolCallId } | { type: "workflow_stage", workflowRunId, stageId, itemId? }`.
- `parents: ArtifactEdge[]` — `{ parentId, relation: derived_from | edited_from | styled_from | animated_from | stitched_from | extended_from | segmented_from | reference_for }`.
- `versions: ArtifactVersion[]` (min 1) — `{ versionId, uri?, createdAt, reason: initial | retry | refinement | audit_repair | user_redo, jobId? }`. Retries, refinements, and redos append, never mutate.
- `metadata: object (open shape)` — width/height, durationSeconds, seed, prompt summary, etc.

**Example.**

```json
{
  "artifactId": "art_01HXYZABCDEFGHJKMNPQRSTVWX",
  "kind": "image",
  "uri": "https://cdn.sogni.ai/runs/r_abc/img-2.png",
  "mimeType": "image/png",
  "userLabel": "Image 2",
  "modelRefs": {
    "gpt-image-2": "Image 1",
    "seedance-2": "@Image1",
    "ltx-2.3": "context_image_0"
  },
  "source": {
    "type": "tool_result",
    "runId": "run_abc",
    "toolCallId": "call_42"
  },
  "parents": [
    { "parentId": "art_01HXYZ0000000000000000A", "relation": "edited_from" }
  ],
  "versions": [
    { "versionId": "v1", "createdAt": "2026-05-20T18:00:00Z", "reason": "initial", "jobId": "job_xyz" }
  ],
  "metadata": { "width": 1024, "height": 1024, "seed": 73 },
  "createdAt": "2026-05-20T18:00:00Z"
}
```

### 2.5 `schemas/artifacts/artifact-graph.schema.json` — ArtifactGraph

**Purpose.** Durable serialization of the in-memory ArtifactGraph. Mirrors into `ChatRunRecord.artifacts[]` and `WorkflowRunRecord.artifacts[]` so cloud and hosted runners can reconstitute the graph on resume.

**Key fields.**

- `nodes: ArtifactNode[]` — uniqueness on `artifactId` enforced by runtime.
- `selectedId?: string` — must match an `artifactId` in `nodes`.
- `compatibilityProjections?: { resultUrls?, videoResultUrls?, audioResultUrls? }` — read-only legacy projections, populated during Phase 1–4 transition, deleted after Phase 5.

### 2.6 `schemas/billing/spend-gate.schema.json` — SpendGate

**Purpose.** Single shared spend-approval state machine for atomic tool calls (`scope: "tool_call"`) **and** workflow authorizations (`scope: "workflow_run"`). One envelope, one state enum, one transition log. Per-job settlement remains on the sogni-socket project+N path — this gate authorizes spend, it does not move funds.

**Key fields.**

- `gateId`, `runId?`, `scope: tool_call | parallel_batch | workflow_run`.
- `tool_call` variant: `toolCallId`, `pendingToolCalls[]`.
- `parallel_batch` variant: `pendingToolCalls[]` (>=1; the constituent calls of the fan-out).
- `workflow_run` variant: `workflowRunId`, `pendingWorkflowPlan: { workflowRunId, templateId }`.
- `estimate: { capacityUnits, breakdown: SpendEstimateLineItem[], tokenType, maxAcceptableUnits? }`.
- `state: not_required | preview_required | waiting_for_user | confirmed | cancelled | insufficient_credit | safety_review_required | failed`.
- `decision?: confirm | cancel | approved | rejected | cancelled`, `createdAt?`, `decidedAt?`, `updatedAt`, `reason?`.

### 2.7 `schemas/billing/workflow-authorization.schema.json` — WorkflowAuthorization

**Purpose.** Umbrella authorization ticket recorded once at workflow run start. The executor consults it before each stage and pauses for re-authorization if cumulative settled + reserved + next-estimate would exceed `authorizedCapacityUnits`. **Per-job settlement continues through the existing sogni-socket "project + N identical jobs" path.** The workflow layer is an authorization umbrella, not a new transaction ledger.

**Key fields.**

- `workflowRunId`, `authorizedCapacityUnits`, `tokenType: spark | sogni`.
- `authorizedAt`, `expiresAt` (duration + retry grace).
- `cumulativeSettledUnits`, `cumulativeReservedUnits`.
- `stageSettlements: { stageId, projectId?, jobIds[], estimatedUnits, settledUnits?, status: pending | in_flight | settled | failed | cancelled }[]`.

### 2.8 `schemas/events/run-event.schema.json` — RunEvent

**Purpose.** Single event vocabulary across chat runs and workflow runs. Both persist into the shared `runs` substrate (plan §13.5) and differ only by `runKind`. SSE replay key is `(runId, sequence)`. `idempotencyKey` covers reentrant transitions such as cost confirmation.

**Key fields.**

- `runId`, `runKind: chat | workflow | tool_batch`, `sequence: integer >= 0`.
- `type: RunEventType` — clusters: lifecycle (`run_created`, `run_queued`, `run_started`, `run_resumed`, `run_completed`, `run_partial_failure`, `run_failed`, `run_cancelled`), LLM (`llm_round_started`, `llm_token`, `llm_round_completed`, `assistant_message_delta`, `assistant_message_completed`), tools (`tool_call_proposed`, `tool_call_dispatched`, `tool_call_progress`, `tool_call_resolved`), artifacts (`artifact_created`, `artifact_updated`, `artifact_referenced`), media context (`media_context_updated`, `media_turn_intent_classified`, `asset_manifest_updated`), waiting (`run_waiting_for_user`), spend/billing (`billing_preview_updated`, `spend_gate_opened`, `spend_preview_emitted`, `spend_confirmed`, `spend_cancelled`, `spend_insufficient`, `run_awaiting_cost_confirmation`, `run_cost_confirmation_resolved`), workflow-stage (`stage_started`, `stage_completed`, `stage_failed`, `stage_waiting_for_user`), audit (`audit_evaluated`, `repair_requested`).
- `status?: queued | running | completed | partial_failure | waiting_for_user | failed | cancelled`.
- `payload: object` — per-type shapes documented in the schema description; schema-level enforcement deferred to a Phase 1 follow-up to avoid an unwieldy union.
- `createdAt`, `resumable?`, `terminal?`, `idempotencyKey?`.

`WaitingReason` enum (carried in `run_waiting_for_user` payload): `ask_clarifying_question | select_media_required | cost_approval_required | safety_review_required | workflow_user_input_required | insufficient_credit | other`.

---

## 3. SogniKit / native codegen

`SogniKit` already ships a Swift codegen pipeline that consumes `@sogni-ai/sogni-protocol` schemas — see `SogniKit/Scripts/codegen-schemas.sh` and `SogniKit/package.json` (`sognikit-codegen`). v2 reuses the existing pipeline; no new tooling required.

**Existing pipeline (Phase 8.7 of the Creative Agent master plan):**

```bash
# In SogniKit/
npm install                          # pulls @sogni-ai/sogni-protocol via npm
npm run codegen:schemas              # quicktype → Sources/SogniKit/Models/Generated/SchemaTypes.swift
npm run codegen:schemas:check        # CI check; fails if generated file is stale
```

The script (`Scripts/codegen-schemas.sh`) feeds `quicktype` the durable workflow run schema as a primary input; `quicktype` walks `$ref`s and pulls in the rest of the graph. The generated file is committed; CI runs `--check` to fail when regen produces a diff.

**v2 addition.** When SogniKit upgrades to the v2 protocol version, regenerate after `npm install` picks up the new package. The 8 new schemas (intent-input, turn-analysis, tool-metadata, artifact-node, artifact-graph, spend-gate, workflow-authorization, run-event) are reachable from the existing roots via `$ref`. If a schema is not reached transitively, add it as an extra `--src` argument in `Scripts/codegen-schemas.sh`. No change to the SogniKit consumer surface beyond regenerating `SchemaTypes.swift`.

**Verification before committing the regen:** `npm run codegen:schemas:check` after `git status` confirms the diff is generated-only.

---

## 4. Recommended integration — native `sogni` (Mac/iOS)

This section enumerates the v2 contract for the native client. **No code lands in the native repo in this branch.** The native team owns implementation timing.

### 4.1 Transport choice

Route all creative turns through **`POST /v1/chat/runs`** (durable cloud runs / Managed Agent path). Reasons:

- Shared `CreativeTurnRuntime` already drives every Managed Agent round in `sogni-api`. Native gets the same classifier, planner, validator, repair, artifact graph, and spend gate the web product gets.
- Durable runs survive client suspension (background → foreground transitions, OS-driven termination).
- The native client receives `RunEvent` SSE — no custom event vocabulary required.

Keep `executionMode: 'app'` tools (file system, screen capture, system integrations, native share sheets) **locally executed** by the Swift harness. The server emits `tool_call_dispatched` with `executionMode: 'app'`; the native client executes locally and posts a `tool_call_resolved` envelope back to the run.

### 4.2 Replacement plan for client-side classifier authority

Current native code that becomes obsolete under v2:

- **`SogniChatService.swift:471-554`** — `toolHintForSuggestion` keyword routing. v2: the server runtime emits `TurnAnalysis.requiredCapabilities` and the post-gating tool surface in the run record. The native client renders these; it does not classify.
- **`ThinkingClassifier.swift:39-133`** — regex authority over thinking detection. v2: the server runtime emits structured `llm_round_started` / `llm_token` / `llm_round_completed` events with explicit reasoning-content separation. Native renders the structured stream; it does not parse reasoning out of free text.

Migration cue: replace these helpers with thin renderers over `RunEvent` and `TurnAnalysis`. Keep regex (if any) only for bounded fact extraction — file path/URL detection, MIME checks, numeric extraction. Never for tool routing or intent.

### 4.3 ChatItemRegistry → ArtifactGraph projection

**`ChatItemRegistry.swift:37-195`** today maintains its own in-memory chat-item collection with positional indices.

Under v2 it becomes a **view over the durable run record's `ArtifactGraph`**:

- Subscribe to `RunEvent` of type `artifact_created` / `artifact_updated` / `artifact_referenced`.
- Project `ArtifactGraph.nodes[]` into the existing item-list view model, keyed by `artifactId` instead of positional index.
- Resolve user references (`"the second image"`) by handing them to the server runtime; the resolved `referencedArtifacts` come back on the next `TurnAnalysis`.

### 4.4 Tool surface budget

**`SogniChatToolDefinitions.swift:14-86`** currently exposes the full tool catalog to the LLM each turn.

Under v2, the native client must consume the **per-turn `ToolSurfacePolicy` budget** the server emits (same as the web product). The budget appears on the run record after the classifier round; native rebuilds its `tools` payload from that budget rather than declaring the full catalog up front. Practical effect: the LLM sees 5–10 relevant tools per turn instead of 30+, matching the third-party harness ceiling.

### 4.5 Suggested phasing for the native team (non-binding)

1. Adopt `@sogni-ai/sogni-protocol` v2 in `Package.swift` and regenerate `SchemaTypes.swift`.
2. Add a `RunEvent` SSE consumer next to the existing chat-completion consumer.
3. Switch one creative tool family (e.g. `edit_image`) to route through `/v1/chat/runs` end-to-end while keeping the rest on the legacy path. Validate parity.
4. Migrate `ChatItemRegistry` to the artifact-graph projection.
5. Retire `toolHintForSuggestion` and the regex parts of `ThinkingClassifier`.

---

## 5. Recommended integration — `sogni-creative-agent-skill`

The skill is already hosted-only and consumes `/v1/chat/completions`, `/v1/chat/runs`, and `/v1/creative-agent/workflows`. v2 is a minor update.

### 5.1 Type-only imports from `@sogni-ai/sogni-intelligence-client`

Keep all type imports from `@sogni-ai/sogni-intelligence-client`. **Do not** import `@sogni/creative-agent` at runtime — that package stays private and chat-/cloud-side. Runtime in the skill remains the OpenAI-compatible REST surface plus the public intelligence-client wrapper.

### 5.2 Replace custom planners with shared templates

**`sogni-agent.mjs:4211-4392`** currently implements custom storyboard / workflow planners inside the skill. Once v2 publishes `WorkflowTemplate` records for the equivalent recipes (planned in plan Phase 4), the skill should call `POST /v1/creative-agent/workflows` with the template id and the user's inputs, dropping its private planner.

Until templates are published, the skill's planners continue to work — the v2 server preserves backward compatibility on the chat/completions surface.

### 5.3 Preserve the SSRF guard

**`sogni-hosted-client.mjs:1-24`** SSRF guard MUST be preserved. v2 does not relax network-egress requirements for the skill. The guard is a security boundary, not a regex routing helper, and falls under the "safety filters" category that the regex policy explicitly permits.

### 5.4 Suggested phasing for the skill team (non-binding)

1. Bump `@sogni-ai/sogni-intelligence-client` to the v2 release; rerun the smoke suite.
2. Replace any `unknown[]` gaps in the local types with the new intelligence-client exports.
3. Once `WorkflowTemplate` records are published for the skill's recipes, swap the custom planners for template invocations behind a feature flag; keep both paths green for one release before deleting the planner.

---

## 6. Public API params preserved

The v2 server preserves the full public `ChatCompletionParams` surface on `/v1/chat/completions`, `/v1/chat/runs`, and the skill-facing endpoints. Consumers do not need to change request shape to adopt v2:

- `sogni_tools` — tool family selector (`'creative-tools'`, `'none'`, custom list).
- `sogni_tool_execution` — execution mode (`'auto'`, `'manual'`).
- `think` — reasoning-mode toggle.
- `task_profile` — task profile selector.
- `response_format` — OpenAI-standard structured-output request.
- `autoExecuteTools` — auto-execute flag.
- Tool callbacks — `onToolCall`, `onToolResult`, etc. on SDK callers.
- Max tool rounds — runtime ceiling on the tool loop.
- `appSource` — caller identifier (chat, native, skill, third-party).
- `tokenType` — billing token (`'sogni' | 'spark'`).

The v2 brain reads these directly. Behavior on these params does not change in v2 unless an Open Decision in plan §18 explicitly resolves to change it (e.g. whether `/v1/chat/completions` should refuse long-running paid media).

---

## 7. Workflow charging model for consumers

**Authorize once at workflow start; settle per-job through sogni-socket.**

The workflow layer is an authorization umbrella, **not** a new transaction ledger. Consumers see two distinct phases:

1. **Authorization (start of run).** Server emits a `spend_preview_emitted` `RunEvent` carrying a `SpendGate` with `scope: "workflow_run"` and a `WorkflowAuthorization` estimate. The user confirms once via `POST /v1/creative-agent/workflows/:id/confirm-cost` (and the equivalent for chat runs). The gate transitions `preview_required → waiting_for_user → confirmed`.
2. **Settlement (during run).** The executor dispatches each stage via the existing sogni-socket "project + N identical jobs" path. Each worker job settles independently against the user's wallet. `WorkflowAuthorization.stageSettlements[]` tracks `projectId`, `jobIds[]`, `estimatedUnits`, `settledUnits`, `status`. No new payment surface.

**Pausing for re-authorization.** If `cumulativeSettledUnits + cumulativeReservedUnits + nextStageEstimate > authorizedCapacityUnits` beyond a documented drift tolerance, the run pauses with a fresh `cost_approval_required` waiting state. Consumers handle the second authorization with the same `confirm-cost` flow.

**Parity with chat runs.** The `cost_approval_required` waiting state and the `confirm-cost` endpoint behave identically for chat runs (atomic paid tool calls) and workflow runs (the umbrella). Consumers can share one cost-confirmation UI.

**Tokens.** `tokenType: 'spark' | 'sogni'`. Spark is required for external-vendor models; Sogni for native Supernet workers. v2 does not change which models require which token.

---

## 8. Migration timeline

This is a **contract**, not a deadline.

- **v2 server APIs maintain backward compatibility throughout.** Existing native and skill code keeps working against `/v1/chat/completions`, `/v1/chat/runs`, and `/v1/creative-agent/workflows` for the entire v2 rollout.
- **Native team owns native migration timing.** The plan in §4 above is a recommendation, not a schedule.
- **Skill team owns skill migration timing.** Per §5, the only required change is the type bump to v2 `@sogni-ai/sogni-intelligence-client`; the planner swap is opportunistic.
- **Web (`sogni-chat`) ships first.** v2 phases 0–6 land on the web product. Native and skill migrate after parity holds on web for at least one release.
- **Deletion.** Legacy chat-side and hosted-side code paths are deleted only in plan Phase 8, gated by parity fixtures from Phases 5–6. No consumer-visible breakage at deletion time, because the public surface stays compatible.

For cross-repo context (active worktrees, dependency cascade, commit rules) see `sogni-agent-knowledge/domains/intelligence-stack.md` and `sogni-agent-knowledge/repos/sogni-protocol.md`.

---

## Cross-references

- Consolidated v2 plan: `sogni-chat/docs/superpowers/plans/2026-05-20-sogni-chat-v2-execution-architecture-plan-final.md` (§15 Phase 7).
- Architecture auditor brief: `sogni-chat/docs/superpowers/specs/2026-05-20-sogni-chat-architecture-auditor-brief.md`.
- Schema additions summary: `docs/v2-changes-summary.md`.
- Knowledge base: `sogni-agent-knowledge/domains/intelligence-stack.md`.
