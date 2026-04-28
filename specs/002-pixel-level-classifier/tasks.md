# Tasks: Pixel-Level Classifier with Active Learning

**Input**: Design documents from `specs/002-pixel-level-classifier/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (touches different files, no dependency on other in-flight tasks)
- **[Story]**: Which user story this task belongs to (US1–US4 from spec.md)
- All tasks include exact file paths

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the new file/directory skeleton so all subsequent tasks have a place to land.

- [x] T001 Create `histomicstk/histomicstk/cli/BuildPixelClassifier/` with blank `__init__.py`
- [x] T002 [P] Create `histomicstk/histomicstk/cli/ApplyPixelClassifier/` with blank `__init__.py`
- [x] T003 Add `"BuildPixelClassifier"` and `"ApplyPixelClassifier"` entries (both `"type": "python"`) to `histomicstk/histomicstk/cli/slicer_cli_list.json`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Define the CLI parameter contracts and shared utilities that all user-story phases depend on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T004 Create `histomicstk/histomicstk/cli/BuildPixelClassifier/BuildPixelClassifier.xml` — Slicer CLI parameter descriptor with groups: Experiment (`item_id`, `annotation_id`, `classes_json`), Model (`model_type` enum: `trident_linear`/`trident_mlp`/`resnet_linear`/`random_forest`, `magnification` int default 20, `patch_size` int default 512, `n_estimators` int default 100), Output (`job_dir`, `output_folder_id`), Girder (`girderApiUrl`, `girderToken`) — per `contracts/BuildPixelClassifier-cli.md`
- [x] T005 [P] Create `histomicstk/histomicstk/cli/ApplyPixelClassifier/ApplyPixelClassifier.xml` — parameter groups: Input (`item_id`, `model_item_id`), Output (`job_dir`), Girder (`girderApiUrl`, `girderToken`) — per `contracts/ApplyPixelClassifier-cli.md`
- [x] T006 [P] Create `histomicstk/histomicstk/cli/pixel_classifier_utils.py` with `read_pixelmap_annotation(gc, annotation_id) -> (patch_coords_per_class: dict[int, list[tuple]], categories: list[dict])` — downloads annotation via `GET /annotation/<id>`, extracts pixelmap element values and `boundaries`, returns per-class (x, y) tile-center coordinates in slide pixel space
- [x] T007 [P] Add `post_pixelmap_annotation(gc, item_id, label_array, categories, annotation_name, patch_size, magnification, origin_xy=(0,0))` to `histomicstk/histomicstk/cli/pixel_classifier_utils.py` — encodes a 2-D numpy label map as a pixelmap annotation element and `POST /annotation?itemId=<item_id>`; returns annotation ID
- [x] T008 Add `get_patch_embeddings(gc, item_meta, patch_centers, magnification, patch_size, model_type) -> np.ndarray` to `histomicstk/histomicstk/cli/pixel_classifier_utils.py` — primary path: load pre-computed TRIDENT `.h5` file from `item_meta['trident']['features_h5']`, look up embeddings nearest to each patch center; fallback path: use `large_image.open()` + `torchvision.models.resnet18(pretrained=True)` on GPU to encode patch crops in batches; returns `(N, D)` float32 embedding matrix

**Checkpoint**: Foundation ready — both CLIs have XML contracts and the three shared utility functions exist. User story implementation can begin.

---

## Phase 3: User Story 1 — Annotate and Train Initial Model (Priority: P1) 🎯 MVP

**Goal**: A user can set up a pixel classifier session on a slide, paint brush annotations, submit a training job, and see a color-coded prediction overlay when the job completes.

**Independent Test**: Open a slide, define a 2-class session, paint ~50 patches per class using DrawWidget brush, click Train, wait for the job to finish, and confirm a named pixelmap annotation overlay appears in the AnnotationSelector panel.

### Implementation for User Story 1

- [x] T009 [US1] Implement `histomicstk/histomicstk/cli/BuildPixelClassifier/BuildPixelClassifier.py` skeleton: `main()` with `CLIArgumentParser`, `_resolve_api_url()`, `girder_client.GirderClient` connection, `json.loads(args.classes_json)` validation (≥2 classes), `os.makedirs(args.job_dir)`, dispatch to `_train()` and `_infer()` sub-functions
- [x] T010 [US1] Implement `_train()` in `histomicstk/histomicstk/cli/BuildPixelClassifier/BuildPixelClassifier.py`: call `read_pixelmap_annotation()` → call `get_patch_embeddings()` for labeled patches → build `X_train, y_train` arrays → fit `sklearn.pipeline.Pipeline([('scaler', StandardScaler()), ('clf', LogisticRegression()|MLPClassifier()|RandomForestClassifier())])` based on `model_type` → compute OOB/cross-val accuracy → serialize bundle `{'model': pipeline, 'embedder': model_type, 'classes': classes, 'patch_size': patch_size, 'magnification': magnification}` to `<job_dir>/model.pkl`; write `training_report.json` with per-class patch counts and OOB accuracy
- [x] T011 [US1] Implement `_infer()` in `histomicstk/histomicstk/cli/BuildPixelClassifier/BuildPixelClassifier.py`: open slide with `large_image.open()`, iterate all patches at `magnification`/`patch_size` stride via `large_image.tileIterator` to collect patch centers → call `get_patch_embeddings()` in batches → `model.predict()` → build 2-D label map → call `post_pixelmap_annotation()` to post as `"PixelClassifier Iteration N — <session_name>"` annotation; return annotation ID
- [x] T012 [US1] Implement Girder writeback in `histomicstk/histomicstk/cli/BuildPixelClassifier/BuildPixelClassifier.py`: load or create `Pixel Classifier Models/<session_name>/run_<timestamp>` folder in user Private folder → `gc.uploadFileToItem()` for `model.pkl` and `training_report.json` → `gc.addMetadataToItem()` with `pixelClassifierModel` dict → `PUT /item/<item_id>/metadata` to append iteration record `{num, job_id, model_item_id, overlay_annotation_id, trained_at, n_train_patches}` to `_pixelClassifierSession.iterations` and set `current_model_item_id`
- [x] T013 [P] [US1] Create `histomicstk/histomicsui/web_client/templates/panels/pixelClassifierPanel.pug` with three conditional sections: (1) no-session: heading + "Setup Pixel Classifier" button; (2) session-active/no-model: class color legend, annotation guidance ("Use Draw panel to paint class regions"), "Train Iteration 1" button (disabled attr when `training_annotation_id` is falsy); (3) trained: iteration count badge, "Train Iteration N" button, "Apply to Selected (K slides)" button, per-class accuracy row from last `training_report`
- [x] T014 [P] [US1] Create `histomicsui/web_client/stylesheets/panels/pixelClassifierPanel.styl` — minimal styles: class color swatch dots, iteration history list, disabled-state button styling, matching existing panel aesthetic (reference `drawWidget.styl`)
- [x] T015 [P] [US1] Create `histomicsui/web_client/templates/dialogs/editPixelClassifier.pug` — Bootstrap modal with: session name input, class-definition table (add/remove rows, name input + color `<input type="color">`, min 2 rows), magnification `<select>` (5/10/20/40), model type `<select>` (trident_linear/trident_mlp/resnet_linear/random_forest with descriptions), patch size `<select>` (256/512 for TRIDENT modes, 64/128/256 for RF), Save/Cancel buttons
- [x] T016 [US1] Create `histomicsui/web_client/dialogs/editPixelClassifier.js` — Backbone.View extending Girder `View`; `_save()`: validate (name non-empty, ≥2 classes, all names unique) → `PUT /item/<id>/metadata` with `_pixelClassifierSession` per schema → if no `training_annotation_id`: `POST /annotation?itemId=<id>` with a blank pixelmap element whose `categories` array matches the class definitions → stamp `training_annotation_id` into metadata → call `onSave(session)` callback; also register each class name as a StyleCollection entry so DrawWidget brush offers them as style groups
- [x] T017 [P] [US1] Create `histomicsui/web_client/templates/dialogs/buildPixelClassifier.pug` — Bootstrap modal with: session name heading, class list with color swatches, patch count per class (from session metadata), selected model type, iteration number, Run/Cancel buttons, error `<div>` (hidden)
- [x] T018 [US1] Create `histomicsui/web_client/dialogs/buildPixelClassifier.js` — `_loadCliInfo()` finds BuildPixelClassifier CLI ID via `GET /slicer_cli_web/cli`; `_collectParams()` builds `{item_id, annotation_id, classes_json, model_type, magnification, patch_size, job_dir, girderApiUrl, girderToken}`; `_submit()` posts to `slicer_cli_web/cli/<id>/run`, stamps `{num, job_id}` skeleton entry into `_pixelClassifierSession.iterations` via `PUT /item/<id>/metadata`, shows floating job-link toast (matching `buildSlideClassifier.js` pattern)
- [x] T019 [US1] Create `histomicsui/web_client/panels/PixelClassifierPanel.js` — Backbone.View extending `Panel`; events: `'click .h-pc-setup-btn': '_onSetup'`, `'click .h-pc-train-btn': '_onTrain'`; `initialize({itemId, accessLevel})`: fetch `GET /item/<id>` → extract `meta._pixelClassifierSession`; `render()` dispatches to appropriate template state; `_onSetup()` → `showEditPixelClassifierDialog({itemId, session: null, onSave: ...})`; `_onTrain()` → `showBuildPixelClassifierDialog({itemId, session, onSubmit: ...})`
- [x] T020 [US1] Add exports to `histomicsui/web_client/panels/index.js`: `export {default as PixelClassifierPanel} from './PixelClassifierPanel'`; add `showEditPixelClassifierDialog` and `showBuildPixelClassifierDialog` exports to `histomicsui/web_client/dialogs/index.js`
- [x] T021 [US1] Wire `PixelClassifierPanel` into `histomicsui/web_client/views/body/ImageView.js`: import panel + dialogs; in the panel-initialization block (where `DrawWidget` is set up), instantiate `this.pixelClassifierPanel = new PixelClassifierPanel({itemId: this.model.id, accessLevel: this._accessLevel})` and render into `this.$('#h-pixel-classifier-panel')`
- [x] T022 [US1] Add `<div id="h-pixel-classifier-panel">` to the correct ImageView Pug template (locate the file via `grep -r "h-draw-widget\|DrawWidget" histomicsui/web_client/templates --include="*.pug" -l`) as a new collapsible panel section alongside DrawWidget and AnnotationSelector

**Checkpoint**: User Story 1 fully functional — can set up session, paint annotations, train, and see prediction overlay.

---

## Phase 4: User Story 2 — Active Learning Refinement Loop (Priority: P2)

**Goal**: After reviewing the initial prediction overlay, the user can paint corrections, retrain, see the updated overlay, and repeat until satisfied.

**Independent Test**: Starting from a trained model (US1 complete), paint 10 correction patches on misclassified regions, click "Train Iteration 2", wait for job completion, confirm a new overlay annotation named "Iteration 2" appears and the panel shows iteration count = 2.

### Implementation for User Story 2

- [x] T023 [US2] Update `histomicsui/web_client/panels/PixelClassifierPanel.js` to show the iteration history list (ordered `_pixelClassifierSession.iterations` entries, each as a clickable row displaying iteration number, trained_at, n_train_patches, OOB accuracy); add `_pollJobStatus(jobId)` — polls `GET /job/<id>` every 5 s, calls `_loadSession()` and re-renders on SUCCESS/ERROR status, clears interval on terminal state
- [x] T024 [P] [US2] Update `histomicsui/web_client/templates/panels/pixelClassifierPanel.pug` to add the iteration history `<ul>` section and a per-iteration "View Overlay" link that calls `showAnnotation(annotationId)` on click
- [x] T025 [US2] Update `histomicsui/web_client/dialogs/buildPixelClassifier.js` to read current `iterations.length` and display "Train Iteration N" label and the patch count from the most recent iteration entry's `n_train_patches`

**Checkpoint**: User Story 2 functional — active learning loop works end-to-end, iteration history is visible.

---

## Phase 5: User Story 3 — Apply Trained Model to Other Slides (Priority: P3)

**Goal**: After finishing the active learning loop, the user can select additional slides and apply the trained model to generate prediction overlays on each.

**Independent Test**: Starting from a saved model (US2 complete), select 2 slides in the folder browser, click "Apply to Selected (2 slides)", confirm two ApplyPixelClassifier jobs appear in the Jobs panel, and after completion confirm each target slide has a "PixelClassifier Applied" annotation.

### Implementation for User Story 3

- [x] T026 [US3] Implement `histomicstk/histomicstk/cli/ApplyPixelClassifier/ApplyPixelClassifier.py`: `main()` with arg parsing, Girder connection; download `model.pkl` from model item via `gc.downloadFile()`; load bundle → extract `embedder`, `classes`, `patch_size`, `magnification`; warn (non-fatal) if slide magnification differs; call `get_patch_embeddings()` in tile-stride batches; call `post_pixelmap_annotation()` with name `"PixelClassifier Applied — <session_name>"`
- [x] T027 [P] [US3] Create `histomicsui/web_client/templates/dialogs/applyPixelClassifier.pug` — Bootstrap modal: selected slide count heading, model metadata (session name, iteration, OOB accuracy from `pixelClassifierModel` metadata), Submit/Cancel, error `<div>`
- [x] T028 [US3] Create `histomicsui/web_client/dialogs/applyPixelClassifier.js` — `_loadCliInfo()` finds ApplyPixelClassifier CLI ID; `_submit()` iterates `this._itemIds`, submits one `POST slicer_cli_web/cli/<id>/run` per item with `{item_id, model_item_id, job_dir, girderApiUrl, girderToken}`, shows combined success toast with job count
- [x] T029 [US3] Add `_onApply()`, `setCheckedItems(ids)`, and `'click .h-pc-apply-btn': '_onApply'` event to `histomicsui/web_client/panels/PixelClassifierPanel.js`; `_onApply()` opens `showApplyPixelClassifierDialog({modelItemId: session.current_model_item_id, itemIds: this._checkedItemIds})`; add `showApplyPixelClassifierDialog` export to `histomicsui/web_client/dialogs/index.js`
- [x] T030 [US3] Wire `setCheckedItems` call into `histomicsui/web_client/views/body/ImageView.js` — in the existing block that tracks `_checkedItemIds` and notifies other panels (e.g., `SlideClassifierPanel.setCheckedItems`), also call `this.pixelClassifierPanel.setCheckedItems(ids)`

**Checkpoint**: User Story 3 functional — batch apply to selected slides works end-to-end.

---

## Phase 6: User Story 4 — Manage Annotation Classes and Model Library (Priority: P4)

**Goal**: Users can edit session class definitions after initial setup and choose from documented model options with descriptions.

**Independent Test**: Open the Pixel Classifier panel on a slide with an existing session, click "Edit Session", change a class color, save, and confirm the annotation categories and style group colors update to match.

### Implementation for User Story 4

- [x] T031 [US4] Add `'click .h-pc-edit-btn': '_onEdit'` event and `_onEdit()` method to `histomicsui/web_client/panels/PixelClassifierPanel.js`: opens `showEditPixelClassifierDialog({itemId, session: this._session, onSave: ...})` in edit mode (pre-populates all fields); update `pixelClassifierPanel.pug` to show the Edit button when a session exists
- [x] T032 [P] [US4] Update `histomicsui/web_client/templates/dialogs/editPixelClassifier.pug` to add brief description text under each `model_type` option (e.g., "trident_linear — fastest, uses pre-computed TRIDENT embeddings"; "random_forest — CPU-only fallback, no GPU or embeddings required")

**Checkpoint**: All four user stories functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Lint, error handling, and smoke-test validation.

- [x] T033 [P] Run `pre-commit run --all-files` in `histomicstk/` repo scope; fix any flake8/ruff/codespell issues in `histomicstk/histomicstk/cli/BuildPixelClassifier/`, `histomicstk/histomicstk/cli/ApplyPixelClassifier/`, and `histomicstk/histomicstk/cli/pixel_classifier_utils.py`
- [x] T034 [P] Run `pre-commit run --all-files` in `HistomicsUI/` repo scope; fix any ESLint/pug-lint/stylus-lint issues in all new panel, dialog, template, and stylesheet files
- [x] T035 [P] Add job-error display to `histomicsui/web_client/panels/PixelClassifierPanel.js`: when `_pollJobStatus` detects ERROR state, display a `g:alert` toast with the job error message and re-enable the Train button
- [x] T036 End-to-end smoke test per `specs/002-pixel-level-classifier/quickstart.md`: register CLIs in a running DSA instance → open slide → set up 2-class session → paint annotations → Train Iteration 1 → verify overlay → paint corrections → Train Iteration 2 → verify updated overlay → apply to a second slide → verify overlay on second slide

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Requires Phase 1 complete — **BLOCKS all user stories**
- **US1 (Phase 3)**: Requires Phase 2 complete — no dependency on US2/US3/US4
- **US2 (Phase 4)**: Requires Phase 3 complete (reuses PixelClassifierPanel and BuildPixelClassifier)
- **US3 (Phase 5)**: Requires Phase 2 complete — can proceed in parallel with US2 (ApplyPixelClassifier CLI is independent; Apply dialog needs PixelClassifierPanel shell from T019)
- **US4 (Phase 6)**: Requires Phase 3 complete (editPixelClassifier dialog extended)
- **Polish (Phase 7)**: Requires all desired user stories complete

### User Story Dependencies

- **US1 (P1)**: Depends only on Phase 2 — foundational MVP
- **US2 (P2)**: Depends on US1 (reuses BuildPixelClassifier CLI and Panel; adds iteration tracking UX)
- **US3 (P3)**: CLI side (T026) depends only on Phase 2; dialog/panel side (T028–T030) depends on T019 (panel shell)
- **US4 (P4)**: Depends on US1 (extends editPixelClassifier dialog)

### Within Each User Story

- XML descriptor → CLI Python → Girder writeback (T004 → T009 → T010 → T011 → T012)
- Pug/Styl templates [P] → Backbone.View → ImageView wiring (T013, T014, T015 [P] → T016, T017, T018 → T019, T020, T021, T022)
- CLI and frontend tracks can proceed in parallel once Phase 2 is complete

---

## Parallel Opportunities

### Phase 2 (can all run in parallel after T001–T003)

```
T004  BuildPixelClassifier.xml
T005  ApplyPixelClassifier.xml          (parallel with T004)
T006  pixel_classifier_utils: reader    (parallel with T004, T005)
T007  pixel_classifier_utils: writer    (parallel with T004, T005, T006)
T008  pixel_classifier_utils: embedder  (after T006 for shared file)
```

### Phase 3 — CLI vs. Frontend tracks (fully parallel after Phase 2)

```
CLI track:   T009 → T010 → T011 → T012
UI track:    T013, T014, T015 [P] → T016, T017, T018 → T019 → T020 → T021 → T022
```

### Phase 5 — CLI and frontend independent

```
T026  ApplyPixelClassifier.py   (depends on Phase 2 only)
T027  applyPixelClassifier.pug  (parallel with T026)
T028  applyPixelClassifier.js   (depends on T027)
T029  PixelClassifierPanel._onApply  (depends on T019, T028)
T030  ImageView wiring           (depends on T029)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T003)
2. Complete Phase 2: Foundational (T004–T008) — **critical blocker**
3. Complete Phase 3: User Story 1 (T009–T022)
4. **STOP and VALIDATE**: Paint annotations → train → confirm overlay appears
5. Demo to stakeholders

