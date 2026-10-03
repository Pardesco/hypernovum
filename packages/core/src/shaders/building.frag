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
uniform float uEmissive;      // window light multiplier: >1 drives lit windows into HDR for bloom (GFX-002); 0 = unset → 1
uniform float uReflect;       // strength of the analytic environment reflection (GFX-005); 0 = off

varying vec2 vUv;
varying vec3 vNormal;         // object-space (unused since GFX-005; kept for the vertex contract)
varying vec3 vNormalV;        // view-space
varying vec3 vPosition;
varying vec3 vViewPos;        // view-space position (GFX-005 view vector)

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
  float litRow = max(litBase, frontierLit);

  // Occupancy (GFX-005): one hash per floor, one per window. Lit floors keep
  // ~88% of their windows on and unlit floors show a few late lights, so the
  // fill line still reads as task progress without a ruler-straight edge.
  float floorHash = random(vec2(windowID.y, 7.31));
  float winHash = random(windowID + vec2(floorHash * 13.0, 1.7));
  float lightOn = litRow > 0.5 ? step(0.12, winHash) : step(0.965, winHash);

  // Window color: warm amber (gold when complete), tinted toward the status
  // color so a district reads as one neighbourhood (GFX-005).
  vec3 warm = uLitPercent >= 1.0 ? vec3(1.0, 0.85, 0.4) : vec3(1.0, 0.95, 0.7);
  vec3 windowBaseColor = mix(warm, warm * (0.55 + 0.9 * uColor), 0.35);

  // Terminal pulse: lit windows breathe brighter
  float terminalPulse = uPulse * (sin(uTime * 3.0) * 0.3 + 0.3);

  // Per-window brightness variation, biased per floor — occupied floors, not a light switch
  float winVar = 0.68 + 0.32 * mix(random(windowID + vec2(3.7, 9.1)), floorHash, 0.4);
  // Lit windows are light sources: with bloom on they are driven above 1.0 so
  // they (and not the facade) clear the bloom threshold (GFX-002).
  float emissive = uEmissive > 0.0 ? uEmissive : 1.0;
  vec3 windowColor = windowBaseColor * (0.8 + terminalPulse) * lightOn * winVar * emissive;

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

  // === SURFACE LIGHTING (both styles since GFX-005) ===
  // A real normal response for every building. viewMatrix is a three.js
  // built-in, so the key and up directions stay fixed in world space.
  vec3 N = normalize(vNormalV);
  vec3 V = normalize(-vViewPos);
  vec3 keyDir = normalize(mat3(viewMatrix) * vec3(0.45, 0.80, 0.40));
  vec3 upDir = normalize(mat3(viewMatrix) * vec3(0.0, 1.0, 0.0));
  float ndl = max(dot(N, keyDir), 0.0);
  float hemi = 0.85 + 0.15 * dot(N, upDir);
  if (uFloors > 0.5) {
    // A wide key range is what separates one mass from the next on stacked
    // towers; 0.34-1.0 keeps the steps legible through the post chain.
    wallColor *= (0.34 + 0.66 * ndl) * hemi * 0.86;
  } else {
    // Classic silhouettes were tuned on the flat gradient alone: a gentler key
    // gives their faces form without dimming the established palette.
    wallColor *= (0.58 + 0.5 * ndl) * hemi;
  }

  // Roof deck: the camera looks down at roofs, and the cap inherits v=1 — the
  // brightest value the wall gradient produces. A dark deck lets greebles and
  // beacons read against it and the parapet read as a lip.
  float roofMask = smoothstep(0.86, 0.97, dot(N, upDir));
  wallColor = mix(wallColor, wallColor * 0.30, roofMask);

  // === COMBINE ===
  // Windows never run across the roof deck.
  float windowMix = isWindow * lightOn * (1.0 - roofMask);
  vec3 finalColor = mix(wallColor, windowColor, windowMix);

  // === PARAPET HIGHLIGHT (GFX-005) ===
  // A thin bright band where the facade meets the roof edge.
  float parapet = smoothstep(0.955, 0.99, vUv.y) * (1.0 - roofMask);
  finalColor += uColor * parapet * 0.3;

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

  // === FRESNEL RIM (both styles since GFX-005) ===
  // View-space normal against the true view vector: an actual fresnel, so every
  // tower gets a glass edge that follows the camera. Pulse/completion boost it.
  float fresnel = 1.0 - max(dot(N, V), 0.0);
  float rim = fresnel * fresnel;
  finalColor += uColor * rim * (0.08 + 0.3 * max(uPulse, uLitPercent * 0.3));

  // === CHEAP REFLECTION (GFX-005) ===
  // Reflect the view ray off the facade and look up an analytic environment
  // that matches the scene — dark ground, the horizon glow, a faint high strip
  // — instead of sampling a texture or rendering a probe. Glass (not lit
  // windows) and walls pick it up most at grazing angles.
  if (uReflect > 0.0) {
    vec3 R = reflect(-V, N);
    float ry = (vec4(R, 0.0) * viewMatrix).y; // view → world (rotation transpose)
    vec3 env = mix(vec3(0.012, 0.012, 0.03), vec3(0.16, 0.19, 0.42), exp(-abs(ry) * 5.0));
    env += vec3(0.55, 0.65, 0.9) * smoothstep(0.5, 0.85, ry) * 0.18;
    float reflectAmt = uReflect * (0.06 + 0.6 * pow(fresnel, 3.0)) * (1.0 - windowMix) * (1.0 - roofMask * 0.6);
    finalColor += env * reflectAmt;
  }

  // === DECAY DITHERING ===
  if (uDecay > 0.6) {
    float dither = step(0.5, random(gl_FragCoord.xy * 0.5 + uTime * 0.1));
    if (dither < (uDecay - 0.6) * 2.0) {
      finalColor *= 0.5;
    }
  }

  gl_FragColor = vec4(finalColor * uDimFactor, 1.0);
}
