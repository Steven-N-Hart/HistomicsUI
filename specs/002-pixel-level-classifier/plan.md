# Implementation Plan: Pixel-Level Classifier with Active Learning

**Branch**: `002-pixel-level-classifier` | **Date**: 2026-04-27 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/002-pixel-level-classifier/spec.md`

## Summary

Add an interactive, per-slide pixel-level semantic segmentation tool with an active learning loop. Users paint brush annotations on a slide (using the existing DrawWidget pixelmap infrastructure), trigger training via a new `BuildPixelClassifier` Slicer CLI (linear/MLP head on TRIDENT patch embeddings, GPU-accelerated fallback for slides without pre-computed embeddings), review the prediction overlay (posted as a pixelmap annotation), paint corrections, and retrain iteratively. A companion `ApplyPixelClassifier` CLI applies the finished model to any number of additional slides. Session state lives in item metadata (`_pixelClassifierSession`); models are uploaded as Girder items.

## Technical Context

**Language/Version**: Python 3.11 (CLI/backend), JavaScript ES6 (frontend)
**Primary Dependencies**: scikit-learn, scikit-image, large_image, h5py, torch, girder_client (CLI); Backbone.js, jQuery, Pug, Stylus, @girder/large_image_annotation (frontend)
**Storage**: MongoDB via Girder REST API (annotations, item metadata); assetstore (model .pkl, training reports)
**Testing**: pytest / tox (Python CLIs); browser smoke test (frontend)
**Target Platform**: Linux server with GPU (CLI Docker container), desktop browser (frontend)
**Project Type**: Full-stack — Slicer CLI Docker task (ML) + Girder-native frontend panel
**Performance Goals**: Initial train + overlay in <5 min (TRIDENT embeddings pre-computed) or <10 min (GPU fallback); subsequent iterations <2 min (TRIDENT path)
**Constraints**: pixelmap overlays must tile for gigapixel slides; <5 min active learning iteration cycle; graceful degradation to RF on CPU if GPU unavailable
**Scale/Scope**: Per-slide session; up to 10 classes; batch inference across up to 100 slides per job

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|---|---|---|
| I. Frontend-Only for UI features | PASS | PixelClassifierPanel, dialogs, and templates are pure JS/Pug/Stylus. ML runs in Slicer CLI Docker — separate from Girder. |
| II. Extend, Don't Replace | PASS | Builds on DrawWidget pixelmap brush (existing), Slicer CLI Web Panel pattern (existing), AnnotationSelector overlay display (existing). No parallel systems created. |
| III. Graceful Degradation | PASS | PixelClassifierPanel only shows "Setup" when no session exists; slide viewer works normally without it. CLIs are not required for other features. |
| IV. Folder-Scoped Configuration | PASS | Session config stored per-item in `_pixelClassifierSession`. Folder config not used (pixel classifier is slide-specific). |
| V. Lint and Build | REQUIRED | All JS/Pug/Stylus must pass `pre-commit run --all-files`; Python CLIs must pass `tox -e lint`. |

*Post-design re-check*: All principles still satisfied after Phase 1 design. No violations.

## Project Structure

### Documentation (this feature)

```text
specs/002-pixel-level-classifier/
├── plan.md              # This file
├── spec.md
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── BuildPixelClassifier-cli.md
│   ├── ApplyPixelClassifier-cli.md
│   └── pixel-classifier-session-schema.md
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (cross-repo)

#### histomicstk (new files)

```text
histomicstk/histomicstk/cli/
├── BuildPixelClassifier/
│   ├── __init__.py
│   ├── BuildPixelClassifier.xml   # CLI parameter descriptor
│   └── BuildPixelClassifier.py   # Train RF on pixelmap annotations
├── ApplyPixelClassifier/
│   ├── __init__.py
│   ├── ApplyPixelClassifier.xml
│   └── ApplyPixelClassifier.py   # Apply model to target slide
└── slicer_cli_list.json           # Add both CLIs here (existing file, updated)
```

