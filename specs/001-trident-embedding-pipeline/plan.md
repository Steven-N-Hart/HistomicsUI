# Implementation Plan: TRIDENT Embedding Pipeline

**Branch**: `001-trident-embedding-pipeline` | **Date**: 2026-04-22 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/001-trident-embedding-pipeline/spec.md`

## Summary

Enable researchers to generate TRIDENT patch/slide-level embeddings from a DSA folder of WSIs via a folder-context action in HistomicsUI. TRIDENT is packaged as a Slicer CLI Docker image (derived from `dsarchive/histomicstk`), exposing all TRIDENT CLI parameters via a `TridentEmbeddings.xml` spec. The HistomicsUI frontend wraps Girder's `HierarchyWidget` to inject a folder-level "TRIDENT Embeddings" action that opens a parameter dialog pre-populated with the folder's filesystem path. All directory paths (WSI source, output dir, checkpoint paths) are `<string>` parameters — the operator mounts the DSA assetstore and output volume into the TRIDENT container.

## Technical Context

**Language/Version**: JavaScript ES6 (HistomicsUI frontend); Python 3.11+ (HistomicsTK CLI); Docker (container image)
**Primary Dependencies**:
- Frontend: Backbone.js, jQuery, `@girder/core`, `@girder/slicer_cli_web`
- Backend (HistomicsTK): TRIDENT 0.2.0 (`/home/m087494/code/TRIDENT/`), `histomicstk.cli.utils.CLIArgumentParser`, PyTorch + CUDA
**Storage**: Local filesystem (HDF5/PT embedding files); MongoDB via Girder (Job records — no schema changes)
**Testing**: `pre-commit run --all-files` + browser smoke test (HistomicsUI); `tox -e lint,py310,py313` (HistomicsTK)
**Target Platform**: DSA Docker deployment, Linux, CUDA-capable GPU node
**Project Type**: web-service (HistomicsUI) + CLI tool (HistomicsTK) — multi-repo
**Performance Goals**: UI submission ≤ 5 min; embedding throughput governed by TRIDENT + GPU
**Constraints**: No external network calls for model weights (pre-downloaded checkpoints only); container-internal paths for all I/O; no changes to HistomicsUI Python backend (use existing REST endpoints)
**Scale/Scope**: 2 repos × ~4 files each; designed for 100+ WSI cohorts

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Frontend-only for UI features | ✓ Pass | The HistomicsUI Python backend is unchanged. New Python code lives in HistomicsTK (separate repo, algorithm implementation). |
| II. Extend, don't replace | ✓ Pass | Wraps existing `HierarchyWidget`; reuses slicer_cli_web panel infrastructure; uses existing `GET /resource/{id}/path` endpoint. |
| III. Graceful degradation | ⚠️ Required action | TRIDENT folder action button must be hidden when the TRIDENT CLI is not registered in slicer_cli_web. Query `GET /slicer_cli_web/cli` on init; show button only if `TridentEmbeddings` entry exists. |
| IV. Folder-scoped config | ✓ N/A | TRIDENT parameters are submitted per job, not persisted in folder config. |
| V. Lint and build | ✓ Standard | Must pass `pre-commit run --all-files` and produce working client build. |

**Post-design re-check**: All principles satisfied. Principle III requires an explicit availability check in the HierarchyWidget wrapper — included as an implementation task.

## Project Structure

### Documentation (this feature)

```text
specs/001-trident-embedding-pipeline/
├── plan.md              ← This file
├── spec.md
├── research.md
├── data-model.md
└── checklists/
    └── requirements.md
```

### Source Code — HistomicsTK (`/home/m087494/code/histomicstk/`)

```text
histomicstk/cli/
├── TridentEmbeddings/
│   ├── __init__.py                   ← new (empty package marker)
│   ├── TridentEmbeddings.py          ← new (Slicer CLI Python wrapper)
│   └── TridentEmbeddings.xml         ← new (25+ parameter spec)
└── slicer_cli_list.json              ← update (add TridentEmbeddings entry)

