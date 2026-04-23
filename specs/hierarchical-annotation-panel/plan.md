# Implementation Plan: Hierarchical Annotation Panel

**Branch**: `001-hierarchical-annotation-panel` | **Date**: 2026-04-21 | **Spec**: [spec.md](./spec.md)

## Summary

Replace the flat group list in AnnotationSelector with a tree view of tissue classes. The taxonomy is defined per-folder in `.histomicsui_config.yaml` (`annotationGroups.groups` with a new `parent` field). Clicking a class sets it as the active drawing class. An "Edit Classes" dialog (write-access only) persists taxonomy changes back via the existing YAML config REST endpoint. Zero backend/Python changes required.

## Technical Context

**Language/Version**: JavaScript (ES6), Pug templates, Stylus CSS  
**Primary Dependencies**: Backbone.js, jQuery, `@girder/large_image_annotation`, `@girder/core`, `@girder/slicer_cli_web`, `js-yaml` (existing build dep)  
**Storage**: Folder YAML config via `GET/PUT folder/{id}/yaml_config/.histomicsui_config.yaml`  
**Testing**: Manual browser smoke test; `pre-commit run --all-files` for lint  
**Target Platform**: Browser (Chrome/Firefox), served by Girder web client  
**Project Type**: Frontend web application feature (panel + dialog)  
**Performance Goals**: Panel re-render within the same timeframe as current flat list  
**Constraints**: Must not break existing deployments without a taxonomy config  
**Scale/Scope**: Typically 5–20 classes per taxonomy; 100s of annotation elements per slide

## Constitution Check

| Principle | Status | Notes |
|---|---|---|
| I. Frontend-Only | ✅ Pass | Zero Python/backend changes |
| II. Extend, Don't Replace | ✅ Pass | Builds on AnnotationSelector, StyleCollection, `_folderConfig` |
| III. Graceful Degradation | ✅ Pass | Falls back to flat list when no hierarchy configured |
| IV. Folder-Scoped Config | ✅ Pass | Taxonomy stored in `.histomicsui_config.yaml` per folder |
| V. Lint and Build | ✅ Pass | Must pass pre-commit + successful Girder client rebuild |

## Project Structure

### Documentation (this feature)

```text
specs/hierarchical-annotation-panel/
├── plan.md              ← this file
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output
├── checklists/
│   └── requirements.md
└── tasks.md             ← created by /speckit-tasks
```

### Source Code (modified/created files)

```text
histomicsui/web_client/
├── panels/
│   └── AnnotationSelector.js        ← MODIFY (tree logic + active class)
├── templates/panels/
│   └── annotationSelector.pug       ← MODIFY (recursive tree mixin)
├── views/body/
│   └── ImageView.js                 ← MODIFY (h:setDefaultGroup listener)
├── stylesheets/panels/
│   └── annotationSelector.styl      ← MODIFY (tree node CSS)
├── dialogs/
│   └── editTaxonomy.js              ← NEW (CRUD dialog)
└── templates/dialogs/
    └── editTaxonomy.pug             ← NEW (dialog template)
```

## Phase 0: Research

*See [research.md](./research.md) — all questions resolved from existing codebase exploration.*

## Phase 1: Design & Contracts

### Data Model

*See [data-model.md](./data-model.md)*

### Implementation Design

#### 1. YAML Config Schema Extension

Add `parent` field (optional string) to groups in `annotationGroups.groups`:

```yaml
annotationGroups:
  defaultGroup: tumor
  replaceGroups: true
  groups:
    - id: tissue
      label: Tissue
      lineColor: "rgb(200,200,200)"
      fillColor: "rgba(200,200,200,0.3)"
    - id: tumor
      label: Tumor
      parent: tissue
      lineColor: "rgb(220,50,50)"
      fillColor: "rgba(220,50,50,0.3)"
    - id: invasive
      label: Invasive Carcinoma
      parent: tumor
      lineColor: "rgb(180,0,30)"
      fillColor: "rgba(180,0,30,0.3)"
    - id: stroma
      label: Stroma
      parent: tissue
      lineColor: "rgb(50,180,50)"
      fillColor: "rgba(50,180,50,0.3)"
```

