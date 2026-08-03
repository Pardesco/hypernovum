uniform vec3 uColor;          // Base building color (status)
uniform float uDecay;         // 0.0 = new, 1.0 = stale
uniform float uLitPercent;    // 0.0-1.0 — task completion ratio
uniform float uPulse;         // 0.0-1.0 — terminal active glow intensity
uniform float uTime;          // For animations
uniform float uGlitch;        // 0.0 = normal, 1.0 = blocked glitch
uniform float uScope;         // File count (fallback window density)
uniform float uTotalTasks;    // Task count (drives window grid density)
uniform float uDimFactor;     // 1.0 = normal, <1 = dimmed (focus mode unrelated)
uniform float uFloors;        // 0 = legacy auto-density; >0 = real floor count (parametric)
uniform float uDiagrid;       // 0 = off; >0 = draw a diagrid facade (preset D)
uniform float uWindowCols;    // 0 = legacy per-face density; >0 = explicit column count

varying vec2 vUv;
varying vec3 vNormal;         // object-space (legacy classic rim)
varying vec3 vNormalV;        // view-space
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
  // Classic UVs run 0-1 per box FACE, so the legacy count is per-face. A loft's
  // u spans the whole perimeter, so the same number would give a quarter of the
  // windows; parametric mode passes an explicit perimeter count instead.
  float windowCols = uWindowCols > 0.5
    ? uWindowCols
    : clamp(3.0 + floor(taskSource / 8.0), 3.0, 10.0);
  // Parametric mode: window rows = real floor count. Classic (uFloors 0): auto.
  float windowRows = uFloors > 0.5
    ? uFloors
    : clamp(4.0 + floor(taskSource / 5.0), 4.0, 20.0);

  vec2 windowGrid = fract(vUv * vec2(windowCols, windowRows));
  // Soft-edged panes read as inset glass instead of painted-on decals
  float wx = smoothstep(0.12, 0.18, windowGrid.x) * (1.0 - smoothstep(0.82, 0.88, windowGrid.x));
  float wy = smoothstep(0.12, 0.18, windowGrid.y) * (1.0 - smoothstep(0.82, 0.88, windowGrid.y));
  float isWindow = wx * wy;

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

  // Per-window brightness variation — occupied floors, not a light switch
  float winVar = 0.7 + 0.3 * random(windowID + vec2(3.7, 9.1));
  vec3 windowColor = windowBaseColor * (0.8 + terminalPulse) * lightOn * winVar;

  // === WALL COLOR ===
  vec3 decayColor = vec3(0.3, 0.25, 0.2);
  vec3 wallColor = mix(uColor * 0.6, decayColor, uDecay * 0.5);
  // Vertical gradient: grounded shadow at the base, lifted crown at the top
  wallColor *= 0.72 + 0.4 * vUv.y;

  // === DIAGRID FACADE (preset D) ===
  // Two crossing line families etched into the wall color.
  if (uDiagrid > 0.5) {
    float density = 9.0;
    float d1 = abs(fract((vUv.x + vUv.y) * density) - 0.5);
    float d2 = abs(fract((vUv.x - vUv.y) * density) - 0.5);
    float lines = smoothstep(0.0, 0.07, d1) * smoothstep(0.0, 0.07, d2);
    wallColor *= 0.55 + 0.45 * lines; // darken along the diagonal members
  }

  // === SURFACE LIGHTING (parametric only) ===
  // Classic silhouettes are axis-aligned boxes whose look is tuned around the
  // flat vertical gradient alone. Lofted profiles need a real normal response
  // or their taper, waist and facets are literally invisible — which is also
  // what made facetedNormals pay 3x the vertices for nothing. viewMatrix is a
  // three.js built-in, so the key and up directions stay fixed in world space.
  float roofMask = 0.0;
  if (uFloors > 0.5) {
    vec3 N = normalize(vNormalV);
    vec3 keyDir = normalize(mat3(viewMatrix) * vec3(0.45, 0.80, 0.40));
    vec3 upDir = normalize(mat3(viewMatrix) * vec3(0.0, 1.0, 0.0));
    float ndl = max(dot(N, keyDir), 0.0);
    float hemi = 0.85 + 0.15 * dot(N, upDir);
    // A wide key range is what separates one mass from the next. At 0.55-1.0 the
    // lit and shaded faces of a stacked tower differ by less than the bloom
    // bleeds, so the steps vanish; 0.34-1.0 keeps them legible through the post
    // chain. The facade also sits a little darker so windows, ledges and the
    // outline carry the brightness instead of the whole surface glowing.
    wallColor *= (0.34 + 0.66 * ndl) * hemi * 0.86;

    // Roof deck. The camera looks DOWN at roofs more than at any facade, and
    // the cap inherits v=1 — the brightest value the wall gradient produces —
    // so an untreated roof was the single brightest surface on the building, in
    // pure status color. Dark deck instead: greebles and beacons now read
    // against it, and the parapet lip reads as a lip.
    roofMask = smoothstep(0.86, 0.97, dot(N, upDir));
    wallColor = mix(wallColor, wallColor * 0.30, roofMask);
  }

  // === COMBINE ===
  // Windows never run across the roof deck.
  vec3 finalColor = mix(wallColor, windowColor, isWindow * lightOn * (1.0 - roofMask));

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
  // Constant faint fresnel gives every tower a glass edge; pulse/completion boost it.
  // Parametric uses the VIEW-space normal, which makes this an actual fresnel —
  // in view space +Z points at the camera. Classic keeps the object-space normal
  // it was tuned against (a fixed stripe, but changing it would alter every
  // shipped classic building).
  vec3 rimN = uFloors > 0.5 ? normalize(vNormalV) : normalize(vNormal);
  float rim = 1.0 - max(dot(rimN, vec3(0.0, 0.0, 1.0)), 0.0);
  rim = pow(rim, 2.0);
  finalColor += uColor * rim * (0.08 + 0.3 * max(uPulse, uLitPercent * 0.3));

  // === DECAY DITHERING ===
  if (uDecay > 0.6) {
    float dither = step(0.5, random(gl_FragCoord.xy * 0.5 + uTime * 0.1));
    if (dither < (uDecay - 0.6) * 2.0) {
      finalColor *= 0.5;
    }
  }

  gl_FragColor = vec4(finalColor * uDimFactor, 1.0);
}
