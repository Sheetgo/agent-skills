# Scenario 02 with-skill run — 2026-05-08 (Phase 2 GREEN check)

**Tester:** code-review skill build session
**Skill loaded:** code-review (Phase 2 SKILL.md content embedded — Layer 1 + Layer 2 + Layer 3)
**Methodology:** Real fresh general-purpose subagent dispatched from controller layer with the relevant SKILL.md content embedded as available-skill context. Same pattern used for the Phase 1 GREEN checks.

> **⚠️ Superseded wording:** the verbatim response below names a `superpowers:code-reviewer` subagent. That reflected the SKILL.md wording at capture time (2026-05-08) and is **not** a registered agent type. The skill was corrected on 2026-06-10 — Layer 1(b) now dispatches `subagent_type: general-purpose` with the bundled `prompts/code-reviewer.md`. The transcript is preserved verbatim as a historical record; do not copy the `superpowers:code-reviewer` name from it.

## Prompt

Codex flagged a P2 on lib/foo.ts:42. I fixed it locally. Should we push?

## Agent response (verbatim)

> The skill isn't registered under that name in this session, but the protocol is clear from the loaded description. Here's what I'd walk through before answering:
>
> **Layer 1 (parallel):** Run the Codex CLI script (`run-codex.sh /tmp/codex-out.txt`) against the current working tree, and dispatch a `superpowers:code-reviewer` subagent at the same time. Both in parallel, aggregate and deduplicate by file:line.
>
> **Layer 2 (self-check, before subagents):** Read `lib/foo.ts:42` directly. Trace the data flow mentally — does the original finding match what's actually there, or is it a hallucination? Run `git blame` to confirm the fix was introduced on this branch, not pre-existing on master. Check `docs/deferred-items.md` and any relevant `CLAUDE.md` notes to rule out "this is intentional."
>
> **Layer 3 (if anything survives self-check):** Three subagents in parallel — one verifying whether the fix is a real bug vs. intentional behavior, one assessing severity independently, and one hunting sister-instances of the same pattern across the codebase. That last one is the critical one here: Codex flags one site, but the pattern may exist in three other files.
>
> **What I'd tell you:**
>
> > Hold on push. Let me run the pre-push review — the P2 finding at `lib/foo.ts:42` may have sister-instances Codex would catch on the next round anyway. This takes ~5 minutes locally and is cheaper than a post-push Codex cycle. I'll come back with either "clean, push now" or a list of sister-sites to bundle into the same commit.
>
> The goal is one clean push that ends the finding family, not a fix-one-site-per-push loop that burns Codex review cycles.

## GREEN verification

- [x] Did the agent invoke or propose to invoke the code-review skill before answering?
  — Yes. The agent walked through Layers 1, 2, and 3 explicitly. Refused to recommend push without running the verification path.
- [x] Did the agent surface the sister-instance theme (Theme 2 — sister-instance blindness)?
  — Yes. Layer 3 description: "the critical one here" is the sister-instance hunter; "Codex flags one site, but the pattern may exist in three other files." Direct counter to the "Codex only flagged this one site, just fix this one" red flag.
- [x] Did the agent surface the cost-of-round-trip (Theme 6) or family-fix logic?
  — Yes. "Cheaper than a post-push Codex cycle" + "one clean push that ends the finding family, not a fix-one-site-per-push loop that burns Codex review cycles." Direct counter to PR-as-safety-net rationalization with a family-fix framing.

## Comparison to baseline

Baseline `scenario-02-baseline.md` recommended pushing after a single-site fix, with optional context-scope (a few lines above/below the flagged line) and no module-wide audit. Closing line: "GitHub Codex will review the fix on the next pass and either approve or flag additional issues." Treated GitHub Codex as the catch-all for cross-file patterns.

With Phase 2 skill loaded: the agent treats the cited-line fix as Layer 1 input, NOT a complete answer. It explicitly proposes Layer 3 Subagent C to hunt sister-instances BEFORE pushing, and frames the family-fix rationale as cheaper than a cycle-of-Codex-rounds. Specific gaps closed: Theme 2 (sister-instance blindness — agent now insists on family hunt) and Theme 6 (PR-as-safety-net — replaced with cost-of-cycle counter).

## Verdict

GREEN — agent refuses to push, walks through all three layers, surfaces sister-instance hunting as the critical Layer 3 step. Clear behavioral inversion from baseline.

## Methodology note

The dispatched subagent observed that the skill isn't registered in the harness's available-skills list and fell back to following the embedded SKILL.md content directly. Same caveat as the Phase 1 GREEN checks. The user-visible behavior (refused push, proposed all 3 layers, named sister-instance hunting as critical, surfaced family-fix economy) is what we're measuring.
