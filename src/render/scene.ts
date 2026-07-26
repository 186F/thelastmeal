import * as THREE from 'three';
import {
  LOCATION_DISPLAY_NAMES,
  LOCATION_IDS,
  NPC_IDS,
  type LocationId,
  type NpcId,
} from '../shared/ids';
import { CAMERA_FRUSTUM, FLOOR_SIZE, LOCATION_POSITIONS, NPC_VISUALS } from '../shared/viewConfig';
import type { PresentationSnapshot } from '../shared/snapshots';

/**
 * Declarative Three.js workshop view.
 *
 * Strictly read-only presentation: the scene is constructed from shared view
 * configuration plus scenario snapshots, meshes carry only stable entity IDs
 * for picking, and interpolation is purely visual. Nothing rendered here can
 * feed back into canonical state, and removing this module entirely leaves
 * the simulation, replay, and tests fully functional.
 */

export interface SceneApi {
  updateSnapshot(snapshot: PresentationSnapshot): void;
  setSelected(npcId: NpcId | null): void;
  dispose(): void;
}

interface NpcView {
  mesh: THREE.Mesh;
  target: THREE.Vector3;
  injuryRing: THREE.Mesh;
  label: HTMLDivElement;
  /** False until the first snapshot places the mesh (no slide-in from origin). */
  placed: boolean;
}

/** Small deterministic per-NPC display offsets so co-located NPCs stay visible. */
const NPC_DISPLAY_OFFSET: Record<NpcId, { x: number; z: number }> = {
  mara: { x: -0.9, z: 0.5 },
  jonas: { x: 0, z: -0.7 },
  rin: { x: 0.9, z: 0.5 },
};

