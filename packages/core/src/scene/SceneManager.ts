import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { ProjectData, District, BlockPosition, HypernovumSettings, WeatherData, LinkEdge } from '../types';
import { statusColor } from '../types';
import { HighlightManager, type BuildingParts } from './HighlightManager';
import { BuildingShader } from '../renderers/BuildingShader';
import { GeometryFactory } from '../renderers/GeometryFactory';
import { BuildingFactory } from '../renderers/BuildingFactory';
import { RooftopFactory } from '../renderers/RooftopFactory';
import { NeuralCore } from '../visuals/NeuralCore';
import { ArteryManager } from '../visuals/ArteryManager';
import { debugLog } from '../utils/log';
import { escapeHtml } from '../utils/html';
import type { InteractionStore } from '../stores/interactionStore';

interface SceneManagerOptions {
  savedPositions?: BlockPosition[];
  onSaveLayout?: (positions: BlockPosition[]) => void;
  settings?: HypernovumSettings;
  /** Shared interaction state (selection/hover/move mode). Optional for API compat. */
  interactionStore?: InteractionStore;
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
  hitBox: THREE.Mesh;
  outline: THREE.Line;
  fill: THREE.Mesh;
  label: CSS2DObject;
  leaderLine: THREE.Line;
  dot: THREE.Mesh;
  handleBracket: THREE.Line;
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
  private store: InteractionStore | null = null;
  private highlight!: HighlightManager;
  private parts: Map<string, BuildingParts> = new Map();
  private tooltip: CSS2DObject | null = null;
  private tooltipLeader: THREE.Group | null = null;
  private buildings: THREE.Mesh[] = [];
  private foundations: THREE.Mesh[] = [];
  private blockedEdgeGlows: THREE.LineSegments[] = []; // pulsed in animate — no per-frame traverse
  private roofBeacons: THREE.Mesh[] = []; // critical-priority warning lights, pulsed in animate
  private questMarkers: THREE.Mesh[] = []; // floating gems over projects with open questions
  private linkArcs: THREE.Mesh[] = []; // backlink knowledge arcs between buildings
  private questBursts: { mesh: THREE.Mesh; start: number }[] = []; // quest-resolved shockwaves
  private agentOrbs = new Map<string, { orb: THREE.Mesh; path: string; baseY: number; phase: number }>(); // fleet presence
  private labels: LabelInfo[] = [];
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();

  // Block dragging state
  private blocks: Map<string, BlockData> = new Map();
  private dragHandles: THREE.Mesh[] = [];
  private handleHitBoxes: THREE.Mesh[] = [];   // Larger invisible hitboxes for drag handles
  private foundationHitPads: THREE.Mesh[] = []; // Larger invisible hitboxes for foundation hover
  private isDragging = false;
  private draggedBlock: BlockData | null = null;
  private dragStartPoint = new THREE.Vector3();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private hoveredHandle: THREE.Mesh | null = null;
  private gridSize = 5; // Grid snap size
  private dragAccumulator = new THREE.Vector2(0, 0); // Accumulate small movements
  private cityBounds = { centerX: 0, centerZ: 0, radius: 50 }; // Pan boundary

  // Layout persistence
  private savedPositions: Map<string, { offsetX: number; offsetZ: number }> = new Map();
  private blockOffsets: Map<string, { offsetX: number; offsetZ: number }> = new Map();
  private onSaveLayout?: (positions: BlockPosition[]) => void;

  // Building move mode (entered via context menu — see enterBuildingMoveModeByPath)
  private movingBuilding: THREE.Mesh | null = null;
  private movingBuildingOriginalPos = new THREE.Vector3();
  private buildingDragStart = new THREE.Vector3();
  // Click events that end a drag must not select/deselect
  private dragEndAt = 0;

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

  // Neural Core and Data Arteries
  private neuralCore: NeuralCore | null = null;
  private arteryManager: ArteryManager | null = null;
  private buildingPathMap: Map<string, THREE.Mesh> = new Map();
  // uPulse gently decays each frame so streaming glow releases when streams stop
  private static readonly PULSE_DECAY = 0.97;

  // Neural Core hit sphere for raycasting
  private coreHitSphere: THREE.Mesh | null = null;

  // Launch effect tracking
  private launchEffects: Map<THREE.Mesh, { startTime: number; duration: number }> = new Map();

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
    this.store = options?.interactionStore ?? null;
    this.highlight = new HighlightManager(this.parts, this.store, {
      bloom: options?.settings?.enableBloom ?? false,
    });

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

    // Initialize Neural Core and Artery Manager
    this.neuralCore = new NeuralCore({ position: new THREE.Vector3(0, 25, 0) });
    this.scene.add(this.neuralCore);
    this.arteryManager = new ArteryManager({ scene: this.scene });

    // Invisible hit sphere for Neural Core raycasting (direct scene child)
    const hitGeo = new THREE.SphereGeometry(5, 8, 8);
    const hitMat = new THREE.MeshBasicMaterial({ opacity: 0, transparent: true });
    this.coreHitSphere = new THREE.Mesh(hitGeo, hitMat);
    this.coreHitSphere.position.copy(this.neuralCore.position);
    this.coreHitSphere.userData = { isNeuralCore: true };
    this.scene.add(this.coreHitSphere);

    this.container.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.container.addEventListener('mousedown', (e) => this.onMouseDown(e));
    this.container.addEventListener('mouseup', (e) => this.onMouseUp(e));
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

