import type { LocationId, NpcId } from './ids';

/**
 * Centralized presentation configuration. Location IDs — never coordinates —
 * are canonical; these fixed coordinates exist purely so the renderer and
 * validation agree that every logical location has exactly one presentation
 * position. Units are Three.js world units on the workshop floor plane
 * (x: right, z: down-screen in the isometric view; y is up).
 */

export interface FloorPosition {
  x: number;
  z: number;
}

export const LOCATION_POSITIONS: Record<LocationId, FloorPosition> = {
  'purifier-workbench': { x: -6, z: -4 },
  'food-shelf': { x: 6, z: -4 },
  'medical-cot': { x: 6, z: 4 },
  'routine-work-station': { x: -6, z: 4 },
};

/** Per-NPC primitive shape and color (distinct silhouettes for the viewport). */
export const NPC_VISUALS: Record<NpcId, { shape: 'box' | 'sphere' | 'cone'; color: number }> = {
  mara: { shape: 'box', color: 0x4f83cc },
  jonas: { shape: 'sphere', color: 0x5cab7d },
  rin: { shape: 'cone', color: 0xd08a4a },
};

export const FLOOR_SIZE = 20;
export const CAMERA_FRUSTUM = 14;
