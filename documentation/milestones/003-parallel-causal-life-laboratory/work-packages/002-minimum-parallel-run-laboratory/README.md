# Work Package 2 — Minimum Parallel-Run Laboratory Specification

## Status

**SPECIFICATION ESTABLISHED — MAIN SPECIFICATION VERSION `1.0.0`; CONFORMANCE DOCUMENT VERSION `1.0.0`.**

The main specification and conformance document are distinct versioned objects. This establishment assertion is valid only for the reviewed documents at the unchanged exact Git head identified by the final-integration dispatch, after the complete required continuous-integration workflow succeeds on that head and final Advisor clearance for that same head is recorded. Version labels, document completeness, integration review, or continuous-integration success on another head do not independently establish the package.

This is a documentation milestone only. No parallel-laboratory implementation has been authorized, built, assessed, or shown conformant. No experiment, model call, browser run, evidence-generating run, or Work Package 3 activity is authorized. Work Package 3 remains unregistered, unauthorized, and not begun; Work Packages 4–8 remain unauthorized.

## Purpose

This package establishes a versioned, implementation-neutral technical, evidence, conformance, and handoff contract for isolated concurrent independent runs and independent studies that share infrastructure while retaining separate identity, configuration, budget, storage, treatment, and evidence boundaries.

## Established documents and reading order

1. [Milestone 3 Research Charter](../../MILESTONE_003_RESEARCH_CHARTER.md) — research direction, scientific claim boundaries, sequencing, and governance.
2. [This work-package README](./README.md) — package status, boundary, and reading order.
3. [Minimum Parallel-Run Laboratory Specification](./WORK_PACKAGE_002_MINIMUM_PARALLEL_RUN_LABORATORY_SPECIFICATION.md) — main specification identity, version `1.0.0`; the normative technical, evidence, acceptance, and implementation-handoff contract.
4. [Conformance Requirements](./WORK_PACKAGE_002_CONFORMANCE_REQUIREMENTS.md) — conformance-document identity, version `1.0.0`; the complete requirement-to-check matrix, check and fault catalogues, keyless suite, evidence contract, and acceptance criteria.
5. [Staged Specification Instructions](./WORK_PACKAGE_002_STAGED_SPECIFICATION_INSTRUCTIONS.md) — immutable process provenance for the staged drafting and review that produced the established documents.

The charter governs the research objective, scientific boundaries, sequencing, and authorization model. The two versioned Work Package 2 documents establish the specification and conformance contracts within that charter; they do not supersede it or broaden its authorization.

## Established boundary

The package establishes:

- the complete 466-requirement normative contract across twelve requirement namespaces;
- the complete, bidirectionally reconciled conformance mapping and conceptual acceptance model;
- the implementation-decision handoff register, without selecting any mechanism or numeric operating parameter; and
- one nonblocking specification question, `OQ-01`, and its matching nonblocking conformance question, `CQ-01`, concerning independent format verification for a future packaging version.

`OQ-01` and `CQ-01` block neither implementation selection nor implementation acceptance under the current contract. A later ruling can affect the contract only through an explicit versioned revision.

## Explicit exclusions

This package does not authorize or establish:

- implementation, deployment, or implementation conformance;
- selection of a provider, framework, queue, scheduler, broker, database, object store, serialization format, or deployment topology;
- an experiment, model call, browser run, evidence-generating run, or evidence package;
- serial-versus-parallel parity work or any behavioral, scientific, or research claim;
- concurrent decision-making among causally coupled NPCs inside one shared world;
- Work Package 3 registration, authorization, scheduling, or commencement; or
- alteration or reuse of Milestone 2 evidence as Milestone 3 evidence.

## Implementation authorization status

**NOT AUTHORIZED.**

Implementation requires later, separate Operator authorization and applicable Advisor review. Establishment, approval, or merge of this documentation package does not itself authorize implementation, experimentation, model calls, evidence generation, a conformance run, or Work Package 3.
