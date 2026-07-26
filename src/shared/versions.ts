/**
 * Central version identifiers.
 *
 * - SCHEMA_VERSION: version of the event / ledger schema. Bumped when event
 *   payload shapes change incompatibly.
 * - PROTOCOL_VERSION: version of the browser worker message protocol.
 * - CONFIG_VERSION: version of the frozen experiment configuration
 *   (Vertical Slice 001 v1.0). Any material change to fixed experiment data
 *   requires a new config version per the change-control section of the brief.
 * - LEDGER_FILE_FORMAT_VERSION: version of the exported ledger JSON file.
 *
 * Remediation release 1.1.0 (audit remediation brief, section 3):
 * SCHEMA_VERSION 1 -> 2 (decision-lifecycle events; exact payload schemas),
 * PROTOCOL_VERSION 1 -> 2 (submit-decision-response command, decision-request
 * output, dual hashes in results), LEDGER_FILE_FORMAT_VERSION 1 -> 2
 * (worldStateHash + canonicalLedgerHash replace finalStateHash). Version-1
 * exports are REJECTED at import with an explicit unsupported-format error —
 * never silently reinterpreted. CONFIG_VERSION is deliberately unchanged: the
 * frozen experiment data (scenarios, seeds, identities, needs, rates,
 * timelines, action categories) did not change; hashing and transport are
 * derived-data concerns.
 */
export const SCHEMA_VERSION = 2;
export const PROTOCOL_VERSION = 2;
export const CONFIG_VERSION = 'vs001-1.0.0';
export const LEDGER_FILE_FORMAT_VERSION = 2;
export const EXPERIMENT_ID = 'vertical-slice-001';
