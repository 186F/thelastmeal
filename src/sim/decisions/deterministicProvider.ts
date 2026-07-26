import {
  HUNGER_CRITICAL,
  HUNGER_HIGH,
  HUNGER_MODERATE,
  INCAPACITATION_SEVERITY,
  COMMITMENT_LEAD_TICKS,
  COMMITMENT_RELIEF_MIN_DURATION_TICKS,
  REPAIR_TOTAL_UNITS,
  SOCIAL_SIGNAL_RECENCY_TICKS,
} from '../config';
import type { Affordance } from '../actions/affordances';
import type { AffordanceScoreRecord, AffordanceScoreComponent } from '../events/types';
import { evaluateConstraints } from './constraints';
import { memoryInfluence, type MemoryEffectKind } from './memoryInfluence';
import type { DecisionContext, DecisionProvider, DecisionResult } from './provider';
import { NPC_WEIGHTS, RELIEVE_SKILL_RATE, SCORING } from './weights';

/**
 * Deterministic utility-scoring decision provider ("condition 1" baseline).
 *
 * Layered evaluation, in fixed order:
 *  L0 — incapacitated NPCs make no decisions (engine skips them entirely).
 *  L1/L2 — survival overrides and hard identity boundaries come from the
 *       shared provider-independent constraint module (decisions/
 *       constraints.ts). The provider filters to the allowed set so
 *       prohibited choices are never scored; the engine's acceptance gate
 *       enforces the same module authoritatively regardless of provider.
 *  L3 — transparent additive utility scoring with per-component debug output.
 *       Memory effects flow exclusively through the generic appraisal module
 *       (decisions/memoryInfluence.ts); no memory IDs are ever inspected.
 *
 * Ties break deterministically: higher score first, then ascending
 * affordance ID. The provider never mutates state and only ever returns an
 * offered affordance ID.
 */
export class DeterministicProvider implements DecisionProvider {
  readonly id = 'deterministic-utility-v1';

  decide(ctx: DecisionContext): DecisionResult {
    const evaluation = evaluateConstraints(ctx, ctx.affordances);
    const allowed = new Set(evaluation.allowedAffordanceIds);
    const candidates = ctx.affordances.filter((a) => allowed.has(a.id));
    const scored = candidates.map((a) => scoreAffordance(ctx, a));
    scored.sort(
      (x, y) => y.totalScore - x.totalScore || (x.affordanceId < y.affordanceId ? -1 : 1),
    );
    const top = scored[0];
    if (!top) {
      throw new Error('provider-no-affordances');
    }
    const second = scored[1];
    const margin = second ? top.totalScore - second.totalScore : top.totalScore;
    const confidenceBp = Math.min(
      10_000,
      SCORING.confidenceBaseBp + Math.floor(Math.max(0, margin) / SCORING.confidenceMarginDivisor),
    );
    return {
      affordanceId: top.affordanceId,
      confidenceBp,
      reasonCode: dominantReason(top),
      scores: scored,
    };
  }
}

// ---------------------------------------------------------------------------
// L3 — utility scoring
// ---------------------------------------------------------------------------

