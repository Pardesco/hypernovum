import * as THREE from 'three';
import type { ProjectData } from '../types';

export interface RaycastHit {
  project: ProjectData;
  point: THREE.Vector3;
  mesh: THREE.Mesh;
}

/**
 * Pure click-timing state machine: every click on a project selects
 * (idempotent); a second click on the SAME project within the window
 * additionally opens. Extracted for unit testing.
 */
export class ClickInterpreter {
  private lastPath: string | null = null;
  private lastTime = -Infinity;

  constructor(private readonly doubleClickMs = 350) {}

  interpret(path: string, now: number): { select: boolean; open: boolean } {
    const isDouble = this.lastPath === path && now - this.lastTime < this.doubleClickMs;
    this.lastPath = path;
    // After an open, require two fresh clicks for the next open
    this.lastTime = isDouble ? -Infinity : now;
    return { select: true, open: isDouble };
  }

  reset(): void {
    this.lastPath = null;
    this.lastTime = -Infinity;
  }
}

/**
 * Click detection on buildings via Three.js raycasting.
 *
 * Interaction model: single-click = select (persistent focus),
 * double-click = open, empty-space click = deselect, right-click = actions.
 */
export class BuildingRaycaster {
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  private camera: THREE.Camera;
  private scene: THREE.Scene;
  private clicks = new ClickInterpreter();

  private onSelect: ((hit: RaycastHit) => void) | null = null;
  private onOpen: ((hit: RaycastHit) => void) | null = null;
  private onEmptyClick: (() => void) | null = null;
  private onBuildingRightClick: ((hit: RaycastHit, event: MouseEvent) => void) | null = null;
  private onOrbRightClick: ((event: MouseEvent) => void) | null = null;
  /** When true, the incoming click is swallowed (e.g. it ended a drag) */
  private clickGuard: (() => boolean) | null = null;

  constructor(
    camera: THREE.Camera,
    scene: THREE.Scene,
    domElement: HTMLElement,
  ) {
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.camera = camera;
    this.scene = scene;

    domElement.addEventListener('click', (e) => this.handleClick(e, domElement));
    domElement.addEventListener('contextmenu', (e) => this.handleRightClick(e, domElement));
  }

  setSelectHandler(handler: (hit: RaycastHit) => void): void {
    this.onSelect = handler;
  }

  setOpenHandler(handler: (hit: RaycastHit) => void): void {
    this.onOpen = handler;
  }

  setEmptyClickHandler(handler: () => void): void {
    this.onEmptyClick = handler;
  }

  setClickGuard(guard: () => boolean): void {
    this.clickGuard = guard;
  }

  /** @deprecated Use setSelectHandler/setOpenHandler — single-click no longer opens. */
  setClickHandler(handler: (hit: RaycastHit) => void): void {
    this.onSelect = handler;
  }

  setRightClickHandler(handler: (hit: RaycastHit, event: MouseEvent) => void): void {
    this.onBuildingRightClick = handler;
  }

  setOrbRightClickHandler(handler: (event: MouseEvent) => void): void {
    this.onOrbRightClick = handler;
  }

  private castFromEvent(event: MouseEvent, domElement: HTMLElement): THREE.Intersection[] {
    const rect = domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    return this.raycaster.intersectObjects(this.scene.children, false);
  }

  private handleClick(event: MouseEvent, domElement: HTMLElement): void {
    if (this.clickGuard?.()) return;

    const intersects = this.castFromEvent(event, domElement);

    // Nearest project surface wins — buildings and foundation hit pads both
    // carry the project and both count as "clicking the project".
    let nonEmptyHit = false;
    for (const hit of intersects) {
      const ud = hit.object.userData;
      if ((ud?.isBuilding || ud?.isFoundation) && ud?.project) {
        const project = ud.project as ProjectData;
        const raycastHit: RaycastHit = {
          project,
          point: hit.point,
          mesh: hit.object as THREE.Mesh,
        };
        const { open } = this.clicks.interpret(project.path, performance.now());
        this.onSelect?.(raycastHit);
        if (open) this.onOpen?.(raycastHit);
        return;
      }
      // Interactive non-project objects are not "empty space"
      if (ud?.isDragHandle || ud?.isNeuralCore || ud?.isAgentOrb) {
        nonEmptyHit = true;
      }
    }

    if (!nonEmptyHit) {
      this.clicks.reset();
      this.onEmptyClick?.();
    }
  }

  private handleRightClick(event: MouseEvent, domElement: HTMLElement): void {
    const intersects = this.castFromEvent(event, domElement);

    for (const hit of intersects) {
      if (hit.object.userData?.isBuilding && hit.object.userData?.project) {
        event.preventDefault();
        this.onBuildingRightClick?.({
          project: hit.object.userData.project as ProjectData,
          point: hit.point,
          mesh: hit.object as THREE.Mesh,
        }, event);
        return;
      }
      if (hit.object.userData?.isNeuralCore) {
        event.preventDefault();
        this.onOrbRightClick?.(event);
        return;
      }
    }
  }
}
