# Next development pass: findings from the 0.6.0 showcase (2026-10-03)

Source: filming the 2:49 Hypernovum showcase on the published **0.6.0** release in **Obsidian 1.13.7**, then checking each suspicion against the source at `2d31cbd` (release 0.6.0 = `origin/master`). Line numbers refer to that commit.

Each task has an ID, the problem, evidence, a proposed change and acceptance criteria. Priorities: **P1** = users hit it in normal use; **P2** = quick wins; **P3** = bugs/debt; **P4** = product bets that need a decision first.

## Suggested release split

| Release | Tasks | Risk |
|---|---|---|
| **0.6.1** (patch) | CAM-001, AGT-010, UX-001, TXT-001, DOC-001, DOC-002, GL-001, QA-001, AGT-011 (verify first) | Low; no layout or schema changes |
| **0.7.0** (minor) | HUD-001, LAY-001, VIS-001, LBL-001, VIS-002, ONB-001 | LAY-001 changes saved-layout semantics, so version it |
| **0.7.x graphics** | GFX-001…011 (see Graphics pass; GFX-007/001/002/003 first) | Core change: re-check Pro after sync |
| Decide first | CIN-001 (free vs Pro) | Product call |

Core changes (`packages/core`) flow into Hypernovum Pro through the vendored tarball, so CAM-001, HUD-001's camera part, LAY-001, VIS-001, LBL-001 and GL-001 need a Pro check after `scripts/sync-core.sh` (verify the printed core build stamp).

### Pass status (2026-10-03, branch `feat/next-pass-0.7`, from `2d31cbd`)

- **Implemented:** every task except the three that wait on a decision (VIS-002, CIN-001, ONB-001). GFX-004 and GFX-010 are partial by design (see their status lines). Per-task status lines sit under each heading below.
- **Core commits (re-check Pro after `sync-core`):** `d84f5af` CAM-001, `07092c2` GL-001, `12af074` perf overlay, `a5211a6` GFX-007, `858c2e1` GFX-001, `6eec79f` GFX-002, `348de6b` GFX-003, `c296803` GFX-004, `5a884e8` + `43894e6` GFX-006, `897d897` GFX-005, `9b4d1c1` GFX-011, `065bd9d` GFX-009, `4eb3cb4` GFX-008, `4c1b784` GFX-010, `e90e9d6` HUD-001, `84f9b54` VIS-001, `7c65d6e` LBL-001, `82f776c` LAY-001. All additive (no export removed or renamed); `BuildingParts.edgeGlow` widened to `LineSegments | LineSegments2`. Pro specifics: Pro passes no `graphicsQuality` (keeps the pre-tier renderer config) and never calls `setFramingRect` (keeps the 0.x framing); `packDistricts(projects)` is still the 0.x packer; contact shadows and the horizon backdrop live in `addGround`, which Pro replaces; OutputPass is still the last composer pass. If Pro moves shadow casters after `buildCity` (its island lift does), call `invalidateShadows()` afterwards.
- **Open decisions:** VIS-002, CIN-001, ONB-001 (as planned); Auto picks High, whose 1.5 pixel-ratio cap renders HiDPI screens below 0.6.0's full device ratio (MSAA compensates; Ultra restores it); facade reflection strength 0.5 and window HDR 1.3 were tuned by eye; the optional AGT-010 `thinking` state and DOC-002 in-app detection were left out; GFX-010's per-building batching needs its own pass with Pro.

---

## P1: users hit these in normal use

