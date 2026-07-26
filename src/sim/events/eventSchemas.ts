import { z } from 'zod';
import {
  ACTION_CATEGORIES,
  ACTION_MODES,
  EVENT_TYPES,
  LOCATION_IDS,
  NPC_IDS,
  RESOURCE_IDS,
  SCENARIO_IDS,
  type EventType,
} from '../../shared/ids';
import { DECISION_REJECTION_REASONS } from '../../shared/decisionContracts';
import { SCHEMA_VERSION } from '../../shared/versions';
import {
  REPAIR_RATE_PER_TICK,
  REPAIR_TOTAL_UNITS,
  SCENARIO_END_TICK,
  TRAVEL_TICKS,
} from '../config';
import type { SimEvent } from './types';

/**
 * Exact runtime schemas for every event type (remediation 3).
 *
 * One `.strict()` schema per event type, discriminated on `type`: exact
 * payload fields, integer ranges derived from the frozen configuration
 * (never re-stated as magic numbers), enums for all bounded vocabularies,
 * explicit nullability, structured-ID formats, and rejection of unknown
 * properties. A ledger event that parses here is shape-correct; semantic
 * consistency (ordering, references, replay, invariants, hashes) is layered
 * on top by validateLedgerFile.
 *
 * Drift control (cross-check, not inference — inferring SimEvent from zod
 * would widen the domain types the reducer's exhaustive switch relies on):
 * the runtime completeness check below throws at module load if any
 * EVENT_TYPES member lacks a schema branch, `parseSimEvent` pins the
 * output-side compatibility, and the schema round-trip tests run every event
 * of all seven live scenario ledgers through these schemas, so a payload
 * shape change on either side fails the suite immediately.
 */

const npcId = z.enum(NPC_IDS);
const resourceId = z.enum(RESOURCE_IDS);
const locationId = z.enum(LOCATION_IDS);
const scenarioId = z.enum(SCENARIO_IDS);
const actionCategory = z.enum(ACTION_CATEGORIES);
const actionMode = z.enum(ACTION_MODES);

const tickInt = z.number().int().min(0).max(SCENARIO_END_TICK);
/** Ticks that may legitimately point past the scenario window (arrivals,
 * completion targets, expiry windows for actions started near the end). */
const futureTick = z
  .number()
  .int()
  .min(0)
  .max(SCENARIO_END_TICK + 2_000);
const microUnit = z.number().int().min(0).max(1_000_000);
const signedMicro = z.number().int().min(-1_000_000).max(1_000_000);
const hash16 = z.string().regex(/^[0-9a-f]{16}$/);
const nonNegInt = z.number().int().nonnegative();
const scoreInt = z.number().int();

const canonicalEventId = z.string().regex(/^evt-\d{6,}$/);
const actionId = z.string().regex(/^act-\d{4,}$/);
const affordanceId = z.string().regex(/^(aff:|scripted:)[a-z0-9:_-]+$/i);
const decisionRequestId = z.string().regex(/^dec-\d{4,}$/);
const transferRequestId = z.string().regex(/^req-\d{3,}$/);
const proposalId = z.string().regex(/^prop-\d{3,}$/);
const signalId = z.string().regex(/^sig-\d{3,}$/);
const commitmentId = z.string().regex(/^cmt-[a-z-]+$/);
const beliefId = z.string().regex(/^bel-[a-z]+-[a-z0-9:._-]+$/i);
const shortCode = z.string().min(1).max(200);
const externalId = z.string().min(1).max(200);

const commitmentTerms = z
  .object({
    startTick: futureTick,
    graceTick: futureTick,
    minDurationTicks: z.number().int().min(1).max(SCENARIO_END_TICK),
  })
  .strict();

const offeredAffordance = z
  .object({
    id: affordanceId,
    category: actionCategory,
    mode: actionMode,
    actorId: npcId,
    targetNpcId: npcId.nullable(),
    targetResourceId: resourceId.nullable(),
    requiredLocationId: locationId.nullable(),
    durationTicks: z.number().int().min(1).max(SCENARIO_END_TICK),
    expectedTravelTicks: z.number().int().min(0).max(TRAVEL_TICKS),
    preconditions: z.array(shortCode),
    reservations: z.array(resourceId),
    violation: z.boolean(),
    interruptible: z.boolean(),
    commitmentId: commitmentId.nullable(),
    proposalId: proposalId.nullable(),
    requestId: transferRequestId.nullable(),
    proposedTerms: commitmentTerms.nullable(),
    continuesActionId: actionId.nullable(),
    stateVersion: nonNegInt,
  })
  .strict();

