# Contract: TRIDENT Job Submission API

**Type**: REST API (slicer_cli_web passthrough)
**Date**: 2026-04-22

## Submit Embedding Job

**Endpoint**: `POST /api/v1/slicer_cli_web/cli/{cli_id}/run`

Where `{cli_id}` is the slicer_cli_web ID for the `TridentEmbeddings` CLI (resolved by querying `GET /api/v1/slicer_cli_web/cli` and finding the entry with `name=TridentEmbeddings`).

**Request body** (form-encoded or JSON):

| Parameter | Type | Required | Description |
|---|---|---|---|
| `task` | string | yes | One of: `seg`, `coords`, `feat`, `all` |
| `wsi_dir` | string | yes | Container-internal path to WSI directory |
| `job_dir` | string | yes | Container-internal path for outputs |
| `patch_encoder` | string | yes (feat/all) | Encoder model name |
| `patch_encoder_ckpt_path` | string | no | Container-internal checkpoint path |
| `mag` | integer | yes (coords/all) | One of: 5, 10, 20, 40, 80 |
| `patch_size` | integer | yes (coords/all) | Patch size in pixels |
| `overlap` | integer | no | Pixel overlap; default 0 |
| `min_tissue_proportion` | double | no | 0.0–1.0; default 0.0 |
| `segmenter` | string | no | `hest` or `grandqc`; default `hest` |
| `seg_conf_thresh` | double | no | 0.0–1.0; default 0.5 |
| `remove_holes` | boolean | no | default false |
| `remove_artifacts` | boolean | no | default false |
| `remove_penmarks` | boolean | no | default false |
| `slide_encoder` | string | no | Slide encoder name or `none` |
| `slide_encoder_ckpt_path` | string | no | Container-internal checkpoint path |
| `gpu` | integer | no | GPU index; default 0 |
| `batch_size` | integer | no | Default batch size; default 64 |
| `seg_batch_size` | integer | no | Segmentation batch size override; 0=use batch_size |
| `feat_batch_size` | integer | no | Feature extraction batch size override; 0=use batch_size |
| `max_workers` | integer | no | 0=auto |
| `skip_errors` | boolean | no | default false |
| `saveas` | string | no | `h5` or `pt`; default `h5` |
| `search_nested` | boolean | no | default false |
| `wsi_ext` | string | no | Comma-separated extensions (e.g., `.svs,.ndpi`) |
| `reader_type` | string | no | `auto`, `openslide`, `image`, `cucim`, `sdpc` |
| `custom_mpp_keys` | string | no | Comma-separated MPP metadata key names |
| `custom_list_of_wsis` | string | no | Container path to CSV file |
| `wsi_cache` | string | no | Container path for SSD staging cache |
| `cache_batch_size` | integer | no | default 32 |

**Response** (success `200 OK`):
```json
{
  "_id": "<girder_job_id>",
  "status": 0,
  "title": "TridentEmbeddings",
  "type": "histomicstk_job"
}
```

**Error responses**:
- `400` — missing required parameter or invalid value
- `403` — insufficient permissions
- `404` — CLI not registered (`TridentEmbeddings` not in slicer_cli_web)

---

## Check CLI Availability

**Endpoint**: `GET /api/v1/slicer_cli_web/cli`

Returns array of registered CLI tools. Filter for entries where `name == "TridentEmbeddings"`. If no match, the TRIDENT action button must be hidden.

---

## Get Folder Filesystem Path

**Endpoint**: `GET /api/v1/resource/{folderId}/path?type=folder`

**Response**: Plain text string — the container-accessible filesystem path for the given Girder folder (assetstore path).

Used to pre-populate the `wsi_dir` field in the submission form.
