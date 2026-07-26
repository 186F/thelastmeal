import { z } from 'zod';

/**
 * Runtime zod schema for PresentationSnapshot: the worker-to-main snapshot
 * payload is schema-validated at the boundary (brief sections 5 and 23), not
 * just typed at compile time.
 */

const npcIdSchema = z.enum(['mara', 'jonas', 'rin']);
const locationIdSchema = z.enum([
  'purifier-workbench',
  'food-shelf',
  'medical-cot',
  'routine-work-station',
]);
const micro = z.number().int().min(0).max(1_000_000);

const transitSchema = z
  .object({
    fromLocationId: locationIdSchema,
    toLocationId: locationIdSchema,
    startTick: z.number().int().nonnegative(),
    arriveTick: z.number().int().nonnegative(),
  })
  .strict();

const actionSchema = z
  .object({
    id: z.string(),
    category: z.string(),
    mode: z.string(),
    phase: z.enum(['moving', 'active']),
    startedTick: z.number().int(),
    completesAtTick: z.number().int(),
    targetNpcId: npcIdSchema.nullable(),
    targetResourceId: z.string().nullable(),
    locationId: locationIdSchema.nullable(),
  })
  .strict();

const decisionSchema = z
  .object({
    requestId: z.string(),
    affordanceId: z.string(),
    category: z.string().nullable(),
    mode: z.string().nullable(),
    confidenceBp: z.number().int().min(0).max(10_000),
    reasonCode: z.string(),
    providerId: z.string(),
    tick: z.number().int(),
    usedFallback: z.boolean(),
  })
  .strict();

const pendingDecisionSchema = z
  .object({
    requestId: z.string(),
    providerId: z.string(),
    requestedAtTick: z.number().int().nonnegative(),
    expiresAtTick: z.number().int().nonnegative(),
    worldRevisionAtRequest: z.number().int().nonnegative(),
    offeredAffordanceCount: z.number().int().nonnegative(),
    responseIdsSeen: z.array(z.string()),
  })
  .strict();

const npcSchema = z
  .object({
    id: npcIdSchema,
    displayName: z.string(),
    locationId: locationIdSchema,
    transit: transitSchema.nullable(),
    hungerMicro: micro,
    fatigueMicro: micro,
    injurySeverityMicro: micro,
    incapacitated: z.boolean(),
    goal: z.string(),
    currentAction: actionSchema.nullable(),
    lastDecision: decisionSchema.nullable(),
    pendingDecision: pendingDecisionSchema.nullable(),
    beliefs: z.array(
      z
        .object({
          id: z.string(),
          subject: z.string(),
          value: z.string(),
          confidenceMicro: micro,
          provenanceKind: z.string(),
          updatedTick: z.number().int(),
        })
        .strict(),
    ),
    memories: z.array(
      z
        .object({
          id: z.string(),
          canonicalFact: z.string(),
          perception: z.string(),
          interpretation: z.string(),
          confidenceMicro: micro,
          importanceMicro: micro,
          createdTick: z.number().int(),
          themes: z.array(z.string()),
          socialTargetId: npcIdSchema.nullable(),
          valenceMicro: z.number().int().min(-1_000_000).max(1_000_000),
          selfRelevanceMicro: micro,
        })
        .strict(),
    ),
    relationships: z.array(
      z
        .object({
          toNpcId: npcIdSchema,
          valueMicro: z.number().int().min(-1_000_000).max(1_000_000),
        })
        .strict(),
    ),
  })
  .strict();

export const presentationSnapshotSchema = z
  .object({
    scenarioId: z.enum(['A', 'B1', 'B2', 'C', 'D', 'E', 'F']),
    scenarioVersion: z.string(),
    configVersion: z.string(),
    seed: z.number().int(),
    tick: z.number().int().nonnegative(),
    endTick: z.number().int().positive(),
    terminal: z.boolean(),
    purifier: z
      .object({
        progressUnits: z.number().int().nonnegative(),
        progressTotalUnits: z.number().int().positive(),
        activeWorkerId: npcIdSchema.nullable(),
        deadlineTick: z.number().int().positive(),
        taskOutcome: z.enum(['pending', 'completed', 'deadline-missed']),
      })
      .strict(),
    meal: z
      .object({
        exists: z.boolean(),
        reservedForNpcId: npcIdSchema.nullable(),
        consumedByNpcId: npcIdSchema.nullable(),
        locationId: locationIdSchema,
      })
      .strict(),
    npcs: z.array(npcSchema).length(3),
    commitments: z.array(
      z
        .object({
          id: z.string(),
          kind: z.string(),
          debtorId: npcIdSchema,
          creditorId: npcIdSchema,
          status: z.enum(['active', 'fulfilled', 'broken']),
          startTick: z.number().int(),
          graceTick: z.number().int(),
          minDurationTicks: z.number().int(),
          renegotiated: z.boolean(),
          pendingProposalId: z.string().nullable(),
        })
        .strict(),
    ),
    recentRelationshipChanges: z.array(
      z
        .object({
          fromNpcId: npcIdSchema,
          toNpcId: npcIdSchema,
          deltaMicro: z.number().int(),
          valueMicro: z.number().int(),
          tick: z.number().int(),
          causeEventIds: z.array(z.string()),
        })
        .strict(),
    ),
    eventCount: z.number().int().nonnegative(),
    stateVersion: z.number().int().nonnegative(),
    worldRevision: z.number().int().nonnegative(),
    worldStateHash: z
      .string()
      .regex(/^[0-9a-f]{16}$/)
      .nullable(),
    canonicalLedgerHash: z
      .string()
      .regex(/^[0-9a-f]{16}$/)
      .nullable(),
    providerId: z.string(),
  })
  .strict();