      debugLog('Bloom post-processing initialized');
    } catch (e) {
      console.warn('[Hypernovum] Failed to initialize bloom:', e);
      this.composer = null;
      this.bloomPass = null;
    }
  }

  buildCity(projects: ProjectData[], districts: Map<string, District>): void {
    // Capture streaming state before clearing (clearCity destroys buildingPathMap)
    const wasStreaming = this.arteryManager?.getIsStreaming() ?? false;
    const streamingPath = this.arteryManager?.getStreamingPath() ?? null;

    this.clearCity();
    this.blockOffsets.clear();

    // Center the layout on origin (0, 0)
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of projects) {
      if (!p.position) continue;
      minX = Math.min(minX, p.position.x);
      maxX = Math.max(maxX, p.position.x);
      minZ = Math.min(minZ, p.position.z);
      maxZ = Math.max(maxZ, p.position.z);
    }
    if (minX !== Infinity) {
      const offsetX = (minX + maxX) / 2;
      const offsetZ = (minZ + maxZ) / 2;
      for (const p of projects) {
        if (p.position) {
          p.position.x -= offsetX;
          p.position.z -= offsetZ;
        }
      }
      for (const district of districts.values()) {
        district.bounds.x -= offsetX;
        district.bounds.z -= offsetZ;
      }
    }

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

    this.centerSingleBuildings();
    this.createSmartLabels(projects);

    // Fresh build starts from status colors — the view re-applies lens
    // colors/weather after every rebuild when a data layer is active.
    this.highlight.setLensColors(null);
    this.highlight.refreshAll();

    // Apply saved positions after initial layout
    this.applySavedPositions();

    // Position Neural Core at city center
    this.positionNeuralCore(projects);

    this.fitCameraToCity(projects);

    // Re-establish streaming if it was active before rebuild
    if (wasStreaming && streamingPath) {
      this.arteryManager?.stopStream();
      this.startStreaming(streamingPath);
    }
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
    this.blockedEdgeGlows = [];
    this.roofBeacons = [];
    this.questMarkers = [];
    this.clearLinkArcs();
    this.questBursts = [];
    this.agentOrbs.clear(); // orbs are building children — disposed with the city above
    this.labels = [];
    this.blocks.clear();
    this.dragHandles = [];
    this.handleHitBoxes = [];
    this.foundationHitPads = [];
    this.shaderMaterials.clear();
    this.buildingPathMap.clear();
    this.parts.clear();
  }

  private addGround(projects: ProjectData[]): void {
    if (projects.length === 0) return;

    let maxExtent = 0;
    for (const p of projects) {
      if (p.position) {
        maxExtent = Math.max(maxExtent, Math.abs(p.position.x) + 20, Math.abs(p.position.z) + 20);
      }
    }

    const radius = Math.max(maxExtent, 50);
    // Circular ground plane centered at origin
    const groundGeo = new THREE.CircleGeometry(radius, 64);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a14,
      roughness: 0.95,
      metalness: 0.05,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -0.1, 0);
    ground.receiveShadow = true;
    ground.userData = { isGround: true };
    this.scene.add(ground);

    // Square grid lines clipped to circular boundary
    const gridColor = this.useAtmosphere ? 0x00ffff : 0x1a1a2e;
    const gridGroup = new THREE.Group();
    gridGroup.position.set(0, 0.01, 0);
    gridGroup.userData = { isGround: true };
    const gridSpacing = 5;
    const lineMat = new THREE.LineBasicMaterial({
      color: gridColor,
      transparent: this.useAtmosphere,
      opacity: this.useAtmosphere ? 0.3 : 1.0,
    });
    // Horizontal lines (parallel to X axis, varying Z)
    for (let z = -radius; z <= radius; z += gridSpacing) {
      const rSq = radius * radius;
      const zSq = z * z;
      if (zSq >= rSq) continue;
      const halfChord = Math.sqrt(rSq - zSq);
      const pts = [
        new THREE.Vector3(-halfChord, 0, z),
        new THREE.Vector3(halfChord, 0, z),
      ];
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      gridGroup.add(new THREE.Line(geo, lineMat.clone()));
    }
    // Vertical lines (parallel to Z axis, varying X)
    for (let x = -radius; x <= radius; x += gridSpacing) {
      const rSq = radius * radius;
      const xSq = x * x;
      if (xSq >= rSq) continue;
      const halfChord = Math.sqrt(rSq - xSq);
      const pts = [
        new THREE.Vector3(x, 0, -halfChord),
        new THREE.Vector3(x, 0, halfChord),
      ];
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      gridGroup.add(new THREE.Line(geo, lineMat.clone()));
    }
    // Circular border outline
    const borderPts: THREE.Vector3[] = [];
    const segments = 64;
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      borderPts.push(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
    }
    const borderGeo = new THREE.BufferGeometry().setFromPoints(borderPts);
    const borderMat = new THREE.LineBasicMaterial({
      color: gridColor,
      transparent: this.useAtmosphere,
      opacity: this.useAtmosphere ? 0.3 : 1.0,
    });
    gridGroup.add(new THREE.Line(borderGeo, borderMat));
    this.scene.add(gridGroup);
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
      'web-apps': 0x00cccc,
      'visualization': 0xcc66ff,
      'infrastructure': 0xff9933,
      'trading': 0xff3366,
      'obsidian-plugins': 0x66ff66,
      'content': 0xffcc00,
      'desktop-apps': 0x00aaff,
      'research': 0xff66cc,
      'animation': 0xff8844,
      'art': 0xff00ff,
      'AI/ML': 0x66ffcc,
    };

    const padding = 3; // Padding around buildings

    // Generate a consistent color for unknown categories via string hash
    const hashColor = (str: string): number => {
      let h = 0;
      for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
      const hue = ((h % 360) + 360) % 360;
      // Convert HSL(hue, 90%, 60%) to RGB hex
      const s = 0.9, l = 0.6;
      const c = (1 - Math.abs(2 * l - 1)) * s;
      const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
      const m = l - c / 2;
      let r: number, g: number, b: number;
      if (hue < 60) { r = c; g = x; b = 0; }
      else if (hue < 120) { r = x; g = c; b = 0; }
      else if (hue < 180) { r = 0; g = c; b = x; }
      else if (hue < 240) { r = 0; g = x; b = c; }
      else if (hue < 300) { r = x; g = 0; b = c; }
      else { r = c; g = 0; b = x; }
      return (Math.round((r + m) * 255) << 16) | (Math.round((g + m) * 255) << 8) | Math.round((b + m) * 255);
    };

    for (const [category, bounds] of categoryBounds) {
      const color = categoryColors[category] ?? hashColor(category);
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
        opacity: 0.25,
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
        opacity: 0.02,
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
      labelDiv.className = 'hypernovum-category-label';
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
        opacity: 0.2,
      });
      const leaderLine = new THREE.Line(leaderGeo, leaderMat);
      leaderLine.userData = { isDistrict: true, category };
      this.scene.add(leaderLine);
      blockObjects.push(leaderLine);

      // Endpoint dot at the outline
      const dotGeo = new THREE.CircleGeometry(0.4, 16);
      const dotMat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.25 });
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.rotation.x = -Math.PI / 2;
      dot.position.set(bounds.minX - padding, 0.08, labelZ);
      dot.userData = { isDistrict: true, category };
      this.scene.add(dot);
      blockObjects.push(dot);

      // Flat drag handle at top-right corner of outline
      const handleArmLen = 2.5;
      const handleX = bounds.maxX + padding;
      const handleZ = bounds.minZ - padding;

      // Flat L-bracket line on the ground
      const bracketPts = [
        new THREE.Vector3(handleX - handleArmLen, 0.06, handleZ),
        new THREE.Vector3(handleX, 0.06, handleZ),
        new THREE.Vector3(handleX, 0.06, handleZ + handleArmLen),
      ];
      const bracketGeo = new THREE.BufferGeometry().setFromPoints(bracketPts);
      const bracketMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 });
      const handleBracket = new THREE.Line(bracketGeo, bracketMat);
      handleBracket.userData = { isDragHandle: true, category };
      this.scene.add(handleBracket);
      blockObjects.push(handleBracket);

      // Small flat square at the corner for visual focus + emissive animation
      const handleGeo = new THREE.PlaneGeometry(1.6, 1.6);
      const handleMat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.15,
        transparent: true,
        opacity: 0.3,
        roughness: 0.4,
        metalness: 0.6,
        side: THREE.DoubleSide,
      });
      const handle = new THREE.Mesh(handleGeo, handleMat);
      handle.rotation.x = -Math.PI / 2;
      handle.position.set(handleX, 0.07, handleZ);
      handle.userData = { isDragHandle: true, category };
      this.scene.add(handle);
      this.dragHandles.push(handle);
      blockObjects.push(handle);

      // Invisible larger hitbox for easier click/hover detection (flat slab)
      // Expanded vertically and horizontally to catch clicks from sharp camera angles
      const hitBoxGeo = new THREE.BoxGeometry(10.0, 8.0, 10.0);
      const hitBoxMat = new THREE.MeshBasicMaterial({ visible: false });
      const hitBox = new THREE.Mesh(hitBoxGeo, hitBoxMat);
      hitBox.position.set(handleX, 4.0, handleZ);
      hitBox.userData = { isDragHandle: true, category, visualHandle: handle };
      this.scene.add(hitBox);
      this.handleHitBoxes.push(hitBox);
      blockObjects.push(hitBox);

      // Store block data with named refs for recalcBlockBounds
      this.blocks.set(category, {
        category,
        bounds: { ...bounds },
        color,
        objects: blockObjects,
        handle,
        hitBox,
        outline,
        fill,
        label,
        leaderLine,
        dot,
        handleBracket,
        projects: categoryProjects.get(category) || [],
      });
    }
  }

  private centerSingleBuildings(): void {
    for (const [category, block] of this.blocks) {
      const catBuildings = this.buildings.filter(
        b => b.userData.project?.category === category
      );
      if (catBuildings.length !== 1) continue;
      const building = catBuildings[0];
      const project = building.userData.project;
      if (!project?.position || !project?.dimensions) continue;
      const zoneCenterX = (block.bounds.minX + block.bounds.maxX) / 2;
      const zoneCenterZ = (block.bounds.minZ + block.bounds.maxZ) / 2;
      const deltaX = zoneCenterX - project.position.x;
      const deltaZ = zoneCenterZ - project.position.z;
      if (Math.abs(deltaX) < 0.1 && Math.abs(deltaZ) < 0.1) continue;
      this.moveSingleBuilding(building, deltaX, deltaZ);
    }
  }

  private createBuilding(project: ProjectData): void {
    const { width, height, depth } = project.dimensions!;
    const { x, z } = project.position!;
    const baseColor = this.getStatusColor(project.status);

    // Foundation plinth (shows stack on hover) — shape varies by category via BuildingFactory
    const foundationHeight = 0.8;
    const foundationGeo = BuildingFactory.createFoundation(project, foundationHeight);
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
    foundation.position.set(x, 0, z);
    foundation.receiveShadow = true;
    foundation.userData = { isFoundation: true, project };
    this.scene.add(foundation);
    this.foundations.push(foundation);

    // Invisible larger hit pad for easier tech stack hover detection
    // For hit pad we can still use a simple box for coverage, even if foundation is hex
    const hitPadExtra = 1.8;
    const hitPadGeo = new THREE.BoxGeometry(
      width + 0.4 + hitPadExtra * 2,
      foundationHeight + 0.4,
      depth + 0.4 + hitPadExtra * 2
    );
    const hitPadMat = new THREE.MeshBasicMaterial({ visible: false });
    const hitPad = new THREE.Mesh(hitPadGeo, hitPadMat);
    hitPad.position.set(x, foundationHeight / 2, z);
    hitPad.userData = { isFoundation: true, project, visualFoundation: foundation };
    this.scene.add(hitPad);
    this.foundationHitPads.push(hitPad);

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

    // Building silhouette: category-specific parametric shape where one is
    // mapped, status/height-based BuildingFactory shape otherwise
    const geometry = this.createBuildingGeometry(project);

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
    // Geometry is already translated up by height/2 in factory (bottom is at 0)
    // So we just place it on top of the foundation
    mesh.position.set(x, foundationHeight, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { isBuilding: true, project };

    // Store shader materials for animation updates
    if (isShaderMaterial) {
      this.shaderMaterials.set(mesh, material as THREE.ShaderMaterial);
    }

    this.scene.add(mesh);
    this.buildings.push(mesh);

    // Track building by project path for data flow targeting
    this.buildingPathMap.set(project.path, mesh);

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
    if (project.status === 'blocked') {
      this.blockedEdgeGlows.push(wireframe);
    }

    // Register in the parts registry — HighlightManager's application target
    this.parts.set(project.path, {
      path: project.path,
      project,
      building: mesh,
      shaderMaterial: isShaderMaterial ? (material as THREE.ShaderMaterial) : null,
      edgeGlow: wireframe,
      foundation,
      foundationWireframe,
      label: null,
      state: null,
    });

    // Rooftop detail kit — children of the building mesh so they move and
    // dispose with it (clearCity traverses recursively; raycaster does not).
    const roof = RooftopFactory.createRooftop(project, geometry);
    if (roof.detail) {
      const detailMat = new THREE.MeshStandardMaterial({
        color: 0x232838,
        roughness: 0.55,
        metalness: 0.75,
        flatShading: true,
      });
      const detailMesh = new THREE.Mesh(roof.detail, detailMat);
      detailMesh.castShadow = true;
      detailMesh.userData = { isBuilding: true, project, isRoofDetail: true };
      mesh.add(detailMesh);
    }
    if (roof.beaconPosition) {
      const beaconMat = new THREE.MeshStandardMaterial({
        color: 0xff3344,
        emissive: 0xff3344,
        emissiveIntensity: 1.6,
      });
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), beaconMat);
      beacon.position.copy(roof.beaconPosition);
      beacon.userData = { isBuilding: true, project, isRoofDetail: true };
      mesh.add(beacon);
      this.roofBeacons.push(beacon);
    }

    // Quest marker — floating gold gem over projects with open research questions
    if (project.questions && project.questions.length > 0) {
      geometry.computeBoundingBox();
      const topY = geometry.boundingBox ? geometry.boundingBox.max.y : height;
      const questMat = new THREE.MeshStandardMaterial({
        color: 0xffcc44,
        emissive: 0xffaa22,
        emissiveIntensity: 1.2,
        flatShading: true,
      });
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.35), questMat);
      const baseY = topY + 1.2;
      gem.position.set(0, baseY, 0);
      gem.userData = {
        isBuilding: true,
        project,
        isQuestMarker: true,
        baseY,
        bobPhase: (x * 7 + z * 13) % (Math.PI * 2),
      };
      mesh.add(gem);
      this.questMarkers.push(gem);
    }
  }

  /**
   * Building silhouette selection. Categories with a mapped parametric shape
   * get their GeometryFactory silhouette; everything else falls back to the
   * status/height-driven BuildingFactory shapes (so unmapped categories keep
   * the established look — the old default-to-plain-box behavior flattened
   * the city, which is part of why this wiring was previously reverted).
   *
   * GeometryFactory shapes are CENTER-anchored while createBuilding expects
   * bottom-anchored geometry (base at y=0) — bottom-anchor via bounding box.
   */
  private createBuildingGeometry(project: ProjectData): THREE.BufferGeometry {
    const { width, height, depth } = project.dimensions!;
    let geometry: THREE.BufferGeometry;

    switch (project.category) {
      case 'web-apps':
        // "The Helix Tower" — twisting tower representing the stack
        geometry = GeometryFactory.createHelixTower(width, height, depth);
        break;
      case 'visualization':
        // "The Data Shard" — the octahedron spans ±h, so pass height/2
        // for a total visual height of `height`
        geometry = GeometryFactory.createDataShard(width * 0.7, height / 2);
        break;
      case 'infrastructure':
        // "The Brutalist Ziggurat" — heavy stepped pyramid
        geometry = GeometryFactory.createZiggurat(width, height, depth);
        break;
      case 'trading':
        // "The Quant Blade" — sharp triangular prism, aggressive
        geometry = GeometryFactory.createQuantBlade(width, height);
        break;
      case 'obsidian-plugins':
        // "The Modular Hive" — hexagonal column
        geometry = GeometryFactory.createHive(width / 2, height);
        break;
      case 'content':
        // "The Memory Core" — ribbed cylinder
        geometry = GeometryFactory.createMemoryCore(width / 2, height);
        break;
      default:
        // Bottom-anchored already — BuildingFactory translates its shapes
        return BuildingFactory.createBuilding(project);
    }

    geometry.computeBoundingBox();
    geometry.translate(0, -geometry.boundingBox!.min.y, 0);
    return geometry;
  }

  /**
   * Render backlink knowledge arcs between buildings. Arcs are violet
   * additive tubes that rise with distance, pulse gently, and thicken with
   * link count. Rebuilt whenever the city rebuilds; cleared via clearLinkArcs.
   */
  showLinkArcs(edges: LinkEdge[]): void {
    this.clearLinkArcs();

    for (const edge of edges) {
      const a = this.buildingPathMap.get(edge.from);
      const b = this.buildingPathMap.get(edge.to);
      if (!a || !b) continue;

      const geoA = a.geometry as THREE.BufferGeometry;
      const geoB = b.geometry as THREE.BufferGeometry;
      geoA.computeBoundingBox();
      geoB.computeBoundingBox();
      const start = new THREE.Vector3(a.position.x, a.position.y + (geoA.boundingBox?.max.y ?? 5) * 0.9, a.position.z);
      const end = new THREE.Vector3(b.position.x, b.position.y + (geoB.boundingBox?.max.y ?? 5) * 0.9, b.position.z);

      const dist = start.distanceTo(end);
      const control = start.clone().add(end).multiplyScalar(0.5);
      control.y += Math.max(3, dist * 0.35);

      const curve = new THREE.QuadraticBezierCurve3(start, control, end);
      const radius = 0.05 + Math.min(edge.count, 6) * 0.015;
      const tube = new THREE.TubeGeometry(curve, 24, radius, 5, false);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xb38cff, // brand violet — distinct from the cyan activity arteries
        transparent: true,
        opacity: 0.32,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const arc = new THREE.Mesh(tube, mat);
      arc.userData = {
        isLinkArc: true,
        baseOpacity: 0.2 + Math.min(edge.count, 6) * 0.04,
        pulsePhase: (start.x + end.z) % (Math.PI * 2),
      };
      this.scene.add(arc);
      this.linkArcs.push(arc);
    }
  }

  clearLinkArcs(): void {
    for (const arc of this.linkArcs) {
      arc.geometry.dispose();
      (arc.material as THREE.Material).dispose();
      this.scene.remove(arc);
    }
    this.linkArcs = [];
  }

  /**
   * Agent fleet presence: one glowing orb per active agent, orbiting the
   * building it is working on. Each agent id gets a stable hue. Orbs are
   * children of the building mesh (they move and dispose with it); the
   * activity monitor re-sends presence every poll, so rebuilds self-heal.
   */
  updateAgentPresence(agents: { id: string; projectPath: string | null }[]): void {
    const seen = new Set<string>();

    for (const agent of agents) {
      if (!agent.projectPath) continue;
      const building = this.buildingPathMap.get(agent.projectPath);
      if (!building) continue;
      seen.add(agent.id);

      const existing = this.agentOrbs.get(agent.id);
      if (existing && existing.path === agent.projectPath) continue;

      // Reparent or create
      if (existing) {
        existing.orb.parent?.remove(existing.orb);
        existing.orb.geometry.dispose();
        (existing.orb.material as THREE.Material).dispose();
        this.agentOrbs.delete(agent.id);
      }

      const geo = building.geometry as THREE.BufferGeometry;
      geo.computeBoundingBox();
      const baseY = (geo.boundingBox?.max.y ?? 5) + 1.8;

      // Stable hue per agent id
      let hash = 0;
      for (let i = 0; i < agent.id.length; i++) hash = (hash * 31 + agent.id.charCodeAt(i)) | 0;
      const color = new THREE.Color().setHSL((((hash % 360) + 360) % 360) / 360, 0.75, 0.6);

      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.26, 12, 12),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.8 }),
      );
      orb.position.set(0, baseY, 0);
      orb.userData = { isBuilding: true, isAgentOrb: true, project: building.userData.project };
      building.add(orb);
      this.agentOrbs.set(agent.id, {
        orb,
        path: agent.projectPath,
        baseY,
        phase: (((hash % 628) + 628) % 628) / 100,
      });
    }

    // Remove orbs for agents that went idle or vanished
    for (const [id, entry] of this.agentOrbs) {
      if (seen.has(id)) continue;
      // Keep entries whose agent was simply unresolvable this tick? No — the
      // monitor re-sends the full fresh list every poll, so absence = gone.
      entry.orb.parent?.remove(entry.orb);
      entry.orb.geometry.dispose();
      (entry.orb.material as THREE.Material).dispose();
      this.agentOrbs.delete(id);
    }
  }

  /**
   * Quest-resolved celebration: an expanding emerald shockwave ring at the
   * building's base. Self-disposing after ~1.5s.
   */
  flashBuilding(projectPath: string, colorHex = 0x22ff88): void {
    const building = this.buildingPathMap.get(projectPath);
    if (!building) return;

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.15, 40),
      new THREE.MeshBasicMaterial({
        color: colorHex,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(building.position.x, 0.15, building.position.z);
    ring.userData = { isQuestBurst: true };
    this.scene.add(ring);
    this.questBursts.push({ mesh: ring, start: this.clock.getElapsedTime() });
  }

  /**
   * Recolor buildings (and their edge glows) for a data-visualization layer.
   * Colors map project path → hex color; buildings absent from the map keep
   * their status color. Call right after buildCity — rebuilding restores
   * status colors, so there is no separate clear step.
   */
  applyLayerColors(colors: Map<string, number>): void {
    // Lens colors own baseColor in the resolver; buildings absent from the
    // map keep their status color. Edge glows retint via the same pass.
    this.highlight.setLensColors(colors);
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
      labelDiv.className = 'hypernovum-building-label';
      labelDiv.textContent = project.title;
      const label = new CSS2DObject(labelDiv);
      label.position.copy(labelPos);
      label.userData = { isLabel: true };
      this.scene.add(label);

      this.labels.push({ project, buildingPos: buildingTop, labelPos, label });

      const entry = this.parts.get(project.path);
      if (entry) entry.label = label;
    }
  }

  private getStatusColor(status: string): THREE.Color {
    // Unified palette (types.STATUS_COLORS) — shared with the shader path
    return new THREE.Color(statusColor(status));
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

    // Store bounds for pan clamping
    this.cityBounds = { centerX, centerZ, radius: maxSize * 0.75 };
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

    // Check drag handle hitboxes (larger invisible areas)
    const handleHits = this.raycaster.intersectObjects(this.handleHitBoxes, false);

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
      const hitBox = handleHits[0].object as THREE.Mesh;
      if (hitBox.userData.isDragHandle) {
        const visualHandle = (hitBox.userData.visualHandle ?? hitBox) as THREE.Mesh;
        this.hoveredHandle = visualHandle;
        const mat = visualHandle.material as THREE.MeshStandardMaterial;
        if (mat.emissiveIntensity !== undefined) {
          mat.emissiveIntensity = 0.8;
        }
        this.container.style.cursor = 'grab';
        return; // Don't show other tooltips when hovering handle
      }
    }

    // Check buildings
    const buildingHits = this.raycaster.intersectObjects(this.buildings, false);
    // Then foundation hit pads (larger invisible areas around foundations)
    const foundationHits = this.raycaster.intersectObjects(this.foundationHitPads, false);

    // Clear tooltip + leader line
    if (this.tooltip) {
      this.scene.remove(this.tooltip);
      this.tooltip = null;
    }
    if (this.tooltipLeader) {
      this.tooltipLeader.traverse((child: THREE.Object3D) => {
        const m = child as any;
        if (m.geometry) m.geometry.dispose();
        if (m.material) m.material.dispose();
      });
      this.scene.remove(this.tooltipLeader);
      this.tooltipLeader = null;
    }

    // Determine which project is hovered (building takes priority, then foundation)
    let hoveredProject: ProjectData | null = null;
    let tooltipPos: THREE.Vector3 | null = null;
    let tooltipHeight = 0;

    if (buildingHits.length > 0) {
      const hit = buildingHits[0].object as THREE.Mesh;
      if (hit.userData.isBuilding && hit.userData.project) {
        hoveredProject = hit.userData.project as ProjectData;
        tooltipPos = hit.position;
        tooltipHeight = hoveredProject.dimensions!.height + 0.8;
      }
    } else if (foundationHits.length > 0) {
      const hitPad = foundationHits[0].object as THREE.Mesh;
      if (hitPad.userData.isFoundation && hitPad.userData.project) {
        const visualFoundation = (hitPad.userData.visualFoundation ?? hitPad) as THREE.Mesh;
        hoveredProject = hitPad.userData.project as ProjectData;
        tooltipPos = visualFoundation.position;
        tooltipHeight = 0.8;
      }
    }

    if (hoveredProject && tooltipPos) {
      this.showTooltip(hoveredProject, tooltipPos, tooltipHeight);
    }

    // Mirror hover into the shared store (only on change)
    const hoveredPath = hoveredProject?.path ?? null;
    if (this.store && this.store.getState().hoveredPath !== hoveredPath) {
      this.store.getState().hover(hoveredPath);
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

    // (Double-click no longer enters move mode — it opens the note.
    //  Move mode is explicit via the context menu.)

    // Check for drag handle clicks (use larger hitboxes)
    const handleHits = this.raycaster.intersectObjects(this.handleHitBoxes, false);

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

    // Visual feedback (bright glow) applied by HighlightManager via the store
    const path = (building.userData.project as ProjectData | undefined)?.path;
    if (path) this.store?.getState().enterMoveMode(path);

    // Highlight the parent block outline + fill
    const cat = building.userData.project?.category;
    if (cat) {
      const block = this.blocks.get(cat);
      if (block) {
        if (block.outline) (block.outline.material as THREE.LineBasicMaterial).opacity = 0.7;
        if (block.fill) (block.fill.material as THREE.MeshBasicMaterial).opacity = 0.06;
      }
    }

    this.container.style.cursor = 'move';

    // Show move mode indicator
    this.showMoveModeIndicator(building);
  }

  private exitBuildingMoveMode(): void {
    if (!this.movingBuilding) return;

    // Visual restore handled by HighlightManager when move mode clears
    this.store?.getState().exitMoveMode();

    // Restore block outline + fill to default
    const cat = this.movingBuilding.userData.project?.category;
    if (cat) {
      const block = this.blocks.get(cat);
      if (block) {
        if (block.outline) (block.outline.material as THREE.LineBasicMaterial).opacity = 0.25;
        if (block.fill) (block.fill.material as THREE.MeshBasicMaterial).opacity = 0.02;
      }
    }

    this.movingBuilding = null;
    this.container.style.cursor = 'default';

    // Remove move mode indicator
    this.hideMoveModeIndicator();
  }

  private showMoveModeIndicator(building: THREE.Mesh): void {
    // Remove existing indicator
    this.hideMoveModeIndicator();

    const div = document.createElement('div');
    div.className = 'hypernovum-move-indicator';
    div.textContent = 'MOVE MODE - Click elsewhere to exit';
    div.id = 'hypernovum-move-indicator';
    this.container.appendChild(div);
  }

  private hideMoveModeIndicator(): void {
    const existing = document.getElementById('hypernovum-move-indicator');
    if (existing) existing.remove();
  }

  /** True briefly after a drag ends — lets the click handler swallow the drag's click */
  wasRecentlyDragging(): boolean {
    return performance.now() - this.dragEndAt < 300;
  }

  /** Enter move mode from the context menu (the only entry point) */
  enterBuildingMoveModeByPath(projectPath: string): boolean {
    const building = this.buildingPathMap.get(projectPath);
    if (!building) return false;
    this.enterBuildingMoveMode(building);
    // Keyboard Escape is canvas-focus-gated — make sure the canvas has focus
    this.renderer.domElement.focus();
    return true;
  }

  /** Exit move mode if active (Escape / view-level clear) */
  exitMoveModeIfActive(): boolean {
    if (!this.movingBuilding) return false;
    this.exitBuildingMoveMode();
    return true;
  }

  isInMoveMode(): boolean {
    return this.movingBuilding !== null;
  }

  private onMouseUp(_event: MouseEvent): void {
    if (this.isDragging) {
      this.dragEndAt = performance.now();
      if (this.draggedBlock) {
        // Persist the internal state immediately so background rebuilds (e.g. file edits)
        // do not revert the user's manual dragging before they hit the Save Layout button.
        const offset = this.blockOffsets.get(this.draggedBlock.category);
        if (offset) {
          this.savedPositions.set(this.draggedBlock.category, { ...offset });
        }
      }

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

    // Move associated foundation and hit pads
    for (const foundation of this.foundations) {
      if (foundation.userData.project === project) {
        foundation.position.x += deltaX;
        foundation.position.z += deltaZ;
      }
    }
    for (const hitPad of this.foundationHitPads) {
      if (hitPad.userData.project === project) {
        hitPad.position.x += deltaX;
        hitPad.position.z += deltaZ;
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

    // Recalc block bounds after single building move
    const cat = building.userData.project?.category;
    if (cat) this.recalcBlockBounds(cat);
  }

  private recalcBlockBounds(category: string): void {
    const block = this.blocks.get(category);
    if (!block) return;

    // Compute new bounds from all buildings in this category
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    let found = 0;
    for (const b of this.buildings) {
      const p = b.userData.project as ProjectData;
      if (!p || p.category !== category) continue;
      found++;
      const pos = p.position;
      const dim = p.dimensions;
      if (!pos || !dim) continue;
      const halfW = dim.width / 2;
      const halfD = dim.depth / 2;
      minX = Math.min(minX, pos.x - halfW);
      maxX = Math.max(maxX, pos.x + halfW);
      minZ = Math.min(minZ, pos.z - halfD);
      maxZ = Math.max(maxZ, pos.z + halfD);
    }
    if (found === 0) return;

    // Epsilon check — skip if bounds didn't change
    const eps = 0.01;
    const ob = block.bounds;
    if (Math.abs(ob.minX - minX) < eps && Math.abs(ob.maxX - maxX) < eps &&
        Math.abs(ob.minZ - minZ) < eps && Math.abs(ob.maxZ - maxZ) < eps) return;

    block.bounds = { minX, maxX, minZ, maxZ };
    const padding = 3;

    // 1. Update outline vertices (5-point closed rectangle)
    if (block.outline) {
      const pos = block.outline.geometry.attributes.position as THREE.BufferAttribute;
      const pts: [number, number, number][] = [
        [minX - padding, 0.05, minZ - padding],
        [maxX + padding, 0.05, minZ - padding],
        [maxX + padding, 0.05, maxZ + padding],
        [minX - padding, 0.05, maxZ + padding],
        [minX - padding, 0.05, minZ - padding],
      ];
      for (let i = 0; i < pts.length; i++) {
        pos.setXYZ(i, pts[i][0], pts[i][1], pts[i][2]);
      }
      pos.needsUpdate = true;
    }

    // 2. Dispose + recreate fill geometry
    if (block.fill) {
      block.fill.geometry.dispose();
      block.fill.geometry = new THREE.PlaneGeometry(
        maxX - minX + padding * 2, maxZ - minZ + padding * 2
      );
      block.fill.position.set((minX + maxX) / 2, 0.03, (minZ + maxZ) / 2);
    }

    // 3. Reposition label, leader line, dot to new left edge
    const labelX = minX - padding - 6;
    const labelZ = (minZ + maxZ) / 2;
    const labelY = 1.5;
    if (block.label) {
      block.label.position.set(labelX, labelY, labelZ);
    }
    if (block.leaderLine) {
      const lp = block.leaderLine.geometry.attributes.position as THREE.BufferAttribute;
      const horizontalEnd = labelX + 3;
      lp.setXYZ(0, labelX + 1.5, labelY - 0.5, labelZ);
      lp.setXYZ(1, horizontalEnd, labelY - 0.5, labelZ);
      lp.setXYZ(2, minX - padding, 0.1, labelZ);
      lp.needsUpdate = true;
    }
    if (block.dot) {
      block.dot.position.set(minX - padding, 0.08, labelZ);
    }

    // 4. Reposition handle cluster to new top-right corner
    const handleX = maxX + padding;
    const handleZ = minZ - padding;
    if (block.handle) {
      block.handle.position.set(handleX, 0.07, handleZ);
    }
    if (block.hitBox) {
      block.hitBox.position.set(handleX, 4.0, handleZ);
    }
    // Update L-bracket vertices
    if (block.handleBracket) {
      const armLen = 2.5;
      const bp = block.handleBracket.geometry.attributes.position as THREE.BufferAttribute;
      bp.setXYZ(0, handleX - armLen, 0.06, handleZ);
      bp.setXYZ(1, handleX, 0.06, handleZ);
      bp.setXYZ(2, handleX, 0.06, handleZ + armLen);
      bp.needsUpdate = true;
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
    for (const hitPad of this.foundationHitPads) {
      if (hitPad.userData.project?.category === category) {
        hitPad.position.x += deltaX;
        hitPad.position.z += deltaZ;
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
    div.className = 'hypernovum-tooltip';

    let html = `
      <strong>${this.escapeHtml(project.title)}</strong>
      <div class="tooltip-row"><span>Status:</span> <span class="status-${project.status}">${project.status}</span></div>
      <div class="tooltip-row"><span>Priority:</span> ${project.priority}</div>
      <div class="tooltip-row"><span>Category:</span> ${project.category}</div>
      <div class="tooltip-row"><span>Health:</span> ${project.health}%</div>
      <div class="tooltip-row"><span>Files:</span> ${project.noteCount}</div>
    `;

    if (project.gitActivity) {
      const lastCommit = project.gitActivity.lastCommitDate
        ? this.formatRelativeTime(project.gitActivity.lastCommitDate)
        : 'none';
      html += `
        <div class="tooltip-enriched-section">
          <div class="tooltip-row tooltip-enriched"><span>Git:</span> ${lastCommit}</div>
          <div class="tooltip-row tooltip-enriched"><span>Branch:</span> ${this.escapeHtml(project.gitActivity.activeBranch || 'unknown')}</div>
          <div class="tooltip-row tooltip-enriched"><span>30d commits:</span> ${project.gitActivity.commitsLast30d}</div>
        </div>
      `;
    }

    if (project.hasMemoryContext) {
      html += `
        <div class="tooltip-row tooltip-enriched"><span>Memory:</span> <span class="tooltip-memory">Context ready</span></div>
      `;
    }

    if (project.questions && project.questions.length > 0) {
      html += `
        <div class="tooltip-row tooltip-enriched"><span>Quests:</span> <span class="tooltip-quest">${project.questions.length} open</span></div>
      `;
    }

    if (project.stack && project.stack.length > 0) {
      html += `
        <div class="tooltip-stack-section">
          <div class="tooltip-stack-header">TECH STACK</div>
          <div class="tooltip-stack-list">
            ${project.stack.map(tech => `<span class="tooltip-stack-item">${this.escapeHtml(tech)}</span>`).join('')}
          </div>
        </div>
      `;
    }

    div.innerHTML = html;

    // Determine which side of the screen has more space for the tooltip
    const buildingCentroid = new THREE.Vector3(position.x, height / 2, position.z);
    const screenPos = buildingCentroid.clone().project(this.camera);
    // screenPos.x: -1 (left edge) to +1 (right edge)
    const buildingOnLeft = screenPos.x < 0;

    // Offset tooltip to the side with more space (in world-space X)
    const offsetX = buildingOnLeft ? 8 : -8;
    const tooltipY = height + 2;
    const tooltipX = position.x + offsetX;
    const tooltipZ = position.z;

    this.tooltip = new CSS2DObject(div);
    this.tooltip.position.set(tooltipX, tooltipY, tooltipZ);
    this.scene.add(this.tooltip);

    // Leader line: horizontal stub from tooltip, then diagonal to building centroid
    const leaderGroup = new THREE.Group();
    const stubEnd = tooltipX + (buildingOnLeft ? -2 : 2); // horizontal stub toward the building
    const targetY = height * 0.5;  // aim at building centroid height

    const leaderPoints = [
      new THREE.Vector3(tooltipX, tooltipY - 0.5, tooltipZ),          // start near tooltip
      new THREE.Vector3(stubEnd, tooltipY - 0.5, tooltipZ),           // end of horizontal stub
      new THREE.Vector3(position.x, targetY, position.z),             // building centroid
    ];
    const leaderGeo = new THREE.BufferGeometry().setFromPoints(leaderPoints);
    const leaderMat = new THREE.LineBasicMaterial({
      color: 0x8899bb,
      transparent: true,
      opacity: 0.35,
    });
    const leaderLine = new THREE.Line(leaderGeo, leaderMat);
    leaderGroup.add(leaderLine);

    // Small dot at the building end
    const dotGeo = new THREE.CircleGeometry(0.25, 12);
    const dotMat = new THREE.MeshBasicMaterial({
      color: 0x8899bb,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.4,
    });
    const dot = new THREE.Mesh(dotGeo, dotMat);
    dot.rotation.x = -Math.PI / 2;
    dot.position.set(position.x, targetY + 0.05, position.z);
    leaderGroup.add(dot);

    this.tooltipLeader = leaderGroup;
    this.scene.add(leaderGroup);
  }

  private escapeHtml(str: string): string {
    return escapeHtml(str);
  }

  private formatRelativeTime(epochMs: number): string {
    const diff = Date.now() - epochMs;
    if (diff < 60_000) return 'just now';
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  private animate = (): void => {
    this.animationId = requestAnimationFrame(this.animate);

    const elapsed = this.clock.getElapsedTime();
    const delta = this.clock.getDelta();

    // Update Neural Core and Data Arteries
    if (this.neuralCore) {
      this.neuralCore.animate(elapsed);
    }
    if (this.arteryManager) {
      this.arteryManager.update(delta, elapsed);
      // Update Neural Core state based on artery activity
      if (this.neuralCore) {
        this.neuralCore.setState(this.arteryManager.getCityState());
      }
    }

    // Shader uniforms: time modulation around HighlightManager baselines.
    // State decisions (colors, glitch base, decay) live in the resolver —
    // this block only adds sin-wave motion and transient pulses.
    const streamingPath = this.arteryManager?.getStreamingPath() ?? null;
    for (const entry of this.parts.values()) {
      const material = entry.shaderMaterial;
      if (!material) continue;
      material.uniforms.uTime.value = elapsed;

      const s = entry.state;
      if (s && s.glitch > 0) {
        material.uniforms.uGlitch.value = s.glitch + Math.sin(elapsed * s.glitchSpeed) * 0.3;
      } else {
        // Smoothly decay glitch back to 0 after a state change
        const current = material.uniforms.uGlitch.value as number;
        if (current > 0.01) {
          material.uniforms.uGlitch.value = current * 0.95;
        }
      }

      // uPulse decays each frame so glow releases when its source stops,
      // then overheat/streaming re-boost it below
      material.uniforms.uPulse.value =
        (material.uniforms.uPulse.value as number) * SceneManager.PULSE_DECAY;

      const weather = this.highlight.getWeather(entry.path);
      if (weather && weather.churnScore > 60 && !weather.hasMergeConflicts) {
        const overheatIntensity = (weather.churnScore - 60) / 40; // 0-1 for scores 60-100
        const overheatPulse = Math.sin(elapsed * 4 + entry.building.position.x) * 0.15 * overheatIntensity;
        material.uniforms.uPulse.value = Math.max(
          material.uniforms.uPulse.value as number,
          overheatIntensity * 0.6 + overheatPulse
        );
      }

      // Terminal pulse: active if this building is being streamed to
      if (streamingPath === entry.path) {
        material.uniforms.uPulse.value = 1.0;
      }
    }

    // Agent orbs orbit their buildings
    for (const entry of this.agentOrbs.values()) {
      const t = elapsed * 1.6 + entry.phase;
      entry.orb.position.set(
        Math.cos(t) * 0.9,
        entry.baseY + Math.sin(elapsed * 2.3 + entry.phase) * 0.12,
        Math.sin(t) * 0.9,
      );
    }

    // Knowledge arcs breathe softly
    for (const arc of this.linkArcs) {
      const base = arc.userData.baseOpacity as number;
      (arc.material as THREE.MeshBasicMaterial).opacity =
        base * (0.75 + 0.25 * Math.sin(elapsed * 1.5 + (arc.userData.pulsePhase as number)));
    }

    // Quest-resolved shockwaves: expand and fade, then self-dispose
    if (this.questBursts.length > 0) {
      const alive: { mesh: THREE.Mesh; start: number }[] = [];
      for (const burst of this.questBursts) {
        const t = elapsed - burst.start;
        if (t > 1.5) {
          burst.mesh.geometry.dispose();
          (burst.mesh.material as THREE.Material).dispose();
          this.scene.remove(burst.mesh);
          continue;
        }
        const scale = 1 + t * 7;
        burst.mesh.scale.set(scale, scale, scale);
        (burst.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - t / 1.5);
        alive.push(burst);
      }
      this.questBursts = alive;
    }

    // Quest gems: slow spin + gentle bob
    for (const gem of this.questMarkers) {
      gem.rotation.y = elapsed * 1.2;
      gem.position.y = (gem.userData.baseY as number) +
        Math.sin(elapsed * 2 + (gem.userData.bobPhase as number)) * 0.15;
    }

    // Pulse critical-priority warning beacons (slow aircraft-light blink)
    if (this.roofBeacons.length > 0) {
      const blink = (Math.sin(elapsed * 2.4) + 1) / 2;
      const intensity = 0.3 + blink * 2.0;
      for (const beacon of this.roofBeacons) {
        (beacon.material as THREE.MeshStandardMaterial).emissiveIntensity = intensity;
      }
    }

    // Standard-material emissives: sin-wave around resolver baselines.
    // Hover/move/dim states arrive with pulseAmplitude 0, so no skip lists.
    for (const entry of this.parts.values()) {
      if (entry.shaderMaterial) continue;
      if (this.launchEffects.has(entry.building)) continue;
      const s = entry.state;
      if (!s) continue;
      const mat = entry.building.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = s.pulseAmplitude > 0
        ? s.emissiveBase + Math.sin(elapsed * s.pulseSpeed) * s.pulseAmplitude
        : s.emissiveBase;
    }

    // Process launch effects (dramatic pulse when launching Claude)
    const now = performance.now();
    for (const [building, effect] of this.launchEffects) {
      const age = now - effect.startTime;
      const progress = age / effect.duration;

      if (progress >= 1.0) {
        // Effect complete, remove
        this.launchEffects.delete(building);
      } else {
        // Apply dramatic launch effect
        const mat = building.material as THREE.MeshStandardMaterial;
        if (mat.emissiveIntensity !== undefined) {
          // Bright flash that fades
          const flash = Math.sin(progress * Math.PI) * 2.0;
          const pulse = Math.sin(progress * Math.PI * 6) * 0.5;
          mat.emissiveIntensity = 0.5 + flash + pulse;

          // Scale pulse for drama
          const scalePulse = 1.0 + Math.sin(progress * Math.PI * 4) * 0.05;
          building.scale.setScalar(scalePulse);
        }
      }
    }

    // Animate drag handles - gentle idle pulse
    for (const handle of this.dragHandles) {
      if (handle === this.hoveredHandle) continue; // Keep hover bright
      const mat = handle.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.25 + Math.sin(elapsed * 2 + handle.position.x * 0.5) * 0.15;
    }

    // Animate edge glow for blocked buildings — tracked array, NOT a
    // full-scene traverse (that walked every object in the graph per frame).
    // Suppressed while the building is dimmed (resolver sets edgeGlowPulse).
    for (const glow of this.blockedEdgeGlows) {
      const path = (glow.userData.project as ProjectData | undefined)?.path;
      const s = path ? this.parts.get(path)?.state : undefined;
      if (s && !s.edgeGlowPulse) continue;
      const mat = glow.material as THREE.LineBasicMaterial;
      mat.opacity = 0.4 + Math.sin(elapsed * 4) * 0.25;
    }

    // Clamp pan target so camera can't drift into the void
    const t = this.controls.target;
    const b = this.cityBounds;
    const dx = t.x - b.centerX;
    const dz = t.z - b.centerZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > b.radius) {
      const scale = b.radius / dist;
      t.x = b.centerX + dx * scale;
      t.z = b.centerZ + dz * scale;
    }

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
    this.highlight.dispose();
    if (this.composer) {
      this.composer.dispose();
    }
    // Cleanup Neural Core hit sphere
    if (this.coreHitSphere) {
      this.scene.remove(this.coreHitSphere);
      this.coreHitSphere.geometry.dispose();
      (this.coreHitSphere.material as THREE.Material).dispose();
      this.coreHitSphere = null;
    }
    // Cleanup Neural Core and Artery Manager
    if (this.neuralCore) {
      this.scene.remove(this.neuralCore);
      this.neuralCore.dispose();
      this.neuralCore = null;
    }
    if (this.arteryManager) {
      this.arteryManager.dispose();
      this.arteryManager = null;
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
    this.store?.getState().select(null);
  }

  /**
   * Capture the current 3D frame as a PNG data URL. Renders a fresh frame
   * synchronously before reading pixels (drawing buffer is not preserved).
   * HUD overlays and CSS2D labels are DOM, so the capture is a clean render.
   */
  captureSnapshot(): string {
    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    return this.renderer.domElement.toDataURL('image/png');
  }

  focusOnPosition(position: { x: number; y: number; z: number }): void {
    const target = new THREE.Vector3(position.x, 0, position.z);
    const cameraPos = target.clone().add(new THREE.Vector3(0, 35, 30));
    this.camera.position.copy(cameraPos);
    this.controls.target.copy(target);
    this.controls.update();
  }

  /** @deprecated Read selection from the shared interaction store instead. */
  getFocusedProject(): ProjectData | null {
    const path = this.store?.getState().selectedPath;
    if (!path) return null;
    return (this.buildingPathMap.get(path)?.userData.project as ProjectData | undefined) ?? null;
  }
  /** @deprecated Write selection through the shared interaction store instead. */
  setFocusedProject(project: ProjectData | null): void {
    this.store?.getState().select(project?.path ?? null);
  }

  /** Smoothly animate camera back to default overhead position */
  animateCameraToDefault(duration = 1000): void {
    const projects = this.buildings.map(b => b.userData.project).filter(Boolean) as ProjectData[];
    if (projects.length === 0) return;

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
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
    const targetPos = new THREE.Vector3(centerX, distance * 0.6, centerZ + distance * 0.7);
    const targetLookAt = new THREE.Vector3(centerX, 0, centerZ);
    const startPos = this.camera.position.clone();
    const startTarget = this.controls.target.clone();
    const startTime = performance.now();
    const animate = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      this.camera.position.lerpVectors(startPos, targetPos, ease);
      this.controls.target.lerpVectors(startTarget, targetLookAt, ease);
      this.controls.update();
      if (t < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }

  /** Position the Neural Core at the center of the city (origin) */
  private positionNeuralCore(projects: ProjectData[]): void {
    if (!this.neuralCore || projects.length === 0) return;

    this.neuralCore.position.set(0, 25, 0);

    // Keep hit sphere in sync
    if (this.coreHitSphere) {
      this.coreHitSphere.position.copy(this.neuralCore.position);
    }
  }

  /** Trigger a data flow animation from Neural Core to a building */
  triggerFlow(projectPath: string): void {
    if (!this.neuralCore || !this.arteryManager) return;

    const building = this.buildingPathMap.get(projectPath);
    if (!building) return;

    const project = building.userData.project as ProjectData;
    if (!project || !project.dimensions) return;

    this.arteryManager.spawnArtery(
      this.neuralCore,
      building.position.clone(),
      projectPath,
      project.dimensions.height + 0.8 // Account for foundation
    );
  }

  /** Trigger a dramatic launch effect on a building (for terminal launch) */
  triggerLaunchEffect(projectPath: string): void {
    const building = this.buildingPathMap.get(projectPath);
    if (!building) return;

    // Start tracking this building for the launch effect
    this.launchEffects.set(building, {
      startTime: performance.now(),
      duration: 1500, // 1.5 second effect
    });

    // Also trigger the data flow
    this.triggerFlow(projectPath);

    debugLog('Launch effect triggered for:', projectPath);
  }

  /** Start continuous streaming to a project (for Claude Code activity) */
  startStreaming(projectPath: string): void {
    if (!this.neuralCore || !this.arteryManager) return;

    const building = this.buildingPathMap.get(projectPath);
    if (!building) {
      debugLog('No building found for path:', projectPath);
      return;
    }

    const project = building.userData.project as ProjectData;
    if (!project || !project.dimensions) return;

    debugLog('Starting stream to:', project.title);

    this.arteryManager.startStream(
      this.neuralCore,
      building.position.clone(),
      projectPath,
      project.dimensions.height + 0.8
    );
  }

  /** Stop continuous streaming */
  stopStreaming(): void {
    if (!this.arteryManager) return;

    debugLog('Stopping stream');
    this.arteryManager.stopStream();
  }

  /** Check if currently streaming */
  isStreaming(): boolean {
    return this.arteryManager?.getIsStreaming() ?? false;
  }

  /** Find a project by partial name match (for fuzzy matching from Claude status) */
  findProjectByName(name: string): ProjectData | null {
    const lowerName = name.toLowerCase();

    // First try exact match on title
    for (const [path, building] of this.buildingPathMap) {
      const project = building.userData.project as ProjectData;
      if (project.title.toLowerCase() === lowerName) {
        return project;
      }
    }

    // Then try partial match
    for (const [path, building] of this.buildingPathMap) {
      const project = building.userData.project as ProjectData;
      if (project.title.toLowerCase().includes(lowerName) ||
        lowerName.includes(project.title.toLowerCase())) {
        return project;
      }
    }

    // Try matching on path
    for (const [path, building] of this.buildingPathMap) {
      const project = building.userData.project as ProjectData;
      if (path.toLowerCase().includes(lowerName)) {
        return project;
      }
    }

    // Try matching on projectDir folder name
    for (const [path, building] of this.buildingPathMap) {
      const project = building.userData.project as ProjectData;
      if (project.projectDir) {
        const dirName = project.projectDir.split(/[/\\]/).pop()?.toLowerCase();
        if (dirName && (dirName.includes(lowerName) || lowerName.includes(dirName))) {
          return project;
        }
      }
    }

    return null;
  }

  /**
   * Apply git-weather data to a building's visual state.
   * Maps weather metrics to shader uniforms and material properties:
   *  - Merge conflicts → glitch effect (vertex displacement + chromatic aberration)
   *  - High churn → overheat glow (boosted emissive, warm color shift)
   *  - Stale branches → decay dithering
   *  - Active commits → trigger data artery flow
   */
  applyWeather(projectPath: string, weather: WeatherData): void {
    // Visual mapping (glitch, decay, lit windows, emissive shifts) is
    // resolved and applied by HighlightManager
    this.highlight.setWeather(projectPath, weather);

    // Active commits in last 7 days → trigger a data flow
    if (weather.commitsLast7d > 0 && weather.lastCommitDate > 0) {
      const hoursSinceCommit = (Date.now() - weather.lastCommitDate) / (1000 * 60 * 60);
      if (hoursSinceCommit < 24) {
        this.triggerFlow(projectPath);
      }
    }
  }

  /**
   * Paths considered connected to the current selection (edge neighbors).
   * The view recomputes this from visible edges on selection change.
   */
  setConnectedPaths(paths: Set<string>): void {
    this.highlight.setConnectedPaths(paths);
  }

  /** Remove weather data for a project (e.g. when project is removed) */
  clearWeather(projectPath: string): void {
    this.highlight.setWeather(projectPath, null);
  }

  /** Clear all weather data */
  clearAllWeather(): void {
    this.highlight.clearAllWeather();
  }
}