Dockerfile                            ← update (pip install trident + deps)
```

### Source Code — HistomicsUI (`/home/m087494/code/HistomicsUI/`)

```text
histomicsui/web_client/
├── views/
│   └── HierarchyWidget.js            ← update (inject TRIDENT folder action button)
├── dialogs/
│   └── tridentEmbeddings.js          ← new (dialog: fetch CLI spec, render form, submit job)
└── main.js                           ← update (import tridentEmbeddings.js)
```

**Structure Decision**: Multi-repo feature. Backend algorithm code follows the established HistomicsTK `cli/` pattern. Frontend follows the established HistomicsUI `wrap + dialog` pattern.

---

## Phase 0 Output: research.md ✓

All unknowns resolved — see [research.md](research.md).

---

## Phase 1 Design

### HistomicsTK: TridentEmbeddings Slicer CLI

#### `TridentEmbeddings.xml` — Parameter Groups

**Group 1: Pipeline Control** (required)
- `task` — `<string-enumeration>` choices: `seg`, `coords`, `feat`, `all`; default `all`
- `wsi_dir` — `<string>` (container-internal path to WSI directory)
- `job_dir` — `<string>` (container-internal output path)

**Group 2: Patch Encoder** (required when task includes `feat`)
- `patch_encoder` — `<string-enumeration>` 21 choices (uni_v1, conch_v15, virchow, …)
- `patch_encoder_ckpt_path` — `<string>` default `""` (empty = no local ckpt → auto-download; but spec says pre-downloaded: users put path here)

**Group 3: Patching** (required when task includes `coords` or `all`)
- `mag` — `<integer-enumeration>` choices: `5, 10, 20, 40, 80`; default `20`
- `patch_size` — `<integer>` default `512`
- `overlap` — `<integer>` default `0`
- `min_tissue_proportion` — `<double>` min 0 max 1, default `0.0`
- `coords_dir` — `<string>` default `""` (auto-generated if empty)

**Group 4: Segmentation** (advanced, relevant when task includes `seg` or `all`)
- `segmenter` — `<string-enumeration>` choices: `hest`, `grandqc`; default `hest`
- `seg_conf_thresh` — `<double>` min 0 max 1, default `0.5`
- `remove_holes` — `<boolean>` default `false`
- `remove_artifacts` — `<boolean>` default `false`
- `remove_penmarks` — `<boolean>` default `false`

**Group 5: Slide Encoder** (advanced, optional)
- `slide_encoder` — `<string-enumeration>` choices: `none`, `threads`, `titan`, `prism`, `chief`, `gigapath`, `madeleine`, `feather` + mean-pool variants; default `none`
- `slide_encoder_ckpt_path` — `<string>` default `""`

**Group 6: Execution** (advanced)
- `gpu` — `<integer>` default `0`
- `batch_size` — `<integer>` default `64`
- `seg_batch_size` — `<integer>` default `0` (0 = use `batch_size`)
- `feat_batch_size` — `<integer>` default `0` (0 = use `batch_size`)
- `max_workers` — `<integer>` default `0` (0 = auto)
- `skip_errors` — `<boolean>` default `false`
- `saveas` — `<string-enumeration>` choices: `h5`, `pt`; default `h5`
- `search_nested` — `<boolean>` default `false`

**Group 7: WSI Source** (advanced)
- `wsi_ext` — `<string>` default `""` (comma-separated, e.g., `.svs,.ndpi`)
- `reader_type` — `<string-enumeration>` choices: `auto`, `openslide`, `image`, `cucim`, `sdpc`; default `auto`
- `custom_mpp_keys` — `<string>` default `""` (comma-separated keys)
- `custom_list_of_wsis` — `<string>` default `""` (path to CSV)
- `wsi_cache` — `<string>` default `""` (SSD staging path)
- `cache_batch_size` — `<integer>` default `32`

#### `TridentEmbeddings.py` — Wrapper Logic

```python
from histomicstk.cli.utils import CLIArgumentParser
from trident import Processor
from trident.segmentation_models.load import segmentation_model_factory
from trident.patch_encoder_models.load import encoder_factory as patch_encoder_factory
from trident.slide_encoder_models.load import encoder_factory as slide_encoder_factory

