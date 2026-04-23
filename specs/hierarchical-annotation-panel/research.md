# Research: Hierarchical Annotation Panel

## YAML Config Endpoint

**Decision**: Use existing `GET/PUT folder/{id}/yaml_config/.histomicsui_config.yaml`  
**Rationale**: Both endpoints are registered in `girder_large_image` (`/opt/large_image/girder/girder_large_image/rest/__init__.py` lines 20-21). No backend changes needed.  
**Alternatives considered**: Girder folder metadata (`PUT /folder/{id}/metadata`) — rejected because it would diverge from the existing config system and not be picked up by `_getConfig()`.

## Hierarchy Storage

**Decision**: Add `parent` field (optional string, references another group's `id`) to entries in `annotationGroups.groups` in the YAML config.  
**Rationale**: The server stores arbitrary YAML as-is. Existing code already reads `annotationGroups.groups` and converts to StyleCollection — adding `parent` requires zero backend changes. The field is optional, so existing configs without it work unchanged.  
**Alternatives considered**: Separate `hierarchy` key at the same level as `groups` — rejected as it would require keeping two lists in sync.

## Element Classification Key

**Decision**: Use the existing element `group` field (string) to store the taxonomy class ID.  
**Rationale**: Already used for group assignment and display. StyleCollection uses it. AnnotationContextMenu uses it for right-click class assignment.  
**Alternatives considered**: `label.value` field — rejected because `group` is already the canonical classification field in the current system.

## js-yaml Availability

**Decision**: Use `js-yaml` (already in the HistomicsUI build) for YAML serialization in the taxonomy editor save.  
**Rationale**: Found as a transitive dependency; used elsewhere in the girder ecosystem. No new package needed.  
**Alternatives considered**: JSON-based config — rejected because the endpoint already delivers YAML and the existing format is YAML.

## Active Class Wiring

**Decision**: Use Backbone `trigger('h:setDefaultGroup', groupId)` event from AnnotationSelector, caught by ImageView which sets `this._defaultGroup` and `this.drawWidget._defaultGroup`.  
**Rationale**: This follows the existing event pattern (e.g., `h:toggleLabels`, `h:editAnnotation`). The `_defaultGroup` property is already set by `_getConfig()` and read by DrawWidget.  
**Alternatives considered**: Direct call to DrawWidget from AnnotationSelector — rejected because it creates a tight coupling that violates the existing event-based architecture.

## Expand/Collapse: Tree Nodes vs Annotation Rows

**Decision**: Use `expandedGroups` Set with two namespaces: `'tree:' + groupId` for tree node expand/collapse, and `groupId` for annotation row expand/collapse (unchanged from today).  
**Rationale**: Reuses the existing `_expandedGroups` Set and `_toggleExpandGroup()` mechanism. The `'tree:'` prefix distinguishes tree node state from annotation list state without adding new state variables.  
**Alternatives considered**: Separate `_expandedTreeNodes` Set — rejected as unnecessary complexity.