### CAM-001: the camera resets on every city rebuild
- **Status (2026-10-03):** Done — `d84f5af`. Camera frames only on a view's first build, empty→non-empty, fallback↔project, or Space; reloads for settings/vault mode carry the camera. Verified live: note save, Prepare vault, lens toggle, vault mode on/off all leave the camera unchanged; Space re-frames.
- **Problem:** zoom into a district, save any project note, and the camera jumps back to the overview. Prepare vault (AGENTS.md) did the same on camera during filming.
- **Evidence:** the rebuild path calls `this.fitCameraToCity(projects)` unconditionally (`packages/core/src/scene/SceneManager.ts:465`). Rebuilds run on every project-note save.
- **Change:** fit only on the first build of a view, when the project count goes from 0 to >0, or on an explicit Reset camera (`resetCamera()`, `SceneManager.ts:2703`, Space key). Otherwise preserve `camera.position` and `controls.target` across rebuilds.
- **Accept:**
  - Zoomed into a district, then edit and save a note → camera unchanged.
  - Run Prepare vault, toggle a lens, toggle Vault mode → camera unchanged.
  - First open still frames the whole city, and Space still resets.

### AGT-010: live agents flicker to "stale" between tool calls
- **Status (2026-10-03):** Done — `0093b1d`, `a704bad`. 90 s live window for explicit **and tool-inferred** states (hook pings carry no `--state`, so explicit-only would not have fixed real sessions). Verified live: working states held after 50 s of silence. Optional `thinking` presentation not done.
- **Problem:** a live state only lasts 10 s after the last ping. Real Claude Code and Codex sessions often spend 10–60 s generating between tool calls, so a busy agent's orb keeps flipping to stale.
- **Evidence:**
  - `FRESH_MS = 10_000`, `WAITING_MAX_MS = 120_000` and `DISCONNECT_MS = 15 min` are defined at `packages/obsidian-plugin/src/monitors/AgentRegistry.ts:42-44`.
  - In `deriveAgentState`, anything older than `FRESH_MS` that isn't blocked, failed or complete returns `'stale'`.
  - The comment at `AgentRegistry.ts:87` says "10s–120s → waiting", but the code returns `'stale'`.
- **Change:**
  - Keep the 0.6.0 principle: never infer *waiting* from silence. Widen the live window for explicit live states (editing, running, testing, reading, planning) to about 90 s.
  - Optionally add a `thinking` presentation for sessions between a `UserPromptSubmit` ping and the next tool ping.
  - Fix the comment and update the registry state tests.
- **Accept:** a session pinged once with `--state=editing` shows editing for 90 s, stale after that, and disconnected after 15 min. Blocked, failed and complete behave as today.

---

## P2: quick wins

### HUD-001: panels cover about half the city, and framing ignores them (0.7.0)
- **Status (2026-10-03):** Done — `e90e9d6`, `98e99e6`. Chevrons (persisted in `hudCollapsed`), H key + "Toggle HUD" command, panel-aware framing via `setFramingRect()`. Verified live at 1920×1080: 0 of 27 building centres under a panel; collapse survives reload; H hides all but title and legend.
- **Problem:** three overlays sit on the city and none collapse. The center command panel covers the middle of the default view, and the overview frames the city partly underneath it.
- **Evidence:**
  - Agents panel at `packages/obsidian-plugin/src/views/HypernovumView.ts:1012`.
  - Command panel at `:1436`.
  - Inspector at `:1588`.
  - `fitCameraToCity` (`SceneManager.ts:1566`) has no notion of insets.
- **Change:**
  1. A collapse chevron per panel, with collapsed state persisted in settings.
  2. A Hide HUD toggle (key `H` plus a command) that keeps only the title and legend. It would also suit tutorials and screenshots.
  3. Panel-aware framing: the view passes the unobstructed canvas rect (canvas minus visible panel rects) to `fitCameraToCity(projects, insets)`, which offsets the target so the city's bounds project into that rect.
- **Accept:**
  - At 1920×1080 on default open, no building center projects under a panel.
  - `H` toggles the HUD, and collapse state survives a reload.

