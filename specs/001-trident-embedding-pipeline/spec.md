# Feature Specification: TRIDENT Embedding Pipeline

**Feature Branch**: `001-trident-embedding-pipeline`
**Created**: 2026-04-22
**Status**: Draft
**Input**: User description: "I'd like to hook in the TRIDENT workflow for generating embeddings and saving the results locally. All CLI parameters should be exposed to the user so they can fill out their own information. In a later session, we'll use these for supervised learning problems, but for now only focus on this stage."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Submit Embedding Job from Folder (Priority: P1)

A computational pathology researcher navigates to a collection or folder in the Digital Slide Archive containing whole-slide image files. From the folder's action menu, they select "Generate TRIDENT Embeddings". A configuration panel opens pre-filled with the folder's filesystem path as the WSI source. They specify an output directory, select a foundation model from locally available checkpoints, and set magnification and patch size. They submit the job and receive a tracking notification.

**Why this priority**: This is the core value proposition — enabling researchers to generate embeddings from DSA-managed WSI collections without leaving the platform.

**Independent Test**: Navigate to a folder with WSIs, open the TRIDENT panel, fill required fields (output dir, model, patching params), and submit. Verify job is created and embedding files appear in the output directory.

**Acceptance Scenarios**:

1. **Given** a DSA folder containing at least one supported WSI file, **When** the user selects "Generate TRIDENT Embeddings" from the folder action menu, **Then** a configuration panel appears with the folder's filesystem path pre-filled as the WSI source.

2. **Given** the TRIDENT configuration panel with all required fields filled, **When** the user submits the job, **Then** a background embedding job is created and the user sees a confirmation with a link to track job progress.

3. **Given** a completed embedding job, **When** the job finishes successfully, **Then** patch-level embedding files are saved in the specified output directory under TRIDENT's standard directory structure (e.g., `{job_dir}/{mag}x_{patch_size}px_{overlap}px_overlap/features_{encoder_name}/`).

---

### User Story 2 - Configure Foundation Model and Patching Parameters (Priority: P2)

A researcher selects which foundation model to use for patch embeddings and configures patching settings (magnification, patch size, overlap) to match the chosen model's recommended settings or their experiment's requirements. They can optionally also select a slide-level encoder.

**Why this priority**: Model and patching configuration directly determines embedding quality and compatibility with downstream tasks.

**Independent Test**: Open the configuration panel, select different encoders, verify recommended settings are displayed as guidance, submit with custom values, verify output reflects chosen parameters.

**Acceptance Scenarios**:

1. **Given** the configuration panel, **When** the user selects a patch encoder from the available list, **Then** the recommended magnification and patch size for that model are shown as inline guidance.

2. **Given** the configuration panel, **When** the user provides a local filesystem path to a model checkpoint file, **Then** the submitted job uses that checkpoint without any external network requests.

3. **Given** the configuration panel, **When** the user selects an optional slide-level encoder and provides its local checkpoint path, **Then** the job produces slide-level embedding files in addition to patch-level files.

---

### User Story 3 - Configure Tissue Segmentation Parameters (Priority: P3)

A researcher working with challenging slides (IHC stains, slides with pen marks or artifacts) configures the tissue segmentation step — choosing a segmenter type and tuning the confidence threshold and artifact removal options — to ensure accurate tissue boundary detection before patch extraction.

**Why this priority**: Segmentation accuracy controls which tissue regions are embedded; poor results waste compute on background or miss tissue.

**Independent Test**: Submit a job with only the `seg` task, inspect output contours and GeoJSON files to confirm tissue boundaries match expectations.

**Acceptance Scenarios**:

1. **Given** the configuration panel with `task=seg` or `task=all` selected, **When** the segmentation section is expanded, **Then** segmenter model, confidence threshold, and artifact/hole/penmark removal toggles are available.

2. **Given** slides with pen marks, **When** the penmark removal option is enabled and the job runs, **Then** output contours exclude pen-marked regions.

---

### User Story 4 - Monitor Job Progress and Access Logs (Priority: P4)

After submitting an embedding job, the researcher can check its progress and access processing logs from the DSA interface without needing terminal access.

**Why this priority**: Embedding jobs can run for hours on large cohorts; visibility into status and errors is essential.

**Independent Test**: Submit a job, navigate to the DSA jobs panel, confirm status updates and log output appear.

**Acceptance Scenarios**:

1. **Given** a submitted embedding job, **When** the user views the jobs panel, **Then** the job appears with a current status (queued, running, completed, failed).

2. **Given** a failed job, **When** the user opens job details, **Then** the error message and relevant TRIDENT log output are visible.

---

### Edge Cases

