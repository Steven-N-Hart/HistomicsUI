# Data Model: TRIDENT Embedding Pipeline

**Feature**: `001-trident-embedding-pipeline`
**Date**: 2026-04-22

## Overview

This feature produces filesystem-based outputs (not Girder data model additions). The primary entities are files written by TRIDENT to the user-specified `job_dir`. Job execution metadata lives in the existing Girder `Job` model managed by slicer_cli_web.

---

## Entity 1: EmbeddingJob

**What it represents**: A single TRIDENT pipeline execution — submitted by a user from a DSA folder, tracked via the Girder jobs system.

**Storage**: Girder `Job` model (MongoDB); job kwargs stored as BSON

**Fields** (beyond standard Girder Job fields):
| Field | Type | Description |
|---|---|---|
| `title` | string | "TRIDENT Embedding Pipeline" |
| `type` | string | `"histomicstk_job"` (slicer_cli_web convention) |
| `kwargs.wsi_dir` | string | Container-internal path to WSI source directory |
| `kwargs.job_dir` | string | Container-internal path to output directory |
| `kwargs.task` | string | `seg`, `coords`, `feat`, or `all` |
| `kwargs.patch_encoder` | string | Encoder model name (e.g., `conch_v15`) |
| `kwargs.patch_encoder_ckpt_path` | string | Container-internal checkpoint path (optional) |
| `kwargs.slide_encoder` | string | Slide encoder name (optional) |
| `kwargs.mag` | integer | Magnification level |
| `kwargs.patch_size` | integer | Patch size in pixels |
| `kwargs.overlap` | integer | Patch overlap in pixels |
| `kwargs.segmenter` | string | `hest` or `grandqc` |
| `kwargs.*` | various | All other TRIDENT CLI parameters |
| `status` | integer | `0`=inactive, `1`=queued, `2`=running, `3`=success, `4`=error, `5`=cancelled |
| `log` | array | TRIDENT stdout/stderr log lines |

**State transitions**:
```
inactive → queued → running → success
                           ↘ error
                           ↘ cancelled
```

---

## Entity 2: PatchEmbeddings (filesystem)

**What it represents**: Per-patch feature vectors for a single WSI, output by the `feat` pipeline stage.

**Storage**: HDF5 (`.h5`) or PyTorch tensor (`.pt`) files on local filesystem

**Location**: `{job_dir}/{mag}x_{patch_size}px_{overlap}px_overlap/features_{encoder_name}/{wsi_name}.h5`

**HDF5 structure**:
```
{wsi_name}.h5
├── features     # float32 array, shape (n_patches, feature_dim)
└── coords       # int32 array, shape (n_patches, 2) — (x, y) pixel coordinates
```

**Relationships**: One file per (WSI, encoder model) combination within a job.

---

## Entity 3: PatchCoordinates (filesystem)

**What it represents**: (x, y) pixel coordinates of extracted tissue patches for a single WSI, output by the `coords` pipeline stage.

**Storage**: HDF5 (`.h5`) files on local filesystem

**Location**: `{job_dir}/{mag}x_{patch_size}px_{overlap}px_overlap/patches/{wsi_name}_patches.h5`

**HDF5 structure**:
```
{wsi_name}_patches.h5
└── coords    # int32 array, shape (n_patches, 2) — (x, y) in pixel space at target magnification
```

---

## Entity 4: SegmentationOutputs (filesystem)

**What it represents**: Tissue boundary contours and GeoJSON masks for a single WSI, output by the `seg` pipeline stage.

**Storage**: PNG images and GeoJSON files on local filesystem

**Locations**:
- `{job_dir}/contours/{wsi_name}.png` — RGB thumbnail with green tissue contour overlay
- `{job_dir}/contours_geojson/{wsi_name}.geojson` — GeoJSON polygon(s) defining tissue regions
- `{job_dir}/thumbnails/{wsi_name}.png` — WSI thumbnail without overlay

**Validation rules**: GeoJSON polygons must have a `Polygon` or `MultiPolygon` geometry type.

---

## Entity 5: SlideEmbeddings (filesystem, optional)

**What it represents**: A single aggregated feature vector per WSI at the slide level, output by an optional slide encoder.

**Storage**: HDF5 (`.h5`) or PyTorch tensor (`.pt`) files on local filesystem

**Location**: `{job_dir}/{mag}x_{patch_size}px_{overlap}px_overlap/slide_features_{slide_encoder_name}/{wsi_name}.h5`

**HDF5 structure**:
```
{wsi_name}.h5
└── features    # float32 array, shape (feature_dim,)
```

---

## Configuration Artifacts (filesystem)

TRIDENT writes reproducibility config files alongside each stage's outputs:
- `{job_dir}/_config_segmentation.json` — segmentation parameters
- `{job_dir}/{patching_dir}/_config_coords.json` — patching parameters
- `{job_dir}/{patching_dir}/_config_feats_{encoder_name}.json` — feature extraction parameters

---

## Entity Relationships

```
EmbeddingJob
├── produces → SegmentationOutputs (1 per WSI, if task includes seg)
├── produces → PatchCoordinates (1 per WSI, if task includes coords)
├── produces → PatchEmbeddings (1 per WSI, if task includes feat)
└── produces → SlideEmbeddings (1 per WSI, if slide_encoder specified)

All filesystem entities are identified by (job_dir, wsi_name, encoder_name).
```
