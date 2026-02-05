import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { ProjectData, District } from '../types';

export class SceneManager {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private labelRenderer: CSS2DRenderer;
  private controls: MapControls;
  private container: HTMLElement;
  private animationId: number | null = null;
  private resizeObserver: ResizeObserver;

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera();
    this.renderer = new THREE.WebGLRenderer();
    this.labelRenderer = new CSS2DRenderer();

    this.initScene();
    this.initCamera();
    this.initRenderer();
    this.controls = this.initControls();
    this.initLights();
    this.addGround();

    // Handle resize via ResizeObserver (more reliable in Obsidian)
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(container);

    // Start render loop
    this.animate();
  }

  private initScene(): void {
    this.scene.background = new THREE.Color(0x0a0a0a);
    this.scene.fog = new THREE.Fog(0x0a0a0a, 50, 200);
  }

  private initCamera(): void {
    const aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
    this.camera.position.set(0, 50, 60);
    this.camera.lookAt(0, 0, 0);
  }

  private initRenderer(): void {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    // CSS2D Renderer for labels
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.labelRenderer.domElement.style.position = 'absolute';
    this.labelRenderer.domElement.style.top = '0';
    this.labelRenderer.domElement.style.pointerEvents = 'none';
    this.container.appendChild(this.labelRenderer.domElement);
  }

  private initControls(): MapControls {
    const controls = new MapControls(this.camera, this.renderer.domElement);

    // Dashboard-style navigation
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false;

    // Disable rotation (keep top-down perspective)
    controls.enableRotate = false;

    // Zoom limits
    controls.minDistance = 10;
    controls.maxDistance = 200;

    // View angle limits
    controls.minPolarAngle = Math.PI / 3;   // 60deg from vertical
    controls.maxPolarAngle = Math.PI / 2.5;  // 72deg from vertical

    // Mouse button config: left reserved for raycasting
    controls.mouseButtons = {
      LEFT: null as unknown as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };

    return controls;
  }

  private initLights(): void {
    // Ambient
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambient);

    // Directional (sun)
    const directional = new THREE.DirectionalLight(0xffffff, 0.6);
    directional.position.set(50, 100, 50);
    directional.castShadow = true;
    directional.shadow.mapSize.width = 2048;
    directional.shadow.mapSize.height = 2048;
    directional.shadow.camera.far = 200;
    this.scene.add(directional);

    // Hemisphere (sky gradient)
    const hemisphere = new THREE.HemisphereLight(0x4488ff, 0x222222, 0.3);
    this.scene.add(hemisphere);
  }

  private addGround(): void {
    const groundGeometry = new THREE.PlaneGeometry(500, 500);
    const groundMaterial = new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 0.9,
      metalness: 0.1,
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Grid helper
    const grid = new THREE.GridHelper(500, 50, 0x333333, 0x222222);
    this.scene.add(grid);
  }

  buildCity(projects: ProjectData[], districts: Map<string, District>): void {
    // Clear existing buildings
    const toRemove: THREE.Object3D[] = [];
    this.scene.traverse((obj) => {
      if (obj.userData.isBuilding) {
        toRemove.push(obj);
      }
    });
    toRemove.forEach((obj) => this.scene.remove(obj));

    // Create building meshes from laid-out project data
    for (const project of projects) {
      if (!project.position || !project.dimensions) continue;

      const geometry = new THREE.BoxGeometry(
        project.dimensions.width,
        project.dimensions.height,
        project.dimensions.depth,
      );
      const material = new THREE.MeshStandardMaterial({
        color: this.getStatusColor(project.status),
        roughness: 0.7,
        metalness: 0.3,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(
        project.position.x,
        project.dimensions.height / 2, // Sit on ground
        project.position.z,
      );
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { isBuilding: true, project };

      this.scene.add(mesh);
    }
  }

  private getStatusColor(status: string): THREE.Color {
    const colors: Record<string, number> = {
      active: 0x00ff88,
      blocked: 0xff4444,
      paused: 0x4488ff,
      complete: 0xaa88ff,
    };
    return new THREE.Color(colors[status] ?? 0x888888);
  }

  private animate = (): void => {
    this.animationId = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  };

  private onResize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
    this.labelRenderer.setSize(width, height);
  }

  dispose(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
    }
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
  }

  getScene(): THREE.Scene {
    return this.scene;
  }

  getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }
}
