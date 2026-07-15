# Hypernovum Manual QA Checklist

Run in Obsidian against a vault with ≥10 project notes across ≥3 categories, at least one project per
status (active/blocked/paused/complete), one with `projectDir` pointing at a real git repo, one with
open `questions:`, and backlinks between at least two projects. Reference screenshots: `docs/qa-baseline/`
(capture via the Snapshot button per lens).

## Interaction (0.4 behavior — feat/interaction-foundation)

- [ ] Hover building: tooltip + leader line appear; building brightens steadily (no pulse); foundation
      brightens; moving hover A→B leaves A fully restored.
- [ ] Hover foundation plinth: same tooltip; foundation + building hover treatment.
- [ ] **Single-click building: selects — does NOT open the note.** Building gets bright edge glow +
      slight scale-up; all unrelated buildings, foundations, edge glows, and labels dim; inspector fills;
      camera does not move.
- [ ] With NEURAL LINKS on: backlink neighbors of the selection stay undimmed and keep labels.
- [ ] **Double-click building: opens the note (exactly one leaf); selection + dim state persist** when
      you return to the city.
- [ ] Click empty ground: selection clears, every visual restores (compare against baseline screenshot).
- [ ] Escape: clears selection (canvas must have focus — click the city first).
- [ ] Right-click building → menu shows: Launch agent · Inspect project · **Move building** · Open folder ·
      Open note · Focus camera.
- [ ] Move building (context menu): drag repositions with grid snap; indicator shows; Esc exits; clicking
      elsewhere exits; cursor states correct throughout; building glows max while in move mode.
- [ ] Double-click NO LONGER enters move mode.
- [ ] Block drag handle: drag whole category; on release, the click does NOT select/deselect anything.
- [ ] Save Layout: persists; reload view restores block offsets.
- [ ] Inspector ✕: clears selection and dim state (identical to Esc).
- [ ] Keyboard B / S: cycles blocked/stale projects — selection + inspector + camera follow.
- [ ] Space: camera reset; selection cleared.
- [ ] One-time notice "Click selects · Double-click opens" appears on first view open only.

## Lenses & filters

- [ ] All six layers render with matching adaptive legend (Status/Git/Memory/Tasks/Recency/Stack).
- [ ] Lens colors coexist with selection dimming (select while in Tasks lens: lens colors persist,
      unrelated dim).
- [ ] Search + three filter dropdowns narrow the city; "no matches" empty state; Clear filters restores.
- [ ] Selecting a building then filtering it out clears the selection.
- [ ] NEURAL LINKS toggle: violet arcs appear/disappear; arcs pulse gently.

## Status & weather visuals (parity with pre-0.4 baseline)

- [ ] Blocked project: red, pulsing edge glow, glitch shader (if shaders on).
- [ ] Active project with recent commits (git lens): warm/hot glow scaling with churn.
- [ ] Repo with merge in progress: intense glitch + red emissive (pierces dim when something else selected).
- [ ] Stale repo (30d+): dimmed/decayed appearance.
- [ ] Critical-priority building: red roof beacon blinking.
- [ ] Quest gem floats/bobs over questioned projects; resolving a quest fires the emerald shockwave.
- [ ] NOTE (intentional 0.4 change): non-shader buildings use the brighter shader palette now
      (active is brighter green than pre-0.4 baseline).

## Agents

- [ ] Right-click building → Launch agent: terminal opens in project dir; building flashes; SETUP.md
      written under `.hypernovum/`.
- [ ] Heartbeat activity: activity indicator appears; artery streams to the building; Neural Core state
      shifts; agent orb orbits the building.
      Orbs only render while pings are fresher than 10s — simulate one from the vault root (PowerShell,
      replace the project name with a real building title):
      `while($true){ node scripts\heartbeat.js --vault="$PWD" --project="Sample Project" --action="editing"; Start-Sleep 5 }`
      Ctrl+C to stop; the orb disappears ~10s later.
- [ ] Agent switcher panel lists installed agents; Prepare vault writes AGENTS.md.

## Vault mode

Enter via command palette → "Toggle vault mode" (reloads the view), or Settings → Hypernovum →
"Enable vault mode".

- [ ] Agent UI absent; right-click background → Create New Project works; click-focus model still applies.

## Housekeeping

- [ ] No console output during normal operation (set `localStorage.hypernovumDebug = '1'` to see debug logs).
- [ ] Snapshot button saves a titled PNG into the vault.
- [ ] Settings round-trip: toggle each setting, reload view, verify persistence.
