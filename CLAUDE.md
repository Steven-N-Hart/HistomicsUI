<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan at
`specs/002-pixel-level-classifier/plan.md`
<!-- SPECKIT END -->

# HistomicsUI CLAUDE.md

Girder plugin for whole-slide image annotation, analysis job submission, and image viewing. Backbone.js + jQuery frontend, Python backend installed as an editable package inside the DSA Docker container.

## Key commands

```bash
# Rebuild web client and restart Girder inside the running container
docker exec dsa-girder-1 bash -lc 'rebuild_and_restart_girder.sh'

# Frontend dev (outside container)
cd histomicsui/web_client && npm install
girder build --dev --watch-plugin histomicsui && girder serve

# Lint
tox -e lint           # Python (flake8 + ruff)
tox -e lintclient     # npm lint
```

## Architecture

- **HierarchyWidget.js** — wraps Girder's folder browser; injects TRIDENT, Slide Classifier, Pixel Classifier, and delete-selected buttons/panels
- **panels/** — persistent side panels (SlideClassifierPanel, PixelClassifierPanel, DrawWidget, AnnotationSelector, …)
- **dialogs/** — modal dialogs for each tool (editPixelClassifier, buildPixelClassifier, applyPixelClassifier, tridentEmbeddings, …)
- **templates/** — Pug templates matching each panel/dialog JS file

## Deployed features on `001-hierarchical-annotation-panel` branch

### Slide Classifier
Folder-scoped. Panel in `SlideClassifierPanel.js`, template `slideClassifierPanel.pug`. Session stored in folder metadata `_aiExperiment`; per-slide data in item metadata `_slideClassifierLabels`, `_aiSplit`, `_slideClassifierPrediction`. CLIs: `BuildSlideClassifier`, `ApplySlideClassifier` in histomicstk.

### Pixel Classifier
Item-scoped (per slide). Panel in `PixelClassifierPanel.js`, dialogs in `editPixelClassifier.js` / `buildPixelClassifier.js` / `applyPixelClassifier.js`. Session stored in item metadata `_pixelClassifierSession`. Annotation dropdown auto-detects classes from polygon element groups. Single-class sessions auto-sample background patches. CLIs: `BuildPixelClassifier`, `ApplyPixelClassifier`, shared utilities in `pixel_classifier_utils.py` in histomicstk. Docker rebuild: `docker build -f Dockerfile.pixel-classifier -t dsarchive/histomicstk:latest .` from histomicstk root.

## Constitution (key rules)
- Frontend-only for UI changes — no Python/backend for UI-only features
- Extend, don't replace — build on DrawWidget, AnnotationSelector, existing Slicer CLI patterns
- Graceful degradation — new panels must work when their config is absent
- All changes must pass `pre-commit run --all-files` and a browser smoke test
