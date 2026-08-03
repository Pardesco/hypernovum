# Hypernovum community-listing audit — 2026-08-03

Scope: fresh screenshots for the Obsidian community listing + an audit of the description
copy. Plugin state audited: **0.4.1**, master in sync with `origin/master`, release `0.4.1`
published, live in `community-plugins.json`.

---

## 1. What the "listing" actually is

Two separate surfaces, fed from two places:

| Surface | Source | Current value |
|---|---|---|
| Browse list blurb | `manifest.json` `description` at **HEAD of the default branch** | "Visualize your vault as a 3D city, launch AI coding agents with full context, and track Git activity live." |
| Plugin detail page | **README.md** rendered in-app | see §3 |

The directory appends its own suffix to auto-approved plugins, so what users read today is:

> Visualize your vault as a 3D city, launch AI coding agents with full context, and track
> Git activity live. **- This plugin has not been manually reviewed by Obsidian staff.**

That suffix is added by the directory, not by anything in the repo.

---

## 2. Manifest description — verdict: **keep as is**

Checked against Obsidian's published submission requirements:

| Rule | Status |
|---|---|
| ≤ 250 characters | ✅ 106 |
| Ends with a period | ✅ |
| No emoji / special characters | ✅ |
| Doesn't contain the word "Obsidian" | ✅ |
| Starts with an action statement, not "This is a plugin" | ✅ "Visualize your vault…" |
| Correct capitalization of proper nouns ("Git") | ✅ |
| Root manifest and plugin manifest agree | ✅ both 0.4.1, identical description |
| `versions.json` maps 0.4.1 → minAppVersion | ✅ 1.6.0 |
| `fundingUrl` absent (Sponsors never configured) | ✅ |

**One substantive concern, and it is the biggest one in this document.**

"Visualize your vault as a 3D city" is a promise the plugin does not keep on first run. It
renders **project notes**, not the vault — a new install with no `tags: [project]` notes
shows an empty city. This is the known F1 gap, and it is the single most likely source of
"installed it, nothing happened" churn now that the plugin is discoverable by strangers
rather than by people you sent to the repo.

Two ways out, in order of preference:

1. **Ship whole-vault rendering** (folders = districts, notes = buildings) and the
   description becomes true. This is the fix; the description is only the symptom.
2. **Reword to match reality** — e.g. *"Render your projects as a 3D city, launch AI coding
   agents with full context, and track Git activity live."* Costs you the word "vault"
   (which is what makes the blurb feel native in the browse list), so only worth doing if
   option 1 is far off.

I did not change the description — it is compliant, it already passed review, and changing
it should be a deliberate positioning call, not a side effect of a screenshot pass. The
README now carries a **Quick start** that closes the gap for anyone who reaches the detail
page (see §3).

---

## 3. README changes made

The detail page is the README, and it was the stale surface. Changes applied:

**Removed / corrected**

- The only plugin screenshot (`site/assets/obsidian-app.png`) was from **February 2026** —
  before the entire 0.4 overhaul. Every feature added in Phases 1–7 was invisible in it.
  Replaced (§4).
- **"Funding metadata is included for users who want to support the free plugin"** — this
  was false. `fundingUrl` was removed from the manifest pre-submission because
  `github.com/sponsors/pardesco` doesn't exist. Deleted.
- `### Claude Code Integration` → `### Agent integration`. The heading was narrower than
  the feature (Codex and Antigravity CLI are first-class), and it read as an endorsement.