### Incremental Delivery

1. Setup + Foundational → skeleton in place
2. US1 → working train + overlay (MVP)
3. US2 → iteration loop works end-to-end
4. US3 → batch apply to other slides
5. US4 → class editing UX polish
6. Polish phase → lint clean, smoke tested

### Two-Developer Split

With histomicstk and HistomicsUI expertise split across two developers:

- **Dev A** (Python/ML): Phase 1 setup → Phase 2 XML + utils (T004–T008) → Phase 3 CLI (T009–T012) → Phase 5 CLI (T026)
- **Dev B** (Frontend/JS): Phase 2 can start in parallel on templates → Phase 3 UI (T013–T022) → Phase 4 (T023–T025) → Phase 5 UI (T027–T030)

---

## Notes

- `[P]` tasks touch different files and have no unresolved dependencies — safe to parallelize
- `[USN]` labels map each task to the user story it delivers; use for traceability in PR descriptions
- Both repos (`histomicstk/` and `HistomicsUI/`) require separate `git commit` + `pre-commit run`
- The `pixel_classifier_utils.py` shared module is used by both CLIs — implement it in Phase 2 before either CLI's Python work begins
- TRIDENT primary path (T008, T010, T011) requires `meta.trident.features_h5` to exist on the item; the CLI must gracefully fall through to the GPU ResNet-18 fallback if absent
- Stop at each **Checkpoint** to validate the current story independently before proceeding
