import { LOCATION_IDS, MEMORY_THEMES, NPC_IDS, SCENARIO_IDS } from '../../shared/ids';
import { V1_ROLES } from '../scenarios/roles';
import { LOCATION_POSITIONS, NPC_VISUALS } from '../../shared/viewConfig';
import type { ValidationIssue } from '../../shared/validation';
import { validationOk } from '../../shared/validation';
import {
  FATIGUE_RATE_PER_TICK,
  HUNGER_CRITICAL,
  HUNGER_HIGH,
  HUNGER_MODERATE,
  HUNGER_RATE_PER_TICK,
  INJURY_INITIAL_SEVERITY,
  INJURY_WORSENED_SEVERITY,
  REPAIR_INITIAL_UNITS,
  REPAIR_RATE_PER_TICK,
  REPAIR_TOTAL_UNITS,
  SCENARIO_END_TICK,
  TREATMENT_BY_HEALER,
} from '../config';
import { IDENTITIES, SEED_MEMORIES } from '../domain/identities';
import { NPC_WEIGHTS, WEIGHT_TRAIT_SOURCES } from '../decisions/weights';
import { SCENARIOS, SCENARIO_LIST } from '../scenarios/definitions';
import { buildInitialState } from '../scenarios/initialState';
import { canonicalSerialize } from '../replay/serialize';
import { hashCanonicalState } from '../replay/hash';
import { SCHEMA_VERSION } from '../../shared/versions';

/**
 * Shared experiment-data validation (brief section 22). These rules run
 * identically under Node (`npm run validate`) and in the browser worker
 * behind the Validate Configuration control. Filesystem-dependent
 * architecture checks (import scanning, npm script presence) live only in
 * the Node validate script.
 */
