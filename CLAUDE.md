# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A Claude Code plugin marketplace (`.claude-plugin/marketplace.json`) containing one plugin,
`plugins/safe-travels`. The plugin has no application code in the usual sense: it is agent and
skill prompts (Markdown), plus a handful of Node scripts those skills call. `docs/` is the GitHub
Pages site: `docs/index.html` (a map of sample guides, driven by its `#guides-data` JSON block),
`docs/samples/*.html` (finished guides the plugin produced), and `docs/assets/` (README thumbnails,
install screenshots).

There is no build, lint, or test suite. Node is the only runtime requirement.

## Commands

Load the plugin from this checkout instead of the marketplace, then run it:

```
claude --plugin-dir plugins/safe-travels
/safe-travels:create-guide <describe the trip>
```

Guide output lands in the current directory as `<destination-slug>/guide.html`, with research in
`<destination-slug>/research/`.

The composing steps, run from a run folder, in this order (`$S` is
`plugins/safe-travels/skills/travel-guide-html/scripts`):

```
node $S/collect-items.mjs research/                              # merge research/*.items.json → research/items.json, print the item index
node $S/inject-items.mjs guide.html --items research/items.json  # expand guide-data "placements" into full items
node $S/validate-guide.mjs guide.html                            # exits 1 on errors; HEAD-requests every image, needs network
node $S/inject-attribution.mjs guide.html --dir research/ [--no-wikimedia]
```

Run a data script directly, e.g. the page scraper the researchers depend on:

```
node plugins/safe-travels/skills/extract-page-media/scripts/extract-images.mjs "<url>" [--json] [--attribution <dir>]
```

Scripts install their own dependencies into their `scripts/` folder on first run (`npm install`;
`extract-page-media` and `hotels` also download Playwright's Chromium). `node_modules/` is gitignored.
The validator's first run rewrites the tracked `travel-guide-html/scripts/package.json` and
`package-lock.json`; restore them with `git checkout` if you only meant to run it.

## How a guide gets built

1. **`skills/create-guide`** (the only user-facing command). Reads the request, plays it back,
   waits for confirmation, runs `mkdir -p <destination-slug>/`, and hands the user's own words to
   the `travel-guide` agent. It must not add places, dishes, or examples of its own. It forwards
   mid-build additions and resumes a stopped build with SendMessage.
2. **`agents/travel-guide.md`** (orchestrator, `model: opus`, `experimental.cacheTtl: 1h` so its cache
   survives waiting on researchers). Decides single-hub vs route vs seasonal guide and sends
   researchers in rounds of at most 4 (`<research_budget>`, rarely more than ~12 in total). Skips
   research that is already marked complete (`<resuming>`). Only after research returns does it load
   the `travel-guide-html` skill, then collect, compose, inject items, validate, and inject
   attribution. It never researches itself and never opens the guide in a browser.
3. **Researcher agents** (`destination-`, `food-`, `photography-`, `stay-researcher`, all
   `model: sonnet`, `maxTurns: 40`). Each writes `research/{place}-{category}.md` (or
   `{place}-{season}-{category}.md`) as it goes, then `{same stem}.items.json`, then ends the markdown
   with `<!-- research complete -->`. They pass `--attribution research/` to every data script so image
   credits land as `research/attribution-*.json`.

Two files per researcher form the contract between agents. The `.items.json` schema (in each
researcher's `<items_file>` block) feeds `collect-items.mjs` and, through it, the page. The markdown
carries the narrative the orchestrator writes from. A change to either format needs a matching
check of `travel-guide.md`, the `travel-guide-html` skill, and `collect-items.mjs`.

## The guide.html contract

`skills/travel-guide-html/scaffolds/data-driven-guide.html` is the canonical implementation, and
`validate-guide.mjs` enforces it. The pieces that must stay in sync:

- One `<script type="application/json" id="guide-data">`. The composer writes `placements`
  (`{id: {section | content, feature, season, overrides}}`, ids from the collect index) and
  `inject-items.mjs` expands them into `items[]` (`id`, `category`, `section`, `feature`, `name`,
  `blurb`, `description`, `sources[]`, `lat`/`lng`, `images[]`). Hand-written items can sit beside
  them. Optional `route`/`branches` (`[lng,lat]` pairs) and seasonal `heroes` complete the block.
  The validator fails a guide whose placements were never injected.
- Exactly one `<script type="module">`. It renders cards into `.cards[data-section]` mounts, builds
  map pins from the same `items`, and runs the lightbox and carousel.
- Items shown outside a card grid carry their `id` as `data-id` instead of a `section`. An item with
  both, or neither, is a validator error.
- An empty `<script type="application/json" id="attribution-data">{}</script>`, filled later by
  `inject-attribution.mjs` and read by the lightbox.
- Map: MapLibre GL from unpkg with keyless OpenFreeMap styles. A `.map-container` wrapper around
  `#map` drives the split view.

A change to this contract touches the scaffold, `travel-guide-html/SKILL.md`, the validator, and
often a `references/*.md` module. Commit 697fe6d (the Leaflet/CARTO to MapLibre/OpenFreeMap switch)
also updated every file in `docs/samples/` and `docs/index.html` to match.

Image URLs are joined by exact string in three places: `inject-items.mjs` (an image override must be
one of the item's own URLs), the validator's duplicate-image check, and the attribution merge. That is
why every prompt insists URLs are copied verbatim from script output.

## Editing the prompts

- `<enrichment>`, `<source_trust>`, `<items_file>` and `<saving>` are byte-identical across all four
  researcher agents. Edit all four together, then confirm they still match:
  `for f in plugins/safe-travels/agents/*-researcher.md; do sed -n '/^<saving>/,/^<\/saving>/p' "$f" | md5sum; done`
- Researchers may take coordinates and images only from script output (`extract-page-media`,
  `eater`, `infatuation`, `hotels`), never from model memory. Geocoding is the orchestrator's job
  alone; resolved coordinates go into placements.
- Skills declare `allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/*)`. Script calls must match
  that pattern plainly; added redirection or `; echo $?` breaks auto-approval.
- An agent's `tools:` list doesn't restrict Bash to a command pattern such as `Bash(mkdir *)`; the
  researchers run node scripts and curl regardless. Limits on behaviour have to be written into the
  prompt or enforced with `maxTurns`.
- `eater`, `geocoding`, `hotels`, and `infatuation` have `description: Disabled` in their
  frontmatter, yet agents still preload them through `skills:` lists and their prompts still call
  them. Don't change either side without knowing which behaviour is intended.
- `travel-guide-html/references/*.md` are optional modules. SKILL.md's "Module library" table tells
  the orchestrator when to read each one, so a new module needs a row there.

## License

CC BY-NC-SA 4.0 (`LICENSE.md`, `plugin.json`).
