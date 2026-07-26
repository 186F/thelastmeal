/**
 * Stable identifiers shared by the simulation core, worker protocol, renderer,
 * and UI. These are canonical string IDs; presentation coordinates and display
 * names are looked up from configuration, never the reverse.
 */

export const NPC_IDS = ['mara', 'jonas', 'rin'] as const;
export type NpcId = (typeof NPC_IDS)[number];

export const LOCATION_IDS = [
  'purifier-workbench',
  'food-shelf',
  'medical-cot',
  'routine-work-station',
] as const;
export type LocationId = (typeof LOCATION_IDS)[number];

export const RESOURCE_IDS = ['meal-1', 'workbench-slot'] as const;
export type ResourceId = (typeof RESOURCE_IDS)[number];

export const SCENARIO_IDS = ['A', 'B1', 'B2', 'C', 'D', 'E', 'F'] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];

/** The ten fixed high-level action categories from the brief (section 9). */
export const ACTION_CATEGORIES = [
  'work-on-purifier',
  'relieve-worker',
  'treat-injured',
  'eat-meal',
  'request-meal-transfer',
  'transfer-or-release-meal',
  'ask-for-help',
  'request-break',
  'renegotiate-commitment',
  'rest-or-wait',
] as const;
export type ActionCategory = (typeof ACTION_CATEGORIES)[number];

/**
 * Structured action modes. A mode is a concrete variant within one of the ten
 * fixed categories; it never introduces a new category. In particular the
 * low-intensity duty variants ('routine-work', 'deliver-materials',
 * 'stay-at-cot') are documented variants of 'rest-or-wait'.
 */
export const ACTION_MODES = [
  'work',
  'relieve',
  'treat',
  'eat',
  'eat-violation',
  'request-transfer',
  'transfer',
  'release',
  'refuse-request',
  'ask-help',
  'request-break',
  'propose-renegotiation',
  'accept-renegotiation',
  'reject-renegotiation',
  'rest',
  'wait',
  'routine-work',
  'deliver-materials',
  'stay-at-cot',
] as const;
export type ActionMode = (typeof ACTION_MODES)[number];

export const MODE_TO_CATEGORY: Record<ActionMode, ActionCategory> = {
  work: 'work-on-purifier',
  relieve: 'relieve-worker',
  treat: 'treat-injured',
  eat: 'eat-meal',
  'eat-violation': 'eat-meal',
  'request-transfer': 'request-meal-transfer',
  transfer: 'transfer-or-release-meal',
  release: 'transfer-or-release-meal',
  'refuse-request': 'transfer-or-release-meal',
  'ask-help': 'ask-for-help',
  'request-break': 'request-break',
  'propose-renegotiation': 'renegotiate-commitment',
  'accept-renegotiation': 'renegotiate-commitment',
  'reject-renegotiation': 'renegotiate-commitment',
  rest: 'rest-or-wait',
  wait: 'rest-or-wait',
  'routine-work': 'rest-or-wait',
  'deliver-materials': 'rest-or-wait',
  'stay-at-cot': 'rest-or-wait',
};

/**
 * Event vocabulary. The first block is the minimum set required by the brief
 * (section 12); the second block documents deliberate additions needed by this
 * slice (the brief's list is a minimum).
 */
export const EVENT_TYPES = [
  'ScenarioStarted',
  'ScenarioEnded',
  'TimeAdvanced',
  'DecisionRequested',
  'DecisionReturned',
  'DecisionProviderFailed',
  'FallbackDecisionUsed',
  'ActionProposed',
  'ActionStarted',
  'ActionCompleted',
  'ActionRejected',
  'ActionInterrupted',
  'MovementStarted',
  'MovementCompleted',
  'RepairProgressed',
  'InjuryOccurred',
  'InjuryWorsened',
  'TreatmentStarted',
  'TreatmentCompleted',
  'ResourceReserved',
  'ReservationTransferRequested',
  'ReservationTransferred',
  'ReservationReleased',
  'MealConsumed',
  'OwnershipViolated',
  'CommitmentCreated',
  'CommitmentRenegotiationProposed',
  'CommitmentRenegotiationAccepted',
  'CommitmentRenegotiationRejected',
  'CommitmentFulfilled',
  'CommitmentBroken',
  'TaskCompleted',
  'TaskDeadlineMissed',
  'PerceptionRecorded',
  'BeliefUpdated',
  'RelationshipChanged',
  'SimulationPaused',
  'SimulationResumed',
  // Additions beyond the required minimum:
  'ResourceRemoved', // scripted meal removal (scenario E)
  'ReservationTransferRefused', // owner explicitly refuses a transfer request
  'HelpRequested', // category 7 social signal
  'ReliefRequested', // category 8 social signal
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const NPC_DISPLAY_NAMES: Record<NpcId, string> = {
  mara: 'Mara',
  jonas: 'Jonas',
  rin: 'Rin',
};

export const LOCATION_DISPLAY_NAMES: Record<LocationId, string> = {
  'purifier-workbench': 'Purifier Workbench',
  'food-shelf': 'Food Shelf',
  'medical-cot': 'Medical Cot',
  'routine-work-station': 'Routine Work Station',
};