export function validateExperimentData(): { ok: boolean; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const err = (code: string, message: string, where: string | null = null): void => {
    issues.push({ severity: 'error', code, message, where });
  };

  // Scenario definitions: presence, uniqueness, references.
  const seenIds = new Set<string>();
  for (const id of SCENARIO_IDS) {
    if (!SCENARIOS[id]) {
      err('missing-scenario', `Scenario ${id} is not defined`, `scenarios.${id}`);
    }
  }
  for (const s of SCENARIO_LIST) {
    if (seenIds.has(s.id)) err('duplicate-scenario-id', `Duplicate scenario id ${s.id}`);
    seenIds.add(s.id);
    if (!/^\d+\.\d+\.\d+$/.test(s.version)) {
      err('invalid-scenario-version', `Scenario ${s.id} version ${s.version}`, `scenarios.${s.id}`);
    }
    if (!Number.isInteger(s.seed)) {
      err('invalid-seed', `Scenario ${s.id} seed must be an integer`, `scenarios.${s.id}`);
    }
    if (s.injury) {
      if (!NPC_IDS.includes(s.injury.npcId)) {
        err('broken-npc-reference', `Scenario ${s.id} injury targets ${s.injury.npcId}`);
      }
      if (s.injury.atTick <= 0 || s.injury.atTick >= SCENARIO_END_TICK) {
        err('invalid-injury-tick', `Scenario ${s.id} injury at ${s.injury.atTick}`);
      }
    }
    if (
      s.mealRemovalAtTick !== null &&
      (s.mealRemovalAtTick <= 0 || s.mealRemovalAtTick >= SCENARIO_END_TICK)
    ) {
      err('invalid-meal-removal-tick', `Scenario ${s.id}`);
    }
    if (
      s.providerFailureFromTick !== null &&
      (s.providerFailureFromTick <= 0 || s.providerFailureFromTick >= SCENARIO_END_TICK)
    ) {
      err('invalid-provider-failure-tick', `Scenario ${s.id}`);
    }
  }
  if (SCENARIOS.B1.seed !== SCENARIOS.B2.seed) {
    err('b1-b2-seed-mismatch', 'B1 and B2 must share one seed for the memory ablation');
  }

  // Identity cards.
  for (const npcId of NPC_IDS) {
    const identity = IDENTITIES[npcId];
    if (!identity) {
      err('missing-identity', `No identity card for ${npcId}`);
      continue;
    }
    for (const [trait, value] of Object.entries(identity.traits)) {
      if (!Number.isInteger(value) || value < 0 || value > 1_000_000) {
        err('invalid-trait-value', `${npcId}.${trait} = ${value}`);
      }
    }
    const { hungerMicro, fatigueMicro, locationId } = identity.initial;
    if (hungerMicro < 0 || hungerMicro > 1_000_000 || !Number.isInteger(hungerMicro)) {
      err('invalid-initial-need', `${npcId} hunger ${hungerMicro}`);
    }
    if (fatigueMicro < 0 || fatigueMicro > 1_000_000 || !Number.isInteger(fatigueMicro)) {
      err('invalid-initial-need', `${npcId} fatigue ${fatigueMicro}`);
    }
    if (!LOCATION_IDS.includes(locationId)) {
      err('broken-location-reference', `${npcId} starts at unknown location ${locationId}`);
    }
  }
  for (const memory of SEED_MEMORIES) {
    if (!NPC_IDS.includes(memory.npcId)) {
      err('broken-npc-reference', `Seed memory ${memory.id} belongs to ${memory.npcId}`);
    }
    // Typed appraisal integrity (remediation 6).
    if (memory.themes.length === 0) {
      err('memory-missing-themes', `Seed memory ${memory.id} has no appraisal themes`);
    }
    for (const theme of memory.themes) {
      if (!MEMORY_THEMES.includes(theme)) {
        err('unknown-memory-theme', `Seed memory ${memory.id} theme ${theme}`);
      }
    }
    if (memory.socialTargetId !== null && !NPC_IDS.includes(memory.socialTargetId)) {
      err('broken-npc-reference', `Seed memory ${memory.id} targets ${memory.socialTargetId}`);
    }
    if (memory.socialTargetId === memory.npcId) {
      err('memory-self-target', `Seed memory ${memory.id} targets its own holder`);
    }
    if (
      !Number.isInteger(memory.valenceMicro) ||
      memory.valenceMicro < -1_000_000 ||
      memory.valenceMicro > 1_000_000
    ) {
      err('invalid-memory-appraisal', `Seed memory ${memory.id} valence ${memory.valenceMicro}`);
    }
    if (
      !Number.isInteger(memory.selfRelevanceMicro) ||
      memory.selfRelevanceMicro < 0 ||
      memory.selfRelevanceMicro > 1_000_000
    ) {
      err(
        'invalid-memory-appraisal',
        `Seed memory ${memory.id} selfRelevance ${memory.selfRelevanceMicro}`,
      );
    }
  }

  // Structural-role consistency (remediation 7): the frozen v1.0 scenario
  // data must agree with the default role assignment the engine wires at
  // tick 0.
  for (const s of SCENARIO_LIST) {
    if (s.injury && s.injury.npcId !== V1_ROLES.mealOwner) {
      err(
        'role-injury-target-mismatch',
        `Scenario ${s.id} injury targets ${s.injury.npcId}, but the meal-owner role is ${V1_ROLES.mealOwner}`,
      );
    }
  }
  {
    const expectedModes: Record<string, string> = {
      [V1_ROLES.benchWorker]: 'work',
      [V1_ROLES.debtor]: 'routine-work',
      [V1_ROLES.mealOwner]: 'deliver-materials',
    };
    for (const npcId of NPC_IDS) {
      if (IDENTITIES[npcId].initial.initialActionMode !== expectedModes[npcId]) {
        err(
          'role-initial-action-mismatch',
          `${npcId} identity card initial action ${IDENTITIES[npcId].initial.initialActionMode} != role-derived ${expectedModes[npcId]}`,
        );
      }
    }
  }

  // Decision weights: every field that mirrors a brief-fixed trait must equal
  // the identity card exactly (section 26 change control), and all weights
  // must be exact integers in range.
  for (const npcId of NPC_IDS) {
    const weights = NPC_WEIGHTS[npcId];
    for (const [field, value] of Object.entries(weights)) {
      if (!Number.isInteger(value) || value < -1_000_000 || value > 1_000_000) {
        err('invalid-decision-weight', `${npcId}.${field} = ${value}`);
      }
    }
    for (const [field, traitKey] of Object.entries(WEIGHT_TRAIT_SOURCES[npcId])) {
      const traitValue = IDENTITIES[npcId].traits[traitKey];
      const weightValue = weights[field as keyof typeof weights];
      if (traitValue === undefined) {
        err('weight-trait-source-missing', `${npcId}.${field} references trait ${traitKey}`);
      } else if (weightValue !== traitValue) {
        err(
          'weight-trait-mismatch',
          `${npcId}.${field} (${weightValue}) != identity trait ${traitKey} (${traitValue})`,
        );
      }
    }
  }

  // Presentation coordinates: every logical location has exactly one.
  for (const loc of LOCATION_IDS) {
    const pos = LOCATION_POSITIONS[loc];
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.z)) {
      err('missing-presentation-coordinate', `Location ${loc}`);
    }
  }
  for (const npcId of NPC_IDS) {
    if (!NPC_VISUALS[npcId]) err('missing-npc-visual', `NPC ${npcId}`);
  }

  // Fixed-value sanity (integer canonical units, ordered thresholds).
  if (!(HUNGER_MODERATE < HUNGER_HIGH && HUNGER_HIGH < HUNGER_CRITICAL)) {
    err('invalid-thresholds', 'Hunger thresholds must be strictly increasing');
  }
  for (const [npcId, rate] of Object.entries(REPAIR_RATE_PER_TICK)) {
    if (!Number.isInteger(rate) || rate <= 0) {
      err('invalid-repair-rate', `${npcId} rate ${rate}`);
    }
  }
  if (REPAIR_INITIAL_UNITS >= REPAIR_TOTAL_UNITS) {
    err('invalid-repair-config', 'Initial progress must be below the total');
  }
  if (!Number.isInteger(HUNGER_RATE_PER_TICK) || !Number.isInteger(FATIGUE_RATE_PER_TICK)) {
    err('non-integer-need-rate', 'Need drift rates must be exact integers per tick');
  }
  if (INJURY_INITIAL_SEVERITY >= INJURY_WORSENED_SEVERITY) {
    err('invalid-injury-config', 'Worsened severity must exceed initial severity');
  }
  for (const [healer, cap] of Object.entries(TREATMENT_BY_HEALER)) {
    if (!cap) continue;
    if (!NPC_IDS.includes(healer as (typeof NPC_IDS)[number])) {
      err('broken-npc-reference', `Treatment capability for unknown NPC ${healer}`);
    }
    if (cap.resultSeverity >= INJURY_INITIAL_SEVERITY) {
      err('invalid-treatment-outcome', `${healer} result ${cap.resultSeverity}`);
    }
  }

  // Serializable, hashable canonical data for every scenario's initial state.
  for (const s of SCENARIO_LIST) {
    try {
      const state = buildInitialState(s);
      if (state.schemaVersion !== SCHEMA_VERSION) {
        err('schema-version-mismatch', `Initial state of ${s.id}`);
      }
      canonicalSerialize(state);
      hashCanonicalState(state);
    } catch (e) {
      err(
        'non-serializable-canonical-data',
        `Scenario ${s.id}: ${(e as Error).message}`,
        `scenarios.${s.id}`,
      );
    }
  }

  return { ok: validationOk(issues), issues };
}