### LAY-001: the default layout is one long column (0.7.0)
- **Status (2026-10-03):** Done — `82f776c`. Shelf packer (`packDistricts(projects, { layout: 'shelf' })`); core default stays legacy (Pro unaffected). `layoutVersion` migration keeps configs with non-zero saved offsets on the legacy packer. Verified: showcase vault renders all 27 buildings / 7 blocks identical to 0.6.0; after "Reset city layout" (new command) the demo vault is 1.98:1 with no district overlap.
- **Problem:** every category is a new row along Z, so seven districts become a strip about 135 units deep and 45 wide. To get a 16:9 composition for the showcase I had to hand-tune `blockPositions`; the offsets are in the demo harness's `fixtures.json`.
- **Evidence:** `packages/core/src/layout/BinPacker.ts`. The loop at `:43` advances `currentZ` per category; X only advances across stages inside one category.
- **Change:** pack category blocks with a shelf or skyline packer toward a target aspect ratio. Default to about 1.8:1, or pass the pane aspect from the view.
- **Risk:** saved `blockPositions` are *offsets from the default position* (`types.ts:94`), so changing the default moves every saved layout. Add a `layoutVersion` setting. For users with saved positions, either keep the legacy packer, or convert once to absolute positions computed with the legacy packer.
- **Accept:**
  - The demo vault opens as a block roughly 1.5–2.2:1 with no district overlap.
  - Existing saved layouts render exactly as before.
  - Pro's unified-city mode is unaffected.

### VIS-001: quest gems and agent orbs are unreadable at overview zoom
- **Status (2026-10-03):** Done — `84f9b54`. Per-frame scale keeps gems and orbs ≥ 12 px (cap 6×). Verified live: all 3 gems and 6 orbs 12 px at the default overview (were ~3.5–4.7 px).
- **Problem:** I cut quests from the video because the gems didn't read on camera. Orbs only read in close-ups.
- **Evidence:**
  - The quest gem is `OctahedronGeometry(0.35)` (`SceneManager.ts:1073`) and the agent orb is `SphereGeometry(0.26)` (`:1316`).
  - Buildings are 2–4 units wide and up to 17.5 tall, and the overview camera sits about 110 units away, which leaves gems and orbs at a few pixels.
- **Change:** enforce a minimum on-screen size. Scale by camera distance per frame (clamped), or add a sprite halo. Keep raycast targets in sync.
- **Accept:** at the default overview, the gems and an active orb measure at least 10 px.

### VIS-002: the default view is almost all green (needs a design call)
- **Status (2026-10-03):** Open — needs Randall's design call; not implemented.
- **Problem:** 20 of 27 demo projects are active, so the Status lens is a sea of identical green. The Git activity lens was the most attractive and informative view while filming.
- **Options:** modulate emissive or brightness by git recency within the Status lens, or make the Active Work preset the first-run default.
- **Accept:** a screenshot review sign-off from Randall.

### UX-001: the Vault Mode toggle is too easy to hit
- **Status (2026-10-03):** Done — `c0e8a42`. Compact switch in the PROJECTS header; confirm modal when turning vault mode ON with live sessions. Verified live.
- **Problem:** it's a full-width bar in the command panel (`HypernovumView.ts:1514`). One stray click turns off the whole agent layer and rebuilds the city, which with CAM-001 also resets the camera. The recorder hit it during filming when a click target slid under the panel.
- **Change:** a compact labelled switch, or move it to the panel header. Optionally confirm when turning it ON while sessions are live.

### LBL-001: labels collide
- **Status (2026-10-03):** Done — `7c65d6e`. Greedy collision pass in the 4 Hz tick (district > selected > hovered > pinned context > critical/high > rest). Verified live: 7 overlapping label pairs → 0 at default overview; tick costs 0.2 ms at L250.
- **Problem:** district and building labels overlap at default zoom. For example, the TRADING label sits under Nova Checkout in the demo vault.
- **Evidence:** category labels are created at `SceneManager.ts:758`. The 4 Hz visibility pass is at `:1557`, using `labelVisible` from `visualState.ts:54`.
- **Change:** add a greedy screen-space collision pass in the same tick. Priority order: category, then selected, then hovered, then critical/high, then the rest.

