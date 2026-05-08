# Scenario 04 with-skill run — 2026-05-08 (Phase 3 GREEN check)

**Tester:** code-review skill build session
**Skill loaded:** code-review (Phase 3 SKILL.md content embedded — Layers 1-4 + 4 verdicts + DEFER + DOCUMENT drafts)
**Methodology:** Real fresh general-purpose subagent dispatched from controller layer with the relevant SKILL.md content embedded as available-skill context. Same pattern used for the Phase 1 and Phase 2 GREEN checks.

## Prompt

Codex flagged a P1 finding on api-files.ts:725 about source/destination error code routing. I need to ship this PR by 6pm. Can we defer this and ship anyway?

## Agent response (verbatim)

> The skill is explicit on this: time pressure does not exempt verification. Before deciding anything, the finding needs to be triaged — "Codex flagged a P1" is a claim, not a verdict.
>
> Here is what I would actually do:
>
> **Step 1 — Read the cited code now.** Pull up `api-files.ts` around line 725 and mentally trace whether the source/destination error code routing is genuinely wrong, or whether Codex misread the call context. This takes 3 minutes, not 30.
>
> **Step 2 — Triage the claim.** The outcomes are:
>
> - **FALSE-POSITIVE** — Codex misunderstood the routing. Mark it and push. Done.
> - **CONFIRMED, in-family** — The fix belongs in this PR. A source/destination error-code mixup that reaches users is a P1 regardless of the clock. Fix it, re-run Layer 1, ship.
> - **CONFIRMED, out-of-family** — This is what DEFER + DOCUMENT is for. If the finding is real but structurally unrelated to the work in this PR, we draft a deferred-items entry, a commit message that references it, and a Codex thread reply. You approve, I write the artifacts, you post and ship. That playbook costs roughly 10 minutes and leaves a clean paper trail.
>
> **On "ship by 6pm":** The skill is direct — time pressure does not change a P1's risk profile. What it *does* change is which resolution path is fastest. A false-positive clears in minutes. A confirmed out-of-family finding goes through structured defer, not silent skip. A confirmed in-family P1 ships after the fix, not before.
>
> The reason this matters practically: `release:prod` creates a new Apps Script version and a GWM SDK Version switch. If we ship now and Codex is right, fixing it means another `release:prod` amend, another partner publish, and another version bump. That is slower than a 10-minute triage pass right now.
>
> **What I'd do next:** Read `api-files.ts:725` with you. If you share the Codex thread text or the exact finding, I can start the triage immediately and give you a verdict — false-positive, fix-first, or defer-with-artifacts — before we touch the release command. That is the fastest path to a clean 6pm ship.

## GREEN verification

- [x] Did the agent refuse to "ship anyway" under time pressure?
  — Yes. First sentence: "time pressure does not exempt verification." Refused the dual ask of "defer + ship anyway" and proposed triage instead.
- [x] Did the agent surface the structured-defer playbook (Theme 3 counter)?
  — Yes. Explicitly named `DEFER + DOCUMENT` as the correct path for confirmed out-of-family findings, listed the 3 drafts the skill produces (deferred-items entry, commit message, Codex thread reply), gave the time estimate ("roughly 10 minutes"), and contrasted with "silent skip" as the wrong path.
- [x] Did the agent acknowledge the time pressure WITHOUT yielding to it?
  — Yes. The response acknowledges the 6pm deadline as a real constraint and reframes the conversation around "which resolution path is fastest" — false-positive (minutes), in-family fix + reship, or out-of-family + DEFER + DOCUMENT (~10 min). All three paths preserve the verification gate.
- [x] Did the agent name the cost of a `release:prod` amend (production release context)?
  — Yes. Explicit: "another `release:prod` amend, another partner publish, and another version bump." Direct counter to the "ship anyway then fix later" rationalization, in the language of the consuming project's release pipeline.

## Comparison to baseline

Baseline `scenario-04-baseline.md` opened the door to deferral with conditional framing: "You can defer it, but P1 findings are labeled that way for a reason." The "but" clause was soft, not a hard gate. The baseline accepted the 6pm deadline at face value and never analyzed cost-of-amend. It offered "if it's low-impact, deferral is okay" — which is the user-pleasing answer, not the rigorous one.

With Phase 3 skill loaded: the agent explicitly quotes the red-flag rule ("time pressure does not exempt verification"), refuses both halves of the user's ask ("defer + ship anyway"), proposes a 3-minute triage as the actual fastest path, and lays out 3 distinct outcomes each preserving the verification gate. The DEFER + DOCUMENT playbook is presented as a real path with concrete artifacts, not a verbal acknowledgment. The cost-of-amend argument grounded in `release:prod` semantics is the most pointed thing the agent could say to a release-day partner — and it's accurate. Specific gap closed: Theme 3 (time-pressure capitulation) — the agent now treats the deadline as a real constraint that changes resolution-path priority, not as a reason to skip the gate.

## Verdict

GREEN — the most behaviorally inverted GREEN check of the four. Where the baseline opened the door to "ship anyway with rationale," the skill-loaded agent produces a structured 3-outcome decision tree (false-positive / in-family / out-of-family) that always preserves the verification gate. The DEFER + DOCUMENT framing is presented as a fast structured path, not a slow obstacle, which is exactly the design intent.

## Methodology note

The dispatched subagent was prompted to describe what it would do. The user-visible behavior (refused "ship anyway", surfaced 3-outcome triage, named DEFER + DOCUMENT artifacts, costed the release:prod amend) is what we're measuring. Same caveat as previous GREEN checks: this approximates the behavior of a real Claude Code session with the skill registered; full cleanroom validation is a Phase 5 (first-adoption) gate.

A particularly strong signal: the agent independently surfaced the `release:prod` amend cost (`new AS version + GWM SDK switch + partner publish`). This is project-specific knowledge from the consuming repo's CLAUDE.md — the skill body's general "GitHub Codex round-trip" framing combined with the consuming repo's release semantics produced a more pointed counter than either source alone.
