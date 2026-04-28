# Research: Pixel-Level Classifier with Active Learning

## Decision 1 — Annotation Storage Format

**Decision**: Use `large_image_annotation` pixelmap element type (stored via Girder annotation API: `POST /annotation`).

**Rationale**: `DrawWidget.js` already has full brush-painting support for pixelmap elements (`'change .h-brush-shape,.h-brush-size,.h-brush-screen': '_changeBrush'` and `_brushAction`). `PixelmapContextMenu.js` already handles category assignment. No new brush infrastructure is needed — the user can paint class regions immediately with the existing Draw panel.

**Alternatives considered**:
- GeoJSON polygon annotations: rejected because polygons don't represent dense pixel masks well and would require a separate rendering pipeline.
- External raster file (GeoTIFF stored as Girder item): rejected because it would bypass the annotation layer and require a separate viewer integration.

---

## Decision 2 — ML Model for Pixel Classification

**Decision**: Linear/MLP classification head trained on TRIDENT patch embeddings (GPU-accelerated), with Random Forest on handcrafted features as a fallback when TRIDENT embeddings are not pre-computed.

**Primary path (TRIDENT embeddings available)**:
- Read patch embeddings from the pre-computed `.h5` files stored at `meta.trident.features_h5` (same source used by `BuildSlideClassifier`)
- Train a `sklearn.linear_model.LogisticRegression` or `sklearn.neural_network.MLPClassifier` head on the embeddings of annotated patches
- GPU not required for the classifier head itself (embeddings are already computed); training is near-instant
- For inference: look up embedding for each patch in the `.h5` file → classify → build pixelmap

**Fallback path (no pre-computed embeddings)**:
- Extract patch crops at configured magnification via `large_image.tileIterator`
- Encode each patch with a lightweight patch encoder (e.g., ResNet-18 pretrained on ImagePath, loaded on GPU via torch)
- Train the same sklearn head on the resulting embeddings
- GPU used for batch encoding — fast (~1–3 min per iteration for a 2 GB slide at 20×)
- Fallback also available: Random Forest on handcrafted color/LBP features (CPU-only, no torch dependency)

**`model_type` parameter values**: `"trident_linear"`, `"trident_mlp"`, `"resnet_linear"`, `"random_forest"`

**Rationale**:
- Foundation model embeddings (TRIDENT) dramatically outperform handcrafted features with few annotations — critical for the active learning "few-shot" regime.
- TRIDENT embeddings are already computed for most slides in a DSA instance that uses TRIDENT.
- GPU availability removes the key objection to on-the-fly feature extraction in the fallback path.
- sklearn classifier heads train in under 10 seconds on typical annotation counts (hundreds to low thousands of patches).

**Alternatives considered**:
- End-to-end CNN fine-tuning (U-Net, ViT): highest ceiling but requires many more annotations and much longer training (~10–30 min/iteration). Suitable for a future v2.
- Gradient boosting: similar accuracy to RF but no advantage over linear probe on foundation embeddings.

**Patch size and stride for inference**:
- Default: patch_size matching the TRIDENT h5 coordinates (typically 512px at 20×)
- Stride = patch_size (no overlap) — pixelmap resolution is one label per patch tile
- If fallback encoder used: configurable patch_size (default 256px at 20×) for speed/quality tradeoff

---

## Decision 3 — Prediction Overlay Storage

**Decision**: Post prediction as a new `pixelmap` annotation to the slide item via `POST /annotation`. Name the annotation `PixelClassifier Iteration N`.

**Rationale**:
- Predictions are immediately visible in the existing AnnotationSelector panel (user can toggle layers).
- Follows the same pattern as TRIDENT's tissue segmentation overlay (posted back as an annotation).
- No separate viewer integration needed.
- Supports overlay comparison across iterations (each iteration creates a new named annotation).

**Alternatives considered**:
- Store as a GeoTIFF file item alongside the slide: flexible but requires custom tile-serving and viewer plumbing that doesn't exist yet.
- Store raw label array in item metadata: impractical for gigapixel slides (metadata size limit).

---

## Decision 4 — Session State Storage

**Decision**: Store session state in item metadata under key `_pixelClassifierSession`.

**Rationale**:
- Analogous to `_aiExperiment` (per-folder) and `meta.trident` (per-item) patterns already in use.
- Keeps session tightly coupled to the slide (not the folder), since the classifier is trained on a specific slide's appearance.
- Survives browser reloads — panel can restore state on re-open.
- Small JSON blob (class names, Girder item IDs, iteration counters) well within metadata size limits.

**Alternatives considered**:
- Folder-level metadata: rejected because the pixel classifier is slide-specific, not folder-wide.
- localStorage: rejected by Constitution Principle IV (must be shareable across users).

---

## Decision 5 — Panel Injection Point

**Decision**: PixelClassifierPanel is instantiated in `ImageView.js` and mounted in the left-side control panel, alongside DrawWidget and AnnotationSelector.

**Rationale**: The classifier workflow is tightly coupled to a single slide in the image viewer (annotate → train → review overlay on the same slide). HierarchyWidget (used by SlideClassifierPanel) is for folder-level workflows. The ImageView left panel already hosts DrawWidget and AnnotationSelector — the PixelClassifierPanel fits there naturally.

**Alternatives considered**:
- HierarchyWidget injection (like SlideClassifierPanel): rejected because the pixel classifier is item-level, not folder-level.
- Separate sidebar: unnecessary complexity; the existing panel framework is sufficient.

---

## Decision 6 — Batch Application UX

**Decision**: "Apply to Other Slides" reads the `model_item_id` from the current item's `_pixelClassifierSession`, prompts the user to select target slides (using already-selected items from the HierarchyWidget checklist), and submits one `ApplyPixelClassifier` job per target slide.

**Rationale**: Follows the same pattern as `ApplySlideClassifier` which reads `this._checkedItemIds` from `SlideClassifierPanel`. Reuses the existing "checked items" mechanism for multi-slide selection.

---

## Decision 7 — CLI Docker Image Strategy

**Decision**: `BuildPixelClassifier` and `ApplyPixelClassifier` CLIs live in `histomicstk/histomicstk/cli/` alongside existing CLIs and run in the same `dsarchive/histomicstk` Docker image.

**Rationale**: The existing image already includes scikit-learn (used by `BuildSlideClassifier`), large_image, girder_client, and h5py. The primary training path (linear probe on TRIDENT embeddings) needs no new heavy dependencies. The GPU-accelerated fallback path (ResNet-18 on-the-fly encoding) requires torch, which is already present in the histomicstk image via TRIDENT.

**Dependencies**:
- `scikit-learn` — already present
- `scikit-image` — already present
- `h5py` — already present
- `torch` + `torchvision` — already present (TRIDENT)
- No new dependencies needed for the primary path; fallback reuses TRIDENT's torch installation.