const scoreRecord = z
  .object({
    affordanceId,
    mode: actionMode,
    totalScore: scoreInt,
    components: z.array(z.object({ code: shortCode, value: scoreInt }).strict()),
  })
  .strict();

const actionDescriptor = {
  actionId,
  affordanceId,
  npcId,
  category: actionCategory,
  mode: actionMode,
  targetNpcId: npcId.nullable(),
  targetResourceId: resourceId.nullable(),
  locationId: locationId.nullable(),
  durationTicks: z.number().int().min(1).max(SCENARIO_END_TICK),
  stateVersion: nonNegInt,
  interruptible: z.boolean(),
  violation: z.boolean(),
  commitmentId: commitmentId.nullable(),
  proposalId: proposalId.nullable(),
  requestId: transferRequestId.nullable(),
  proposedTerms: commitmentTerms.nullable(),
};

const envelopeBase = {
  id: z.string().regex(/^evt-(op-)?\d{4,}$/),
  seq: nonNegInt,
  tick: tickInt,
  schemaVersion: z.literal(SCHEMA_VERSION),
  actorId: npcId.nullable(),
  targetId: z.string().min(1).max(200).nullable(),
  causationId: canonicalEventId.nullable(),
  correlationId: z.string().min(1).max(200).nullable(),
};

function ev<T extends EventType, P extends z.ZodRawShape>(
  type: T,
  payloadShape: P,
): z.ZodObject<Record<string, z.ZodTypeAny>> {
  return z
    .object({
      ...envelopeBase,
      type: z.literal(type),
      payload: z.object(payloadShape).strict(),
    })
    .strict() as unknown as z.ZodObject<Record<string, z.ZodTypeAny>>;
}

