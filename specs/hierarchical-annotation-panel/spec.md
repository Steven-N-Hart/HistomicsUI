# Feature Specification: Hierarchical Annotation Panel

**Feature Branch**: `001-hierarchical-annotation-panel`
**Created**: 2026-04-21
**Status**: Draft

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Define a Class Taxonomy for a Folder (Priority: P1)

A researcher opens the DSA image viewer for a slide in a collection. Before annotating, they click "Edit Classes" in the annotation panel and define a tissue class hierarchy:
- Tissue (root)
  - Tumor (child of Tissue)
    - Invasive Carcinoma (child of Tumor)
  - Stroma (child of Tissue)

They assign colors to each class and save. The hierarchy persists for all slides in that folder.

**Why this priority**: Without a defined taxonomy the annotator has no structured classes to assign to elements. This is the foundational capability everything else depends on.

**Independent Test**: Open a new folder, click "Edit Classes", add a 3-level hierarchy, save. Reopen viewer and confirm the tree appears in the panel.

**Acceptance Scenarios**:

1. **Given** a slide is open and the user has write access to its folder, **When** they click "Edit Classes", **Then** a dialog opens showing the current class list (empty if none defined).
2. **Given** the taxonomy editor is open, **When** the user adds a class "Tumor" with parent "Tissue" and saves, **Then** the panel tree shows "Tumor" nested under "Tissue" without a page reload.
3. **Given** a class hierarchy is saved, **When** another user opens a different slide in the same folder, **Then** they see the same hierarchy in their annotation panel.

---

### User Story 2 - Draw Annotations Assigned to a Class (Priority: P1)

A pathologist clicks "Tumor" in the hierarchical panel to set it as the active drawing class, then draws a polygon on the slide. The polygon element is automatically tagged with the Tumor class and displayed in the correct tree node.

**Why this priority**: Class assignment during drawing is the core annotation workflow. Without it, the hierarchy is just visual decoration.

**Independent Test**: Set an active class, draw an element, open the element editor — confirm the element's class matches what was selected.

**Acceptance Scenarios**:

1. **Given** a class hierarchy is defined, **When** the user clicks a class name in the panel, **Then** that class is highlighted as "active" and subsequent drawn elements are assigned to it.
2. **Given** "Tumor" is the active class and an annotation is open for editing, **When** the user draws a rectangle, **Then** the element's class is "Tumor".
3. **Given** an element is drawn with class "Tumor", **When** the panel renders, **Then** the element count badge on "Tumor" increments by 1.

---

### User Story 3 - View Element Counts and Colors per Class (Priority: P2)

A pathologist glances at the annotation panel and immediately sees how many elements are assigned to each class in the hierarchy, along with the class color swatch. Parent classes show the aggregate count of all descendant elements.

**Why this priority**: At-a-glance counts are critical for quality control ("Have I annotated enough Tumor regions?").

**Independent Test**: Load a slide with 10 Invasive elements (child of Tumor, child of Tissue). Confirm Invasive shows 10, Tumor shows ≥10, Tissue shows ≥10.

**Acceptance Scenarios**:

1. **Given** elements of various classes are in an annotation, **When** the panel renders, **Then** each class node shows the count of elements assigned directly to that class.
2. **Given** "Invasive Carcinoma" is a child of "Tumor", **When** the panel renders, **Then** the "Tumor" node shows a count that includes all Invasive Carcinoma elements.
3. **Given** a class has a color defined in the taxonomy, **When** the panel renders, **Then** a 12×12 swatch in that color appears next to the class name.

---

### User Story 4 - Expand/Collapse Class Nodes (Priority: P2)

A pathologist with a deep hierarchy collapses parent nodes to focus on the leaf classes they are currently annotating.

**Why this priority**: Navigation of deep trees requires expand/collapse to remain usable.

**Independent Test**: Define a 3-level hierarchy. Collapse the root node. Confirm child nodes are hidden. Expand. Confirm they reappear.

**Acceptance Scenarios**:

1. **Given** a parent class has children, **When** the user clicks the expand toggle, **Then** child nodes appear.
2. **Given** a parent node is collapsed, **When** the user clicks the toggle again, **Then** children are hidden.
3. **Given** the panel re-renders (e.g., after saving an annotation), **Then** expanded/collapsed state is preserved.