- What happens when the WSI source directory is empty or contains no supported file types?
- What happens when the output directory is not writable or does not exist?
- What happens when a local checkpoint path is provided but the file is missing or corrupted?
- What happens if the specified GPU index is unavailable on the execution host?
- What happens when `skip_errors=false` and one WSI fails mid-batch?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a "Generate TRIDENT Embeddings" action accessible from any DSA folder or collection view.
- **FR-002**: The system MUST pre-populate the WSI source path with the selected folder's corresponding filesystem path when the configuration panel opens.
- **FR-003**: The system MUST expose the following required parameters: task type (seg / coords / feat / all), WSI source directory, output directory, patch encoder model, magnification level (5/10/20/40/80×), and patch size (pixels).
- **FR-004**: The system MUST expose the following optional parameters:
  - GPU index
  - Batch sizes (segmentation, feature extraction, segmentation-specific override)
  - Patch overlap (pixels)
  - Minimum tissue proportion per patch (0–1)
  - Segmenter type (hest / grandqc)
  - Segmentation confidence threshold
  - Remove holes / remove artifacts / remove penmarks toggles
  - WSI reader type (openslide / cucim / image / sdpc / auto)
  - WSI file extension filter
  - Custom MPP metadata key names
  - WSI local cache directory (for SSD staging)
  - Max concurrent workers
  - Skip errors on individual slide failures
  - Output format (HDF5 / PyTorch tensor)
  - Search nested subdirectories toggle
  - Custom WSI list CSV path
- **FR-005**: The system MUST allow the user to select a patch encoder from a list of all supported TRIDENT models and display each model's recommended magnification and patch size as guidance.
- **FR-006**: The system MUST provide a local checkpoint path input for the selected patch encoder, specifying a path within the execution environment (container), so jobs run without external model downloads.
- **FR-007**: The system MUST optionally allow selection of a slide-level encoder (with its own local checkpoint path input), generating slide-level embeddings alongside patch-level embeddings.
- **FR-008**: The system MUST create and track a background job for each embedding pipeline submission, surfacing status (queued / running / completed / failed) and log output through the standard DSA job monitoring interface.
- **FR-009**: The system MUST save outputs to the user-specified output directory using TRIDENT's standard directory structure.
- **FR-010**: The system MUST validate all required fields before job submission and display user-friendly error messages for missing or invalid inputs.
- **FR-011**: The system MUST support running any subset of pipeline stages (segmentation only, patching only, feature extraction only, or all stages end-to-end).

### Key Entities

- **Embedding Job**: Background task record — includes all TRIDENT configuration parameters, WSI source path, output path, status, and log output.
- **Patch Embeddings**: Per-patch feature vectors stored in HDF5 or PyTorch tensor files, named by WSI and organized under the encoder subdirectory.
- **Slide Embeddings**: Optional slide-level feature vectors (one per WSI per slide encoder), stored alongside patch embeddings.
- **Segmentation Outputs**: Tissue boundary contours and GeoJSON masks per WSI, saved to the `contours/` and `contours_geojson/` subdirectories.
- **Patch Coordinates**: HDF5 files storing (x, y) patch coordinates per WSI in the patching subdirectory.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A researcher can configure and submit a TRIDENT embedding job from a DSA folder in under 5 minutes without any command-line interaction.
- **SC-002**: Every TRIDENT CLI parameter is accessible through the configuration UI with no parameters requiring manual file editing.
- **SC-003**: Successfully processed WSIs produce embedding files in the correct output directory structure for 100% of completed slides.
- **SC-004**: Job status updates are reflected in the DSA interface within 30 seconds of a status change, without requiring a page reload.
- **SC-005**: Jobs run to completion without any external network calls when all model checkpoints are provided as local paths.

## Assumptions

- TRIDENT will be packaged and deployed following the same Slicer CLI Docker image pattern used by existing HistomicsTK algorithms (e.g., NucleiDetection). This means TRIDENT is installed inside a Docker image derived from or alongside the `dsarchive/histomicstk` image, and its pipeline is exposed as a Slicer CLI tool discoverable by DSA.
- Foundation model checkpoint files are pre-downloaded to host filesystem paths and mounted into the execution container via Docker volume configuration; no HuggingFace authentication is needed at runtime. Checkpoint path parameters in the UI refer to container-internal paths (the operator maps host paths to container paths through deployment configuration).
- The folder selected in DSA corresponds to a filesystem directory accessible inside the execution container via mounted volume (same assetstore mount used by the rest of DSA).
- The output directory must reside on a filesystem path mounted in the execution container.
- GPU availability is assumed for feature extraction; the operator is responsible for enabling GPU passthrough in Docker; CPU fallback behavior is TRIDENT's responsibility.
- Supervised learning workflows that consume these embeddings are out of scope for this specification.
- Slide-level embeddings are optional secondary outputs; patch-level embeddings are the primary deliverable.
- Only WSIs already managed in DSA (in the selected folder) are in scope; arbitrary filesystem directories entered manually by the user are not pre-validated by DSA.
