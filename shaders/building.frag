uniform vec3 uColor;          // Base building color (status)
uniform float uDecay;         // 0.0 = new, 1.0 = stale
uniform float uActivity;      // 0.0 = inactive, 1.0 = glowing
uniform float uTime;          // For animations

varying vec2 vUv;             // UV coordinates from vertex shader
varying vec3 vNormal;

// Pseudo-random function for window light variation
float random(vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

void main() {
  // 1. Create window grid pattern
  vec2 windowGrid = fract(vUv * vec2(5.0, 10.0)); // 5 cols x 10 rows
  float isWindow = step(0.1, windowGrid.x) * step(0.1, windowGrid.y) *
                   step(windowGrid.x, 0.9) * step(windowGrid.y, 0.9);

  // 2. Window lights (randomly lit based on activity)
  vec2 windowID = floor(vUv * vec2(5.0, 10.0));
  float lightOn = step(0.5, random(windowID)) * uActivity;
  vec3 windowColor = vec3(1.0, 0.95, 0.7) * lightOn; // Warm light

  // 3. Wall color with decay (desaturation + brownish tint)
  vec3 decayColor = vec3(0.4, 0.3, 0.2); // Concrete/brown
  vec3 wallColor = mix(uColor, decayColor, uDecay);

  // 4. Combine wall + windows
  vec3 finalColor = mix(wallColor, windowColor, isWindow * lightOn);

  // 5. Add subtle glow for active projects
  float glowAmount = uActivity * 0.3;
  finalColor += uColor * glowAmount;

  // 6. Screen-door dithering for decay (NOT transparency)
  if (uDecay > 0.5) {
    float dither = step(0.5, random(gl_FragCoord.xy * 0.5));
    if (dither < uDecay - 0.5) discard;
  }

  gl_FragColor = vec4(finalColor, 1.0);
}
