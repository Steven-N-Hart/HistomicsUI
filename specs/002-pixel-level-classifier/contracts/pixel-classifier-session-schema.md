# Contract: `_pixelClassifierSession` Item Metadata Schema

Stored via `PUT /item/<id>/metadata` with key `_pixelClassifierSession`.

## JSON Schema (annotated)

```json
{
  "name": "Tumor vs Stroma",
  "classes": [
    {
      "name": "Tumor",
      "fillColor": "rgba(255, 0, 0, 0.4)",
      "strokeColor": "rgba(255, 0, 0, 1)"
    },
    {
      "name": "Stroma",
      "fillColor": "rgba(0, 200, 0, 0.4)",
      "strokeColor": "rgba(0, 200, 0, 1)"
    }
  ],
  "magnification": 20,
  "patch_size": 64,
  "model_type": "trident_linear",
  "current_model_item_id": "68120a...",
  "training_annotation_id": "68120b...",
  "iterations": [
    {
      "num": 1,
      "job_id": "68120c...",
      "model_item_id": "68120a...",
      "overlay_annotation_id": "68120d...",
      "trained_at": "2026-04-27T14:30:00Z",
      "n_train_patches": 842
    }
  ],
  "created_at": "2026-04-27T14:00:00Z",
  "updated_at": "2026-04-27T14:31:00Z"
}
```

## Validation Rules

- `name`: non-empty string, max 100 chars
- `classes`: array, length 2–10, all names unique
- `magnification`: integer, one of `[5, 10, 20, 40]`
- `patch_size`: integer, one of `[256, 512]` (TRIDENT/ResNet paths) or `[64, 128, 256]` (RF fallback)
- `model_type`: one of `["trident_linear", "trident_mlp", "resnet_linear", "random_forest"]`
- `current_model_item_id`: valid Girder item ID or `null`
- `training_annotation_id`: valid Girder annotation ID or `null`
- `iterations`: array (may be empty), ordered by `num`

## Writer Responsibilities

- **Frontend**: writes `name`, `classes`, `magnification`, `patch_size`, `model_type`, `training_annotation_id`, `created_at`; updates `updated_at` on edits; appends skeleton `{num, job_id}` entries when submitting training jobs
- **BuildPixelClassifier CLI**: stamps `model_item_id`, `overlay_annotation_id`, `trained_at`, `n_train_patches` into the iteration entry; sets `current_model_item_id`
