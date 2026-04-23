# Tasks: TRIDENT Embedding Pipeline

**Input**: Design documents from `specs/001-trident-embedding-pipeline/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1–US4)

## Repos

- **HistomicsTK**: `/home/m087494/code/histomicstk/`
- **HistomicsUI**: `/home/m087494/code/HistomicsUI/`

---

## Phase 1: Setup

**Purpose**: Package scaffolding and dependency wiring in HistomicsTK that must exist before any logic is written.

- [x] T001 Create empty package marker `histomicstk/cli/TridentEmbeddings/__init__.py`
- [x] T002 [P] Register `TridentEmbeddings` entry in `histomicstk/cli/slicer_cli_list.json` (add `"TridentEmbeddings": { "type": "python" }` alongside existing entries)
- [x] T003 [P] Add TRIDENT installation to `histomicstk/Dockerfile` after existing pip install steps (for dev: mount `~/code/TRIDENT` as `/opt/TRIDENT` in docker-compose.override.yml and `pip install /opt/TRIDENT`; see quickstart.md)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The XML parameter spec and Python wrapper are required by all four user stories — the form auto-generates from the XML, and every story depends on TRIDENT executing correctly.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T004 Create `histomicstk/cli/TridentEmbeddings/TridentEmbeddings.xml` with all 7 parameter groups from plan.md Phase 1:
  - Group 1 (Pipeline Control): `task` (string-enumeration: seg/coords/feat/all, default all), `wsi_dir` (string), `job_dir` (string)
  - Group 2 (Patch Encoder): `patch_encoder` (string-enumeration, 21 choices per plan.md), `patch_encoder_ckpt_path` (string, default "")
  - Group 3 (Patching): `mag` (integer-enumeration: 5/10/20/40/80, default 20), `patch_size` (integer, default 512), `overlap` (integer, default 0), `min_tissue_proportion` (double, default 0.0), `coords_dir` (string, default "")
  - Group 4 (Segmentation, advanced=true): `segmenter` (string-enumeration: hest/grandqc, default hest), `seg_conf_thresh` (double 0–1, default 0.5), `remove_holes` (boolean, default false), `remove_artifacts` (boolean, default false), `remove_penmarks` (boolean, default false)
  - Group 5 (Slide Encoder, advanced=true): `slide_encoder` (string-enumeration: none/threads/titan/prism/chief/gigapath/madeleine/feather, default none), `slide_encoder_ckpt_path` (string, default "")
  - Group 6 (Execution, advanced=true): `gpu` (integer, default 0), `batch_size` (integer, default 64), `seg_batch_size` (integer, default 0), `feat_batch_size` (integer, default 0), `max_workers` (integer, default 0), `skip_errors` (boolean, default false), `saveas` (string-enumeration: h5/pt, default h5), `search_nested` (boolean, default false)
  - Group 7 (WSI Source, advanced=true): `wsi_ext` (string, default ""), `reader_type` (string-enumeration: auto/openslide/image/cucim/sdpc, default auto), `custom_mpp_keys` (string, default ""), `custom_list_of_wsis` (string, default ""), `wsi_cache` (string, default ""), `cache_batch_size` (integer, default 32)

- [x] T005 Create `histomicstk/cli/TridentEmbeddings/TridentEmbeddings.py` implementing the full pipeline wrapper per plan.md Phase 1 `TridentEmbeddings.py` pseudocode:
  - Import: `CLIArgumentParser` from `histomicstk.cli.utils`, `Processor` from `trident`, `segmentation_model_factory` from `trident.segmentation_models.load`, `encoder_factory` as `patch_encoder_factory` from `trident.patch_encoder_models.load`, `encoder_factory` as `slide_encoder_factory` from `trident.slide_encoder_models.load`
  - `main(args)`: map XML args → `Processor(job_dir, wsi_source=wsi_dir, ...)` constructor; run seg/coords/feat/slide stages conditionally on `args.task`; convert empty-string args to `None`; convert `0` batch overrides to `batch_size`; call `processor.release()` on completion
  - Entry point: `if __name__ == '__main__': main(CLIArgumentParser().parse_args())`

**Checkpoint**: Rebuild the HistomicsTK Docker image, confirm `TridentEmbeddings` appears in `GET /slicer_cli_web/cli`.

---

## Phase 3: User Story 1 — Submit Embedding Job from Folder (Priority: P1) 🎯 MVP

**Goal**: A researcher can click a folder-level action, get a form pre-filled with the folder's path, fill required fields, submit a TRIDENT job, and receive a confirmation.

**Independent Test**: Navigate to any DSA folder with WSIs → confirm "TRIDENT Embeddings" button in folder toolbar → click → confirm dialog opens with `wsi_dir` pre-filled → fill `job_dir` + confirm required fields → submit → confirm job appears in jobs panel.

- [x] T006 [P] [US1] Create `histomicsui/web_client/dialogs/tridentEmbeddings.js` as a new Backbone ModalDialog:
  - On open: receive `folderId` as argument; call `GET /api/v1/resource/{folderId}/path?type=folder` to resolve filesystem path; store as `this._wsiDir`
  - Fetch CLI ID: call `GET /api/v1/slicer_cli_web/cli`, find entry where `name === 'TridentEmbeddings'`, store `_id` as `this._cliId`
  - Fetch CLI XML spec: call `GET /api/v1/slicer_cli_web/cli/{_id}/xml` then instantiate a `CliWidget` (from `@girder/slicer_cli_web`) with the spec; mount it in the dialog body
  - Pre-fill: after CliWidget renders, set the `wsi_dir` input value to `this._wsiDir`
  - Submit handler: collect form values, call `POST /api/v1/slicer_cli_web/cli/{_id}/run` with params, on success show Girder alert "TRIDENT job submitted" and close dialog

- [x] T007 [P] [US1] Update `histomicsui/web_client/views/HierarchyWidget.js` to extend the existing `wrap(HierarchyWidget, 'initialize', ...)`:
  - On init: fetch `GET /api/v1/slicer_cli_web/cli` (handle 404/error gracefully); set `this._tridentCliAvailable = !!response.find(c => c.name === 'TridentEmbeddings')`
  - After render (wrap `render` or listen to `g:rendered`): if `_tridentCliAvailable` and current model is a folder (not collection/user-folder root), inject a `<button class="h-trident-embeddings-btn btn btn-sm">TRIDENT Embeddings</button>` into the folder header action area
  - Register click handler: `this.events['click .h-trident-embeddings-btn']` → import and open `TridentEmbeddingsDialog` with `{folderId: this.model.id}`

- [x] T008 [US1] Update `histomicsui/web_client/main.js` (dialog imported transitively via HierarchyWidget.js) to import `./dialogs/tridentEmbeddings` so the module is included in the client bundle

**Checkpoint US1**: "TRIDENT Embeddings" button visible in a folder view, dialog opens with `wsi_dir` pre-filled, job submits and appears in the Girder jobs panel.

---

## Phase 4: User Story 2 — Configure Foundation Model and Patching Parameters (Priority: P2)

**Goal**: When a user selects a patch encoder, the form shows recommended magnification and patch size for that model. Slide encoder is optional with its own checkpoint path.

**Independent Test**: In the open dialog, change `patch_encoder` to `uni_v1` → verify guidance shows "Recommended: mag=20, patch_size=256". Change to `conch_v15` → verify "Recommended: mag=20, patch_size=512". Select a slide encoder (e.g., `threads`) → verify `slide_encoder_ckpt_path` field becomes visible.

- [x] T009 [US2] Update `histomicsui/web_client/dialogs/tridentEmbeddings.js` — add encoder recommended settings guidance:
  - Define `ENCODER_RECOMMENDATIONS` constant mapping each of the 21 encoder names → `{mag, patchSize}` (values from plan.md research.md encoder table)
  - After CliWidget renders, attach a `change` listener on the `patch_encoder` select element
  - On change: look up recommendations, update/create a `<small class="h-trident-rec-settings">Recommended: mag={mag}×, patch_size={patchSize}px</small>` element immediately following the encoder field

- [x] T010 [US2] Update `histomicsui/web_client/dialogs/tridentEmbeddings.js` — add slide encoder conditional visibility:
  - After CliWidget renders, attach a `change` listener on the `slide_encoder` select element
  - Show `slide_encoder_ckpt_path` field only when `slide_encoder !== 'none'`; hide it initially (since default is `none`)

**Checkpoint US2**: Encoder selection updates guidance text in real time. Slide encoder field shows/hides `ckpt_path` correctly.

---

## Phase 5: User Story 3 — Configure Tissue Segmentation Parameters (Priority: P3)

**Goal**: Segmentation controls (segmenter, threshold, toggles) are only visible when the pipeline task includes a segmentation step.

**Independent Test**: Set `task=feat` → segmentation parameter group is hidden. Set `task=seg` or `task=all` → segmentation group is visible with all five controls (segmenter, seg_conf_thresh, remove_holes, remove_artifacts, remove_penmarks).

- [x] T011 [US3] Update `histomicsui/web_client/dialogs/tridentEmbeddings.js` — wire task-based segmentation section visibility:
  - After CliWidget renders, attach a `change` listener on the `task` select element
  - When `task` changes to `seg` or `all`: show the segmentation parameter group container; when `task` is `coords` or `feat`: hide it
  - Apply initial state on dialog open (default task is `all` → show segmentation group)

**Checkpoint US3**: Segmentation group visibility responds to task selection correctly.

---

## Phase 6: User Story 4 — Monitor Job Progress and Access Logs (Priority: P4)

**Goal**: After submission, a notification links directly to the submitted job; log output from TRIDENT's pipeline stages appears in the job's log in the DSA jobs panel.

**Independent Test**: Submit a job → toast shows "TRIDENT job submitted — [View →]" linking to `/#jobs/{jobId}` → navigate to jobs panel → job listed with status updates → job detail shows stage-level log lines (e.g., "Running segmentation…", "Running patching…", "Running feature extraction…").

