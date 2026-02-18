import * as THREE from 'three';

interface DataArteryOptions {
  startPoint: THREE.Vector3;
  endPoint: THREE.Vector3;
  color?: number;
  duration?: number;
  persistent?: boolean;  // If true, stays until manually stopped
}

// Vertex shader: pass lineDistance as varying for dash pattern
const arteryVertexShader = `
  attribute float lineDistance;
  varying float vLineDistance;

  void main() {
    vLineDistance = lineDistance;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Fragment shader: animated dashed flow from core → building
const arteryFragmentShader = `
  uniform float uTime;
  uniform float uFlowSpeed;
  uniform float uProgress;
  uniform vec3 uColor;
  uniform float uDashSize;
  uniform float uGapSize;

  varying float vLineDistance;

  void main() {
    // Moving dash pattern — subtract time so dashes travel outward (core → building)
    float pattern = mod(vLineDistance - uTime * uFlowSpeed, uDashSize + uGapSize);

    // Soft dash edges via smoothstep
    float dash = smoothstep(0.0, uDashSize * 0.15, pattern)
               * smoothstep(uDashSize, uDashSize * 0.85, pattern);

    // Discard fully transparent fragments
    if (dash < 0.01) discard;

    // Fade in/out based on progress
    float fadeIn = smoothstep(0.0, 0.2, uProgress);
    float fadeOut = smoothstep(1.0, 0.8, uProgress);
    float alpha = fadeIn * fadeOut * dash;

    // HDR color output for bloom pickup
    vec3 finalColor = uColor * 2.0;

    gl_FragColor = vec4(finalColor, alpha);
  }
`;

/** Neon dashed line that flows from Neural Core to a building */
export class DataArtery extends THREE.Group {
  private line: THREE.Line;
  private material: THREE.ShaderMaterial;
  private startTime: number;
  private duration: number;
  private isFinished = false;
  private isPersistent: boolean;
  private isFadingOut = false;
  private fadeOutStart = 0;
  private fadeOutDuration = 500; // 500ms fade out

  constructor(options: DataArteryOptions) {
    super();

    this.startTime = performance.now();
    this.duration = options.duration ?? 5000;
    this.isPersistent = options.persistent ?? false;

    const color = options.color ?? 0x00ffff;

    // Straight line from start to end
    const start = options.startPoint;
    const end = options.endPoint;

    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    // computeLineDistances populates the lineDistance attribute for dash shader
    const tempLine = new THREE.Line(geometry);
    tempLine.computeLineDistances();
    // Transfer the lineDistance attribute
    const lineDistances = (tempLine.geometry as THREE.BufferGeometry).getAttribute('lineDistance');
    geometry.setAttribute('lineDistance', lineDistances);

    // Custom shader material for animated dashed flow
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFlowSpeed: { value: 8.0 },
        uProgress: { value: 0 },
        uColor: { value: new THREE.Color(color) },
        uDashSize: { value: 3.0 },
        uGapSize: { value: 2.0 },
      },
      vertexShader: arteryVertexShader,
      fragmentShader: arteryFragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.line = new THREE.Line(geometry, this.material);
    this.add(this.line);
  }

  /** Update animation - returns true if still active */
  update(delta: number, elapsed: number): boolean {
    if (this.isFinished) return false;

    const now = performance.now();
    const age = now - this.startTime;

    this.material.uniforms.uTime.value = elapsed;

    // Handle fade out (for persistent arteries being stopped)
    if (this.isFadingOut) {
      const fadeAge = now - this.fadeOutStart;
      const fadeProgress = Math.min(fadeAge / this.fadeOutDuration, 1.0);
      this.material.uniforms.uProgress.value = 1.0 - fadeProgress * 0.5; // Fade from 1.0 to 0.5 range

      if (fadeProgress >= 1.0) {
        this.isFinished = true;
        return false;
      }
      return true;
    }

    // Persistent mode - stay at full brightness after fade in
    if (this.isPersistent) {
      const fadeInProgress = Math.min(age / 500, 1.0); // 500ms fade in
      this.material.uniforms.uProgress.value = 0.3 + fadeInProgress * 0.4; // Stay at 0.7 when fully faded in
      return true;
    }

    // Normal timed mode
    const progress = Math.min(age / this.duration, 1.0);
    this.material.uniforms.uProgress.value = progress;

    if (progress >= 1.0) {
      this.isFinished = true;
      return false;
    }

    return true;
  }

  /** Check if the artery animation has completed */
  isComplete(): boolean {
    return this.isFinished;
  }

  /** Start fading out (for persistent arteries) */
  fadeOut(): void {
    if (this.isFadingOut || this.isFinished) return;
    this.isFadingOut = true;
    this.fadeOutStart = performance.now();
  }

  /** Update the artery color */
  setColor(color: number): void {
    this.material.uniforms.uColor.value.setHex(color);
  }

  /** Check if this is a persistent artery */
  getIsPersistent(): boolean {
    return this.isPersistent;
  }

  /** Cleanup resources */
  dispose(): void {
    this.line.geometry.dispose();
    this.material.dispose();
  }
}