#### HistomicsUI (new files)

```text
histomicsui/web_client/
├── panels/
│   └── PixelClassifierPanel.js     # Per-slide panel: session status + Train/Apply buttons
├── dialogs/
│   ├── buildPixelClassifier.js     # Training job submission dialog
│   └── applyPixelClassifier.js     # Apply-to-slides job submission dialog
├── templates/
│   ├── panels/
│   │   └── pixelClassifierPanel.pug
│   └── dialogs/
│       ├── buildPixelClassifier.pug
│       └── applyPixelClassifier.pug
└── stylesheets/
    └── panels/
        └── pixelClassifierPanel.styl
```

#### HistomicsUI (modified files)

```text
histomicsui/web_client/
├── panels/index.js                 # Export PixelClassifierPanel
├── views/body/ImageView.js         # Instantiate & mount PixelClassifierPanel
└── dialogs/index.js                # Export buildPixelClassifier, applyPixelClassifier dialogs
```

**Structure Decision**: Cross-repo feature spanning `histomicstk/` (CLI/Python) and `HistomicsUI/` (frontend JS). Each repo is committed independently. The plan lives in `HistomicsUI/specs/` as the primary coordination point.

## Implementation Phases

### Phase A — BuildPixelClassifier CLI (histomicstk)

**Goal**: A working Slicer CLI that reads a pixelmap annotation from Girder, extracts patch features, trains a Random Forest, posts a prediction overlay annotation, and uploads the model.

**Key implementation steps**:

1. Create `histomicstk/cli/BuildPixelClassifier/BuildPixelClassifier.xml` with parameters per [BuildPixelClassifier-cli.md](contracts/BuildPixelClassifier-cli.md).

2. Create `histomicstk/cli/BuildPixelClassifier/BuildPixelClassifier.py`:
   - Parse args via `CLIArgumentParser`
   - Connect to Girder via `girder_client.GirderClient`
   - Download annotation (`GET /annotation/<id>`) → extract pixelmap element values + categories
   - **Primary path** (TRIDENT embeddings available via `meta.trident.features_h5`):
     - Load patch coordinates + embeddings from the pre-computed `.h5` file
     - Map annotated pixels → nearest patch center → look up embedding
     - Train `StandardScaler` + `LogisticRegression` (or `MLPClassifier` if `model_type=trident_mlp`) on labeled embeddings
     - Classify all patch embeddings in the `.h5` → reconstruct label map at patch resolution
   - **Fallback path** (no pre-computed embeddings):
     - Load a GPU-accelerated patch encoder (ResNet-18 via torchvision, or user-specified TRIDENT encoder)
     - Batch-encode annotated patches + all inference patches via `large_image.tileIterator` + torch DataLoader
     - Same sklearn head training and label map reconstruction
   - Encode label map as pixelmap annotation → `POST /annotation?itemId=<item_id>`
   - Serialize model bundle (`{'model': Pipeline, 'embedder': encoder_name, 'classes': [...], 'patch_size': N, 'magnification': N}`) → upload as Girder item files
   - Patch `_pixelClassifierSession` into item metadata

3. Register in `slicer_cli_list.json`.

4. Add `__init__.py`.

**Testing**: `tox -e py310` (unit tests for feature extraction and annotation parsing functions).

---

### Phase B — ApplyPixelClassifier CLI (histomicstk)

**Goal**: A working Slicer CLI that downloads a model item from Girder and applies it to a target slide.

**Key implementation steps**:

1. Create `histomicstk/cli/ApplyPixelClassifier/ApplyPixelClassifier.xml` per [ApplyPixelClassifier-cli.md](contracts/ApplyPixelClassifier-cli.md).

2. Create `histomicstk/cli/ApplyPixelClassifier/ApplyPixelClassifier.py`:
   - Download `model.pkl` from model item via `girder_client.downloadFile()`
   - Load model and extract `classes`, `patch_size`, `magnification`
   - Open target slide with `large_image`
   - Apply model in tiles → post prediction as pixelmap annotation
   - Log magnification mismatch warning (non-fatal)

