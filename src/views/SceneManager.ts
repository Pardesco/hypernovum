import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { ProjectData, District } from '../types';
import type { BlockPosition, HypervaultSettings } from '../settings/SettingsTab';
import { BuildingShader } from '../renderers/BuildingShader';
import { GeometryFactory } from '../renderers/GeometryFactory';

interface SceneManagerOptions {
  savedPositions?: BlockPosition[];
  onSaveLayout?: (positions: BlockPosition[]) => void;
  settings?: HypervaultSettings;
}

interface LabelInfo {
  project: ProjectData;
  buildingPos: THREE.Vector3;
  labelPos: THREE.Vector3;
  label: CSS2DObject;
  line?: THREE.Line;
}

interface BlockData {
  category: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  color: number;
  objects: THREE.Object3D[];  // All objects belonging to this block
  handle: THREE.Mesh;
  projects: ProjectData[];
}

export class SceneManager {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private labelRenderer: CSS2DRenderer;
  private controls: MapControls;
  private container: HTMLElement;
  private animationId: number | null = null;
  private resizeObserver: ResizeObserver;
  private focusedProject: ProjectData | null = null;
  private hoveredMesh: THREE.Mesh | null = null;
  private tooltip: CSS2DObject | null = null;
  private buildings: THREE.Mesh[] = [];
  private foundations: THREE.Mesh[] = [];
  private labels: LabelInfo[] = [];
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private hoveredFoundation: THREE.Mesh | null = null;
  private stackTooltip: HTMLDivElement | null = null;

  // Block dragging state
  private blocks: Map<string, BlockData> = new Map();
  private dragHandles: THREE.Mesh[] = [];
  private isDragging = false;
  private draggedBlock: BlockData | null = null;
  private dragStartPoint = new THREE.Vector3();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private hoveredHandle: THREE.Mesh | null = null;
  private gridSize = 5; // Grid snap size
  private dragAccumulator = new THREE.Vector2(0, 0); // Accumulate small movements

  // Layout persistence
  private savedPositions: Map<string, { offsetX: number; offsetZ: number }> = new Map();
  private blockOffsets: Map<string, { offsetX: number; offsetZ: number }> = new Map();
  private onSaveLayout?: (positions: BlockPosition[]) => void;

  // Building move mode
  private movingBuilding: THREE.Mesh | null = null;
  private movingBuildingOriginalPos = new THREE.Vector3();
  private buildingDragStart = new THREE.Vector3();
  private lastClickTime = 0;
  private lastClickedBuilding: THREE.Mesh | null = null;

  // Animation timing
  private clock = new THREE.Clock();

  // Shader system
  private useShaders = false;
  private useBloom = false;
  private useAtmosphere = false;
  private bloomIntensity = 0.8;
  private buildingShader: BuildingShader;
  private shaderMaterials: Map<THREE.Mesh, THREE.ShaderMaterial> = new Map();
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;

  constructor(container: HTMLElement, options?: SceneManagerOptions) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera();
    this.renderer = new THREE.WebGLRenderer();
    this.labelRenderer = new CSS2DRenderer();
    this.buildingShader = new BuildingShader();

    // Load saved positions
    if (options?.savedPositions) {
      for (const pos of options.savedPositions) {
        this.savedPositions.set(pos.category, { offsetX: pos.offsetX, offsetZ: pos.offsetZ });
      }
    }
    this.onSaveLayout = options?.onSaveLayout;

    // Load visual effect settings
    if (options?.settings) {
      this.useShaders = options.settings.enableShaders;
      this.useBloom = options.settings.enableBloom;
      this.useAtmosphere = options.settings.enableAtmosphere;
      this.bloomIntensity = options.settings.bloomIntensity;
    }

    this.initScene();
    this.initCamera();
    this.initRenderer();
    this.controls = this.initControls();
    this.initLights();

    // Test shader compilation if shaders are enabled
    if (this.useShaders) {
      BuildingShader.testCompilation(this.renderer);
    }

    // Initialize bloom composer if enabled
    if (this.useBloom) {
      this.initComposer();
    }

    this.container.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.container.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.container.addEventListener('mouseup', (e) => this.onMouseUp(e));
    document.addEventListener('keydown', (e) => this.onKeyDown(e));
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(container);