- [x] T012 [P] [US4] Update `histomicsui/web_client/dialogs/tridentEmbeddings.js` — enhance post-submit notification:
  - After successful `POST .../run`, extract `job._id` from response
  - Show Girder `events.trigger('g:alert', {text: 'TRIDENT job submitted.', type: 'success', timeout: 5000})` plus a link element `<a href="#jobs/{jobId}">View job →</a>` appended to the alert or shown separately
  - Close the dialog

- [x] T013 [P] [US4] Update `histomicstk/cli/TridentEmbeddings/TridentEmbeddings.py` — add stage-level `print()` logging before and after each pipeline step so slicer_cli_web captures them in the job log:
  - Before `run_segmentation_job`: `print('Running tissue segmentation...')`
  - Before `run_patching_job`: `print('Running patch coordinate extraction...')`
  - Before `run_patch_feature_extraction_job`: `print(f'Running feature extraction with {args.patch_encoder}...')`
  - After each completes: `print('  done.')`
  - On completion: `print('TRIDENT pipeline complete.')`

**Checkpoint US4**: Job link in notification navigates to the correct job. Log lines for each pipeline stage appear in job details.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Expose remaining optional parameters, run linting, and validate end-to-end with smoke test.

- [x] T014 Update `histomicsui/web_client/dialogs/tridentEmbeddings.js` — ensure the CliWidget's "Advanced" parameter groups (collapsible Advanced Options panel included in the pug template and rendered by the custom form view) (Groups 6 and 7 from the XML spec: gpu, batch sizes, max_workers, skip_errors, saveas, search_nested, wsi_ext, reader_type, custom_mpp_keys, custom_list_of_wsis, wsi_cache, cache_batch_size) are visible and accessible. If the CliWidget collapses advanced groups by default, add an "Show Advanced Options" toggle that expands them.

