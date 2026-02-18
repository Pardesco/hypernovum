import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';

/**
 * Wraps MapControls for dashboard-style top-down navigation.
 * Prevents camera flipping, reserves left-click for raycasting.
 */
export class CityMapController {
  private controls: MapControls;
  private camera: THREE.Camera;

  constructor(camera: THREE.Camera, domElement: HTMLElement) {
    this.camera = camera;
    this.controls = new MapControls(camera, domElement);

    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.enableRotate = false;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 200;
    this.controls.minPolarAngle = Math.PI / 3;
    this.controls.maxPolarAngle = Math.PI / 2.5;

    this.controls.mouseButtons = {
      LEFT: null as unknown as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
  }

  update(): void {
    this.controls.update();
  }

  focusOnBuilding(position: THREE.Vector3): void {
    const target = position.clone().add(new THREE.Vector3(0, 20, 20));
    // TODO: Smooth camera transition (GSAP or manual lerp)
    this.camera.position.copy(target);
    this.controls.target.copy(position);
    this.controls.update();
  }

  dispose(): void {
    this.controls.dispose();
  }
}
