# Quickstart: Pixel-Level Classifier with Active Learning

## Prerequisites

- A running DSA instance (standard `devops/dsa/` deployment)
- At least one whole-slide image item in a Girder folder
- The `dsarchive/histomicstk` worker image built with the new CLIs (see step 0)

## Step 0 — Register the new CLIs

After adding `BuildPixelClassifier` and `ApplyPixelClassifier` to `histomicstk/histomicstk/cli/` and `slicer_cli_list.json`, rebuild the histomicstk image and register it in DSA:

```bash
# From the devops/dsa/ directory:
DSA_USER=$(id -u):$(id -g) docker compose exec girder bash -lc \
  'girder-slicer-cli-web pull dsarchive/histomicstk:latest'
```

Or via the DSA admin UI: Plugins → Slicer CLI Web → Add Docker Image.

## Step 1 — Open a slide in the image viewer

Navigate to a slide item, click "Open in Viewer".

## Step 2 — Set up a classifier session

In the left control panel, find the **Pixel Classifier** tab.  
Click **Setup** and define:
- Session name
- Class names and colors (e.g., Tumor: red, Stroma: green, Background: gray)
- Magnification level (default: 20x)
- Model type (default: Random Forest)

Click **Save**. The `_pixelClassifierSession` metadata is written to the item.

## Step 3 — Annotate representative regions

In the **Draw** panel:
- Select a brush size
- Choose a class from the **Style Group** dropdown (class names are auto-registered as style groups)
- Paint regions on the slide

Repeat for all classes. Aim for 50–200 patches per class initially.

## Step 4 — Train the first model

In the **Pixel Classifier** panel, click **Train (Iteration 1)**.  
A dialog appears showing training parameters. Click **Run**.  
A Celery job is submitted; a link to the job status appears.

When training completes, a new annotation (`PixelClassifier Iteration 1 — <name>`) appears in the **Annotations** panel. Enable it to see the color-coded prediction overlay.

## Step 5 — Review and correct

Toggle the prediction overlay on and keep the Draw panel open.  
Paint corrections where the model was wrong (use the appropriate class brush).  
Corrections merge into the same training annotation.

Click **Train (Iteration 2)** when done. Repeat until satisfied.

## Step 6 — Apply to other slides

In the **Pixel Classifier** panel, click **Apply to Selected**.  
Check target slides in the folder browser (the same "checked items" used by other CLI tools), then click **Submit**.  
One `ApplyPixelClassifier` job is submitted per selected slide.  
When each job completes, a `PixelClassifier Applied` annotation appears on that slide.

## Development workflow

```bash
cd HistomicsUI/histomicsui/web_client
npm install
# From repo root:
girder build --dev --watch-plugin histomicsui
girder serve
# Then open http://localhost:8080
```

For the CLI side:
```bash
cd histomicstk
tox -e py310
```