function scoreAffordance(ctx: DecisionContext, a: Affordance): AffordanceScoreRecord {
  const w = NPC_WEIGHTS[ctx.npcId];
  const parts: AffordanceScoreComponent[] = [];
  const add = (code: string, value: number): void => {
    if (value !== 0) parts.push({ code, value: Math.round(value) });
  };
  const addMemoryEffects = (
    effect: MemoryEffectKind,
    counterpartyId: typeof a.targetNpcId,
  ): void => {
    for (const component of memoryInfluence(ctx.memories, effect, counterpartyId)) {
      add(component.code, component.value);
    }
  };
  const isContinue = a.continuesActionId !== null;

  switch (a.mode) {
    case 'work':
    case 'relieve': {
      add('base', a.mode === 'work' ? SCORING.base.work : SCORING.base.relieve);
      add('work-drive', w.workDriveMicro * SCORING.workDriveScale);
      if (ctx.purifierProgressUnits < REPAIR_TOTAL_UNITS) {
        // The colony-survival/-stability value is what makes the unfinished
        // purifier press on the decision; label the component accordingly so
        // value effects stay separately inspectable.
        const survivalValue = ctx.identity.values.find(
          (v) => v === 'colony-survival' || v === 'colony-stability',
        );
        add(
          survivalValue ? `value:${survivalValue}` : 'deadline-pressure',
          SCORING.deadlinePressure,
        );
      }
      addMemoryEffects('work', null);
      const drag = Math.max(0, ctx.hungerMicro - HUNGER_HIGH) * SCORING.workHungerDragFactor;
      add('hunger-drag', -Math.min(SCORING.workHungerDragCap, drag));

      if (a.mode === 'relieve' && !isContinue) {
        const occupant = ctx.benchOccupantId;
        const commitment = ctx.commitments.find(
          (c) => c.id === a.commitmentId && c.role === 'debtor' && c.status === 'active',
        );
        if (commitment && ctx.tick >= commitment.terms.startTick - COMMITMENT_LEAD_TICKS) {
          add('commitment-due', w.promiseDutyMicro * SCORING.relieveCommitmentScale);
          addMemoryEffects('relieve-commitment-due', commitment.otherPartyId);
        }
        if (occupant) {
          const requestedRelief = ctx.recentSignals.some(
            (s) =>
              s.kind === 'relief-requested' &&
              s.fromNpcId === occupant &&
              ctx.tick - s.tick < SOCIAL_SIGNAL_RECENCY_TICKS,
          );
          if (requestedRelief) {
            add('empathy-relief', w.empathyMicro * SCORING.relieveEmpathyScale);
          }
          const myRate = RELIEVE_SKILL_RATE[ctx.npcId];
          const theirRate = RELIEVE_SKILL_RATE[occupant];
          add('skill-delta', (myRate - theirRate) * SCORING.relieveSkillDeltaPerUnit);
          const run = ctx.benchOccupantRunTicks;
          if (run !== null && run < COMMITMENT_RELIEF_MIN_DURATION_TICKS && !requestedRelief) {
            const occupantCommitment = ctx.commitments.find(
              (c) =>
                c.role === 'creditor' &&
                c.otherPartyId === occupant &&
                c.status === 'active' &&
                c.activeReliefStartTick !== null,
            );
            if (occupantCommitment) {
              // Do not yank the debtor out of the relief promised to me.
              add('protect-own-relief', -SCORING.relieveProtectOwnReliefPenalty);
            } else {
              add('politeness', -SCORING.relievePolitenessPenalty);
            }
          }
        }
      }
      break;
    }

    case 'eat': {
      add('base', 0);
      add('need-hunger', legalEatScore(ctx.hungerMicro, w.selfPreservationMicro));
      break;
    }

    case 'eat-violation': {
      add('need-hunger', legalEatScore(ctx.hungerMicro, w.selfPreservationMicro));
      const ownerRel =
        a.targetNpcId === null
          ? 0
          : (ctx.relationships.find((r) => r.toNpcId === a.targetNpcId)?.valueMicro ?? 0);
      const penalty =
        SCORING.violationBasePenalty +
        w.ruleAdherenceMicro * SCORING.violationRuleScale +
        Math.max(0, ownerRel) * SCORING.violationRelationshipScale;
      add('norm-penalty', -penalty);
      break;
    }

    case 'request-transfer': {
      let drive = 0;
      if (ctx.hungerMicro >= HUNGER_HIGH) {
        drive =
          SCORING.requestHighBase +
          Math.min(
            SCORING.requestHighHungerCap,
            (ctx.hungerMicro - HUNGER_HIGH) * SCORING.requestHighHungerFactor,
          );
      } else if (ctx.hungerMicro >= HUNGER_MODERATE) {
        drive = SCORING.requestModerateBase;
      }
      add('need-hunger', drive);
      add('pride-penalty', -w.prideMicro * SCORING.requestPrideScale);
      break;
    }

    case 'transfer': {
      add('base', SCORING.base.respondToRequest);
      add('generosity', w.generosityMicro * SCORING.transferGenerosityScale);
      const rel =
        a.targetNpcId === null
          ? 0
          : (ctx.relationships.find((r) => r.toNpcId === a.targetNpcId)?.valueMicro ?? 0);
      add('relationship', rel * SCORING.transferRelationshipScale);
      if (ctx.hungerMicro >= HUNGER_MODERATE) add('self-need', -SCORING.transferSelfNeedPenalty);
      addMemoryEffects('transfer', a.targetNpcId);
      break;
    }

    case 'refuse-request': {
      add('base', SCORING.base.respondToRequest);
      add('directness', w.directnessMicro * SCORING.refuseDirectnessScale);
      add('suspicion', w.suspicionMicro * SCORING.refuseSuspicionScale);
      // Conflict-avoidant NPCs (identity trait) find blunt refusals costly.
      add(
        'conflict-avoidance',
        -(ctx.identity.traits['conflictAvoidance'] ?? 0) * SCORING.refuseConflictAvoidanceScale,
      );
      if (ctx.hungerMicro >= HUNGER_MODERATE) add('self-need', SCORING.refuseSelfNeedBonus);
      addMemoryEffects('refuse-request', a.targetNpcId);
      break;
    }

    case 'release': {
      add('base', 0);
      add('generosity', w.generosityMicro * SCORING.releaseGenerosityScale);
      break;
    }

    case 'ask-help': {
      add('base', SCORING.base.askHelp);
      add('self-preservation', w.selfPreservationMicro * SCORING.askHelpSelfPreservationScale);
      addMemoryEffects('ask-help', null);
      break;
    }

    case 'request-break': {
      let need = 0;
      if (ctx.hungerMicro >= HUNGER_MODERATE) {
        need =
          SCORING.breakNeedBase + (ctx.hungerMicro - HUNGER_MODERATE) * SCORING.breakHungerFactor;
      }
      if (ctx.fatigueMicro >= SCORING.restFatigueThreshold) {
        need += (ctx.fatigueMicro - SCORING.restFatigueThreshold) * SCORING.breakFatigueFactor;
      }
      add('need-break', need);
      add('pride-penalty', -w.prideMicro * SCORING.breakPrideScale);
      addMemoryEffects('request-break', null);
      break;
    }

    case 'treat': {
      add('base', SCORING.base.treat);
      add('empathy', w.empathyMicro * SCORING.treatEmpathyScale);
      add('first-aid-skill', w.firstAidBonus);
      const asked = ctx.recentSignals.some(
        (s) =>
          s.kind === 'help-requested' &&
          s.fromNpcId === a.targetNpcId &&
          (s.toNpcId === null || s.toNpcId === ctx.npcId) &&
          ctx.tick - s.tick < SOCIAL_SIGNAL_RECENCY_TICKS,
      );
      if (asked) add('asked-for-help', SCORING.treatAskedForHelpBonus);
      break;
    }

    case 'propose-renegotiation': {
      add('base', SCORING.base.proposeRenegotiation);
      add('promise-duty', w.promiseDutyMicro * SCORING.proposePromiseDutyScale);
      break;
    }

    case 'accept-renegotiation':
    case 'reject-renegotiation': {
      const emergency = ctx.beliefs.some(
        (b) =>
          b.subject.startsWith('injury:') &&
          (b.value === 'serious' || b.value === 'being-treated' || b.value === 'incapacitating'),
      );
      const isAccept = a.mode === 'accept-renegotiation';
      const aligned = isAccept === emergency;
      add(
        'emergency-belief',
        aligned ? SCORING.base.respondToProposal : SCORING.respondProposalMismatchScore,
      );
      if (!isAccept) add('pride', w.prideMicro * SCORING.rejectPrideScale);
      break;
    }

    case 'stay-at-cot': {
      add('base', SCORING.base.stayAtCot);
      add('self-preservation', w.selfPreservationMicro * SCORING.stayAtCotSelfPreservationScale);
      break;
    }

    case 'rest': {
      add('base', SCORING.base.rest);
      if (ctx.fatigueMicro >= SCORING.restFatigueThreshold) {
        add(
          'need-fatigue',
          (ctx.fatigueMicro - SCORING.restFatigueThreshold) * SCORING.restFatigueFactor,
        );
      }
      addMemoryEffects('rest', null);
      break;
    }

    case 'routine-work':
    case 'deliver-materials': {
      add('base', SCORING.base.routineWork);
      add('industriousness', w.industriousnessMicro * SCORING.routineIndustriousnessScale);
      break;
    }

    case 'wait': {
      add('base', SCORING.base.wait);
      break;
    }

    default:
      add('base', 0);
  }

  if (isContinue) add('continuity', SCORING.continuityBonus);

  const totalScore = parts.reduce((sum, p) => sum + p.value, 0);
  return { affordanceId: a.id, mode: a.mode, totalScore, components: parts };
}

function legalEatScore(hungerMicro: number, selfPreservationMicro: number): number {
  if (hungerMicro >= HUNGER_CRITICAL) return SCORING.eatCritical;
  if (hungerMicro >= HUNGER_HIGH) {
    return SCORING.eatHigh + selfPreservationMicro * SCORING.eatSelfPreservationScale;
  }
  if (hungerMicro >= HUNGER_MODERATE) return SCORING.eatModerate;
  return SCORING.eatLow;
}

function dominantReason(record: AffordanceScoreRecord): string {
  let best: AffordanceScoreComponent | null = null;
  for (const c of record.components) {
    if (c.code === 'base' || c.code === 'continuity') continue;
    if (c.value > 0 && (best === null || c.value > best.value)) best = c;
  }
  if (best) return best.code;
  return record.components.some((c) => c.code === 'continuity')
    ? 'continuity'
    : 'default-preference';
}

export const INCAPACITATION_LIMIT = INCAPACITATION_SEVERITY;