3. Register in `slicer_cli_list.json`.

**Testing**: Same tox run; mock Girder calls with a small synthetic model.

---

### Phase C — PixelClassifierPanel frontend (HistomicsUI)

**Goal**: A Backbone.js Panel in the ImageView left sidebar that manages the classifier session lifecycle.

**Key implementation steps**:

1. `PixelClassifierPanel.js` — extends `Panel` from `@girder/slicer_cli_web/views/Panel`:
   - On `initialize`: fetch item metadata, extract `_pixelClassifierSession`
   - Render states:
     - **No session**: "Setup Pixel Classifier" button only
     - **Session exists, no model**: class list, annotation guidance, "Train Iteration 1" button (disabled if `training_annotation_id` is null)
     - **Model trained**: iteration history list, "Train Iteration N" button, "Apply to Selected (K slides)" button
   - `_onSetup()`: open `editPixelClassifierDialog` (new dialog for class/session definition)
   - `_onTrain()`: open `buildPixelClassifier` dialog
   - `_onApply()`: open `applyPixelClassifier` dialog (passes `current_model_item_id` + checked item IDs)
   - `setCheckedItems(ids)`: called by ImageView when folder-browser selection changes, updates Apply button count

2. `editPixelClassifier` dialog (simple inline or reuse `editSlideClassifier` pattern):
   - Fields: session name, class definitions (name + color picker × 2–10 rows), magnification select, model type select
   - On save: `PUT /item/<id>/metadata` with `_pixelClassifierSession`

3. `buildPixelClassifier.js` dialog:
   - Shows: session name, classes, iteration count, patch counts per class (fetched from session metadata)
   - On submit: `POST /slicer_cli_web/cli/<BuildPixelClassifier_id>/run` with params; saves `{num, job_id}` to session metadata; shows job link

4. `applyPixelClassifier.js` dialog:
   - Shows: selected slide count, model info (iteration, OOB accuracy if available)
   - On submit: one `POST /slicer_cli_web/cli/<ApplyPixelClassifier_id>/run` per selected item_id

5. **PugTemplates**: `pixelClassifierPanel.pug`, `buildPixelClassifier.pug`, `applyPixelClassifier.pug`.

6. **Stylus**: `pixelClassifierPanel.styl` — minimal styles matching existing panel aesthetics.

---

### Phase D — ImageView integration (HistomicsUI)

**Goal**: Wire PixelClassifierPanel into the existing ImageView so it appears in the left control panel.

**Key implementation steps**:

1. `panels/index.js`: add `export {default as PixelClassifierPanel} from './PixelClassifierPanel';`

2. `dialogs/index.js`: add exports for new dialogs.

3. `views/body/ImageView.js`:
   - Import `PixelClassifierPanel`
   - In the section where `DrawWidget` and `AnnotationSelector` are instantiated, also instantiate `PixelClassifierPanel({itemId: this.model.id, accessLevel: this._accessLevel})`
   - Mount to a new `#h-pixel-classifier-panel` element in the template
   - Wire `setCheckedItems` when checked items change (reuse existing `_checkedItemIds` tracking)

4. The HTML template for ImageView already has a collapsible panel structure — add a new panel entry for the Pixel Classifier tab.

---

### Phase E — Integration testing & smoke test

1. Register CLIs in a running DSA instance.
2. Open a slide, set up a 2-class session, paint brief annotations, trigger training, verify overlay appears.
3. Paint corrections, retrain, verify new overlay.
4. Select a second slide, apply model, verify overlay appears on that slide.
5. Run `pre-commit run --all-files` (both repos).
6. Run `tox -e lint,py310` in histomicstk and `tox -e lint` in HistomicsUI.

## Complexity Tracking

No constitution violations. No additional complexity justification required.