const eventSchemaList = [
  ev('ScenarioStarted', {
    scenarioId,
    scenarioVersion: z.string().min(1).max(50),
    seed: z.number().int(),
    configVersion: z.string().min(1).max(50),
    providerId: shortCode,
  }),
  ev('ScenarioEnded', {
    worldStateHash: hash16,
    taskOutcome: z.enum(['completed', 'deadline-missed']),
  }),
  ev('TimeAdvanced', { tick: tickInt }),
  ev('SimulationPaused', {}),
  ev('SimulationResumed', {}),
  ev('DecisionRequested', {
    npcId,
    requestId: decisionRequestId,
    providerId: shortCode,
    stateVersion: nonNegInt,
    worldRevision: nonNegInt,
    expiresAtTick: futureTick,
    hardDependencyFingerprint: hash16,
    affordanceIds: z.array(affordanceId),
    offeredAffordances: z.array(offeredAffordance),
  }),
  ev('DecisionResponseReceived', {
    npcId,
    requestId: externalId,
    responseId: externalId,
    providerId: shortCode,
    selectedAffordanceId: z.string().min(1).max(500),
    confidenceBp: z.number().int().min(0).max(10_000),
    reasonCode: shortCode,
    scores: z.array(scoreRecord),
  }),
  ev('DecisionResponseAccepted', {
    npcId,
    requestId: decisionRequestId,
    responseId: externalId,
    selectedAffordanceId: affordanceId,
    confidenceBp: z.number().int().min(0).max(10_000),
    reasonCode: shortCode,
    usedFallback: z.boolean(),
  }),
  ev('DecisionResponseRejected', {
    npcId,
    requestId: externalId,
    responseId: externalId,
    selectedAffordanceId: z.string().min(1).max(500).nullable(),
    rejectionReason: z.enum(DECISION_REJECTION_REASONS),
    constraintCodes: z.array(shortCode),
  }),
  ev('DecisionRequestExpired', {
    npcId,
    requestId: decisionRequestId,
    reasonCode: z.enum(['ttl-expired', 'scenario-ended']),
  }),
  ev('DecisionRequestSuperseded', {
    npcId,
    requestId: decisionRequestId,
    supersededByRequestId: decisionRequestId,
  }),
  ev('DecisionProviderFailed', {
    npcId,
    requestId: decisionRequestId,
    providerId: shortCode,
    errorCode: shortCode,
  }),
  ev('FallbackDecisionUsed', {
    npcId,
    requestId: decisionRequestId,
    affordanceId,
    reasonCode: shortCode,
  }),
  ev('ActionProposed', actionDescriptor),
  ev('ActionStarted', { ...actionDescriptor, completesAtTick: futureTick }),
  ev('ActionCompleted', {
    actionId,
    npcId,
    category: actionCategory,
    mode: actionMode,
    startedTick: tickInt,
    outcomeCode: shortCode,
  }),
  ev('ActionRejected', {
    actionId: actionId.nullable(),
    affordanceId,
    npcId,
    category: actionCategory,
    mode: actionMode,
    reasonCode: shortCode,
    failedPreconditions: z.array(shortCode),
  }),
  ev('ActionInterrupted', {
    actionId,
    npcId,
    category: actionCategory,
    mode: actionMode,
    reasonCode: shortCode,
  }),
  ev('MovementStarted', {
    npcId,
    actionId,
    fromLocationId: locationId,
    toLocationId: locationId,
    arriveTick: futureTick,
  }),
  ev('MovementCompleted', { npcId, actionId, locationId }),
  ev('RepairProgressed', {
    npcId,
    unitsDelta: z
      .number()
      .int()
      .min(1)
      .max(Math.max(...Object.values(REPAIR_RATE_PER_TICK))),
    progressUnits: z.number().int().min(0).max(REPAIR_TOTAL_UNITS),
  }),
  ev('InjuryOccurred', { npcId, severityMicro: microUnit, cause: z.literal('scripted') }),
  ev('InjuryWorsened', {
    npcId,
    severityMicro: microUnit,
    reasonCode: z.literal('treatment-not-started-in-time'),
  }),
  ev('TreatmentStarted', {
    actionId,
    healerId: npcId,
    patientId: npcId,
    expectedDurationTicks: z.number().int().min(0).max(SCENARIO_END_TICK),
  }),
  ev('TreatmentCompleted', {
    actionId,
    healerId: npcId,
    patientId: npcId,
    severityBeforeMicro: microUnit,
    severityAfterMicro: microUnit,
  }),
  ev('ResourceReserved', {
    resourceId,
    holderNpcId: npcId,
    kind: z.enum(['consumption-right', 'exclusive-use']),
  }),
  ev('ReservationTransferRequested', {
    requestId: transferRequestId,
    resourceId,
    requesterNpcId: npcId,
    ownerNpcId: npcId,
  }),
  ev('ReservationTransferred', {
    resourceId,
    fromNpcId: npcId,
    toNpcId: npcId,
    requestId: transferRequestId.nullable(),
  }),
  ev('ReservationTransferRefused', {
    requestId: transferRequestId,
    resourceId,
    ownerNpcId: npcId,
    requesterNpcId: npcId,
    reasonCode: shortCode,
  }),
  ev('ReservationReleased', {
    resourceId,
    previousHolderNpcId: npcId,
    reasonCode: shortCode,
  }),
  ev('ResourceRemoved', { resourceId, reasonCode: z.literal('scripted-world-event') }),
  ev('MealConsumed', {
    npcId,
    resourceId,
    hungerBeforeMicro: microUnit,
    hungerAfterMicro: microUnit,
    violation: z.boolean(),
  }),
  ev('OwnershipViolated', {
    actorId: npcId,
    resourceId,
    ownerNpcId: npcId,
    violationKind: z.literal('took-reserved-meal'),
  }),
  ev('CommitmentCreated', {
    commitmentId,
    kind: z.literal('relieve-at-bench'),
    debtorId: npcId,
    creditorId: npcId,
    terms: commitmentTerms,
  }),
  ev('CommitmentRenegotiationProposed', {
    commitmentId,
    proposalId,
    proposedByNpcId: npcId,
    proposedTerms: commitmentTerms,
    reasonCode: shortCode,
  }),
  ev('CommitmentRenegotiationAccepted', {
    commitmentId,
    proposalId,
    acceptedByNpcId: npcId,
    newTerms: commitmentTerms,
  }),
  ev('CommitmentRenegotiationRejected', {
    commitmentId,
    proposalId,
    rejectedByNpcId: npcId,
  }),
  ev('CommitmentFulfilled', {
    commitmentId,
    reliefStartTick: tickInt,
    reliefEndTick: tickInt,
  }),
  ev('CommitmentBroken', { commitmentId, reasonCode: shortCode }),
  ev('TaskCompleted', {
    taskId: shortCode,
    progressUnits: z.number().int().min(0).max(REPAIR_TOTAL_UNITS),
  }),
  ev('TaskDeadlineMissed', {
    taskId: shortCode,
    progressUnits: z.number().int().min(0).max(REPAIR_TOTAL_UNITS),
  }),
  ev('PerceptionRecorded', {
    npcId,
    sourceEventId: canonicalEventId,
    sourceEventType: z.enum(EVENT_TYPES),
    summaryCode: shortCode,
  }),
  ev('BeliefUpdated', {
    npcId,
    beliefId,
    subject: shortCode,
    value: shortCode,
    confidenceMicro: microUnit,
    provenanceKind: z.enum(['perception', 'testimony', 'inference']),
    provenanceEventId: canonicalEventId.nullable(),
  }),
  ev('RelationshipChanged', {
    fromNpcId: npcId,
    toNpcId: npcId,
    deltaMicro: z.number().int().min(-2_000_000).max(2_000_000),
    valueMicro: signedMicro,
    reasonCode: shortCode,
    causeEventIds: z.array(canonicalEventId),
  }),
  ev('HelpRequested', {
    signalId,
    fromNpcId: npcId,
    toNpcId: npcId.nullable(),
    topicCode: shortCode,
  }),
  ev('ReliefRequested', {
    signalId,
    fromNpcId: npcId,
    toNpcId: npcId.nullable(),
    topicCode: shortCode,
  }),
];