---

### User Story 5 - Edit Classes via In-App Dialog (Priority: P2)

A researcher adds a new class "DCIS" as a child of "Tumor", renames "Invasive Carcinoma" to "IDC", and deletes an unused class — all from within the annotation panel without editing YAML files manually.

**Why this priority**: Researchers without YAML knowledge need to manage the taxonomy from the UI.

**Independent Test**: Open "Edit Classes", add/rename/delete a class, save. Confirm the panel tree reflects changes without a page reload.

**Acceptance Scenarios**:

1. **Given** the taxonomy editor is open, **When** the user clicks "Add class", **Then** a new row appears with empty name, color picker, and parent selector.
2. **Given** a class exists in the editor, **When** the user changes its name and saves, **Then** the panel shows the updated name.
3. **Given** a class has existing elements assigned to it, **When** the user deletes that class, **Then** the user is warned that elements will become unclassified, and can confirm or cancel.
4. **Given** the user has only read access to the folder, **When** viewing the annotation panel, **Then** the "Edit Classes" button is not visible.

---

### Edge Cases

- What happens when no taxonomy is defined? The panel falls back to the existing flat group list (no regression).
- What happens when an element's class ID does not exist in the taxonomy? It appears under a fallback "Other" node at the root.
- What happens when a class is deleted but elements still reference it? Those elements move to "Other".
- What if the YAML config write fails? The dialog shows an error message; the local tree is not updated.
- What if a circular parent reference is created (A → B → A)? The taxonomy editor prevents saving with a validation error.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The annotation panel MUST display class groups in a tree reflecting parent-child relationships when a taxonomy is defined.
- **FR-002**: The panel MUST fall back to flat-list behavior when no hierarchy is configured.
- **FR-003**: Clicking a class in the panel MUST set it as the active drawing class; new elements are assigned to it automatically.
- **FR-004**: Each class node MUST display a color swatch and element count (direct + descendant).
- **FR-005**: Class nodes MUST support expand/collapse; state is preserved across re-renders within the session.
- **FR-006**: Users with write access MUST be able to open an "Edit Classes" dialog from the annotation panel.
- **FR-007**: The "Edit Classes" dialog MUST support adding, renaming, reparenting, recoloring, and deleting classes.
- **FR-008**: Saving the taxonomy MUST persist it to the folder-level config and update the panel without a page reload.
- **FR-009**: Users without write access MUST NOT see the "Edit Classes" button.
- **FR-010**: The system MUST warn the user before deleting a class that has elements assigned to it.
- **FR-011**: The taxonomy editor MUST reject circular parent references.
- **FR-012**: Elements whose class ID is absent from the taxonomy MUST appear under an "Other" node.

### Key Entities

- **TaxonomyClass**: A named tissue class with an ID, display label, color (fill + line), optional parent class ID, and optional hotkey.
- **ClassHierarchy**: A tree of TaxonomyClass nodes defined per folder, stored in the folder YAML config.
- **AnnotationElement**: An existing entity with a `group` field that maps to a TaxonomyClass ID.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A researcher can define a 5-level class hierarchy using only the in-app "Edit Classes" dialog, with no direct YAML file editing, in under 3 minutes.
- **SC-002**: The annotation panel loads and renders the class tree within the same time as the current flat-list panel (no perceptible regression).
- **SC-003**: 100% of existing slides without a taxonomy config continue to work identically to today (no regression).
- **SC-004**: Element counts on each class node are accurate within one annotation-save cycle.
- **SC-005**: The "Edit Classes" dialog correctly rejects circular parent references 100% of the time before saving.

---

## Assumptions

- Users annotate using the existing draw tools (rectangle, polygon, etc.) in DrawWidget; the active class is set from the new panel, not within DrawWidget itself.
- The taxonomy is defined once per folder and shared across all slides in that folder; slide-specific taxonomies are out of scope.
- DICOM export of annotated data is a future deliverable and is not part of this feature.
- The `js-yaml` library is available in the HistomicsUI build (used for serializing back to YAML when saving via "Edit Classes").
- All taxonomy editing requires Girder folder write permissions; read-only users can only view the panel.
- The existing flat-group behavior remains the default when no `annotationGroups.groups` with `parent` fields are present.
