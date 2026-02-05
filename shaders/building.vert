uniform float uTime;
uniform float uGlitch;        // 0.0 = normal, 1.0 = full glitch (blocked)

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vPosition;

// Pseudo-random
float hash(float n) {
  return fract(sin(n) * 43758.5453123);
}

void main() {
  vUv = uv;
  vNormal = normal;
  vPosition = position;

  vec3 pos = position;

  // Glitch vertex displacement for blocked projects
  if (uGlitch > 0.0) {
    // Random time-based jitter
    float glitchTime = floor(uTime * 15.0); // 15 Hz flicker rate
    float glitchRand = hash(glitchTime + position.y * 10.0);

    // Only glitch occasionally (30% of frames)
    if (glitchRand > 0.7) {
      // Horizontal slice displacement
      float sliceY = floor(position.y * 4.0) / 4.0;
      float sliceRand = hash(glitchTime + sliceY * 100.0);

      // Shift X position for glitch slices
      pos.x += (sliceRand - 0.5) * 0.5 * uGlitch;

      // Occasional Z pop
      if (sliceRand > 0.9) {
        pos.z += (hash(glitchTime) - 0.5) * 0.3 * uGlitch;
      }
    }
  }

  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
