import * as THREE from 'three';
import type { CityState } from '../types';

interface NeuralCoreOptions {
  position?: THREE.Vector3;
  radius?: number;
}

/** Central "brain" of the Code City — wireframe cages with RGB chromatic split */
export class NeuralCore extends THREE.Group {
  private state: CityState = 'IDLE';
  private pulsePhase = 0;

  // Wireframe cage layers
  private outerCage: THREE.LineSegments;
  private midShell: THREE.LineSegments;
  private innerCore: THREE.LineSegments;

  // RGB chromatic split layers (clones of mid shell)
  private rgbLayers: THREE.LineSegments[] = [];
  private rgbOffsetAxes: THREE.Vector3[] = [];

  // Line-circle rings
  private rings: THREE.Line[] = [];
  private ringMaterials: THREE.LineBasicMaterial[] = [];

  // Materials for disposal
  private outerMat: THREE.LineBasicMaterial;
  private midMat: THREE.LineBasicMaterial;
  private innerMat: THREE.LineBasicMaterial;
  private rgbMats: THREE.LineBasicMaterial[] = [];

  // State-specific parameters
  private readonly stateConfigs: Record<CityState, {
    pulseSpeed: number;
    ringSpeed: number;
    rgbSpread: number;
    rgbOscSpeed: number;
  }> = {
    IDLE:        { pulseSpeed: 0.5, ringSpeed: 0.3, rgbSpread: 0.15, rgbOscSpeed: 0.3 },
    STREAMING:   { pulseSpeed: 2.0, ringSpeed: 1.5, rgbSpread: 0.8,  rgbOscSpeed: 1.5 },
    BULK_UPDATE: { pulseSpeed: 3.0, ringSpeed: 2.5, rgbSpread: 1.5,  rgbOscSpeed: 3.0 },
    ERROR:       { pulseSpeed: 8.0, ringSpeed: 0.5, rgbSpread: 2.0,  rgbOscSpeed: 8.0 },
  };

