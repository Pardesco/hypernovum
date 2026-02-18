uniform vec3 uColor;          // Base building color (status)
uniform float uDecay;         // 0.0 = new, 1.0 = stale
uniform float uLitPercent;    // 0.0-1.0 — task completion ratio
uniform float uPulse;         // 0.0-1.0 — terminal active glow intensity
uniform float uTime;          // For animations
uniform float uGlitch;        // 0.0 = normal, 1.0 = blocked glitch
uniform float uScope;         // File count (fallback window density)
uniform float uTotalTasks;    // Task count (drives window grid density)

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
  // Task-based grid if tasks exist, else scope-based
  float taskSource = uTotalTasks > 0.0 ? uTotalTasks : uScope;
  float windowCols = 3.0 + floor(taskSource / 8.0);
  float windowRows = 4.0 + floor(taskSource / 5.0);
  windowCols = clamp(windowCols, 3.0, 10.0);
  windowRows = clamp(windowRows, 4.0, 20.0);

  vec2 windowGrid = fract(vUv * vec2(windowCols, windowRows));
  float isWindow = step(0.15, windowGrid.x) * step(0.15, windowGrid.y) *
                   step(windowGrid.x, 0.85) * step(windowGrid.y, 0.85);

  // === FILL-FROM-BOTTOM ILLUMINATION ===
  // Window ID (row 0 = bottom, row N-1 = top)
  vec2 windowID = floor(vUv * vec2(windowCols, windowRows));
  float rowPercent = (windowID.y + 1.0) / windowRows;

  // Lit if this row is below the completion line
  float litBase = step(rowPercent, uLitPercent);

  // Organic edge: partial row at the frontier gets random per-window fill
  float frontierRow = floor(uLitPercent * windowRows);
  float isFrontier = step(abs(windowID.y - frontierRow), 0.5);
  float frontierRand = random(windowID);
  float frontierLit = isFrontier * step(0.5, frontierRand);

  float lightOn = max(litBase, frontierLit);

  // Window color: warm amber, gold tint when fully complete
  vec3 windowBaseColor = uLitPercent >= 1.0 ? vec3(1.0, 0.85, 0.4) : vec3(1.0, 0.95, 0.7);

  // Terminal pulse: lit windows breathe brighter
  float terminalPulse = uPulse * (sin(uTime * 3.0) * 0.3 + 0.3);
  vec3 windowColor = windowBaseColor * (0.8 + terminalPulse) * lightOn;

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

  // === TERMINAL PULSE GLOW (replaces old activity glow) ===
  float pulse = sin(uTime * 3.0) * 0.5 + 0.5;
  float glowAmount = uPulse * 0.25 * (0.7 + pulse * 0.3);
  finalColor += uColor * glowAmount;

  // === EDGE GLOW (rim lighting) ===
  float rim = 1.0 - max(dot(normalize(vNormal), vec3(0.0, 0.0, 1.0)), 0.0);
  rim = pow(rim, 2.0);
  finalColor += uColor * rim * 0.3 * max(uPulse, uLitPercent * 0.3);

  // === DECAY DITHERING ===
  if (uDecay > 0.6) {
    float dither = step(0.5, random(gl_FragCoord.xy * 0.5 + uTime * 0.1));
    if (dither < (uDecay - 0.6) * 2.0) {
      finalColor *= 0.5;
    }
  }

  gl_FragColor = vec4(finalColor, 1.0);
}
