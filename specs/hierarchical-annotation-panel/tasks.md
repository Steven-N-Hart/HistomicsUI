# Tasks: Hierarchical Annotation Panel

**Input**: Design documents from `specs/hierarchical-annotation-panel/`  
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Wire up specify context and verify the feature branch builds cleanly.

- [x] T001 Confirm the HistomicsUI dev environment builds: `docker compose exec girder bash -lc 'rebuild_and_restart_girder.sh'` (smoke test existing build before changes)
- [x] T002 Update `.specify/feature.json` to `specs/hierarchical-annotation-panel` (already done — verify)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core data-model logic and backward-compatible YAML schema extension. Must be complete before any UI work.

- [x] T003 Add `_buildGroupTree()` method to `histomicsui/web_client/panels/AnnotationSelector.js` — reads `_folderConfig.annotationGroups.groups`, counts elements per group, builds recursive tree with `{id, label, fillColor, lineColor, parent, count, annotations, children, depth}`, returns `null` (flat-list fallback) when no `parent` fields exist
- [x] T004 Add `_activeGroup` state and `_setActiveGroup(groupId)` method to `histomicsui/web_client/panels/AnnotationSelector.js` — fires `this.trigger('h:setDefaultGroup', groupId)`
- [x] T005 Add `'click .h-class-name': '_handleClassClick'` event and `_handleClassClick()` handler to `histomicsui/web_client/panels/AnnotationSelector.js` — extracts `data-group-id` and calls `_setActiveGroup()`
- [x] T006 Default `_activeGroup` from `this.parentView._defaultGroup` on first render in `histomicsui/web_client/panels/AnnotationSelector.js`
- [x] T007 [P] Pass `groupTree` and `activeGroup` into the template call in `AnnotationSelector.render()` alongside existing `annotationGroups`

**Checkpoint**: `_buildGroupTree()` can be unit-tested in the browser console against a mock `_folderConfig`

---

## Phase 3: User Story 1 — Define a Class Taxonomy (Priority: P1) 🎯 MVP

**Goal**: Researcher can define a class hierarchy in `.histomicsui_config.yaml` and see it rendered as a tree in the annotation panel.

**Independent Test**: Add `annotationGroups.groups` with `parent` fields to a folder's YAML config; open a slide in that folder; confirm the panel shows a tree, not a flat list.

### Implementation for User Story 1

- [x] T008 [US1] Add recursive `+classNode` mixin to `histomicsui/web_client/templates/panels/annotationSelector.pug` — renders indent, color swatch, class name, count badge, and tree expand toggle; uses `data-group-id` attribute
- [x] T009 [US1] Replace flat `each groupName in groups` loop in `annotationSelector.pug` with conditional: `if groupTree` renders tree via `+classNode`, `else` renders existing flat loop unchanged
- [x] T010 [US1] Add tree node CSS to `histomicsui/web_client/stylesheets/panels/annotationSelector.styl`: `.h-class-node`, `.h-class-header`, `.h-class-swatch` (12×12 inline box), `.h-class-count` badge, `.h-class-tree-toggle`, `.h-class-tree-toggle-placeholder`
- [x] T011 [US1] Add `.h-active-class` CSS rule (left border accent + light background) to `annotationSelector.styl`
- [x] T012 [US1] Handle tree node expand/collapse: wire `'click .h-class-tree-toggle': '_toggleTreeNode'` in `AnnotationSelector.events`, add `_toggleTreeNode()` using `'tree:' + groupId` key in `_expandedGroups` Set
- [x] T013 [US1] Add `h:setDefaultGroup` listener in `histomicsui/web_client/views/body/ImageView.js` (around line 122) that sets `this._defaultGroup` and `this.drawWidget._defaultGroup`

**Checkpoint**: Open slide with hierarchy YAML → panel shows tree; open slide without hierarchy YAML → flat list unchanged

---

## Phase 4: User Story 2 — Draw Annotations Assigned to a Class (Priority: P1)

**Goal**: Clicking a class in the tree sets it as the active drawing class; new elements are automatically assigned to that class.

**Independent Test**: Set active class to "Tumor", draw a polygon, open element editor — confirm `group === 'tumor'`.

### Implementation for User Story 2

- [x] T014 [US2] Highlight active class in panel: `h-active-class` CSS class applied to the `.h-class-node` whose `data-group-id === activeGroup` (already wired via template in T008 — verify it renders correctly)
- [x] T015 [US2] Wire `h:setDefaultGroup` in `ImageView.js` to also re-render `DrawWidget` so its current group indicator updates (check if DrawWidget renders group name anywhere)
- [x] T016 [US2] Verify `DrawWidget._defaultGroup` assignment propagates to new elements: trace `_defaultGroup` usage from `DrawWidget` init through `_createAnnotationElement` — add `histomicsui/web_client/panels/DrawWidget.js` change if needed to read `parentView._defaultGroup` on element creation

**Checkpoint**: Click "Stroma" in tree → draw a brush element → element `group` field reads `"stroma"`

---

## Phase 5: User Story 3 — View Element Counts and Colors per Class (Priority: P2)

**Goal**: Panel shows element counts (direct + descendant) and color swatches per class.

**Independent Test**: Load slide with 10 "Invasive" elements (child of Tumor, child of Tissue). Confirm: Invasive badge = 10, Tumor badge ≥ 10, Tissue badge ≥ 10.

### Implementation for User Story 3