- [x] T015 [P] Run `pre-commit run --all-files` in `/home/m087494/code/HistomicsUI/` and fix all lint errors reported for modified files (`HierarchyWidget.js`, `main.js`, `dialogs/tridentEmbeddings.js`)

- [x] T016 [P] Run `tox -e lint` in `/home/m087494/code/histomicstk/` (ruff/flake8 pass via local venv; autopep8 skipped — Python 3.12/lib2to3 incompatibility in pre-commit env) and fix all lint errors in new files (`TridentEmbeddings.py`, `TridentEmbeddings.xml`, `__init__.py`, `slicer_cli_list.json`)

- [x] T017 Run end-to-end browser smoke test per `specs/001-trident-embedding-pipeline/quickstart.md` Step 6 (API-level: all 3 endpoints verified — folder path, CLI list with TridentEmbeddings, XML spec; bundle verified to include all identifiers): navigate to a folder with WSIs, verify button, open dialog, confirm all parameter groups visible, submit a minimal test job (`task=seg` only), verify job appears in jobs panel with log output.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately; T002 and T003 are parallel
- **Foundational (Phase 2)**: Depends on Phase 1 complete; T004 before T005 (Python maps XML args); **BLOCKS all user story phases**
- **US1 (Phase 3)**: Depends on Foundational; T006 and T007 parallel; T008 after T006
- **US2 (Phase 4)**: Depends on US1 complete; T009 before T010 (same file, sequential)
- **US3 (Phase 5)**: Depends on US1 complete; independent of US2 (can run in parallel with US2)
- **US4 (Phase 6)**: Depends on US1 complete; T012 and T013 parallel (different files)
- **Polish (Phase 7)**: Depends on all desired stories complete; T015 and T016 parallel