  constructor(options: NeuralCoreOptions = {}) {
    super();

    const radius = options.radius ?? 3;

    // --- Outer cage: sparse wireframe (detail 1) ---
    const outerGeo = new THREE.IcosahedronGeometry(radius, 1);
    const outerEdges = new THREE.EdgesGeometry(outerGeo);
    outerGeo.dispose();
    this.outerMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(0.3, 0.05, 0.6),
      transparent: true,
      opacity: 0.8,
    });
    this.outerCage = new THREE.LineSegments(outerEdges, this.outerMat);
    this.add(this.outerCage);

    // --- Mid shell: medium wireframe (detail 2), base for RGB split ---
    const midGeo = new THREE.IcosahedronGeometry(radius * 0.7, 2);
    const midEdges = new THREE.EdgesGeometry(midGeo);
    midGeo.dispose();
    this.midMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(0.6, 0.1, 1.2),
      transparent: true,
      opacity: 0.6,
    });
    this.midShell = new THREE.LineSegments(midEdges, this.midMat);
    this.add(this.midShell);

    // --- Inner core: dense wireframe (detail 3), blooms intensely ---
    const innerGeo = new THREE.IcosahedronGeometry(radius * 0.35, 3);
    const innerEdges = new THREE.EdgesGeometry(innerGeo);
    innerGeo.dispose();
    this.innerMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(2.0, 1.8, 2.5),
      transparent: true,
      opacity: 0.9,
    });
    this.innerCore = new THREE.LineSegments(innerEdges, this.innerMat);
    this.add(this.innerCore);

    // --- RGB chromatic split layers (clones of mid shell edges) ---
    const rgbColors = [
      new THREE.Color(2.0, 0, 0),   // R
      new THREE.Color(0, 2.0, 0),   // G
      new THREE.Color(0, 0, 2.0),   // B
    ];
    // Offset axes at 120° apart in the XZ plane
    const rgbAngles = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3];

    for (let i = 0; i < 3; i++) {
      const mat = new THREE.LineBasicMaterial({
        color: rgbColors[i],
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      // Clone the mid-shell edges geometry for each RGB layer
      const layer = new THREE.LineSegments(midEdges.clone(), mat);
      this.rgbLayers.push(layer);
      this.rgbMats.push(mat);
      this.rgbOffsetAxes.push(
        new THREE.Vector3(Math.cos(rgbAngles[i]), 0, Math.sin(rgbAngles[i]))
      );
      this.add(layer);
    }

    // --- Rings: line circles ---
    const ringConfigs = [
      { radius: radius * 1.4, rotation: new THREE.Euler(Math.PI / 2, 0, 0), color: new THREE.Color(2.5, 0.1, 0.5) },
      { radius: radius * 1.7, rotation: new THREE.Euler(Math.PI / 3, Math.PI / 4, 0), color: new THREE.Color(0.2, 2.5, 0.1) },
      { radius: radius * 2.0, rotation: new THREE.Euler(Math.PI / 5, -Math.PI / 3, Math.PI / 6), color: new THREE.Color(0.0, 0.8, 2.5) },
    ];

    const ringSegments = 128;
    for (const config of ringConfigs) {
      const points: THREE.Vector3[] = [];
      for (let j = 0; j <= ringSegments; j++) {
        const angle = (j / ringSegments) * Math.PI * 2;
        points.push(new THREE.Vector3(
          Math.cos(angle) * config.radius,
          Math.sin(angle) * config.radius,
          0
        ));
      }
      const ringGeo = new THREE.BufferGeometry().setFromPoints(points);
      const ringMat = new THREE.LineBasicMaterial({
        color: config.color,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const ring = new THREE.Line(ringGeo, ringMat);
      ring.rotation.copy(config.rotation);
      this.rings.push(ring);
      this.ringMaterials.push(ringMat);
      this.add(ring);
    }

    // Set initial position
    if (options.position) {
      this.position.copy(options.position);
    }
  }

  /** Update animation each frame */
  animate(time: number): void {
    const config = this.stateConfigs[this.state];

    // Breathing pulse
    this.pulsePhase += config.pulseSpeed * 0.016;
    const pulse = 0.85 + Math.sin(this.pulsePhase) * 0.15;

    // --- Outer cage: slow rotation ---
    this.outerCage.scale.setScalar(pulse);
    this.outerCage.rotation.y += 0.002;
    this.outerCage.rotation.x += 0.001;

    // --- Mid shell: medium rotation ---
    this.midShell.rotation.y += 0.004;
    this.midShell.rotation.z += 0.002;

    // --- Inner core: fast pulse + rotation ---
    const innerPulse = 0.9 + Math.sin(this.pulsePhase * 2.0) * 0.1;
    this.innerCore.scale.setScalar(innerPulse);
    this.innerCore.rotation.y -= 0.006;
    this.innerCore.rotation.x += 0.003;

    // HDR color intensity shift on inner core based on state
    const coreIntensity = this.state === 'IDLE' ? 1.0 :
                          this.state === 'STREAMING' ? 1.5 :
                          this.state === 'BULK_UPDATE' ? 2.0 : 0.8;
    this.innerMat.color.setRGB(2.0 * coreIntensity, 1.8 * coreIntensity, 2.5 * coreIntensity);

    // --- RGB chromatic split ---
    const spread = config.rgbSpread;
    const oscSpeed = config.rgbOscSpeed;

    for (let i = 0; i < this.rgbLayers.length; i++) {
      const layer = this.rgbLayers[i];
      const axis = this.rgbOffsetAxes[i];

      // Copy mid shell rotation so layers track
      layer.rotation.copy(this.midShell.rotation);

      let offset: number;
      if (this.state === 'ERROR') {
        // Glitchy random offsets
        offset = (Math.random() - 0.5) * spread * 2;
      } else {
        offset = Math.sin(this.pulsePhase * oscSpeed + i * 2.094) * spread;
      }

      layer.position.set(
        axis.x * offset,
        axis.y * offset,
        axis.z * offset
      );
    }

    // --- State-based color on outer cage ---
    if (this.state === 'ERROR') {
      const glitch = Math.random() > 0.85 ? (Math.random() - 0.5) * 0.3 : 0;
      this.outerCage.scale.setScalar(pulse + glitch);
      this.outerMat.color.setRGB(1.5, 0.05, 0.05);
    } else if (this.state === 'BULK_UPDATE') {
      this.outerMat.color.setRGB(0.8, 0.3, 1.2);
    } else if (this.state === 'STREAMING') {
      this.outerMat.color.setRGB(0.5, 0.1, 0.9);
    } else {
      this.outerMat.color.setRGB(0.3, 0.05, 0.6);
    }

    // --- Rings rotation ---
    const ringSpeed = config.ringSpeed * 0.016;
    this.rings[0].rotation.z += ringSpeed;
    this.rings[0].rotation.x += Math.sin(this.pulsePhase * 0.7) * 0.002;

    this.rings[1].rotation.x += ringSpeed * 0.8;
    this.rings[1].rotation.y += ringSpeed * 0.6;
    this.rings[1].rotation.z += Math.sin(this.pulsePhase * 0.5) * 0.003;

    this.rings[2].rotation.y -= ringSpeed * 0.7;
    this.rings[2].rotation.z += ringSpeed * 0.5;
    this.rings[2].rotation.x += Math.sin(this.pulsePhase * 0.6) * 0.002;

    // Ring opacity pulsing
    for (let i = 0; i < this.ringMaterials.length; i++) {
      const baseOpacity = this.state === 'BULK_UPDATE' ? 0.95 :
                          this.state === 'STREAMING' ? 0.85 :
                          this.state === 'ERROR' ? 0.7 : 0.7;
      this.ringMaterials[i].opacity = baseOpacity + Math.sin(this.pulsePhase + i) * 0.1;
    }
  }

  /** Change the core's visual state */
  setState(state: CityState): void {
    if (this.state === state) return;
    this.state = state;
  }

  /** Get current state */
  getState(): CityState {
    return this.state;
  }

  /** Get connection point for artery attachment (top of core) */
  getConnectionPoint(): THREE.Vector3 {
    return this.position.clone();
  }

  /** Cleanup resources */
  dispose(): void {
    this.outerCage.geometry.dispose();
    this.outerMat.dispose();
    this.midShell.geometry.dispose();
    this.midMat.dispose();
    this.innerCore.geometry.dispose();
    this.innerMat.dispose();

    for (let i = 0; i < this.rgbLayers.length; i++) {
      this.rgbLayers[i].geometry.dispose();
      this.rgbMats[i].dispose();
    }

    for (let i = 0; i < this.rings.length; i++) {
      this.rings[i].geometry.dispose();
      this.ringMaterials[i].dispose();
    }
  }
}
