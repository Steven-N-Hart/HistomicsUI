# Contract: BuildPixelClassifier CLI

**File**: `histomicstk/histomicstk/cli/BuildPixelClassifier/BuildPixelClassifier.xml`  
**Runner**: Slicer CLI Web (invoked via `POST /slicer_cli_web/cli/<id>/run`)

## Parameters

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `item_id` | string | Yes | — | Girder item ID of the training slide |
| `annotation_id` | string | Yes | — | Girder annotation ID of the training pixelmap |
| `classes_json` | string | Yes | — | JSON array of class names matching annotation category order |
| `model_type` | enum | No | `trident_linear` | `trident_linear`, `trident_mlp`, `resnet_linear`, or `random_forest` |
| `magnification` | integer | No | `20` | Magnification level for patch extraction |
| `patch_size` | integer | No | `64` | Square patch size in pixels |
| `n_estimators` | integer | No | `100` | Number of trees (random_forest only) |
| `job_dir` | string | Yes | — | Container-internal output path |
| `output_folder_id` | string | No | `""` | Girder folder for model item; defaults to user Private |
| `girderApiUrl` | string | Auto | — | Injected by Slicer CLI Web |
| `girderToken` | string | Auto | — | Injected by Slicer CLI Web |

## Outputs (posted back to Girder)

1. **Model item** uploaded to `output_folder_id/Pixel Classifier Models/<session_name>/run_<ts>/`
   - Files: `model.pkl`, `training_report.json`
   - Metadata: `pixelClassifierModel` (see data-model.md)

2. **Prediction annotation** `POST /annotation?itemId=<item_id>`
   - Name: `PixelClassifier Iteration N — <session_name>`
   - Type: pixelmap element covering full slide

3. **Item metadata update** `PUT /item/<item_id>/metadata`
   - Stamps `_pixelClassifierSession.iterations[-1].model_item_id` and `.overlay_annotation_id`
   - Updates `_pixelClassifierSession.current_model_item_id`

## Exit codes

- `0`: success
- non-zero: failure (reason in stdout)

## Failure modes

- Fewer than 2 classes annotated → RuntimeError logged, non-zero exit
- Fewer than 5 patches per class → RuntimeError logged (need more annotations)
- Annotation not found in Girder → RuntimeError logged