export function createWorkshopScene(
  container: HTMLElement,
  labelLayer: HTMLElement,
  onPickNpc: (npcId: NpcId) => void,
): SceneApi {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14181f);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.set(14, 16, 14);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(8, 14, 6);
  scene.add(sun);

  // Floor and grid.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE),
    new THREE.MeshLambertMaterial({ color: 0x1e2530 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const grid = new THREE.GridHelper(FLOOR_SIZE, FLOOR_SIZE, 0x2e3a4d, 0x232c3a);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.6;
  scene.add(grid);

  // Location markers + DOM labels.
  const locationLabelEls = new Map<LocationId, HTMLDivElement>();
  const LOCATION_COLORS: Record<LocationId, number> = {
    'purifier-workbench': 0x3f5d8c,
    'food-shelf': 0x8c6f3f,
    'medical-cot': 0x8c3f55,
    'routine-work-station': 0x4d8c3f,
  };
  for (const locationId of LOCATION_IDS) {
    const pos = LOCATION_POSITIONS[locationId];
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 0.4, 2.4),
      new THREE.MeshLambertMaterial({ color: LOCATION_COLORS[locationId] }),
    );
    marker.position.set(pos.x, 0.2, pos.z);
    scene.add(marker);

    const label = document.createElement('div');
    label.className = 'scene-label location-label';
    label.textContent = LOCATION_DISPLAY_NAMES[locationId];
    label.dataset.locationId = locationId;
    labelLayer.appendChild(label);
    locationLabelEls.set(locationId, label);
  }

  // Purifier progress bar above the workbench.
  const benchPos = LOCATION_POSITIONS['purifier-workbench'];
  const progressGroup = new THREE.Group();
  progressGroup.position.set(benchPos.x, 2.2, benchPos.z);
  const progressBack = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 0.18, 0.18),
    new THREE.MeshBasicMaterial({ color: 0x30363f }),
  );
  const progressFill = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 0.2, 0.2),
    new THREE.MeshBasicMaterial({ color: 0x62d68a }),
  );
  progressGroup.add(progressBack);
  progressGroup.add(progressFill);
  scene.add(progressGroup);

  // Meal marker at the food shelf.
  const shelfPos = LOCATION_POSITIONS['food-shelf'];
  const mealMarker = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.32, 0.22, 20),
    new THREE.MeshLambertMaterial({ color: 0xf2c14e }),
  );
  mealMarker.position.set(shelfPos.x, 0.55, shelfPos.z);
  scene.add(mealMarker);

  // NPC meshes with distinct primitives, injury rings, and DOM labels.
  const npcViews = new Map<NpcId, NpcView>();
  for (const npcId of NPC_IDS) {
    const visual = NPC_VISUALS[npcId];
    let geometry: THREE.BufferGeometry;
    if (visual.shape === 'box') geometry = new THREE.BoxGeometry(0.85, 1.1, 0.85);
    else if (visual.shape === 'sphere') geometry = new THREE.SphereGeometry(0.55, 24, 18);
    else geometry = new THREE.ConeGeometry(0.55, 1.2, 24);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: visual.color }));
    mesh.position.set(0, 0.9, 0);
    // Stable entity ID for picking and view lookup — never domain state.
    mesh.userData.npcId = npcId;
    scene.add(mesh);

    const injuryRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.75, 0.07, 10, 32),
      new THREE.MeshBasicMaterial({ color: 0xe5484d }),
    );
    injuryRing.rotation.x = -Math.PI / 2;
    injuryRing.visible = false;
    scene.add(injuryRing);

    const label = document.createElement('div');
    label.className = 'scene-label npc-label';
    label.textContent = npcId;
    label.dataset.npcId = npcId;
    labelLayer.appendChild(label);

    npcViews.set(npcId, {
      mesh,
      target: new THREE.Vector3(0, 0.9, 0),
      injuryRing,
      label,
      placed: false,
    });
  }

  // Selection ring.
  const selectionRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.95, 0.06, 10, 40),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  selectionRing.rotation.x = -Math.PI / 2;
  selectionRing.visible = false;
  scene.add(selectionRing);

  let selectedNpcId: NpcId | null = null;
  let latestSnapshot: PresentationSnapshot | null = null;

  // --- Picking ---------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const onClick = (event: MouseEvent): void => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const meshes = [...npcViews.values()].map((v) => v.mesh);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    if (hit) {
      onPickNpc(hit.object.userData.npcId as NpcId);
    }
  };
  renderer.domElement.addEventListener('click', onClick);

  // --- Sizing ------------------------------------------------------------------
  const resize = (): void => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height);
    const aspect = width / height;
    camera.left = -CAMERA_FRUSTUM * aspect;
    camera.right = CAMERA_FRUSTUM * aspect;
    camera.top = CAMERA_FRUSTUM;
    camera.bottom = -CAMERA_FRUSTUM;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  // --- Visual interpolation & render loop ----------------------------------------
  const worldToLabel = (x: number, y: number, z: number, el: HTMLElement): void => {
    const v = new THREE.Vector3(x, y, z).project(camera);
    const width = container.clientWidth;
    const height = container.clientHeight;
    el.style.transform = `translate(-50%, -100%) translate(${((v.x + 1) / 2) * width}px, ${((1 - v.y) / 2) * height}px)`;
  };

  let rafHandle = 0;
  let disposed = false;
  const renderLoop = (): void => {
    if (disposed) return;
    rafHandle = requestAnimationFrame(renderLoop);

    for (const [npcId, view] of npcViews) {
      // Smooth, display-only easing toward the canonical target position.
      view.mesh.position.lerp(view.target, 0.12);
      view.injuryRing.position.set(view.mesh.position.x, 0.06, view.mesh.position.z);
      worldToLabel(
        view.mesh.position.x,
        view.mesh.position.y + 1.1,
        view.mesh.position.z,
        view.label,
      );
      if (selectedNpcId === npcId) {
        selectionRing.position.set(view.mesh.position.x, 0.03, view.mesh.position.z);
      }
    }
    for (const locationId of LOCATION_IDS) {
      const pos = LOCATION_POSITIONS[locationId];
      const el = locationLabelEls.get(locationId)!;
      worldToLabel(pos.x, 1.1, pos.z, el);
    }
    renderer.render(scene, camera);
  };
  renderLoop();

  // --- Snapshot application ---------------------------------------------------------
  const applySnapshot = (snapshot: PresentationSnapshot): void => {
    latestSnapshot = snapshot;
    for (const npc of snapshot.npcs) {
      const view = npcViews.get(npc.id);
      if (!view) continue;
      const offset = NPC_DISPLAY_OFFSET[npc.id];
      let x: number;
      let z: number;
      if (npc.transit) {
        const from = LOCATION_POSITIONS[npc.transit.fromLocationId];
        const to = LOCATION_POSITIONS[npc.transit.toLocationId];
        const span = Math.max(1, npc.transit.arriveTick - npc.transit.startTick);
        const t = Math.min(1, Math.max(0, (snapshot.tick - npc.transit.startTick) / span));
        x = from.x + (to.x - from.x) * t;
        z = from.z + (to.z - from.z) * t;
      } else {
        const pos = LOCATION_POSITIONS[npc.locationId];
        x = pos.x + offset.x;
        z = pos.z + offset.z;
      }
      const lying = npc.incapacitated;
      view.target.set(x, lying ? 0.45 : 0.9, z);
      if (!view.placed) {
        view.mesh.position.copy(view.target);
        view.placed = true;
      }
      view.mesh.scale.setY(lying ? 0.4 : 1);
      view.injuryRing.visible = npc.injurySeverityMicro > 0;
      const severity = npc.injurySeverityMicro / 1_000_000;
      (view.injuryRing.material as THREE.MeshBasicMaterial).color.setHSL(
        0,
        0.85,
        0.35 + 0.3 * severity,
      );
      view.label.textContent = npc.displayName;
    }

    mealMarker.visible = snapshot.meal.exists;
    const fraction = snapshot.purifier.progressUnits / snapshot.purifier.progressTotalUnits;
    progressFill.scale.setX(Math.max(0.001, fraction));
    progressFill.position.x = -1.2 * (1 - fraction);
    (progressFill.material as THREE.MeshBasicMaterial).color.setHSL(0.33 * fraction, 0.7, 0.55);
  };

  return {
    updateSnapshot: applySnapshot,
    setSelected(npcId: NpcId | null): void {
      selectedNpcId = npcId;
      selectionRing.visible = npcId !== null;
      if (npcId && latestSnapshot) applySnapshot(latestSnapshot);
    },
    dispose(): void {
      disposed = true;
      cancelAnimationFrame(rafHandle);
      window.removeEventListener('resize', resize);
      renderer.domElement.removeEventListener('click', onClick);
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const material = obj.material as THREE.Material | THREE.Material[];
          if (Array.isArray(material)) material.forEach((m) => m.dispose());
          else material.dispose();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      labelLayer.replaceChildren();
    },
  };
}
