# HistomicsUI Constitution

## Core Principles

### I. Frontend-Only for UI Features
Changes to the annotation panel and viewer are pure frontend (JavaScript/Pug/Stylus). Never add Python/backend changes for UI-only features. The Girder REST API is the contract; use existing endpoints.

### II. Extend, Don't Replace
Build on existing patterns: StyleCollection, AnnotationSelector, DrawWidget, ImageView event wiring. Reuse `_folderConfig` for per-folder configuration. Do not create parallel systems.

### III. Graceful Degradation
New features (e.g., hierarchy) must fall back to existing flat-list behavior when the config is absent. Never break existing deployments that lack the new config fields.

### IV. Folder-Scoped Configuration
Per-folder settings live in `.histomicsui_config.yaml` via `GET/PUT folder/{id}/yaml_config/.histomicsui_config.yaml`. Do not use localStorage for data that should be shared across users viewing the same folder.

### V. Lint and Build
All changes must pass `pre-commit run --all-files` and produce a working client build via `rebuild_and_restart_girder.sh`.

## Technology Stack
- JavaScript (ES6 modules), Backbone.js, jQuery, Pug templates, Stylus CSS
- Girder core (`@girder/core`) for REST, auth, events
- `@girder/large_image_annotation` for annotation models
- `@girder/slicer_cli_web` for Panel base class

## Governance

Constitution supersedes all other practices. All changes must pass lint and a browser smoke test.

**Version**: 1.0.0 | **Ratified**: 2026-04-21
