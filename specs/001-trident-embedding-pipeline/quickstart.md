# Quickstart: TRIDENT Embedding Pipeline Development

## Prerequisites

- DSA running locally (`cd devops/dsa && DSA_USER=$(id -u):$(id -g) docker compose up -d`)
- TRIDENT cloned at `~/code/TRIDENT/`
- HistomicsTK fork cloned at `~/code/histomicstk/`
- HistomicsUI fork cloned at `~/code/HistomicsUI/`

## Step 1: Add TRIDENT to HistomicsTK Image

1. Edit `~/code/histomicstk/Dockerfile` to install TRIDENT:
   ```dockerfile
   # After existing pip install steps:
   COPY TRIDENT /opt/TRIDENT
   RUN pip install /opt/TRIDENT
   ```
2. Copy TRIDENT source or mount it (for dev, use docker-compose.override.yml volume):
   ```yaml
   services:
     girder:
       volumes:
         - ~/code/TRIDENT:/opt/TRIDENT
   ```
3. Rebuild: `DSA_USER=$(id -u):$(id -g) docker compose build girder`

## Step 2: Add TridentEmbeddings CLI Tool

Create the 3 files in `~/code/histomicstk/histomicstk/cli/TridentEmbeddings/`:
- `__init__.py` — empty
- `TridentEmbeddings.xml` — full parameter spec (see plan.md Phase 1)
- `TridentEmbeddings.py` — wrapper calling TRIDENT Processor API

Add to `histomicstk/cli/slicer_cli_list.json`:
```json
"TridentEmbeddings": { "type": "python" }
```

## Step 3: Register Image in DSA

In `devops/dsa/provision.yaml` (or `provision.local.yaml`):
```yaml
slicer-cli-image:
  - dsarchive/histomicstk:latest
```

Or pull/update the image manually and restart.

## Step 4: Mount Volumes for Model Checkpoints

In `devops/dsa/docker-compose.override.yml`:
```yaml
services:
  girder:
    volumes:
      - /path/to/model/checkpoints:/checkpoints:ro
      - /path/to/embedding/output:/embeddings:rw
      - /path/to/wsi/assetstore:/assetstore:ro
```

The TRIDENT job container needs the same mounts — configure via slicer_cli_web's docker-params or girder_worker volume settings.

## Step 5: Rebuild HistomicsUI Client

After modifying `histomicsui/web_client/`:
```bash
docker compose exec girder bash -lc 'rebuild_and_restart_girder.sh'
```

## Step 6: Smoke Test

1. Open DSA at `http://localhost:8080`
2. Navigate to a folder containing WSIs
3. Verify "TRIDENT Embeddings" button appears in the folder toolbar
4. Click, fill in `job_dir` and a valid `patch_encoder_ckpt_path`
5. Submit and monitor the job in the Jobs panel
6. Confirm embedding files appear in the output directory

## Lint

```bash
cd ~/code/HistomicsUI
pre-commit run --all-files

cd ~/code/histomicstk
docker exec dsa-girder-1 bash -lc 'tox -e lint,py310'
```