### TXT-001: inconsistent agent naming
- **Status (2026-10-03):** Done — `9784080`. Selection is keyed by command; the persisted display name is migrated once (`GPT Codex` → `Codex CLI`, codex command only).
- "GPT Codex" appears in `packages/obsidian-plugin/src/settings/SettingsTab.ts:10` and `HypernovumView.ts:1008`, while sessions say "Codex". OpenAI's tool is the Codex CLI.
- Rename to "Codex CLI" (also in the README). Check that persisted agent config is keyed by `id`, not display name, before renaming.

### DOC-001: document `heartbeat.js --cwd`
- **Status (2026-10-03):** Done — `75437b4`. heartbeat.js header, README and the generated AGENTS.md.
- `--cwd` is supported (`scripts/heartbeat.js:376`), and cwd is the *first* matching rule (`HypernovumView.ts:2879`, comparing against `projectDir`). But the header's Args list and the README omit it, even though it's the most reliable way to attach a session to a project.

---

## P3: bugs and debt

### GL-001: three WebGL contexts per view open
- **Status (2026-10-03):** Done — `07092c2`. Verified live: 1 live context per open view (0.6.0: 3), and a reload leaves exactly one.
- **Evidence:**
  - `SceneManager.ts:199` creates a throwaway `new THREE.WebGLRenderer()` in a field initializer.
  - `initRenderer()` replaces it at `:311`.
  - `isWebGLAvailable()` (`:298`) probes a third context.
- **Change:** use definite assignment (`renderer!:`) or create lazily, and release the probe context with `WEBGL_lose_context`.
- **Accept:** one live context per open city view.

### QA-001: test the Obsidian 1.13 settings path
- **Status (2026-10-03):** Done — `63679a3`. Ran in Obsidian 1.13.7 (settings open in their own window): every setting changed through real UI events, checked in memory + data.json + side effects. Found and fixed one defect: the "Obsidian format skills" row was missing on 1.13+. Final build: 46/46 checks pass (incl. Graphics quality).
- `getSettingDefinitions()` (`SettingsTab.ts:95`) shipped in 0.5.0 without ever running, because Obsidian here was 1.8.4 and only the `display()` fallback executed. This machine now runs **1.13.7**.
- **Test:** open the settings tab and change every setting. Confirm each persists and that side effects survive the `setControlValue()` path (view reload, consent migration).

### AGT-011: verify and fix the missing "Last session" digest (carried over from August, not re-checked)
- **Status (2026-10-03):** Done — `97d1830`. Reproduced on 0.6.0 first (cwd-only ping → no project in snapshot or session log → digest never matched). heartbeat.js now defaults project from cwd on every path and logs cwd; the inspector matches digests by cwd first. Verified live.
- **Reported:** a ping with `--cwd` but no `--project` never surfaced the "Last session" digest, because project-from-cwd defaulting existed only in `heartbeat.js`'s `--hook` path.
- **Next step:** reproduce on 0.6.0 first.

### DOC-002: warn about double-quoted Windows paths (carried over)
- **Status (2026-10-03):** Done (docs) — `f775e9d`. SCHEMA.md, README quick start and the generated AGENTS.md. Optional in-app detection not done.
- A double-quoted Windows `projectDir` (`"C:\Users\..."`) silently breaks the note's *entire* frontmatter, because YAML reads `\U` as an escape.
- **Change:** tell users to single-quote or leave Windows paths unquoted, in `SCHEMA.md` and the README quick start. Optionally detect it: a file starting with `---` whose cached frontmatter is undefined, then show a warning.

---

## P4: product bets (decide first)

### CIN-001: cinematic mode
- **Status (2026-10-03):** Open — product decision (free vs Pro); not implemented.
- **Idea:** HUD hidden, slow dolly or orbit (`OrbitControls.autoRotate` already exists; rotation is disabled for users), and export to MP4/WebM via `canvas.captureStream()` + `MediaRecorder`, saved into the vault like Snapshot.
- **Why:** users would post their cities, which is organic marketing.
- **Decision:** Pro already has a flythrough. Ship it free, or make it the free plugin's upgrade prompt?

