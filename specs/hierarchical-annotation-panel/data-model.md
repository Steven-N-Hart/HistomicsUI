# Data Model: Hierarchical Annotation Panel

## TaxonomyClass (config-level entity)

Stored as items in `annotationGroups.groups` array in `.histomicsui_config.yaml`:

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | Yes | Unique identifier within the taxonomy; used as element `group` value |
| `label` | string | Yes | Display name shown in the panel |
| `parent` | string | No | ID of parent TaxonomyClass; absent or null = root node |
| `lineColor` | string | No | CSS color for element borders (e.g. `"rgb(220,50,50)"`) |
| `fillColor` | string | No | CSS color for element fill (e.g. `"rgba(220,50,50,0.3)"`) |
| `lineWidth` | number | No | Default border width for elements in this class |
| `pattern` | string | No | Fill pattern (existing field, unchanged) |
| `hotkey` | string | No | Keyboard shortcut to set this as active class (existing field) |

**Constraints**:
- `id` values must be unique within a taxonomy
- `parent` must reference a valid `id` within the same config; circular references are invalid
- Absence of any `parent` fields → flat-list mode (no hierarchy displayed)

## ClassTree (in-memory runtime entity, not persisted)

Built by `AnnotationSelector._buildGroupTree()` from the flat `groups` array:

| Field | Type | Description |
|---|---|---|
| `id` | string | Same as TaxonomyClass.id |
| `label` | string | Same as TaxonomyClass.label |
| `fillColor` | string | Same as TaxonomyClass.fillColor |
| `lineColor` | string | Same as TaxonomyClass.lineColor |
| `parent` | string or null | Parent ID |
| `count` | number | Element count (direct + all descendants) |
| `annotations` | AnnotationModel[] | Annotation objects containing elements of this class |
| `children` | ClassTree[] | Child nodes (recursively) |
| `depth` | number | Nesting depth (0 = root) |

## AnnotationElement (existing entity, unchanged schema)

The `group` field on an element maps it to a TaxonomyClass:

| Field | Type | Notes |
|---|---|---|
| `group` | string | Taxonomy class ID (e.g., `"tumor"`) |
| `label.value` | string | Optional free-text display label |
| `fillColor` | string | Element-specific override (optional) |
| `lineColor` | string | Element-specific override (optional) |

**Backward compatibility**: Elements with a `group` value that is absent from the current taxonomy are shown under the "Other" node.

## State Changes (AnnotationSelector)

| Field | Type | Default | Description |
|---|---|---|---|
| `_activeGroup` | string or null | null (set to `_defaultGroup` on first render) | Currently selected drawing class |
| `_expandedGroups` | Set | existing | Extended with `'tree:' + id` keys for tree node expand state |
