import * as THREE from 'three';

/**
 * Ground and atmosphere pieces for the city (GFX-006): an antialiased grid
 * plane, a horizon-glow background, a vignette pass, and a contact-shadow
 * decal. Each is one draw call (the vignette one full-screen pass).
 */

/** Darkest backdrop, matching the 0.x flat background. */
export const BACKDROP_COLOR = 0x0c0c18;
/** Glow toward the horizon — the far field is always at the top of the screen. */
export const HORIZON_COLOR = 0x141838;

/**
 * Vertical screen-space gradient: horizon glow at the top fading into the
 * backdrop. The camera's pitch is clamped (MapControls polar limits), so the
 * top of the frame is always the far field; fog uses the horizon colour so
 * distant buildings dissolve into the glow rather than a flat void.
 */
export function createHorizonBackground(): THREE.DataTexture {
  const H = 64;
  const data = new Uint8Array(H * 4);
  const top = new THREE.Color(HORIZON_COLOR);
  const bottom = new THREE.Color(BACKDROP_COLOR).multiplyScalar(0.8);
  const c = new THREE.Color();
  for (let i = 0; i < H; i++) {
    // Row 0 is the bottom of the texture (flipY off for DataTexture).
    const t = i / (H - 1);
    c.copy(bottom).lerp(top, Math.pow(t, 2.2));
    data[i * 4] = Math.round(c.r * 255);
    data[i * 4 + 1] = Math.round(c.g * 255);
    data[i * 4 + 2] = Math.round(c.b * 255);
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, 1, H, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Procedural grid on one plane (GFX-006). Lines are measured in screen pixels
 * with fwidth(), so they stay ~1 px wide and antialiased at any distance, and
 * fade out where cells shrink below a few pixels — the far grid used to moiré
 * at the shallow default camera angle. A radial fade dissolves the edge of the
 * disc into the dark, as the line-segment grid did.
 */
export function createGridMaterial(opts: {
  color: THREE.ColorRepresentation;
  opacity: number;
  spacing: number;
  /** World XZ where a grid line crosses (keeps the 0.x line alignment). */
  origin: number;
  fadeStart: number;
  radius: number;
}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(opts.color) },
      uOpacity: { value: opts.opacity },
      uSpacing: { value: opts.spacing },
      uOrigin: { value: opts.origin },
      uFadeStart: { value: opts.fadeStart },
      uRadius: { value: opts.radius },
    },
    vertexShader: `
      varying vec2 vXZ;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vXZ = world.xz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uSpacing;
      uniform float uOrigin;
      uniform float uFadeStart;
      uniform float uRadius;
      varying vec2 vXZ;
      void main() {
        vec2 coord = (vXZ - uOrigin) / uSpacing;
        vec2 fw = max(fwidth(coord), vec2(1e-5));
        // Distance to the nearest line, in pixels; ~1.2 px antialiased line.
        vec2 dist = abs(fract(coord - 0.5) - 0.5) / fw;
        float line = 1.0 - min(min(dist.x, dist.y) / 1.2, 1.0);
        // Cells smaller than ~3 px alias into moire: fade them out.
        float cellPx = 1.0 / max(fw.x, fw.y);
        float lod = smoothstep(2.5, 7.0, cellPx);
        float radial = 1.0 - smoothstep(uFadeStart, uRadius, length(vXZ));
        float a = uOpacity * line * lod * radial;
        if (a < 0.004) discard;
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true,
    depthWrite: false,
    extensions: { derivatives: true, fragDepth: false, drawBuffers: false, shaderTextureLOD: false },
  });
}

/**
 * Multiplicative vignette (GFX-006), run before OutputPass in linear space.
 * Darkens only — a mix toward grey would lift the near-black corners.
 */
export const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uStrength: { value: 0.35 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uStrength;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      float d = length((vUv - 0.5) * vec2(1.2, 1.0));
      texel.rgb *= 1.0 - uStrength * smoothstep(0.35, 0.85, d);
      gl_FragColor = texel;
    }`,
};

/**
 * Soft radial "contact shadow" quad, instanced once per building (GFX-006).
 * On a near-black neon ground the shadow map barely reads; a dark halo under
 * each base grounds the towers for one draw call.
 */
export function createContactShadowMesh(capacity: number): THREE.InstancedMesh {
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec2 vUv;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float a = 0.55 * (1.0 - smoothstep(0.35, 1.0, r));
        if (a < 0.004) discard;
        gl_FragColor = vec4(0.0, 0.0, 0.0, a);
      }`,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(capacity, 1));
  mesh.count = 0;
  mesh.frustumCulled = false; // instances span the city; the mesh's own bounds don't
  mesh.renderOrder = -1;       // under the grid and outlines
  return mesh;
}