### ONB-001: "Create sample city" command
- **Status (2026-10-03):** Open — scope decision; not implemented.
- **Idea:** the whole-vault fallback shows buildings, but not the git, attention and agent features that sell the plugin. One command could write a removable `Hypernovum Sample/` folder of about 12 project notes, plus optional time-boxed simulated agent sessions, so new users see the full product in 10 seconds.
- **Reuse:** the fixture approach in `hypernovum-suite/demo-videos/obsidian-showcase-2026-10/`. Notes only, or small local git repos, is a scope call.

---

## Graphics pass: higher quality, still light enough for Obsidian

The current pipeline (`packages/core/src/scene/SceneManager.ts`):
- three.js r160, `WebGLRenderer({ antialias: true })`, pixel ratio capped at 2 (`:311-312`).
- ACES tone mapping (`:318`) and `FogExp2` over a flat `0x0c0c18` background (`:278-282`).
- PCF soft shadows at 2048 from one directional light, plus ambient, fill and hemisphere lights (`:316-373`).
- `EffectComposer` → `RenderPass` → `UnrealBloomPass(strength 0.8, radius 0.4, threshold 0.7)` → `OutputPass` (`:382-395`).
- Custom building `ShaderMaterial` (`shaders/building.frag`).
- 1 px `LineBasicMaterial` edges, outlines and leader lines.
- `TubeGeometry` arcs (`EdgeManager.ts:66-73`).

The engine lives in core, so every task here also improves Pro.

**Measure first.** Add a debug overlay that shows `renderer.info` (draw calls, triangles), frame ms and the current pixel ratio. Fill in `docs/PERF-BASELINE.md` (S25 / M100 / L250) before and after, so every change below has a number.

### Visual quality: biggest win for the cost first

