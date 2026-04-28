# Data Model: Pixel-Level Classifier with Active Learning

## Entities

### PixelClassifierSession
Stored in Girder item metadata under key `_pixelClassifierSession` on the training slide item.

| Field | Type | Description |
|---|---|---|
| `name` | string | User-defined session name |
| `classes` | ClassDefinition[] | Ordered list of class definitions (index = category ID) |
| `magnification` | number | Magnification at which patches are extracted (default: 20) |
| `patch_size` | number | Square patch size in pixels (default: 64) |
| `model_type` | string | `"trident_linear"`, `"trident_mlp"`, `"resnet_linear"`, or `"random_forest"` |
| `current_model_item_id` | string | Girder item ID of the latest trained model (.pkl) |
| `training_annotation_id` | string | Girder annotation ID of the accumulating training pixelmap |
| `iterations` | Iteration[] | Ordered history of training runs |
| `created_at` | string | ISO-8601 timestamp |
| `updated_at` | string | ISO-8601 timestamp |

**State transitions**:
- `created`: session initialized, no annotations yet
- `annotating`: user has painted at least one region, no model trained
- `training`: a BuildPixelClassifier job is in-flight
- `trained`: model available, overlay posted
- `applying`: one or more ApplyPixelClassifier jobs in-flight

---

### ClassDefinition
Embedded within `PixelClassifierSession.classes`.

| Field | Type | Description |
|---|---|---|
| `name` | string | Display label (e.g., "Tumor", "Stroma") |
| `fillColor` | string | CSS rgba string for overlay color (e.g., `"rgba(255,0,0,0.4)"`) |
| `strokeColor` | string | CSS rgba string for annotation outline |

**Validation**: minimum 2 classes, maximum 10. Names must be unique within a session.  
**Note**: `category_id` (integer index into the pixelmap's `categories` array) is the positional index of the class in this array — no separate field needed.

---

### Iteration
Embedded within `PixelClassifierSession.iterations`.

| Field | Type | Description |
|---|---|---|
| `num` | integer | 1-based iteration counter |
| `job_id` | string | Girder job ID of the BuildPixelClassifier run |
| `model_item_id` | string | Girder item ID where `model.pkl` was uploaded |
| `overlay_annotation_id` | string | Girder annotation ID of the prediction pixelmap |
| `trained_at` | string | ISO-8601 timestamp when job completed |
| `n_train_patches` | integer | Number of annotated patches used for training |

---

### TrainingAnnotation
A Girder annotation (via `large_image_annotation`) posted to the training slide.

**Annotation name**: `PixelClassifier Training — <session_name>`

**Element** (single pixelmap element):
```json
{
  "type": "pixelmap",
  "values": [0, 1, 2, ...],
  "categories": [
    {"label": "Tumor", "fillColor": "rgba(255,0,0,0.4)", "strokeColor": "rgba(255,0,0,1)"},
    {"label": "Stroma", "fillColor": "rgba(0,255,0,0.4)", "strokeColor": "rgba(0,255,0,1)"}
  ],
  "boundaries": [x, y, width, height]
}
```

Pixels outside the annotated region have value 0 (reserved as "unlabeled" — not used in training).

---

### PredictionOverlayAnnotation
A Girder annotation posted to the target slide by the CLI after training or inference.

**Annotation name**: `PixelClassifier Iteration <N> — <session_name>` (training slide) or `PixelClassifier Applied — <session_name>` (other slides)

**Element** (single pixelmap, same schema as TrainingAnnotation):
- `values`: predicted class index per pixel (0 = background/unlabeled class 0, 1 = class 1, etc.)
- `categories`: same color/label definitions as the session's ClassDefinition list
- Covers the full slide extent (or a configured region)

---

### ModelItem
A Girder item created by the CLI in the user's Private folder under `Pixel Classifier Models/<session_name>/run_<timestamp>/`.

**Files** (uploaded to the item):
- `model.pkl` — serialized model bundle (`{'model': Pipeline, 'embedder': 'trident_linear'|'resnet18'|'handcrafted', 'classes': [...], 'patch_size': 512, 'magnification': 20}`)
- `training_report.json` — OOB accuracy, per-class precision/recall, patch counts per class

**Metadata** (`pixelClassifierModel`):
```json
{
  "session_name": "...",
  "training_item_id": "...",
  "iteration": 3,
  "classes": ["Tumor", "Stroma"],
  "patch_size": 64,
  "magnification": 20,
  "oob_accuracy": 0.93,
  "completed_at": "2026-04-27T..."
}
```

---

## Key Relationships

```
Girder Item (slide)
  └── metadata._pixelClassifierSession  →  PixelClassifierSession
        ├── training_annotation_id      →  Girder Annotation (TrainingAnnotation)
        └── iterations[].overlay_annotation_id → Girder Annotation (PredictionOverlay)

Girder Item (model, in user Private)
  ├── model.pkl
  └── metadata.pixelClassifierModel
```