- Headings normalized to sentence case, per Obsidian's style guide.
- Marketing jargon in the H1 and lead removed ("Agent Ops for Your Second Brain", "3D IDE
  and agent-ops dashboard", "living cyberpunk code city"). The opening was a 90-word
  sentence stacking six claims before saying what the thing does.

**Added**

- **Install** section — the README had none. It predates being in the directory and still
  read like a repo you clone.
- **Quick start** with the minimum frontmatter block and one blunt sentence: *"Hypernovum
  renders project notes, not every note in your vault, so a brand-new install shows an
  empty city until at least one note is tagged."* This is the fix for the empty-city
  first-run failure at the documentation level.
- Called out that `projectDir` is the field that actually matters.
- Frontmatter section rewritten so it complements the quick start instead of repeating it,
  now showing `depends_on` / `blocked_by` / `tasks` which weren't demonstrated anywhere.

**Image URLs**

All README images (including the two Pro ones) now use absolute
`raw.githubusercontent.com/pardesco/hypernovum/master/...` URLs rather than repo-relative
paths. Relative paths render on GitHub but are not reliable in Obsidian's in-app README
view; absolute raw URLs work in both. **They 404 until master is pushed** — see §6.

---

## 4. New screenshots

Captured on a purpose-built public-safe vault, at 1920×1080, plugin 0.4.1, shaders + bloom
+ atmosphere on. Written to `docs/screenshots/`:

| File | Shows |
|---|---|
| `city.png` | Hero — 27 projects, 7 districts, backlink arcs, city overview panel |
| `inspector.png` | Project inspector: Git signals, recent commits, open quest board |
| `agent-fleet.png` | 4 live agent sessions, STREAMING overlay, conflict ring + "GPT Codex and Claude Code both touched src/exec/fills.rs" |
| `needs-attention.png` | Triage lens — blocked project lit red, city dimmed, "Blocked by Mesh Gateway" |
| `git-activity.png` | Git activity lens with its adaptive legend |

**Nothing real is in frame.** Two things were deliberately faked out:

- The demo vault uses 27 fictional projects (`atlas-web`, `quant-engine`, …) with real git
  history and staggered commit dates, so the Git layer shows genuine signal.
- The **ABILITIES roster reads `~/.claude/skills/`**, so a naive screenshot would have
  published your real skill names — including the private `polytope-ascii-reveal`. Obsidian
  was launched with `USERPROFILE`/`HOME` pointed at a scratch home containing five invented
  skills. **Worth remembering for any future capture.**

One cosmetic leak remains: the inspector prints the absolute `projectDir`, so
`C:\Users\Randall\Documents\hypernovum-suite\demo-vault\quant-engine` is legible in two
shots. Your name is already the manifest author, so this is harmless — but if you want it
gone, move the demo repos to something like `C:\dev\` and re-run the capture.

### Reproducing the capture

Playwright's `_electron.launch` does **not** work on Obsidian (node-CLI-inspect fuse is
disabled). What works: launch `Obsidian.exe` with `--user-data-dir=<scratch profile>` and
`--remote-debugging-port`, write an `obsidian.json` into that profile pointing at the vault
with `open: true`, then `chromium.connectOverCDP`. Viewport is set with
`Emulation.setDeviceMetricsOverride`, not by resizing the window. Scripts are in the session
scratchpad; the demo vault is generated at
`Documents\hypernovum-suite\demo-obsidian-vault` and can be regenerated from scratch.

---

## 5. Bug found while capturing

**City overview never shows the fleet summary.** Reproduced twice on 0.4.1.

With live agent sessions on disk (`.hypernovum/agents/*.json`), everything else picks the
fleet up correctly — orbs render, the artery streams, the ⚠ badge counts agent warnings,
and the *per-project* inspector shows both the Agents section and the conflict row. But the
**city overview panel** (nothing selected) renders zero `.fleet-summary` elements and its
Attention list omits every agent-derived warning, even after a session changes state.

- The render code exists and looks right: `views/HypernovumView.ts:2506` (`// Fleet summary
  (AGT-009)`), guarded by `if (sessions.length > 0)`.
- The signature gate also looks right: `inspectorSignatureFor` includes `feedKey` from
  `this.fleetSessions` (`views/HypernovumView.ts:2187`), so a fleet change *should*
  invalidate the overview render.
- So `this.fleetSessions` is empty at overview-render time while being populated everywhere
  else — smells like a render-ordering problem between `onFleetUpdate` and the overview
  path rather than a missing feature.

I did **not** root-cause or fix this — flagging it as a 0.4.2 candidate. It's cosmetic (no
data loss), but it's the one place a user is meant to see "3 active · 1 waiting · 1
conflict" at a glance, and it's a claim the README makes.

Not a bug (checked and cleared): switching scan lenses back to Status re-applies status
colors correctly, and the Needs Attention lens does dim unwarned buildings — the effect is
just subtle at full-city zoom.

---

## 6. Open items for you

1. **Push master.** The new README image URLs 404 until `docs/screenshots/` is on
   `origin/master`. Nothing is committed yet — the working tree has the README edits and
   the five PNGs.
2. **Decide the description question in §2** — ship whole-vault rendering, or reword.
3. **The Pro section still loads a 10 MB GIF** (`hypernovum-pro.gif`) inside the in-app
   plugin page. Left alone because it's your marketing call, but every person who opens the
   detail page downloads it.
4. `docs/PERF-BASELINE.md` is still an unfilled template — unrelated to the listing, still
   owed.
