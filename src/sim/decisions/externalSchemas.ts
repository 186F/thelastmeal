import { z } from 'zod';
import { NPC_IDS, SCENARIO_IDS } from '../../shared/ids';
import { decisionResponseSchema, externalDecisionFailureSchema } from '../../shared/workerProtocol';
import { SCENARIO_END_TICK } from '../config';
import { offeredAffordanceSchema } from '../events/eventSchemas';
import { CONDITION_IDS, MODEL_EXPERIMENT_ID, MODEL_EXPERIMENT_VERSION } from './conditions';
import { EXTERNAL_CONTEXT_LIMITS } from './externalContext';

/**
 * Exact runtime schemas for the external decision seam (model integration
 * milestone 001, section 9). This is the SINGLE source of truth used by the
 * engine (at request construction), the worker output boundary, the
 * main-thread gateway client, the Node gateway, and every test — offered
 * affordances reuse the event-schema definition, so the outbound contract can
 * never drift from the ledger contract.
 */

export const EXTERNAL_REQUEST_SCHEMA_VERSION = 1;

const npcId = z.enum(NPC_IDS);
const scenarioId = z.enum(SCENARIO_IDS);
const hash16 = z.string().regex(/^[0-9a-f]{16}$/);
const shortCode = z.string().min(1).max(200);
const text = z.string().max(500);
const tickInt = z.number().int().min(0).max(SCENARIO_END_TICK);
const futureTick = z
  .number()
  .int()
  .min(0)
  .max(SCENARIO_END_TICK + 2_000);
const microUnit = z.number().int().min(0).max(1_000_000);
const signedMicro = z.number().int().min(-1_000_000).max(1_000_000);
const nonNegInt = z.number().int().nonnegative();
const decisionRequestId = z.string().regex(/^dec-\d{4,}$/);

/** Exact replayable engine request (mirrors shared/decisionContracts
 * DecisionRequest), with the offered-ID list pinned to the descriptors. */
export const decisionRequestSchema = z
  .object({
    requestId: decisionRequestId,
    npcId,
    scenarioId,
    requestedAtTick: tickInt,
    expiresAtTick: futureTick,
    worldRevisionAtRequest: nonNegInt,
    providerId: shortCode,
    offeredAffordances: z
      .array(offeredAffordanceSchema)
      .min(1)
      .max(EXTERNAL_CONTEXT_LIMITS.affordances),
    offeredAffordanceIds: z
      .array(z.string().min(1).max(500))
      .min(1)
      .max(EXTERNAL_CONTEXT_LIMITS.affordances),
    hardDependencyFingerprint: hash16,
  })
  .strict()
  .superRefine((value, ctx) => {
    const descriptorIds = value.offeredAffordances.map((a) => (a as { id: string }).id);
    if (
      descriptorIds.length !== value.offeredAffordanceIds.length ||
      descriptorIds.some((id, i) => id !== value.offeredAffordanceIds[i])
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'offeredAffordanceIds must exactly match offeredAffordances[].id',
        path: ['offeredAffordanceIds'],
      });
    }
  });

const contextAffordanceSchema = z
  .object({
    id: z.string().min(1).max(500),
    category: shortCode,
    mode: shortCode,
    actorId: npcId,
    targetNpcId: npcId.nullable(),
    targetResourceId: z.string().min(1).max(200).nullable(),
    requiredLocationId: z.string().min(1).max(200).nullable(),
    durationTicks: z.number().int().min(1).max(SCENARIO_END_TICK),
    expectedTravelTicks: z.number().int().min(0).max(1_000),
    preconditions: z.array(shortCode).max(16),
    reservations: z.array(shortCode).max(16),
    violation: z.boolean(),
    interruptible: z.boolean(),
    isContinuation: z.boolean(),
    description: z.string().min(1).max(300),
  })
  .strict();