No backend changes needed — the server stores whatever YAML is sent.

#### 2. `AnnotationSelector.js` Changes

**New method: `_buildGroupTree()`**

```js
_buildGroupTree() {
    const configGroups = _.get(
        this, 'parentView._folderConfig.annotationGroups.groups', null
    );
    // Fall back to flat list when no hierarchy defined
    if (!configGroups || !configGroups.some((g) => g.parent)) {
        return null;
    }

    // Count elements per group from all displayed annotations
    const counts = {};
    this.collection.each((model) => {
        const elems = (model.get('annotation') || {}).elements || [];
        elems.forEach((e) => {
            const g = e.group || '__other__';
            counts[g] = (counts[g] || 0) + 1;
        });
    });

    // Collect annotations that contain elements in each group
    const annosByGroup = {};
    this.collection.each((model) => {
        const elems = (model.get('annotation') || {}).elements || [];
        const modelGroups = new Set(elems.map((e) => e.group || '__other__'));
        modelGroups.forEach((g) => {
            if (!annosByGroup[g]) annosByGroup[g] = [];
            if (!annosByGroup[g].includes(model)) annosByGroup[g].push(model);
        });
    });

    // Build id→node map
    const nodeMap = {};
    configGroups.forEach((g) => {
        nodeMap[g.id] = {
            id: g.id,
            label: g.label || g.id,
            fillColor: g.fillColor || 'rgba(128,128,128,0.3)',
            lineColor: g.lineColor || 'rgb(128,128,128)',
            parent: g.parent || null,
            count: counts[g.id] || 0,
            annotations: annosByGroup[g.id] || [],
            children: [],
            depth: 0
        };
    });

    // Wire children and find roots
    const roots = [];
    configGroups.forEach((g) => {
        const node = nodeMap[g.id];
        if (node.parent && nodeMap[node.parent]) {
            nodeMap[node.parent].children.push(node);
        } else {
            roots.push(node);
        }
    });

    // Set depth recursively + roll up counts to parents
    const setDepth = (node, depth) => {
        node.depth = depth;
        node.children.forEach((c) => setDepth(c, depth + 1));
    };
    roots.forEach((r) => setDepth(r, 0));

    const rollUp = (node) => {
        node.children.forEach(rollUp);
        node.children.forEach((c) => { node.count += c.count; });
    };
    roots.forEach(rollUp);

    // Handle "Other" (elements with no matching class)
    const otherCount = counts['__other__'] || 0;
    if (otherCount > 0) {
        roots.push({
            id: '__other__',
            label: 'Other',
            fillColor: 'rgba(150,150,150,0.2)',
            lineColor: 'rgb(150,150,150)',
            parent: null,
            count: otherCount,
            annotations: annosByGroup['__other__'] || [],
            children: [],
            depth: 0
        });
    }

    return roots;
}
```

**Active group state:**

```js
initialize(settings = {}) {
    // ... existing code ...
    this._activeGroup = null;  // set from _folderConfig.annotationGroups.defaultGroup on render
},

_setActiveGroup(groupId) {
    this._activeGroup = groupId;
    this.trigger('h:setDefaultGroup', groupId);
    this._debounceRender();
},
```

**Click handler in `events`:**

```js
'click .h-class-name': '_handleClassClick',
```

```js
_handleClassClick(evt) {
    const groupId = $(evt.currentTarget).closest('.h-class-node').data('group-id');
    this._setActiveGroup(groupId);
},
```

**In `render()`**: default `_activeGroup` from config on first render:

```js
if (this._activeGroup === null && this.parentView && this.parentView._defaultGroup) {
    this._activeGroup = this.parentView._defaultGroup;
}
```

Pass `groupTree`, `activeGroup` to template alongside existing `annotationGroups` (keep both for fallback).

#### 3. `annotationSelector.pug` Template Changes

Add a recursive mixin before the existing group loop. Wrap the rendering in a conditional:

```pug
mixin classNode(node, expandedGroups, activeAnnotation, writeAccess, annotationAccess)
  - var indent = node.depth * 1.2
  .h-class-node(
      data-group-id=node.id,
      class=(node.id === activeGroup ? 'h-active-class' : ''))
    .h-class-header(style=`padding-left: ${indent}rem`)
      if node.children.length
        - var treeExpanded = expandedGroups.has('tree:' + node.id)
        span.h-class-tree-toggle(
            data-group-id=node.id,
            class=treeExpanded ? 'h-tree-expanded' : 'h-tree-collapsed')
          i(class=treeExpanded ? 'icon-down-open' : 'icon-right-open')
      else
        span.h-class-tree-toggle-placeholder
      span.h-class-swatch(
          style=`background:${node.fillColor}; border: 2px solid ${node.lineColor}`)
      span.h-class-name= node.label
      span.h-class-count.badge(class=node.count === 0 ? 'h-count-zero' : '')= node.count
    - var annoExpanded = expandedGroups.has(node.id)
    if annoExpanded && node.annotations.length
      each annotation in node.annotations
        // ... annotation row (same markup as today) ...
    if node.children.length && expandedGroups.has('tree:' + node.id)
      each child in node.children
        +classNode(child, expandedGroups, activeAnnotation, writeAccess, annotationAccess)
```

Conditional rendering:
```pug
if groupTree
  // New hierarchical tree
  each node in groupTree
    +classNode(node, expandedGroups, activeAnnotation, writeAccess, annotationAccess)
else
  // Existing flat group loop (unchanged)
  each groupName in groups
    // ... existing template code ...
```

The "Edit Classes" gear button is added in the panel header (alongside the existing controls), visible only when `writeAccess` is true.

#### 4. `ImageView.js` Changes

In the listener setup block (around line 122), add:

```js
this.listenTo(this.annotationSelector, 'h:setDefaultGroup', (groupId) => {
    this._defaultGroup = groupId;
    if (this.drawWidget) {
        this.drawWidget._defaultGroup = groupId;
    }
});
```

#### 5. `annotationSelector.styl` Changes

New CSS for the tree nodes (appended to existing file):

```stylus
.h-class-node
  .h-class-header
    display flex
    align-items center
    gap 6px
    padding 3px 4px
    cursor pointer
    border-radius 3px
    &:hover
      background rgba(0,0,0,0.05)
  &.h-active-class > .h-class-header
    border-left 3px solid #337ab7
    background rgba(51,122,183,0.08)
    font-weight 600

.h-class-swatch
  display inline-block
  width 12px
  height 12px
  border-radius 2px
  flex-shrink 0

.h-class-count
  margin-left auto
  font-size 11px
  &.h-count-zero
    opacity 0.4

.h-class-tree-toggle
  width 14px
  text-align center
  color #888

.h-class-tree-toggle-placeholder
  display inline-block
  width 14px

.h-class-children
  // indentation is handled via padding-left on .h-class-header
```

#### 6. `editTaxonomy.js` (new file)

A Backbone View rendered as a Bootstrap modal:

- Fetches current config via `restRequest({url: 'folder/{folderId}/yaml_config/.histomicsui_config.yaml'})`
- Renders an editable row per class: name input, `<input type="color">`, parent dropdown, delete button
- "Add class" appends a new row with a generated UUID id
- Validation: detects circular parent references before saving
- Deletion warning: checks if any annotation elements use the class id before confirming
- Save: converts rows back to the `annotationGroups.groups` array, merges with rest of config, serializes with `js-yaml`, sends `PUT folder/{folderId}/yaml_config/.histomicsui_config.yaml`
- On success: calls `this.parentView._getConfig(this.parentView.model.id)` to reload config and re-renders AnnotationSelector

#### 7. `editTaxonomy.pug` (new template file)

Bootstrap modal with:
- Table of class rows (Name | Color | Parent | Delete)
- "Add class" button
- "Save" / "Cancel" buttons
- Error message area for circular-reference validation failures

### Interface Contracts

The only external interface is the existing YAML config file format. The `parent` field is a new optional key in each group object — backward-compatible (old configs without `parent` work as before).

**Extended group schema:**
```yaml
id: string          # required, unique within taxonomy
label: string       # display name
parent: string      # optional: id of parent class
lineColor: string   # rgb(r,g,b)
fillColor: string   # rgba(r,g,b,a)
lineWidth: number   # optional
pattern: string     # optional
hotkey: string      # optional
```
