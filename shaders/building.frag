uniform vec3 uColor;          // Base building color (status)
uniform float uDecay;         // 0.0 = new, 1.0 = stale
uniform float uActivity;      // 0.0 = inactive, 1.0 = glowing
uniform float uTime;          // For animations
uniform float uGlitch;        // 0.0 = normal, 1.0 = blocked glitch
uniform float uScope;         // File count (affects window density)

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vPosition;

// Pseudo-random function
float random(vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

float hash(float n) {
  return fract(sin(n) * 43758.5453123);
}

void main() {
  // === WINDOW GRID ===
  // Window density based on scope (more files = more windows)
  float windowCols = 3.0 + floor(uScope / 20.0);
  float windowRows = 5.0 + floor(uScope / 10.0);
  windowCols = clamp(windowCols, 3.0, 8.0);
  windowRows = clamp(windowRows, 5.0, 15.0);

  vec2 windowGrid = fract(vUv * vec2(windowCols, windowRows));
  float isWindow = step(0.15, windowGrid.x) * step(0.15, windowGrid.y) *
                   step(windowGrid.x, 0.85) * step(windowGrid.y, 0.85);

  // Window ID for random lighting
  vec2 windowID = floor(vUv * vec2(windowCols, windowRows));
  float windowRand = random(windowID);

  // Windows lit based on activity level
  float lightOn = step(1.0 - uActivity, windowRand);
  vec3 windowColor = vec3(1.0, 0.95, 0.7) * lightOn * 0.8;

  // === WALL COLOR ===
  vec3 decayColor = vec3(0.3, 0.25, 0.2);
  vec3 wallColor = mix(uColor * 0.6, decayColor, uDecay * 0.5);

  // === COMBINE ===
  vec3 finalColor = mix(wallColor, windowColor, isWindow * lightOn);

  // === GLITCH EFFECTS (Blocked projects) ===
  if (uGlitch > 0.0) {
    float glitchTime = floor(uTime * 12.0);
    float glitchRand = hash(glitchTime);

    // RGB color shift/chromatic aberration
    if (glitchRand > 0.6) {
      float shift = (hash(glitchTime + 1.0) - 0.5) * 0.3 * uGlitch;
      finalColor.r += shift;
      finalColor.b -= shift;
    }

    // Occasional bright flash
    if (glitchRand > 0.85) {
      finalColor += vec3(0.4, 0.1, 0.1) * uGlitch;
    }

    // Scanline effect
    float scanline = sin(vPosition.y * 50.0 + uTime * 20.0) * 0.5 + 0.5;
    finalColor *= 0.9 + scanline * 0.1 * uGlitch;

    // Color desaturation flicker
    if (hash(glitchTime + 2.0) > 0.8) {
      float gray = dot(finalColor, vec3(0.299, 0.587, 0.114));
      finalColor = mix(finalColor, vec3(gray), 0.5 * uGlitch);
    }
  }

  // === ACTIVITY GLOW ===
  // Pulse effect for active projects
  float pulse = sin(uTime * 3.0) * 0.5 + 0.5;
  float glowAmount = uActivity * 0.2 * (0.7 + pulse * 0.3);
  finalColor += uColor * glowAmount;

  // === EDGE GLOW (rim lighting) ===
  float rim = 1.0 - max(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0)), 0.0);
  rim = pow(rim, 2.0);
  finalColor += uColor * rim * 0.3 * uActivity;

  // === DECAY DITHERING ===
  if (uDecay > 0.6) {
    float dither = step(0.5, random(gl_FragCoord.xy * 0.5 + uTime * 0.1));
    if (dither < (uDecay - 0.6) * 2.0) {
      finalColor *= 0.5;
    }
  }

  gl_FragColor = vec4(finalColor, 1.0);
}