export const externalDecisionContextSchema = z
  .object({
    npc: z
      .object({
        id: npcId,
        displayName: shortCode,
        traits: z.array(z.object({ key: shortCode, valueMicro: microUnit }).strict()).max(16),
        values: z.array(shortCode).max(16),
        skills: z.object({ repair: shortCode, firstAid: shortCode }).strict(),
        goalId: shortCode,
        goalText: text,
        hardBoundaryId: shortCode,
        hardBoundaryText: text,
      })
      .strict(),
    state: z
      .object({
        tick: tickInt,
        locationId: shortCode,
        currentAction: z
          .object({
            category: shortCode,
            mode: shortCode,
            phase: shortCode,
            interruptible: z.boolean(),
            completesAtTick: futureTick.nullable(),
          })
          .strict()
          .nullable(),
        hungerMicro: microUnit,
        fatigueMicro: microUnit,
        injury: z
          .object({
            severityMicro: microUnit,
            treatmentStarted: z.boolean(),
            worsened: z.boolean(),
          })
          .strict(),
        incapacitated: z.boolean(),
      })
      .strict(),
    world: z
      .object({
        purifierProgressUnits: nonNegInt,
        purifierTotalUnits: nonNegInt,
        taskOutcome: shortCode,
        benchOccupantId: npcId.nullable(),
        mealExists: z.boolean(),
        mealReservedForNpcId: npcId.nullable(),
        taskDeadlineTick: nonNegInt,
      })
      .strict(),
    cognition: z
      .object({
        beliefs: z
          .array(
            z
              .object({
                subject: shortCode,
                value: shortCode,
                confidenceMicro: microUnit,
                updatedTick: tickInt,
              })
              .strict(),
          )
          .max(EXTERNAL_CONTEXT_LIMITS.beliefs),
        memories: z
          .array(
            z
              .object({
                canonicalFact: text,
                preScenario: z.boolean(),
                perception: text,
                interpretation: text,
                confidenceMicro: microUnit,
                importanceMicro: microUnit,
                /** Seed memories are pre-scenario and carry createdTick -1. */
                createdTick: z.number().int().min(-1).max(SCENARIO_END_TICK),
                themes: z.array(shortCode).max(8),
                socialTargetId: npcId.nullable(),
                valenceMicro: signedMicro,
                selfRelevanceMicro: microUnit,
              })
              .strict(),
          )
          .max(EXTERNAL_CONTEXT_LIMITS.memories),
        relationships: z
          .array(z.object({ toNpcId: npcId, valueMicro: signedMicro }).strict())
          .max(EXTERNAL_CONTEXT_LIMITS.relationships),
        commitments: z
          .array(
            z
              .object({
                id: shortCode,
                kind: shortCode,
                role: shortCode,
                otherPartyId: npcId,
                status: shortCode,
                renegotiated: z.boolean(),
                terms: z
                  .object({
                    startTick: futureTick,
                    graceTick: futureTick,
                    minDurationTicks: z.number().int().min(1).max(SCENARIO_END_TICK),
                  })
                  .strict(),
                hasPendingProposal: z.boolean(),
                activeReliefStartTick: tickInt.nullable(),
              })
              .strict(),
          )
          .max(EXTERNAL_CONTEXT_LIMITS.commitments),
        recentSignals: z
          .array(
            z
              .object({
                kind: shortCode,
                fromNpcId: npcId,
                toNpcId: npcId.nullable(),
                tick: tickInt,
              })
              .strict(),
          )
          .max(EXTERNAL_CONTEXT_LIMITS.recentSignals),
      })
      .strict(),
    affordances: z.array(contextAffordanceSchema).min(1).max(EXTERNAL_CONTEXT_LIMITS.affordances),
  })
  .strict();

export const externalContextTruncationSchema = z
  .object({
    beliefs: nonNegInt,
    memories: nonNegInt,
    commitments: nonNegInt,
    relationships: nonNegInt,
    recentSignals: nonNegInt,
  })
  .strict();

/** The worker's `decision-request` message payload: replayable request +
 * deterministic bounded context + its hash + truncation diagnostics. */
export const externalDecisionRequestSchema = z
  .object({
    request: decisionRequestSchema,
    context: externalDecisionContextSchema,
    contextHash: hash16,
    truncationCounts: externalContextTruncationSchema,
  })
  .strict();

/** Transport + experiment envelope the browser sends to the gateway. `runId`
 * is noncanonical experiment metadata minted with cryptographic randomness
 * OUTSIDE the simulation; it never touches canonical state or hashes. */
export const externalDecisionRequestEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(EXTERNAL_REQUEST_SCHEMA_VERSION),
    experimentId: z.literal(MODEL_EXPERIMENT_ID),
    experimentVersion: z.literal(MODEL_EXPERIMENT_VERSION),
    conditionId: z.enum(CONDITION_IDS),
    runId: z.string().regex(/^[a-zA-Z0-9-]{8,64}$/),
    providerId: shortCode,
    promptVersion: z.string().min(1).max(100),
    contextHash: hash16,
    request: decisionRequestSchema,
    context: externalDecisionContextSchema,
    truncationCounts: externalContextTruncationSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.request.providerId !== value.providerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'envelope providerId must equal request.providerId',
        path: ['providerId'],
      });
    }
    // contextHash is shape-checked only here; the gateway RECOMPUTES it from
    // the context before any upstream call (section 10.4).
  });

/** Transport-diagnostic token usage echoed alongside a gateway response so
 * the operator UI can show cumulative usage; never canonical, never hashed. */
export const gatewayUsageSchema = z
  .object({
    inputTokens: nonNegInt.nullable(),
    outputTokens: nonNegInt.nullable(),
    totalTokens: nonNegInt.nullable(),
  })
  .strict();

/** What POST /v1/decision returns: a complete engine DecisionResponse the
 * gateway constructed itself, or a typed failure. Both member schemas are
 * the shared protocol definitions — one source, no gateway-local copies. */
export const gatewayDecisionResultSchema = z.discriminatedUnion('outcome', [
  z
    .object({
      outcome: z.literal('response'),
      response: decisionResponseSchema,
      usage: gatewayUsageSchema.nullable(),
    })
    .strict(),
  z.object({ outcome: z.literal('failure'), failure: externalDecisionFailureSchema }).strict(),
]);

export type GatewayDecisionResult = z.infer<typeof gatewayDecisionResultSchema>;