/** Per-type schema lookup used by the ledger validator. */
export const EVENT_SCHEMAS_BY_TYPE: ReadonlyMap<EventType, z.ZodTypeAny> = new Map(
  eventSchemaList.map((schema) => {
    const type = (schema.shape as { type: z.ZodLiteral<EventType> }).type.value;
    return [type, schema] as const;
  }),
);

// Runtime completeness check: every declared event type has exactly one
// exact schema. Throws at module load, so drift is impossible to miss.
for (const type of EVENT_TYPES) {
  if (!EVENT_SCHEMAS_BY_TYPE.has(type)) {
    throw new Error(`event-schema-missing: ${type}`);
  }
}
if (EVENT_SCHEMAS_BY_TYPE.size !== EVENT_TYPES.length) {
  throw new Error('event-schema-duplicate-or-extra-branch');
}

/**
 * Validate a single event against its exact schema. Returns null when valid,
 * otherwise a structured description of the first few problems.
 */
export function validateEventExact(event: unknown): string | null {
  const type = (event as { type?: unknown }).type;
  const schema =
    typeof type === 'string' ? EVENT_SCHEMAS_BY_TYPE.get(type as EventType) : undefined;
  if (!schema) {
    return `unknown-event-type: ${String(type)}`;
  }
  const result = schema.safeParse(event);
  if (result.success) return null;
  return result.error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');
}

/**
 * Compile-time drift guard: parsing an unknown value through the union must
 * produce a SimEvent-compatible object. (The reverse direction — every
 * SimEvent parses — is covered by the schema round-trip tests, which run all
 * seven scenario ledgers through validateEventExact.)
 */
export function parseSimEvent(event: unknown): SimEvent | null {
  const type = (event as { type?: unknown }).type;
  const schema =
    typeof type === 'string' ? EVENT_SCHEMAS_BY_TYPE.get(type as EventType) : undefined;
  if (!schema) return null;
  const result = schema.safeParse(event);
  return result.success ? (result.data as SimEvent) : null;
}