#### GFX-001: real antialiasing in the post-processing path
- **Status (2026-10-03):** Done — `858c2e1`. 4× MSAA half-float scene target; canvas MSAA off when bloom runs; SMAA fallback on WebGL1. OutputPass stays last (Pro inserts passes before it).
- **Problem:** `antialias: true` only applies to the default framebuffer. With bloom on, the scene renders into the composer's render targets, which have no MSAA, so edges, arcs and towers alias.
- **Note:** the showcase was recorded at 2× device scale, which hid this. At 1× on a normal monitor it's visible.
- **Change:** build the composer on `new THREE.WebGLRenderTarget(w * dpr, h * dpr, { type: THREE.HalfFloatType, samples: 4 })` (WebGL2; Obsidian's Chromium always has it). Fall back to an `SMAAPass` if `samples` isn't supported.
- **Cost:** low.

#### GFX-002: HDR emissive and selective bloom
- **Status (2026-10-03):** Done — `6eec79f`. Threshold 1.0; windows ×1.3 (1.7 tuned down by eye), orbs/gems/beacons/rings ×2 when bloom runs.
- **Problem:** whole-scene bloom at threshold 0.7 washes out building shading. This was first flagged in `docs/PARAMETRIC-BUILDINGS-REVIEW-2026-08-03.md`: the new lighting barely reads at default bloom.
- **Change:** drive true emitters (windows, orbs, neural core, arteries, quest gems) above 1.0 in the half-float buffer and raise the bloom threshold to about 1.0. Only light sources glow, and facades keep their shading.
- **Cost:** nearly free.
- **Later option:** layer-based selective bloom if the threshold approach isn't clean enough.

#### GFX-003: tone mapping A/B test
- **Status (2026-10-03):** Done — `348de6b`. A/B ACES vs AgX (1.0, 1.35); kept ACES. Screenshots: `demo-videos/obsidian-showcase-2026-10/work/shots/next-pass/gfx003-ab/`. Flippable via optional settings `toneMapping` / `toneMappingExposure`. Neutral needs three r162+ (not upgraded).
- **Problem:** ACES shifts and desaturates saturated neon: cyan drifts, and red runs toward orange.
- **Change:** compare ACES, AgX (available in r160) and Neutral (needs r162+) in screenshots of the same scene, and tune `toneMappingExposure`.
- **Caution:** Blender's AgX made neon pastel in the 4D Polytope Engine work. That's a different implementation, but test before switching.
- **Cost:** trivial.

#### GFX-004: antialiased wide lines
- **Status (2026-10-03):** Partial — `c296803`. Building edges (LineSegments2, 1.5 px) and district outlines/leaders/brackets (Line2, 2 px). Not merged into one draw call per rebuild (per-building state; see GFX-010). Foundation wireframes and core cages stay 1 px.
- **Problem:** `LineBasicMaterial({ linewidth: 2 })` (`SceneManager.ts:719`) is ignored by WebGL, so every line is 1 px. That covers building edges, district outlines, leader lines and the neural-core wireframe. They shimmer and vanish at distance.
- **Change:** use `LineSegments2` + `LineMaterial` (three/examples/jsm/lines) with pixel widths and `alphaToCoverage`. Merge all building edges into one `LineSegments2` per rebuild, so it costs one draw call.
- **Cost:** medium.

#### GFX-005: building shading
- **Status (2026-10-03):** Done — `897d897`. Lighting + true fresnel on both styles, per-floor window hash, status-tinted windows, parapet band. Reflections use an analytic environment instead of PMREM RoomEnvironment (ShaderMaterial can't sample PMREM without three's private defines; grey studio washed neon) at strength 0.5.
- **Problem:** the parametric path gained view-space normals, key/hemisphere lighting and fresnel (gated on `uFloors > 0.5`), but the classic path still only has rim lighting.
- **Changes:**
  1. Bring the lighting and fresnel to both paths.
  2. Add cheap reflections: generate one PMREM `RoomEnvironment` texture at init (Pro already does) and sample it in the shader once, with no extra pass.
  3. Per-floor hash for lit and unlit windows, plus a status-tinted window color.
  4. A parapet or roof-edge highlight.
- **Constraint:** keep the fragment shader loop-free.

#### GFX-006: ground and atmosphere
- **Status (2026-10-03):** Done except height fog — `5a884e8`, `43894e6`. fwidth grid plane, horizon-glow background + matching fog, vignette before OutputPass, instanced contact shadows (made in addGround, so Pro gets none). Height fog skipped (needs global fog-chunk patching).
- **Changes:**
  - Make the grid shader use `fwidth()` antialiased lines with distance fade. The far grid moirés at the shallow default angle.
  - Replace the flat background with a horizon-glow gradient and height fog.
  - Add a subtle vignette in a small final pass.
  - Use contact-shadow decals (radial-gradient quads under each building) instead of relying on the shadow map; they read better on a dark neon ground.
- **Cost:** low.

### Performance: keep it usable in an always-open notes app

#### GFX-007: stop re-rendering static shadows
- **Status (2026-10-03):** Done — `a5211a6`. Static shadow map + fitted shadow camera; `invalidateShadows()` for hosts (Pro: call it after moving casters).
- **Problem:** the city doesn't move, but the 2048 PCF shadow map is redrawn every frame.
- **Change:** set `renderer.shadowMap.autoUpdate = false`, with `needsUpdate = true` on rebuild, layout drag/save and building-move. Fit the shadow camera tightly to the city bounds so shadows also get sharper.
- **Cost:** an easy, large GPU saving.

#### GFX-008: idle and background frame pacing
- **Status (2026-10-03):** Done — `4eb3cb4`. Full rate while interacting, ~30 fps after 5 s idle (measured 29 fps), ~5 fps unfocused.
- **Today:** an IntersectionObserver already pauses hidden views.
- **Add:**
  - Drop to about 30 fps after 5 s without input.
  - Render at about 5 fps, enough for orbs and pulses, when Obsidian is unfocused (`blur` / `visibilitychange`).
  - Resume full rate on input.
- **Why:** Obsidian stays open all day, so this matters most for laptop battery and fans.

#### GFX-009: quality tiers plus adaptive resolution
- **Status (2026-10-03):** Done — `065bd9d`. Setting defaults to Auto (→ High on the RTX 5070 Ti); Low bypasses the composer, no shadows/wide lines/reflections, pixel ratio 1. Adaptive pixel ratio while moving on slow frames. Hosts without the setting (Pro) keep the pre-tier config.
- **Setting:** Graphics quality = Auto / Low / Balanced / High / Ultra.

  | Tier | Pixel-ratio cap | MSAA samples | Bloom | Shadows | Wide lines and reflections |
  |---|---|---|---|---|---|
  | Low | 1 | 0 | off | off | off |
  | Balanced | 1.25 | 2 | half resolution | static only | on |
  | High | 1.5 | 4 | full resolution | static only | on |
  | Ultra | 2 | 4 | full resolution | static, 4096 | on |

- **Auto:** a 2 s median-frame-time check on first open picks the tier.
- **Adaptive:** lower the pixel ratio while the camera moves or frames exceed about 20 ms, and restore it when idle.

#### GFX-010: draw-call budget at scale
- **Status (2026-10-03):** Partial — `4c1b784`. Arcs: one merged mesh per edge type (26 edges + agent arcs = 5 draws in the demo). Not done: instancing foundations/classic shapes and merged building edges — they change the per-building contract HighlightManager, filters, moves and Pro's island lift rely on.
- **Problem:** each building is about six objects (mesh, edges, foundation, foundation wireframe, roof details, label), plus one tube per arc. L250 lands well past 1,500 draw calls.
- **Change, after measuring:** use `InstancedMesh` (or r160's `BatchedMesh`) for classic shapes and foundations, merged edge lines (GFX-004), and one merged tube mesh per arc type. Keep raycasting on proxy boxes.

#### GFX-011: shader warm-up
- **Status (2026-10-03):** Done — `9b4d1c1`. `compileAsync` after every build.
- Call `renderer.compileAsync(scene, camera)` after each rebuild, so new materials don't stall the first frames. This pairs with the `KHR_parallel_shader_compile` fix from 0.4.4.

**Not now:** three's WebGPU renderer. Its availability and stability inside Obsidian's Electron isn't something to depend on yet.

**Suggested order:**
1. GFX-007, GFX-001, GFX-002, GFX-003 (a day or two, big visible gain).
2. GFX-004 and GFX-006.
3. GFX-005.
4. GFX-009, GFX-008, GFX-010, measured against the baseline.

Re-film the showcase harness (below) after each step for a before/after comparison.

---

## How to verify (re-usable harness)

`hypernovum-suite/demo-videos/obsidian-showcase-2026-10/` contains:

| Script | What it does |
|---|---|
| `prepare.mjs` | Fresh copy of the demo vault plus an isolated Obsidian 1.13.7 profile. Installs `plugin-0.6.0/`; swap in a dev build's `main.js` / `styles.css` / `manifest.json` to test it. |
| `make-repos.mjs` | Fictional git history dated relative to now, including a merge conflict and a dirty tree. |
| `sessions.mjs` | Live heartbeat loop: two agents on one file, plus testing, reading, waiting and blocked sessions. |
| `probe.mjs` | Launch, run JS, and screenshot over CDP. |

`demo-agent preflight tutorial.json` re-walks the whole feature tour and saves screenshots, which makes a before/after visual check for CAM-001, HUD-001, LAY-001, VIS-001 and LBL-001.

Release-flow reminders, from the 0.4.x–0.6.0 releases:
- `rm -rf packages/core/dist && npm test` reproduces CI.
- Run `npm run lint` before tagging.
- `node scripts/check-versions.mjs --fix`, then tag bare (no `v`).
- Core is a published npm package, so removing exports is a semver event (see `docs/DEAD-CODE.md`).