    this.animate();
  }

  private initScene(): void {
    this.scene.background = new THREE.Color(0x0c0c18);

    // Add atmospheric fog for depth effect
    if (this.useAtmosphere) {
      this.scene.fog = new THREE.FogExp2(0x0c0c18, 0.006);
    }
  }

  private initCamera(): void {
    const aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);
    this.camera.position.set(40, 80, 100);
    this.camera.lookAt(40, 0, 30);
  }

  private initRenderer(): void {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.labelRenderer.domElement.style.position = 'absolute';
    this.labelRenderer.domElement.style.top = '0';
    this.labelRenderer.domElement.style.pointerEvents = 'none';
    this.container.appendChild(this.labelRenderer.domElement);
  }

  private initControls(): MapControls {
    const controls = new MapControls(this.camera, this.renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false;
    controls.enableRotate = false;
    controls.minDistance = 20;
    controls.maxDistance = 300;
    controls.minPolarAngle = Math.PI / 5;
    controls.maxPolarAngle = Math.PI / 2.3;
    controls.mouseButtons = {
      LEFT: null as unknown as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    return controls;
  }

  private initLights(): void {
    const ambient = new THREE.AmbientLight(0x404060, 0.6);
    this.scene.add(ambient);

    const directional = new THREE.DirectionalLight(0xffffff, 0.9);
    directional.position.set(50, 100, 50);
    directional.castShadow = true;
    directional.shadow.mapSize.width = 2048;
    directional.shadow.mapSize.height = 2048;
    directional.shadow.camera.near = 10;
    directional.shadow.camera.far = 300;
    directional.shadow.camera.left = -150;
    directional.shadow.camera.right = 150;
    directional.shadow.camera.top = 150;
    directional.shadow.camera.bottom = -150;
    this.scene.add(directional);

    const fill = new THREE.DirectionalLight(0x6688cc, 0.3);
    fill.position.set(-40, 60, -40);
    this.scene.add(fill);

    const hemisphere = new THREE.HemisphereLight(0x8090a0, 0x101018, 0.5);
    this.scene.add(hemisphere);
  }

  private initComposer(): void {
    try {
      const width = this.container.clientWidth;
      const height = this.container.clientHeight;

      this.composer = new EffectComposer(this.renderer);

      const renderPass = new RenderPass(this.scene, this.camera);
      this.composer.addPass(renderPass);

      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(width, height),
        this.bloomIntensity,  // strength
        0.4,                   // radius
        0.7                    // threshold - only bright things glow
      );
      this.composer.addPass(this.bloomPass);

      const outputPass = new OutputPass();
      this.composer.addPass(outputPass);

      console.log('[Hypervault] Bloom post-processing initialized');
    } catch (e) {
      console.warn('[Hypervault] Failed to initialize bloom:', e);
      this.composer = null;
      this.bloomPass = null;
    }
  }

  buildCity(projects: ProjectData[], districts: Map<string, District>): void {
    this.clearCity();
    this.blockOffsets.clear();
    this.addGround(projects);
    this.addBlockOutlines(districts);

    for (const project of projects) {
      if (!project.position || !project.dimensions) continue;
      this.createBuilding(project);
      // Associate project with its block
      const block = this.blocks.get(project.category);
      if (block) {
        block.projects.push(project);
      }
    }

    this.createSmartLabels(projects);

    // Apply saved positions after initial layout
    this.applySavedPositions();

    this.fitCameraToCity(projects);
  }

  private applySavedPositions(): void {
    for (const [category, offset] of this.savedPositions) {
      // Safety check - don't apply extreme offsets
      const maxOffset = 500;
      if (Math.abs(offset.offsetX) > maxOffset || Math.abs(offset.offsetZ) > maxOffset) {
        console.warn(`Skipping extreme offset for ${category}:`, offset);
        continue;
      }
      if (offset.offsetX !== 0 || offset.offsetZ !== 0) {
        this.moveBlock(category, offset.offsetX, offset.offsetZ);
        this.blockOffsets.set(category, { ...offset });
      }
    }
  }

  triggerSave(): void {
    if (!this.onSaveLayout) return;

    const positions: BlockPosition[] = [];
    for (const [category, block] of this.blocks) {
      const offset = this.blockOffsets.get(category) || { offsetX: 0, offsetZ: 0 };
      positions.push({
        category,
        offsetX: offset.offsetX,
        offsetZ: offset.offsetZ,
      });
    }
    this.onSaveLayout(positions);
  }

  private clearCity(): void {
    const toRemove: THREE.Object3D[] = [];
    this.scene.traverse((obj) => {
      if (obj.userData.isBuilding || obj.userData.isDistrict ||
          obj.userData.isRoad || obj.userData.isLabel || obj.userData.isGround ||
          obj.userData.isFoundation || obj.userData.isDragHandle) {
        toRemove.push(obj);
      }
    });
    toRemove.forEach((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
        obj.geometry?.dispose();
        const mat = obj.material;
        if (Array.isArray(mat)) mat.forEach(m => m.dispose());
        else if (mat) mat.dispose();
      }
      this.scene.remove(obj);
    });
    this.buildings = [];
    this.foundations = [];
    this.labels = [];
    this.blocks.clear();
    this.dragHandles = [];
    this.shaderMaterials.clear();
  }

  private addGround(projects: ProjectData[]): void {
    if (projects.length === 0) return;

    let maxX = 0, maxZ = 0;
    for (const p of projects) {
      if (p.position) {
        maxX = Math.max(maxX, p.position.x + 20);
        maxZ = Math.max(maxZ, p.position.z + 20);
      }
    }

    const size = Math.max(maxX, maxZ, 100);
    const groundGeo = new THREE.PlaneGeometry(size * 2, size * 2);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a14,
      roughness: 0.95,
      metalness: 0.05,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(size / 2, -0.1, size / 2);
    ground.receiveShadow = true;
    ground.userData = { isGround: true };
    this.scene.add(ground);

    // Subtle grid - cyan tint when atmosphere enabled
    const gridColor = this.useAtmosphere ? 0x00ffff : 0x1a1a2e;
    const gridSubColor = this.useAtmosphere ? 0x003333 : 0x14141e;
    const grid = new THREE.GridHelper(size * 2, this.useAtmosphere ? size / 5 : size, gridColor, gridSubColor);
    if (this.useAtmosphere) {
      (grid.material as THREE.Material).transparent = true;
      (grid.material as THREE.Material).opacity = 0.3;
    }
    grid.position.set(size / 2, 0.01, size / 2);
    grid.userData = { isGround: true };
    this.scene.add(grid);
  }

  private addBlockOutlines(districts: Map<string, District>): void {
    // Get category bounds and projects for outline placement
    const categoryBounds = new Map<string, { minX: number; maxX: number; minZ: number; maxZ: number }>();
    const categoryProjects = new Map<string, ProjectData[]>();

    for (const district of districts.values()) {
      const cat = district.category;
      const b = district.bounds;
      if (!categoryBounds.has(cat)) {
        categoryBounds.set(cat, { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
        categoryProjects.set(cat, []);
      }
      const cb = categoryBounds.get(cat)!;
      cb.minX = Math.min(cb.minX, b.x);
      cb.maxX = Math.max(cb.maxX, b.x + b.width);
      cb.minZ = Math.min(cb.minZ, b.z);
      cb.maxZ = Math.max(cb.maxZ, b.z + b.depth);
    }

    // Category-specific colors for outlines
    const categoryColors: Record<string, number> = {
      'web-apps': 0x00cccc,       // Cyan
      'visualization': 0xcc66ff,  // Purple
      'infrastructure': 0xff9933, // Orange
      'trading': 0xff3366,        // Red-pink
      'obsidian-plugins': 0x66ff66, // Green
      'content': 0xffcc00,        // Gold
    };

    const padding = 3; // Padding around buildings

    for (const [category, bounds] of categoryBounds) {
      const color = categoryColors[category] ?? 0x6699cc;
      const blockObjects: THREE.Object3D[] = [];

      // Create planar rectangular outline on the ground
      const outlinePoints = [
        new THREE.Vector3(bounds.minX - padding, 0.05, bounds.minZ - padding),
        new THREE.Vector3(bounds.maxX + padding, 0.05, bounds.minZ - padding),
        new THREE.Vector3(bounds.maxX + padding, 0.05, bounds.maxZ + padding),
        new THREE.Vector3(bounds.minX - padding, 0.05, bounds.maxZ + padding),
        new THREE.Vector3(bounds.minX - padding, 0.05, bounds.minZ - padding), // Close the loop
      ];

      const outlineGeo = new THREE.BufferGeometry().setFromPoints(outlinePoints);
      const outlineMat = new THREE.LineBasicMaterial({
        color,
        linewidth: 2,
        transparent: true,
        opacity: 0.8,
      });
      const outline = new THREE.Line(outlineGeo, outlineMat);
      outline.userData = { isDistrict: true, category };
      this.scene.add(outline);
      blockObjects.push(outline);

      // Add subtle fill inside the outline
      const fillGeo = new THREE.PlaneGeometry(
        bounds.maxX - bounds.minX + padding * 2,
        bounds.maxZ - bounds.minZ + padding * 2
      );
      const fillMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.04,
        side: THREE.DoubleSide,
      });
      const fill = new THREE.Mesh(fillGeo, fillMat);
      fill.rotation.x = -Math.PI / 2;
      fill.position.set(
        (bounds.minX + bounds.maxX) / 2,
        0.03,
        (bounds.minZ + bounds.maxZ) / 2
      );
      fill.userData = { isDistrict: true, category };
      this.scene.add(fill);
      blockObjects.push(fill);

      // Category label positioned to the left of the outline with leader line
      const labelX = bounds.minX - padding - 6;
      const labelZ = (bounds.minZ + bounds.maxZ) / 2;
      const labelY = 1.5;

      const labelDiv = document.createElement('div');
      labelDiv.className = 'hypervault-category-label';
      labelDiv.textContent = category.toUpperCase();
      labelDiv.style.color = `#${color.toString(16).padStart(6, '0')}`;
      const label = new CSS2DObject(labelDiv);
      label.position.set(labelX, labelY, labelZ);
      label.userData = { isLabel: true, category };
      this.scene.add(label);
      blockObjects.push(label);

      // Leader line: horizontal from label, then diagonal down to outline
      const horizontalEnd = labelX + 3;
      const leaderPoints = [
        new THREE.Vector3(labelX + 1.5, labelY - 0.5, labelZ),
        new THREE.Vector3(horizontalEnd, labelY - 0.5, labelZ),
        new THREE.Vector3(bounds.minX - padding, 0.1, labelZ),
      ];
      const leaderGeo = new THREE.BufferGeometry().setFromPoints(leaderPoints);
      const leaderMat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.7,
      });
      const leaderLine = new THREE.Line(leaderGeo, leaderMat);
      leaderLine.userData = { isDistrict: true, category };
      this.scene.add(leaderLine);
      blockObjects.push(leaderLine);

      // Endpoint dot at the outline
      const dotGeo = new THREE.CircleGeometry(0.4, 16);
      const dotMat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.rotation.x = -Math.PI / 2;
      dot.position.set(bounds.minX - padding, 0.08, labelZ);
      dot.userData = { isDistrict: true, category };
      this.scene.add(dot);
      blockObjects.push(dot);

      // Enhanced drag handle at top-right corner of outline
      const handleSize = 1.8;
      const handleHeight = 1.2;
      // Position at the corner of the outline (maxX + padding, minZ - padding)
      const handleX = bounds.maxX + padding;
      const handleZ = bounds.minZ - padding;

      // Main handle cube with beveled appearance
      const handleGeo = new THREE.BoxGeometry(handleSize, handleHeight, handleSize);
      const handleMat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.3,
        transparent: true,
        opacity: 0.85,
        roughness: 0.3,
        metalness: 0.7,
      });
      const handle = new THREE.Mesh(handleGeo, handleMat);
      handle.position.set(handleX, handleHeight / 2 + 0.1, handleZ);
      handle.userData = { isDragHandle: true, category };
      this.scene.add(handle);
      this.dragHandles.push(handle);
      blockObjects.push(handle);

      // Handle edge outline - brighter
      const handleEdges = new THREE.EdgesGeometry(handleGeo);
      const handleLineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 });
      const handleWireframe = new THREE.LineSegments(handleEdges, handleLineMat);
      handleWireframe.position.copy(handle.position);
      handleWireframe.userData = { isDragHandle: true, category };
      this.scene.add(handleWireframe);
      blockObjects.push(handleWireframe);

      // Corner accent - small diagonal lines suggesting "grab here"
      const accentSize = handleSize * 0.4;
      const accentPoints = [
        // Top-right corner accent
        new THREE.Vector3(handleSize / 2 - accentSize, handleHeight / 2 + 0.01, -handleSize / 2),
        new THREE.Vector3(handleSize / 2, handleHeight / 2 + 0.01, -handleSize / 2),
        new THREE.Vector3(handleSize / 2, handleHeight / 2 + 0.01, -handleSize / 2 + accentSize),
      ];
      const accentGeo = new THREE.BufferGeometry().setFromPoints(accentPoints);
      const accentMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 });
      const accent = new THREE.Line(accentGeo, accentMat);
      accent.position.set(handleX, 0, handleZ);
      accent.userData = { isDragHandle: true, category };
      this.scene.add(accent);
      blockObjects.push(accent);

      // Store block data
      this.blocks.set(category, {
        category,
        bounds: { ...bounds },
        color,
        objects: blockObjects,
        handle,
        projects: categoryProjects.get(category) || [],
      });
    }
  }

  private createBuilding(project: ProjectData): void {
    const { width, height, depth } = project.dimensions!;
    const { x, z } = project.position!;
    const baseColor = this.getStatusColor(project.status);

    // Foundation plinth (shows stack on hover)
    const foundationHeight = 0.8;
    const foundationPadding = 0.4;
    const foundationGeo = new THREE.BoxGeometry(
      width + foundationPadding,
      foundationHeight,
      depth + foundationPadding
    );
    // Foundation base color with subtle status tint
    const foundationBaseColor = new THREE.Color(0x2a2a3a);
    const statusTint = baseColor.clone().multiplyScalar(0.15);
    foundationBaseColor.add(statusTint);

    const foundationMat = new THREE.MeshStandardMaterial({
      color: foundationBaseColor,
      roughness: 0.7,
      metalness: 0.4,
    });
    const foundation = new THREE.Mesh(foundationGeo, foundationMat);
    foundation.position.set(x, foundationHeight / 2, z);
    foundation.receiveShadow = true;
    foundation.userData = { isFoundation: true, project };
    this.scene.add(foundation);
    this.foundations.push(foundation);

    // Foundation edge outline - tinted by status color
    const foundationEdges = new THREE.EdgesGeometry(foundationGeo);
    const edgeColorBase = new THREE.Color(0x5a5a7a);
    const edgeTint = baseColor.clone().multiplyScalar(0.3);
    edgeColorBase.add(edgeTint);
    const foundationLineMat = new THREE.LineBasicMaterial({
      color: edgeColorBase,
      transparent: true,
      opacity: 0.65,
    });
    const foundationWireframe = new THREE.LineSegments(foundationEdges, foundationLineMat);
    foundationWireframe.position.copy(foundation.position);
    foundationWireframe.userData = { isFoundation: true, project };
    this.scene.add(foundationWireframe);

    // Building shape varies by category
    const geometry = this.createBuildingGeometry(project.category, width, height, depth);

    // Try shader material if enabled, fallback to standard material
    let material: THREE.Material;
    let isShaderMaterial = false;

    if (this.useShaders && BuildingShader.isAvailable()) {
      const shaderMat = this.buildingShader.createMaterial(project);
      if (shaderMat) {
        material = shaderMat;
        isShaderMaterial = true;
      } else {
        material = this.createFallbackMaterial(project, baseColor);
      }
    } else {
      material = this.createFallbackMaterial(project, baseColor);
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, foundationHeight + height / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { isBuilding: true, project };

    // Store shader materials for animation updates
    if (isShaderMaterial) {
      this.shaderMaterials.set(mesh, material as THREE.ShaderMaterial);
    }

    this.scene.add(mesh);
    this.buildings.push(mesh);

    // Edge glow - brighter for bloom pickup when enabled
    const edges = new THREE.EdgesGeometry(geometry);
    const bloomMultiplier = this.useBloom ? 1.5 : 1.0;
    const edgeOpacity = project.status === 'blocked' ? 0.8 * bloomMultiplier :
                        project.status === 'active' ? 0.5 * bloomMultiplier : 0.3;
    const edgeColor = baseColor.clone().multiplyScalar(
      project.status === 'blocked' ? 3.0 : (this.useBloom ? 2.5 : 1.8)
    );
    const lineMat = new THREE.LineBasicMaterial({
      color: edgeColor,
      transparent: true,
      opacity: Math.min(edgeOpacity, 1.0),
    });
    const wireframe = new THREE.LineSegments(edges, lineMat);
    wireframe.position.copy(mesh.position);
    wireframe.userData = { isBuilding: true, project, isEdgeGlow: true };
    this.scene.add(wireframe);
  }

  private createBuildingGeometry(category: string, width: number, height: number, depth: number): THREE.BufferGeometry {
    // Procedural Sci-Fi Architecture - parametric silhouettes
    switch (category) {
      case 'web-apps':
        // "The Helix Tower" - twisting tower representing the stack
        return GeometryFactory.createHelixTower(width, height, depth);
      case 'visualization':
        // "The Data Shard" - dual-crystal, abstract mathematical
        return GeometryFactory.createDataShard(width * 0.7, height);
      case 'infrastructure':
        // "The Brutalist Ziggurat" - heavy stepped pyramid
        return GeometryFactory.createZiggurat(width, height, depth);
      case 'trading':
        // "The Quant Blade" - sharp triangular prism, aggressive
        return GeometryFactory.createQuantBlade(width, height);
      case 'obsidian-plugins':
        // "The Modular Hive" - hexagonal column
        return GeometryFactory.createHive(width / 2, height);
      case 'content':
        // "The Memory Core" - ribbed cylinder
        return GeometryFactory.createMemoryCore(width / 2, height);
      default:
        return GeometryFactory.createDefault(width, height, depth);
    }
  }

  private createFallbackMaterial(project: ProjectData, baseColor: THREE.Color): THREE.MeshStandardMaterial {
    const emissiveIntensity = project.status === 'blocked' ? 0.3 :
                              project.status === 'active' ? 0.2 : 0.1;

    return new THREE.MeshStandardMaterial({
      color: baseColor,
      roughness: 0.2,
      metalness: 0.8,
      emissive: baseColor,
      emissiveIntensity,
      flatShading: true,  // Critical for "Low Poly Sci-Fi" look
    });
  }

  private createSmartLabels(projects: ProjectData[]): void {
    // Labels positioned directly above buildings (same X, Z as building)
    const labelHeight = 2.5;

    for (const project of projects) {
      if (!project.position || !project.dimensions) continue;

      const buildingTop = new THREE.Vector3(
        project.position.x,
        project.dimensions.height + 0.8, // Account for foundation
        project.position.z
      );

      // Label directly above building (same X, Z)
      const labelPos = new THREE.Vector3(
        project.position.x,
        buildingTop.y + labelHeight,
        project.position.z
      );

      // Create label
      const labelDiv = document.createElement('div');
      labelDiv.className = 'hypervault-building-label';
      labelDiv.textContent = project.title;
      const label = new CSS2DObject(labelDiv);
      label.position.copy(labelPos);
      label.userData = { isLabel: true };
      this.scene.add(label);

      this.labels.push({ project, buildingPos: buildingTop, labelPos, label });
    }
  }

  private getStatusColor(status: string): THREE.Color {
    const colors: Record<string, number> = {
      active: 0x00cc66,
      blocked: 0xdd3333,
      paused: 0x3366dd,
      complete: 0x9966cc,
    };
    return new THREE.Color(colors[status] ?? 0x666666);
  }

  private fitCameraToCity(projects: ProjectData[]): void {
    if (projects.length === 0) return;

    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for (const p of projects) {
      if (!p.position) continue;
      minX = Math.min(minX, p.position.x);
      maxX = Math.max(maxX, p.position.x);
      minZ = Math.min(minZ, p.position.z);
      maxZ = Math.max(maxZ, p.position.z);
    }

    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const sizeX = maxX - minX + 30;
    const sizeZ = maxZ - minZ + 30;
    const maxSize = Math.max(sizeX, sizeZ, 50);

    const distance = maxSize * 1.1;
    this.camera.position.set(centerX, distance * 0.6, centerZ + distance * 0.7);
    this.controls.target.set(centerX, 0, centerZ);
    this.controls.update();
  }

  private onMouseMove(event: MouseEvent): void {
    const rect = this.container.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Handle building move mode dragging
    if (this.isDragging && this.movingBuilding) {
      const intersectPoint = new THREE.Vector3();
      this.raycaster.ray.intersectPlane(this.groundPlane, intersectPoint);

      // Accumulate raw movement
      this.dragAccumulator.x += intersectPoint.x - this.buildingDragStart.x;
      this.dragAccumulator.y += intersectPoint.z - this.buildingDragStart.z;

      // Snap to grid
      const snappedX = Math.round(this.dragAccumulator.x / this.gridSize) * this.gridSize;
      const snappedZ = Math.round(this.dragAccumulator.y / this.gridSize) * this.gridSize;

      if (snappedX !== 0 || snappedZ !== 0) {
        this.moveSingleBuilding(this.movingBuilding, snappedX, snappedZ);
        this.dragAccumulator.x -= snappedX;
        this.dragAccumulator.y -= snappedZ;
      }

      this.buildingDragStart.copy(intersectPoint);
      return;
    }

    // Handle active block dragging with grid snapping
    if (this.isDragging && this.draggedBlock) {
      const intersectPoint = new THREE.Vector3();
      this.raycaster.ray.intersectPlane(this.groundPlane, intersectPoint);

      // Accumulate raw movement
      this.dragAccumulator.x += intersectPoint.x - this.dragStartPoint.x;
      this.dragAccumulator.y += intersectPoint.z - this.dragStartPoint.z;

      // Snap to grid - only move when accumulated enough
      const snappedX = Math.round(this.dragAccumulator.x / this.gridSize) * this.gridSize;
      const snappedZ = Math.round(this.dragAccumulator.y / this.gridSize) * this.gridSize;

      if (snappedX !== 0 || snappedZ !== 0) {
        this.moveBlock(this.draggedBlock.category, snappedX, snappedZ);
        // Track cumulative offset for saving
        const currentOffset = this.blockOffsets.get(this.draggedBlock.category) || { offsetX: 0, offsetZ: 0 };
        this.blockOffsets.set(this.draggedBlock.category, {
          offsetX: currentOffset.offsetX + snappedX,
          offsetZ: currentOffset.offsetZ + snappedZ,
        });
        // Subtract the snapped amount from accumulator
        this.dragAccumulator.x -= snappedX;
        this.dragAccumulator.y -= snappedZ;
      }

      this.dragStartPoint.copy(intersectPoint);
      return;
    }

    // Check drag handles first
    const handleHits = this.raycaster.intersectObjects(this.dragHandles, false);

    // Reset previous handle hover
    if (this.hoveredHandle) {
      const mat = this.hoveredHandle.material as THREE.MeshStandardMaterial;
      if (mat.emissiveIntensity !== undefined) {
        mat.emissiveIntensity = 0.3;
      }
      this.hoveredHandle = null;
      this.container.style.cursor = 'default';
    }

    // Handle hover on drag handle
    if (handleHits.length > 0) {
      const hit = handleHits[0].object as THREE.Mesh;
      if (hit.userData.isDragHandle) {
        this.hoveredHandle = hit;
        const mat = hit.material as THREE.MeshStandardMaterial;
        if (mat.emissiveIntensity !== undefined) {
          mat.emissiveIntensity = 0.8;
        }
        this.container.style.cursor = 'grab';
        return; // Don't show other tooltips when hovering handle
      }
    }

    // Check buildings
    const buildingHits = this.raycaster.intersectObjects(this.buildings, false);
    // Then foundations
    const foundationHits = this.raycaster.intersectObjects(this.foundations, false);

    // Reset previous building hover
    if (this.hoveredMesh) {
      const mat = this.hoveredMesh.material as THREE.MeshStandardMaterial;
      const status = this.hoveredMesh.userData.project?.status;
      mat.emissiveIntensity = status === 'blocked' ? 0.3 : status === 'active' ? 0.15 : 0.05;
      this.hoveredMesh = null;
    }

    // Reset previous foundation hover
    if (this.hoveredFoundation) {
      const mat = this.hoveredFoundation.material as THREE.MeshStandardMaterial;
      mat.color.setHex(0x2a2a3a);
      mat.emissive.setHex(0x000000);
      this.hoveredFoundation = null;
    }

    // Clear tooltips
    if (this.tooltip) {
      this.scene.remove(this.tooltip);
      this.tooltip = null;
    }
    if (this.stackTooltip) {
      this.stackTooltip.remove();
      this.stackTooltip = null;
    }

    // Handle building hover (takes priority)
    if (buildingHits.length > 0) {
      const hit = buildingHits[0].object as THREE.Mesh;
      if (hit.userData.isBuilding && hit.userData.project) {
        this.hoveredMesh = hit;
        const mat = hit.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = 0.6;

        const project = hit.userData.project as ProjectData;
        this.showTooltip(project, hit.position, project.dimensions!.height + 0.8);
      }
    }
    // Handle foundation hover (shows stack)
    else if (foundationHits.length > 0) {
      const hit = foundationHits[0].object as THREE.Mesh;
      if (hit.userData.isFoundation && hit.userData.project) {
        this.hoveredFoundation = hit;
        const mat = hit.material as THREE.MeshStandardMaterial;
        mat.color.setHex(0x3a3a5a);
        mat.emissive.setHex(0x1a1a2a);
        mat.emissiveIntensity = 0.5;

        const project = hit.userData.project as ProjectData;
        if (project.stack && project.stack.length > 0) {
          this.showStackTooltip(project, event);
        }
      }
    }
  }

  private onMouseDown(event: MouseEvent): void {
    if (event.button !== 0) return; // Only left click

    const rect = this.container.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Check if clicking elsewhere to exit building move mode
    if (this.movingBuilding) {
      const buildingHits = this.raycaster.intersectObjects([this.movingBuilding], false);
      if (buildingHits.length === 0) {
        // Clicked elsewhere - exit move mode
        this.exitBuildingMoveMode();
        return;
      }
      // Start dragging the building
      const intersectPoint = new THREE.Vector3();
      this.raycaster.ray.intersectPlane(this.groundPlane, intersectPoint);
      this.buildingDragStart.copy(intersectPoint);
      this.isDragging = true;
      this.controls.enabled = false;
      this.container.style.cursor = 'grabbing';
      this.dragAccumulator.set(0, 0);
      return;
    }

    // Check for double-click on buildings
    const buildingHits = this.raycaster.intersectObjects(this.buildings, false);
    if (buildingHits.length > 0) {
      const hit = buildingHits[0].object as THREE.Mesh;
      const now = Date.now();

      if (this.lastClickedBuilding === hit && now - this.lastClickTime < 400) {
        // Double-click detected - enter move mode
        this.enterBuildingMoveMode(hit);
        this.lastClickTime = 0;
        this.lastClickedBuilding = null;
        return;
      }

      this.lastClickTime = now;
      this.lastClickedBuilding = hit;
    }

    // Check for drag handle clicks
    const handleHits = this.raycaster.intersectObjects(this.dragHandles, false);

    if (handleHits.length > 0) {
      const hit = handleHits[0].object as THREE.Mesh;
      const category = hit.userData.category as string;
      const block = this.blocks.get(category);

      if (block) {
        this.isDragging = true;
        this.draggedBlock = block;
        this.controls.enabled = false; // Disable camera controls while dragging
        this.container.style.cursor = 'grabbing';
        this.dragAccumulator.set(0, 0); // Reset accumulator

        // Get initial intersection point on ground plane
        const intersectPoint = new THREE.Vector3();
        this.raycaster.ray.intersectPlane(this.groundPlane, intersectPoint);
        this.dragStartPoint.copy(intersectPoint);
      }
    }
  }

  private enterBuildingMoveMode(building: THREE.Mesh): void {
    this.movingBuilding = building;
    this.movingBuildingOriginalPos.copy(building.position);

    // Visual feedback - make building glow
    const mat = building.material as THREE.MeshStandardMaterial;
    mat.emissiveIntensity = 1.0;

    this.container.style.cursor = 'move';

    // Show move mode indicator
    this.showMoveModeIndicator(building);
  }

  private exitBuildingMoveMode(): void {
    if (!this.movingBuilding) return;

    // Reset visual
    const mat = this.movingBuilding.material as THREE.MeshStandardMaterial;
    const status = this.movingBuilding.userData.project?.status;
    mat.emissiveIntensity = status === 'blocked' ? 0.3 : status === 'active' ? 0.15 : 0.05;

    this.movingBuilding = null;
    this.container.style.cursor = 'default';

    // Remove move mode indicator
    this.hideMoveModeIndicator();
  }

  private showMoveModeIndicator(building: THREE.Mesh): void {
    // Remove existing indicator
    this.hideMoveModeIndicator();

    const div = document.createElement('div');
    div.className = 'hypervault-move-indicator';
    div.textContent = 'MOVE MODE - Click elsewhere to exit';
    div.id = 'hypervault-move-indicator';
    this.container.appendChild(div);
  }

  private hideMoveModeIndicator(): void {
    const existing = document.getElementById('hypervault-move-indicator');
    if (existing) existing.remove();
  }

  private onKeyDown(event: KeyboardEvent): void {
    // Escape exits building move mode
    if (event.key === 'Escape' && this.movingBuilding) {
      this.exitBuildingMoveMode();
    }
  }

  private onMouseUp(_event: MouseEvent): void {
    if (this.isDragging) {
      this.isDragging = false;
      this.draggedBlock = null;
      this.controls.enabled = true; // Re-enable camera controls

      // Keep move cursor if still in building move mode
      if (this.movingBuilding) {
        this.container.style.cursor = 'move';
      } else {
        this.container.style.cursor = this.hoveredHandle ? 'grab' : 'default';
      }
    }
  }

  private moveSingleBuilding(building: THREE.Mesh, deltaX: number, deltaZ: number): void {
    const project = building.userData.project as ProjectData;
    if (!project) return;

    // Move the building mesh
    building.position.x += deltaX;
    building.position.z += deltaZ;

    // Update project position data
    if (project.position) {
      project.position.x += deltaX;
      project.position.z += deltaZ;
    }

    // Move associated foundation
    for (const foundation of this.foundations) {
      if (foundation.userData.project === project) {
        foundation.position.x += deltaX;
        foundation.position.z += deltaZ;
      }
    }

    // Move wireframes (foundation and building edges)
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.LineSegments && obj.userData.project === project) {
        obj.position.x += deltaX;
        obj.position.z += deltaZ;
      }
    });

    // Move building label
    for (const labelInfo of this.labels) {
      if (labelInfo.project === project) {
        labelInfo.label.position.x += deltaX;
        labelInfo.label.position.z += deltaZ;
        labelInfo.buildingPos.x += deltaX;
        labelInfo.buildingPos.z += deltaZ;
        labelInfo.labelPos.x += deltaX;
        labelInfo.labelPos.z += deltaZ;
      }
    }
  }

  private moveBlock(category: string, deltaX: number, deltaZ: number): void {
    // Move all buildings and foundations in this category
    for (const building of this.buildings) {
      if (building.userData.project?.category === category) {
        building.position.x += deltaX;
        building.position.z += deltaZ;
        // Update project position data
        if (building.userData.project.position) {
          building.userData.project.position.x += deltaX;
          building.userData.project.position.z += deltaZ;
        }
      }
    }

    for (const foundation of this.foundations) {
      if (foundation.userData.project?.category === category) {
        foundation.position.x += deltaX;
        foundation.position.z += deltaZ;
      }
    }

    // Move foundation wireframes and building wireframes
    this.scene.traverse((obj) => {
      if ((obj.userData.isFoundation || obj.userData.isBuilding) &&
          obj instanceof THREE.LineSegments &&
          obj.userData.project?.category === category) {
        obj.position.x += deltaX;
        obj.position.z += deltaZ;
      }
    });

    // Move building labels
    for (const labelInfo of this.labels) {
      if (labelInfo.project.category === category) {
        labelInfo.label.position.x += deltaX;
        labelInfo.label.position.z += deltaZ;
        labelInfo.buildingPos.x += deltaX;
        labelInfo.buildingPos.z += deltaZ;
        labelInfo.labelPos.x += deltaX;
        labelInfo.labelPos.z += deltaZ;
      }
    }

    // Move block objects (outline, fill, category label, leader line, dot, handle)
    const block = this.blocks.get(category);
    if (block) {
      for (const obj of block.objects) {
        if (obj instanceof THREE.Line) {
          // For lines, we need to update the geometry vertices
          const positions = (obj.geometry as THREE.BufferGeometry).attributes.position;
          for (let i = 0; i < positions.count; i++) {
            positions.setX(i, positions.getX(i) + deltaX);
            positions.setZ(i, positions.getZ(i) + deltaZ);
          }
          positions.needsUpdate = true;
        } else {
          obj.position.x += deltaX;
          obj.position.z += deltaZ;
        }
      }

      // Update bounds
      block.bounds.minX += deltaX;
      block.bounds.maxX += deltaX;
      block.bounds.minZ += deltaZ;
      block.bounds.maxZ += deltaZ;
    }
  }

  private showTooltip(project: ProjectData, position: THREE.Vector3, height: number): void {
    const div = document.createElement('div');
    div.className = 'hypervault-tooltip';
    div.innerHTML = `
      <strong>${this.escapeHtml(project.title)}</strong>
      <div class="tooltip-row"><span>Status:</span> <span class="status-${project.status}">${project.status}</span></div>
      <div class="tooltip-row"><span>Priority:</span> ${project.priority}</div>
      <div class="tooltip-row"><span>Category:</span> ${project.category}</div>
      <div class="tooltip-row"><span>Health:</span> ${project.health}%</div>
      <div class="tooltip-row"><span>Files:</span> ${project.noteCount}</div>
    `;

    this.tooltip = new CSS2DObject(div);
    this.tooltip.position.set(position.x, height + 3, position.z);
    this.scene.add(this.tooltip);
  }

  private showStackTooltip(project: ProjectData, event: MouseEvent): void {
    if (!project.stack || project.stack.length === 0) return;

    const div = document.createElement('div');
    div.className = 'hypervault-stack-tooltip';
    div.innerHTML = `
      <div class="stack-header">TECH STACK</div>
      <div class="stack-list">
        ${project.stack.map(tech => `<span class="stack-item">${this.escapeHtml(tech)}</span>`).join('')}
      </div>
    `;

    // Position at cursor (top-left corner aligned with cursor)
    div.style.position = 'absolute';
    div.style.left = `${event.clientX}px`;
    div.style.top = `${event.clientY}px`;
    div.style.zIndex = '1000';
    div.style.pointerEvents = 'none';

    document.body.appendChild(div);
    this.stackTooltip = div;
  }

  private escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  private animate = (): void => {
    this.animationId = requestAnimationFrame(this.animate);

    const elapsed = this.clock.getElapsedTime();

    // Update shader material uniforms
    for (const [mesh, material] of this.shaderMaterials) {
      material.uniforms.uTime.value = elapsed;

      const project = mesh.userData.project as ProjectData;
      if (project) {
        // Dynamic glitch for blocked projects
        if (project.status === 'blocked') {
          material.uniforms.uGlitch.value = 0.5 + Math.sin(elapsed * 2) * 0.3;
        }
        // Dynamic activity glow
        if (project.status === 'active') {
          material.uniforms.uActivity.value = 0.6 + Math.sin(elapsed * 1.5) * 0.3;
        }
      }
    }

    // Animate standard material emissives for non-shader buildings
    for (const building of this.buildings) {
      // Skip shader materials (handled above)
      if (this.shaderMaterials.has(building)) continue;

      const mat = building.material as THREE.MeshStandardMaterial;
      const project = building.userData.project as ProjectData;

      // Skip if in move mode (keep bright)
      if (building === this.movingBuilding) continue;
      // Skip if hovered (keep bright)
      if (building === this.hoveredMesh) continue;

      if (project) {
        switch (project.status) {
          case 'blocked':
            // Pulsing warning glow (faster, more urgent)
            mat.emissiveIntensity = 0.25 + Math.sin(elapsed * 4) * 0.15;
            break;
          case 'active':
            // Gentle breathing (slower, calming)
            mat.emissiveIntensity = 0.12 + Math.sin(elapsed * 1.5) * 0.08;
            break;
          case 'complete':
            // Subtle shimmer
            mat.emissiveIntensity = 0.05 + Math.sin(elapsed * 2) * 0.03;
            break;
          case 'paused':
            // Very subtle pulse
            mat.emissiveIntensity = 0.08 + Math.sin(elapsed * 0.8) * 0.04;
            break;
        }
      }
    }

    // Animate drag handles - gentle idle pulse
    for (const handle of this.dragHandles) {
      if (handle === this.hoveredHandle) continue; // Keep hover bright
      const mat = handle.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.25 + Math.sin(elapsed * 2 + handle.position.x * 0.5) * 0.15;
    }

    // Animate edge glow for blocked buildings
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.LineSegments && obj.userData.isEdgeGlow) {
        const project = obj.userData.project as ProjectData;
        if (project?.status === 'blocked') {
          const mat = obj.material as THREE.LineBasicMaterial;
          mat.opacity = 0.4 + Math.sin(elapsed * 4) * 0.25;
        }
      }
    });

    this.controls.update();

    // Render with composer (bloom) or direct renderer
    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    // Labels always render last (on top, not affected by bloom)
    this.labelRenderer.render(this.scene, this.camera);
  };

  private onResize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.labelRenderer.setSize(width, height);

    // Resize composer if bloom is enabled
    if (this.composer) {
      this.composer.setSize(width, height);
    }
    if (this.bloomPass) {
      this.bloomPass.resolution.set(width, height);
    }
  }

  dispose(): void {
    if (this.animationId !== null) cancelAnimationFrame(this.animationId);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    if (this.composer) {
      this.composer.dispose();
    }
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
  }

  getScene(): THREE.Scene { return this.scene; }
  getCamera(): THREE.PerspectiveCamera { return this.camera; }
  getCanvas(): HTMLCanvasElement { return this.renderer.domElement; }

  resetCamera(): void {
    this.fitCameraToCity(this.buildings.map(b => b.userData.project).filter(Boolean));
    this.focusedProject = null;
  }

  focusOnPosition(position: { x: number; y: number; z: number }): void {
    const target = new THREE.Vector3(position.x, 0, position.z);
    const cameraPos = target.clone().add(new THREE.Vector3(0, 35, 30));
    this.camera.position.copy(cameraPos);
    this.controls.target.copy(target);
    this.controls.update();
  }

  getFocusedProject(): ProjectData | null { return this.focusedProject; }
  setFocusedProject(project: ProjectData | null): void { this.focusedProject = project; }
}
