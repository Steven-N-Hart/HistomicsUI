# Research: TRIDENT Embedding Pipeline

**Feature**: `001-trident-embedding-pipeline`
**Date**: 2026-04-22

## Decision 1: Deployment Architecture — Slicer CLI Docker Image

**Decision**: Package TRIDENT as a Slicer CLI tool inside a new Docker image derived from `dsarchive/histomicstk`.

**Rationale**: Consistent with all existing HistomicsTK algorithms (NucleiDetection, ColorDeconvolution, etc.). The `slicer_cli_web` plugin provides XML-driven form auto-generation, job lifecycle management, Docker execution, and log streaming — all needed features, all available for free by following this pattern. The XML parameter spec directly drives the UI form, eliminating the need to hand-code 25+ form fields.

**Alternatives considered**:
- Custom Girder REST endpoint + Celery task: More backend code, duplicates job tracking infrastructure already in slicer_cli_web
- Direct Python callable in girder container: Breaks deployment isolation, complicates TRIDENT dependency management

**Files affected**:
- `histomicstk/cli/TridentEmbeddings/TridentEmbeddings.xml` (new)
- `histomicstk/cli/TridentEmbeddings/TridentEmbeddings.py` (new)
- `histomicstk/cli/slicer_cli_list.json` (update)
- `histomicstk/Dockerfile` (update — install TRIDENT)

---

## Decision 2: Directory/Path Parameters — String Types, Not Girder References

**Decision**: Use `<string>` XML parameter type for `wsi_dir` (WSI source), `job_dir` (output), and all checkpoint paths. Do **not** use `<directory>` with `reference="_girder_id_"` for the WSI source.

**Rationale**: The standard `<directory>` with `reference="_girder_id_"` would cause slicer_cli_web/girder_worker to download the entire Girder folder contents to a temporary volume before running the container — completely impractical for WSI collections measured in terabytes. Instead, the operator mounts the DSA assetstore (and an output volume) into the TRIDENT container; the user provides container-internal paths. This is explicitly acknowledged in the spec's assumptions.

**Mechanics**: With `<string>` parameters, slicer_cli_web passes the value verbatim as a CLI argument (`--wsi_dir <value>`). No file download or volume magic occurs — the container must already have access to those paths via its volume mounts.

**Deployment requirement**: The TRIDENT Docker container's `docker-compose.override.yml` must mount:
- The assetstore path (read, same mount as girder container)
- An output directory (read-write, user-specified)
- Model checkpoint directories (read-only)

**Alternatives considered**:
- `<directory>` with `reference="_girder_id_"`: Downloads files from Girder — untenable at WSI scale (TBs)
- `<image>` per WSI: Wrong model — TRIDENT is a batch pipeline, not a per-slide tool

---

## Decision 3: Folder Action Entry Point — HierarchyWidget Wrap + Dialog

**Decision**: Wrap Girder's `HierarchyWidget.initialize` (pattern already used in `histomicsui/web_client/views/HierarchyWidget.js`) to inject a "TRIDENT Embeddings" button into the folder toolbar when the user is browsing a folder (not a collection root or user home). Clicking opens a Backbone dialog pre-populated with the folder's filesystem path.

**Rationale**: The quarantine button in `histomicsui/web_client/views/itemList.js` demonstrates the exact wrapping pattern. HierarchyWidget renders the folder navigation that users interact with in DSA. Placing the action here (visible from the folder view) aligns with the "folder context action" decision made during spec.

**Pre-fill mechanism**: Use the existing `GET /api/v1/resource/{id}/path?type=folder` REST endpoint (implemented in `histomicsui/rest/system.py`, already used by ConfigView.js and openAnnotatedImage.js) to resolve the Girder folder ID to a filesystem path, then inject it as the default `wsi_dir` value in the parameter form.

**TRIDENT availability guard**: The button is only rendered if the TRIDENT CLI is registered in slicer_cli_web (query `GET /slicer_cli_web/cli` and check for a `TridentEmbeddings` entry). If not registered, the button is hidden — satisfying Constitution Principle III (graceful degradation).

**Alternatives considered**:
- Image viewer analysis menu: Wrong scope — TRIDENT processes directories of WSIs, not single slides
- Custom folder detail page: No existing pattern; would require routing changes
- Collection action (right-click menu): Girder's item actions are on items, not containers; HierarchyWidget is the right hook point

---

## Decision 4: TRIDENT Python API — Processor Class (Not main())

**Decision**: The CLI wrapper (`TridentEmbeddings.py`) calls the `Processor` class API directly, along with `encoder_factory()`, `segmentation_model_factory()`, and `slide_encoder_factory()`. It does NOT call `run_batch_of_slides.main()`.

**Rationale**: `run_batch_of_slides.main()` uses `sys.argv` and is not programmatically callable in the Slicer CLI wrapper context (where args come from `CLIArgumentParser().parse_args()`). The `Processor` class provides a clean, well-typed Python API. The wrapper maps CLI args → Processor constructor + method calls.

**API mapping summary**:
```
Processor(job_dir, wsi_source=wsi_dir, wsi_ext, skip_errors, custom_mpp_keys, 
          custom_list_of_wsis, max_workers, reader_type, search_nested)

run_segmentation_job(segmentation_model, device, batch_size=seg_batch_size, ...)
run_patching_job(target_magnification=mag, patch_size, overlap, 
                 min_tissue_proportion, saveto=coords_dir)
run_patch_feature_extraction_job(coords_dir, patch_encoder, device, 
                                  saveas, batch_limit=feat_batch_size)
run_slide_feature_extraction_job(slide_encoder, coords_dir, device, 
                                  saveas, batch_limit)
```

---

## Decision 5: HistomicsUI Panel — slicer_cli_web Form Auto-Generation in Dialog

**Decision**: Create a new Backbone dialog view (`dialogs/tridentEmbeddings.js`) that fetches the TRIDENT CLI spec from slicer_cli_web and renders its parameter form. Use the slicer_cli_web `CliWidget` or equivalent Panel class to auto-generate the form from the XML spec, then override the `wsi_dir` field default with the resolved folder path.

**Rationale**: The XML-driven form generation in slicer_cli_web eliminates hand-coding 25+ individual form fields and keeps the form in sync with the XML spec automatically. The dialog architecture is independent of the image viewer, appropriate for a batch pipeline.

**Alternatives considered**:
- Hand-built Backbone form: Requires maintaining 25+ fields manually, duplicates slicer_cli_web work
- Embed in ImageView/SlicerPanelGroup: Tightly coupled to single-image context, wrong scope

---

## Resolved Unknowns

| Unknown | Resolution |
|---------|------------|
| Does slicer_cli_web support directory inputs efficiently for TB-scale WSI collections? | No — use `<string>` params + volume mounts instead of `<directory>` with Girder reference |
| Can `run_batch_of_slides.main()` be called programmatically? | No (sys.argv) — use `Processor` class API directly |
| How to add a folder-level action in HistomicsUI? | Wrap `HierarchyWidget.initialize` (same pattern as quarantine in itemList.js) |
| How to get a folder's filesystem path from the frontend? | `GET /api/v1/resource/{id}/path?type=folder` — already implemented in system.py |
| Is the Slicer CLI XML form auto-generation reusable outside the image viewer? | Yes — slicer_cli_web CliWidget/Panel can be instantiated in any Backbone view |
