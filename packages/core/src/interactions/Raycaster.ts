import * as THREE from 'three';
import type { ProjectData } from '../types';

export interface RaycastHit {
  project: ProjectData;
  point: THREE.Vector3;
  mesh: THREE.Mesh;
}

/**
 * Handles click detection on buildings via Three.js raycasting.
 */
export class BuildingRaycaster {
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  private camera: THREE.Camera;
  private scene: THREE.Scene;
  private onBuildingClick: ((hit: RaycastHit) => void) | null = null;
  private onBuildingRightClick: ((hit: RaycastHit, event: MouseEvent) => void) | null = null;
  private onOrbRightClick: ((event: MouseEvent) => void) | null = null;

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

  setClickHandler(handler: (hit: RaycastHit) => void): void {
    this.onBuildingClick = handler;
  }

  setRightClickHandler(handler: (hit: RaycastHit, event: MouseEvent) => void): void {
    this.onBuildingRightClick = handler;
  }

  setOrbRightClickHandler(handler: (event: MouseEvent) => void): void {
    this.onOrbRightClick = handler;
  }

  private handleClick(event: MouseEvent, domElement: HTMLElement): void {
    const rect = domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    const intersects = this.raycaster.intersectObjects(
      this.scene.children,
      false,
    );

    for (const hit of intersects) {
      if (hit.object.userData?.isBuilding && hit.object.userData?.project) {
        this.onBuildingClick?.({
          project: hit.object.userData.project as ProjectData,
          point: hit.point,
          mesh: hit.object as THREE.Mesh,
        });
        break;
      }
    }
  }

  private handleRightClick(event: MouseEvent, domElement: HTMLElement): void {
    const rect = domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    const intersects = this.raycaster.intersectObjects(
      this.scene.children,
      false,
    );

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
