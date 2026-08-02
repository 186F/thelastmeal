# Canonical calibration analysis — `m2-calibration-variance-a-001`

The two analysis files in this directory are **exact byte-for-byte
copies** of the production `m2:analyze` outputs for the completed
ten-run Milestone 2 calibration sequence. They are the canonical,
repository-hosted record of the analysis; the interpretation lives in
the [Milestone 2 closeout report](../MILESTONE_002_CLOSEOUT_REPORT.md).

## Identity

| Field                | Value                                                              |
| -------------------- | ------------------------------------------------------------------ |
| Study                | `m2-calibration-variance-a-001` v1.0.0                             |
| Sequence             | `m2-calibration-variance-a` (Scenario A, seed 1001, ten primaries) |
| Repository SHA       | `cadcca7785618fbe12a6a5709faf67df65241527`                         |
| Analysis version     | `m2-calibration-variance-analysis-1.0.0`                           |
| Evidence archive     | `m2-calibration-variance-a-evidence-001.zip`                       |
| Archive SHA-256      | `0e178266f24dfdca77c6b90c3478c0d48b82f9f133dc0c6393db3a6be9ed4039` |
| Inventory aggregate  | `fd71cf99087894e17d2759c108a9b0ecf3afbda1d9f09048a188bf9514c873dd` |
| Study-plan SHA-256   | `e2002b6b414404060dcb5d9d89af8ac96a0147859116d6cdd81b8ded5dd995d0` |

## Analysis files

| File                                                                             | SHA-256                                                            |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [`m2-calibration-variance-a-001.analysis.json`](m2-calibration-variance-a-001.analysis.json) | `7b89c0c11633f819ee778fdc0fec482ca7b7ecc2f82734536feae114890c8b17` |
| [`m2-calibration-variance-a-001.analysis.md`](m2-calibration-variance-a-001.analysis.md)     | `5d2089bc4c4acbb83e6a60b157ccb5f3f4f87f2456b771c0f79d7fe573e02e49` |

The JSON is the authoritative machine-readable report; the Markdown is
its rendered companion, produced by the same `m2:analyze` invocation.
These copies must never be edited: any future analysis change requires a
new analysis version produced by the production entry point.

**The raw evidence archive is retained outside the repository** (with
its `.sha256` sidecar and receipt) and is not committed. Anyone
verifying this analysis needs that archive or the immutable sequence
root; the hashes above bind these files to that exact evidence.

No metric or threshold beyond the registered
`m2-calibration-variance-analysis-1.0.0` definitions appears in this
directory.