def main(args):
    device = f'cuda:{args.gpu}' if args.gpu >= 0 else 'cpu'
    
    # Build Processor kwargs, converting empty strings to None
    processor = Processor(
        job_dir=args.job_dir,
        wsi_source=args.wsi_dir,
        wsi_ext=parse_csv_list(args.wsi_ext) or None,
        skip_errors=args.skip_errors,
        custom_mpp_keys=parse_csv_list(args.custom_mpp_keys) or None,
        custom_list_of_wsis=args.custom_list_of_wsis or None,
        max_workers=args.max_workers or None,
        reader_type=args.reader_type if args.reader_type != 'auto' else None,
        search_nested=args.search_nested,
    )
    
    task = args.task
    seg_batch = args.seg_batch_size or args.batch_size
    feat_batch = args.feat_batch_size or args.batch_size

    if task in ('seg', 'all'):
        seg_model = segmentation_model_factory(
            args.segmenter,
            confidence_thresh=args.seg_conf_thresh,
            remove_artifacts=args.remove_artifacts or args.remove_penmarks,
        )
        processor.run_segmentation_job(
            segmentation_model=seg_model,
            holes_are_tissue=not args.remove_holes,
            batch_size=seg_batch,
            device=device,
        )

    if task in ('coords', 'all'):
        processor.run_patching_job(
            target_magnification=args.mag,
            patch_size=args.patch_size,
            overlap=args.overlap,
            min_tissue_proportion=args.min_tissue_proportion,
            saveto=args.coords_dir or None,
        )

    coords_dir = args.coords_dir or (
        f'{args.mag}x_{args.patch_size}px_{args.overlap}px_overlap'
    )

    if task in ('feat', 'all'):
        ckpt = args.patch_encoder_ckpt_path or None
        patch_enc = patch_encoder_factory(
            args.patch_encoder,
            weights_path=ckpt,
        )
        processor.run_patch_feature_extraction_job(
            coords_dir=coords_dir,
            patch_encoder=patch_enc,
            device=device,
            saveas=args.saveas,
            batch_limit=feat_batch,
        )
        if args.slide_encoder and args.slide_encoder != 'none':
            slide_ckpt = args.slide_encoder_ckpt_path or None
            slide_enc = slide_encoder_factory(
                args.slide_encoder,
                weights_path=slide_ckpt,
            )
            processor.run_slide_feature_extraction_job(
                slide_encoder=slide_enc,
                coords_dir=coords_dir,
                device=device,
                saveas=args.saveas,
                batch_limit=feat_batch,
            )

    processor.release()

if __name__ == '__main__':
    main(CLIArgumentParser().parse_args())
```

#### `Dockerfile` Update

Add after existing `pip install` steps in `histomicstk/Dockerfile`:
```dockerfile
RUN pip install /opt/TRIDENT   # or: pip install git+https://github.com/mahmoodlab/TRIDENT
```
For local development with TRIDENT at `~/code/TRIDENT/`, the compose override mounts it:
```yaml
# docker-compose.override.yml
services:
  girder:
    volumes:
      - ~/code/TRIDENT:/opt/TRIDENT
```

---

### HistomicsUI: Folder Action + Dialog

#### `HierarchyWidget.js` — Folder Action Button

Extend the existing `wrap(HierarchyWidget, 'initialize', ...)` to:
1. After the widget renders, query `GET /slicer_cli_web/cli` to check if `TridentEmbeddings` is registered.
2. If found and the current context is a folder (not a collection root), inject a "TRIDENT Embeddings" button into the folder header toolbar.
3. Button click handler: get current folder ID from the widget model → open `TridentEmbeddingsDialog`.

Key references:
- [HierarchyWidget.js](histomicsui/web_client/views/HierarchyWidget.js) — existing wrap to extend
- [itemList.js](histomicsui/web_client/views/itemList.js) — quarantine button injection pattern

#### `dialogs/tridentEmbeddings.js` — Parameter Dialog

```javascript
// Opens a Girder ModalDialog with:
// 1. Fetch folder filesystem path: GET /resource/{folderId}/path?type=folder
// 2. Fetch TRIDENT CLI spec: GET /slicer_cli_web/cli/TridentEmbeddings/xml
//    (or find CLI id from /slicer_cli_web/cli list)
// 3. Render slicer_cli_web CliWidget for the TRIDENT CLI, with wsi_dir pre-set
// 4. On submit: POST /slicer_cli_web/cli/{cli_id}/run with form params
// 5. Show "Job submitted" notification with job link
```

Key references:
- [openImage.js](histomicsui/web_client/dialogs/openImage.js) — dialog pattern
- [ImageView.js:_getDefaultOutputFolder()](histomicsui/web_client/views/body/ImageView.js) — folder path fetch pattern
- `@girder/slicer_cli_web` — CliWidget for form rendering

#### `main.js` Update

Import `tridentEmbeddings.js` to ensure the HierarchyWidget wrap and dialog are registered at plugin load time.

---

## Contracts

See [contracts/](contracts/) — job submission API contract documented in `contracts/job-submission.md`.

---

## Quickstart (Development)

See [quickstart.md](quickstart.md) for local dev setup.

---

## Complexity Tracking

No Constitution violations. No complexity justification required.
