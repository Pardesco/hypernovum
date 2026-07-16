# Hypernovum 0.4 — Release Notes

The 3D-IDE overhaul: the city becomes a real operations surface. Open it and know
within five seconds what needs attention, what each agent is doing, how projects
are connected, and where to intervene.

## ⚠️ Behavior change — read this first

**Single-clicking a building no longer opens its note.** Click now **selects and
focuses** the building (the city dims around it, connected neighbors stay lit, the
camera stays put). **Double-click opens the note.** Move mode moved to the
right-click menu ("Move building"). **Esc** or a click on empty ground clears the
selection.

A one-time notice appears on first open after updating. There is intentionally no
"legacy click" setting — maintaining two interaction models is worse than the
one-time relearn.

## What's new

- **Multi-agent fleet.** Each agent session (heartbeat v2) shows as a named,
  state-colored orb with an identity tooltip. Concurrent agents never clobber each
  other. Two agents touching the same file surface a **conflict** (red ring +
  inspector row). New inspector **Agents** section.
- **Needs-Attention triage.** A ⚠ badge and a dedicated lens color the city by
  warning severity (merge conflicts, blocked, failed/waiting agents, dirty/behind
  repos, stale). Every warning row is one click from its fix. "City is healthy"
  when there's nothing to do.
- **Typed project graph.** Backlinks, `depends-on` (from `package.json` +
  `depends_on`), `blocked-by` (from `blocked_by`), and agent edges — toggled by the
  **EDGES** chips, with direction arrowheads, inspector dependency sections, and a
  right-click **Trace impact** mode.
- **Session intelligence.** Per-session JSONL logs feed a "Last session: name ·
  duration · N files · M commits" digest, plus optional plan-vs-action.
- **Parametric buildings (beta, opt-in).** Data-true towers whose window rows equal
  their floor count. Settings → Building style → Parametric.
- **Quality of life.** Recent commits + upstream drift, recent-activity feed, saved
  lens presets, Open Terminal / Copy Path / Add Quest actions, debounced search,
  `maxBuildings` cap, working `enableShadows`, label-distance culling, hover
  neighborhoods.

Also: classic non-shader buildings now use the brighter shader status palette
(slightly brighter greens/reds).

## Rollback map — every new thing is reversible

| Feature | How to turn it off |
|---------|--------------------|
| Parametric buildings | Settings → **Building style → Classic** (the default) |
| Typed edges | Turn off the **EDGES** chips (all off = quiet city) |
| Needs-Attention lens | Just don't select it; the ⚠ badge is passive |
| Heartbeat v2 | Legacy `.hypernovum-status.json` is still read — old hooks keep working as an anonymous agent |
| Shadows | Settings → **enableShadows** (now actually works) |
| Interaction model | No toggle by design — see the note above |

## Compatibility

- **Saved layouts, frontmatter, classic silhouettes** are unchanged. New frontmatter
  (`blocked_by`, `depends_on`, `no_deps`) is additive.
- **Settings** from any prior version load cleanly (new keys get defaults).
- **Legacy heartbeat** single-file format is still read this release; see the
  deprecation schedule in `CHANGELOG.md` (removal targeted for 0.5).
