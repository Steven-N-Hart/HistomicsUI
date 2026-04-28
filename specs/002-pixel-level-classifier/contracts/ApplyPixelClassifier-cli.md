# Contract: ApplyPixelClassifier CLI

**File**: `histomicstk/histomicstk/cli/ApplyPixelClassifier/ApplyPixelClassifier.xml`  
**Runner**: Slicer CLI Web (invoked via `POST /slicer_cli_web/cli/<id>/run`)

## Parameters

| Name | Type | Required | Default | Description |
|---|---|---|---|---|
| `item_id` | string | Yes | — | Girder item ID of the target slide |
| `model_item_id` | string | Yes | — | Girder item ID containing the trained `model.pkl` |
| `job_dir` | string | Yes | — | Container-internal output path |
| `girderApiUrl` | string | Auto | — | Injected by Slicer CLI Web |
| `girderToken` | string | Auto | — | Injected by Slicer CLI Web |

## Outputs (posted back to Girder)

1. **Prediction annotation** `POST /annotation?itemId=<item_id>`
   - Name: `PixelClassifier Applied — <session_name>`
   - Type: pixelmap element covering full slide
   - Categories match the class definitions stored in the model item's metadata

## Exit codes

- `0`: success
- non-zero: failure (reason in stdout)

## Failure modes

- Model item not found → RuntimeError logged
- `model.pkl` not downloaded or corrupted → RuntimeError logged
- Slide cannot be opened with `large_image` → RuntimeError logged
- Magnification mismatch warning (non-fatal): logs warning, proceeds at available zoom
