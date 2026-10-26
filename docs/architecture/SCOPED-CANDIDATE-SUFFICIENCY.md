# Scoped candidate sufficiency — PromptForge 2.3

## Problem and resulting behavior

At deployed source 5e0b7dbf25023feafc82c90caa29f800b1009785, synthetic revision
8fbafc69-c1e6-4e96-9f91-2131511a2b4a retained a no-retrieval prohibition but
received an unconditional retrieval template. Flattening all capability
prerequisites also made "text supplied" and "text missing" appear jointly required.

New candidates use an explicit, closed profile:
- retrieval_mode: DISABLED; no retrieval conditions or retrieval-based suppression of clarification.
- requirement_scope: SELECTED_CAPABILITIES.
- required_information: the exact intersection of all capability prerequisite lists.
- capability_requirements: one branch per declared capability, preserving that capability's prerequisites exactly.

The branch list is not a conjunction across all capabilities. A caller must first
identify the applicable capability or capabilities; only their requirements and
the shared requirements apply. This change does not implement a runtime branch
selector, grant retrieval tools or authority, or infer permissions from English.

Disabled retrieval is conservative for every generated candidate, including
research roles: conceptual research capability is not a runtime grant.
The existing source/governance prohibitions remain intact. Models cannot enable
retrieval by omitting a prohibition or emitting positive retrieval language.

## Validation and compatibility

PF2-013 / INV-027 reject absent, duplicate, unknown or tampered prerequisite
branches, invalid scope, duplicate capability identities, and flattened global
requirements. PF2-014 / INV-026 reject retrieval conditions, enabled retrieval,
and incompatible clarification rules. Malformed branch data returns findings.

Clarification wording is deliberately fixed by the candidate profile. These
checks are not a general-purpose natural-language contradiction detector.
Contradictions within model-authored prose still need human review.

The APS 1.5-alpha schema gains optional fields. Historical documents retain their
existing schema behavior; they are not rewritten or silently upgraded.
PromptForge 2.3 must emit and validate the new profile. The TypeScript candidate
validator requires it; Python also requires it for engine 2.3 documents and checks
any document that explicitly declares the profile. Existing engine 2.2 candidates
are not thereby certified as consistent; retain the semantic review block.

## Verification and release boundary

The synthetic recorded-stage fixture preserves the five saved outputs and their
digests for offline replay. A new builder candidate must retain capability
prerequisites, omit retrieval conditions, and remain DRAFT / REQUIRES_REVIEW with
empty execution/delegation authority. A replayed historical reviewer explanation
is test data, not a fresh review of the changed candidate.

Node negative tests run in the existing workspace test command. Python
schema/semantic tests and negative fixtures run in APS Conformance CI.
No database migration is needed. Existing source artifacts, reviews, APS versions,
digests and release records remain immutable.

Deployment and regeneration of a child revision are separate actions. Do not edit
the existing v0.1.1 APS in place or infer semantic approval from these tests.