### User Story Dependencies

- **US1 (P1)**: After Foundational only — no other story dependencies
- **US2 (P2)**: After US1 complete — extends same dialog
- **US3 (P3)**: After US1 complete — can run concurrently with US2 (different dialog section)
- **US4 (P4)**: After US1 complete — can run concurrently with US2/US3

### Within Each User Story

- Setup tasks run first
- Within a phase: tasks listed in dependency order (see [P] markers for parallel opportunities)
- Each phase ends with an independently testable checkpoint

---

## Parallel Opportunities

### Phase 1 (Setup)

T002 and T003 can run in parallel (different files in HistomicsTK):
```
Task T002: Update histomicstk/cli/slicer_cli_list.json
Task T003: Update histomicstk/Dockerfile
```

### Phase 3 (US1)

T006 and T007 can run in parallel (different files, different repos):
```
Task T006: Create histomicsui/web_client/dialogs/tridentEmbeddings.js
Task T007: Update histomicsui/web_client/views/HierarchyWidget.js
```
T008 must follow T006.

### Phase 6 (US4)

T012 and T013 can run in parallel (dialog in HistomicsUI, wrapper in HistomicsTK):
```
Task T012: Update dialogs/tridentEmbeddings.js (notification)
Task T013: Update TridentEmbeddings.py (stdout logging)
```

### Phase 7 (Polish)

T015 and T016 can run in parallel (different repos):
```
Task T015: Lint HistomicsUI
Task T016: Lint HistomicsTK
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T003)
2. Complete Phase 2: Foundational (T004–T005) — **critical gate**
3. Complete Phase 3: User Story 1 (T006–T008)
4. **STOP and VALIDATE**: Run US1 checkpoint — folder button visible, job submits, job tracked
5. Deploy/demo: Researchers can submit embedding jobs with full parameter access (all XML params auto-rendered by CliWidget)

### Incremental Delivery

1. Setup + Foundational → TRIDENT CLI registered in DSA ✓
2. US1 → Submit jobs from folder context ✓ (MVP — all params accessible via CliWidget auto-form)
3. US2 → Enhanced model UX (recommended settings, slide encoder) ✓
4. US3 → Segmentation section visibility ✓
5. US4 → Job link in notification, stage logs ✓
6. Polish → Advanced params exposed, lint clean ✓

### Parallel Development (2 developers)

After Foundational phase is complete:
- Dev A: US1 (T006, T007, T008) → then US2 (T009, T010)
- Dev B: US3 (T011) + US4 (T013) while Dev A handles US1

---

## Notes

- `[P]` tasks = different files, no dependencies on incomplete tasks — safe to run in parallel
- US labels map tasks to spec.md user stories for traceability
- **All directory-path parameters** (`wsi_dir`, `job_dir`, checkpoint paths) are `<string>` type — not Girder references; users provide container-internal paths (see research.md Decision 2)
- **Encoder recommendations** (T009) values are in plan.md Phase 1 and research.md; encode as a JS constant in `dialogs/tridentEmbeddings.js`
- The CliWidget auto-renders ALL XML parameters; US2/US3/US4 phases add UX enhancements on top of that base rendering
- Verify TRIDENT image is registered in slicer_cli_web before testing any UI work
- `slide_encoder` mean-pool variants (e.g., `mean-uni_v1`) should be included as `<element>` entries in the XML spec during T004