- [x] T017 [US3] Verify `_buildGroupTree()` rolls up descendant counts to parent nodes (already in T003 implementation — write and run a manual browser test to confirm)
- [x] T018 [US3] Verify color swatch renders using `fillColor` and `lineColor` from each node (already in T010 — confirm visually in browser)
- [x] T019 [US3] Style `.h-count-zero` dimming so classes with 0 elements are visually de-emphasized

**Checkpoint**: Multi-level hierarchy with annotated elements → counts visible, correct, and roll up to parents

---

## Phase 6: User Story 4 — Expand/Collapse Class Nodes (Priority: P2)

**Goal**: Tree nodes with children can be collapsed/expanded; state persists across re-renders.

**Independent Test**: 3-level hierarchy; collapse root; children hidden. Expand. Children visible. Save an annotation; confirm expand state unchanged.

### Implementation for User Story 4

- [x] T020 [US4] Verify `_toggleTreeNode()` from T012 stores state in `_expandedGroups` with `'tree:'` prefix and that `_debounceRender()` preserves it across re-renders (the Set persists on the view instance)
- [x] T021 [US4] Default tree nodes to expanded state on first load (initialize `'tree:' + id` entries in `_expandedGroups` for all nodes that have children, in `setItem()` when hierarchy is first loaded)

**Checkpoint**: Collapse/expand a tree node; save an annotation; confirm state preserved

---

## Phase 7: User Story 5 — Edit Classes via In-App Dialog (Priority: P2)

**Goal**: Write-access users can add/rename/delete/reparent/recolor classes from within the UI.

**Independent Test**: Click "Edit Classes", add "DCIS" as child of "Tumor", save. Panel shows "DCIS" under "Tumor" without page reload.

### Implementation for User Story 5

- [x] T022 [P] [US5] Create `histomicsui/web_client/dialogs/editTaxonomy.js`: Backbone view that fetches the current config YAML, renders editable class rows (name, color picker, parent selector, delete button), validates for circular references, and saves via `PUT folder/{folderId}/yaml_config/.histomicsui_config.yaml`; on success calls `this.parentView.parentView._getConfig(itemId)`
- [x] T023 [P] [US5] Create `histomicsui/web_client/templates/dialogs/editTaxonomy.pug`: Bootstrap modal with class table (Name | Color | Parent | Delete), "Add class" button, error message area, Save/Cancel buttons
- [x] T024 [US5] Import `editTaxonomy.js` in `AnnotationSelector.js` and add `'click .h-edit-taxonomy': '_openEditTaxonomyDialog'` event handler that instantiates and renders the dialog with `folderId` and current `_folderConfig`
- [x] T025 [US5] Add "Edit Classes" gear button to annotation panel header in `annotationSelector.pug` — visible only when `writeAccess` is true (use same `writeAccess` helper as existing delete/settings buttons)
- [x] T026 [US5] Add deletion warning in `editTaxonomy.js`: before removing a class, check if any currently-loaded annotation elements use that class id; if so, show inline warning "N elements use this class — they will become unclassified"
- [x] T027 [US5] Add circular-reference validation in `editTaxonomy.js` save handler: detect cycles before sending PUT; show error message in dialog if found

**Checkpoint**: Full CRUD on taxonomy via dialog; panel reflects changes after save

---

## Phase 8: Polish & Cross-Cutting Concerns

- [x] T028 [P] Add `annotationSelector.styl` chevron rotation CSS transition for tree expand/collapse toggle (smooth 90° rotation)
- [x] T029 Run `pre-commit run --all-files` in `/home/m087494/code/HistomicsUI` and fix any lint errors
- [x] T030 Rebuild Girder client: `docker compose exec girder bash -lc 'rebuild_and_restart_girder.sh'`
- [ ] T031 Smoke test in browser: (a) open slide without hierarchy config → flat list unchanged; (b) create YAML with 3-level hierarchy → tree renders; (c) click class → draw element → verify `group` field; (d) edit classes dialog → add/delete → panel updates; (e) read-only user → no "Edit Classes" button
- [ ] T032 [P] Commit all changes in HistomicsUI on branch `001-hierarchical-annotation-panel`

---

## Dependencies & Execution Order

| Phase | Depends On | Can Parallelize |
|---|---|---|
| Phase 1 (Setup) | — | T001 |
| Phase 2 (Foundational) | Phase 1 | T003, T004, T005, T007 independently |
| Phase 3 (US1 — Tree Display) | Phase 2 | T008, T010, T013 independently |
| Phase 4 (US2 — Active Class) | Phase 3 | T014, T016 independently |
| Phase 5 (US3 — Counts/Colors) | Phase 2 | T017, T018 independently |
| Phase 6 (US4 — Expand/Collapse) | Phase 3 | T020, T021 independently |
| Phase 7 (US5 — Edit Dialog) | Phase 3 | T022 and T023 in parallel |
| Phase 8 (Polish) | All prior | T028, T029 independently |

### MVP Scope (Phases 1–3 + Phase 4)

1. Phase 1: Setup
2. Phase 2: Foundational JS logic
3. Phase 3: Tree display (US1)
4. Phase 4: Active class assignment (US2)
5. **STOP**: Validate tree displays + drawing assigns correct class
6. Continue with Phases 5–7 for full feature

---

## Notes

- `[P]` = different files, no dependencies — safe to implement in parallel
- `[US#]` label = user story traceability
- No tests written (not requested in spec)
- Commit after each completed phase checkpoint
