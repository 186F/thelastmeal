# Milestone 3 Item 2 — CI cadence amendment

**Date:** August 2, 2026  
**Status:** AUTHORITATIVE AMENDMENT to `MILESTONE_003_ITEM2_STAGED_CHARTER_INSTRUCTIONS.md`  
**Scope:** CI behavior for staged Item 2 work on draft PR #18

---

## 1. Purpose and precedence

This amendment governs CI cadence for the staged research-charter workflow.
It was explicitly approved by the Operator and Advisor after draft PR #18
was opened.

Where this amendment and the general working-PR protocol differ, **this
amendment governs**. All other staged instructions remain unchanged.

---

## 2. Current workflow run

The full CI workflow that began when PR #18 was first opened may finish
normally. Do not cancel, restart, or otherwise manipulate it merely because
later intermediate charter commits will skip CI.

That workflow validates the initial instructions-only head. It is not the
final merge gate for Item 2.

---

## 3. Intermediate chunks

### Chunk 0

Chunk 0 is read-only and must create no commit. It therefore triggers no new
CI run.

### Chunks 1–6

Every commit produced for Chunks 1–6, including any Advisor-requested
remediation commit within those chunks, must include the exact GitHub Actions
skip marker:

```text
[skip ci]
```

A suitable commit-message form is:

```text
docs: complete Item 2 Chunk N [skip ci]
```

The purpose is to avoid rerunning the repository's complete simulation,
browser, gateway, batch, and orchestrator suite for every Markdown-only
review checkpoint.

A skipped or pending required check on an intermediate PR head:

- is expected;
- does not authorize continuation to the next chunk;
- does not authorize merge;
- must not be worked around by changing branch protection, manually marking a
  check successful, or weakening the workflow.

Chunk progression remains controlled only by explicit Advisor approval
relayed by the Operator.

---

## 4. Final integration chunk

The first Chunk 7 integration commit must **not** contain `[skip ci]`,
`[ci skip]`, `[no ci]`, `[skip actions]`, or any equivalent skip instruction.
It must trigger the complete required CI workflow on the integrated Item 2
candidate.

Any remediation commit made after Chunk 7 begins must also omit all CI skip
markers. The **latest PR head** must complete the full required CI suite
successfully before the Advisor may clear Item 2 for final review or the
Operator may merge it.

A successful workflow attached only to an earlier commit is insufficient.
A failed, cancelled, stale, or still-running workflow on the latest head is
not a merge pass.

---

## 5. No workflow changes

This amendment authorizes only commit-message-based skipping for intermediate
documentation chunks. It does **not** authorize:

- editing GitHub Actions workflow files;
- weakening or deleting existing CI gates;
- changing branch-protection requirements;
- adding path filters;
- cancelling required final checks;
- treating local documentation checks as a substitute for final full CI.

The final Item 2 candidate remains subject to the repository's complete
existing required-check suite.

---

## 6. Required dispatch field

Every Chunk 1–7 dispatch must report:

```text
Commit message:
CI skip marker present: yes/no
New workflow triggered: yes/no
Workflow status, if any:
```

For Chunks 1–6, `CI skip marker present` must be `yes`.
For Chunk 7 and any later remediation, it must be `no`.

---

**Operating rule:** intermediate documentation checkpoints skip CI; the final
integrated candidate runs and passes the complete suite on its exact head.
