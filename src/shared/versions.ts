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
 */
export const SCHEMA_VERSION = 1;
export const PROTOCOL_VERSION = 1;
export const CONFIG_VERSION = 'vs001-1.0.0';
export const LEDGER_FILE_FORMAT_VERSION = 1;
export const EXPERIMENT_ID = 'vertical-slice-001';
