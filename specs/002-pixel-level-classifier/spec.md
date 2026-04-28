# Feature Specification: Pixel-Level Classifier with Active Learning

**Feature Branch**: `002-pixel-level-classifier`
**Created**: 2026-04-27
**Status**: Draft
**Input**: User description: "I want to build a pixel level classifier like AIforia create. The user will add pixel annotations, then a model can be selected for active learning. Model trained, applied to current slide. User marks correct and incorrect regions. trains again. when complete, can be applied to other slides."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create Annotations and Train Initial Model (Priority: P1)

A pathologist opens a whole-slide image in HistomicsUI and wants to train a model that can distinguish between tissue classes (e.g., tumor vs. stroma vs. background). They use brush tools to paint pixel-level labels on representative regions of the slide, then initiate training on a chosen model architecture. When training completes, a color-coded prediction overlay appears on the slide.

**Why this priority**: This is the foundational step — without initial annotations and a trained model, no active learning or batch inference is possible. It is the entry point for every other user story.

**Independent Test**: Can be fully tested by annotating a slide with two or more classes, selecting a model, triggering training, and verifying that a prediction overlay is displayed on the slide. Delivers a usable (if unrefined) classifier.

**Acceptance Scenarios**:

1. **Given** a whole-slide image is open and no annotations exist, **When** the user selects the pixel annotation tool and paints regions with class labels, **Then** the painted regions are stored and visually displayed as colored overlays on the slide.
2. **Given** at least one region is annotated for each defined class, **When** the user selects a model architecture and initiates training, **Then** the system accepts the request, shows training progress, and upon completion displays a pixel-level prediction overlay on the full slide (or a user-selected region).
3. **Given** training is in progress, **When** the user views the slide, **Then** a status indicator shows that training is running and the overlay is not yet available.

---

### User Story 2 - Active Learning Refinement Loop (Priority: P2)

After reviewing the initial prediction overlay, the pathologist notices that some regions are misclassified. They paint corrections directly on the slide — adding new annotations where the model was wrong — then trigger retraining. This cycle repeats until the predictions are satisfactory.

**Why this priority**: The active learning loop is the core differentiator of this feature. It dramatically reduces the annotation burden compared to fully labeling a slide upfront and is the primary mechanism for improving model quality.

**Independent Test**: Starting from a trained model (Story 1 complete), the user can add correction annotations, retrain, and confirm the new overlay more accurately reflects the corrected regions.

**Acceptance Scenarios**:

1. **Given** a prediction overlay is displayed, **When** the user paints corrections on misclassified regions with the correct class label, **Then** the new annotations are added to the training set alongside prior annotations.
2. **Given** correction annotations have been added, **When** the user triggers retraining, **Then** the model retrains using all accumulated annotations (original + corrections) and the overlay is updated to reflect the new predictions.
3. **Given** the user is satisfied with the predictions, **When** they stop the active learning loop, **Then** the current model state is saved and available for batch application.
4. **Given** the user retrains multiple times, **When** they review the annotation history, **Then** each training iteration is identifiable (iteration count or timestamp) so they can compare progress.

---

### User Story 3 - Apply Trained Model to Other Slides (Priority: P3)

After completing the active learning loop on one slide, the pathologist wants to apply the trained model to a collection of additional slides in the same project. They select multiple slides from the folder browser and submit a batch inference job.

**Why this priority**: The ability to scale from one curated slide to a cohort is the ultimate clinical/research value. However, it depends on Stories 1 and 2 being complete.

**Independent Test**: Starting from a saved model (Story 2 complete), the user selects two or more slides from the folder browser, submits batch inference, and confirms that prediction overlays appear on each selected slide upon job completion.

**Acceptance Scenarios**:

1. **Given** a trained model exists, **When** the user selects one or more slides and submits batch inference, **Then** the system enqueues inference jobs for each selected slide and shows per-slide job status.
2. **Given** batch inference is complete, **When** the user opens any processed slide, **Then** a prediction overlay is visible and can be toggled on/off.
3. **Given** batch inference fails on one slide (e.g., incompatible magnification), **When** the user reviews the job status, **Then** the failure reason is reported per slide without affecting successful slides in the batch.

---

### User Story 4 - Manage Annotation Classes and Model Library (Priority: P4)

Before starting a new project, a researcher defines the tissue classes they want to distinguish (e.g., "Tumor", "Stroma", "Necrosis", "Background") and assigns each a display color. They also browse available model architectures and select one that matches their performance/speed requirements.

**Why this priority**: Class management and model selection are prerequisites to annotation, but they are lightweight configuration steps that can be done with simple defaults in P1-P3.

**Independent Test**: User can define 2–6 named classes with distinct colors before beginning annotation, and can choose from at least two available model architectures at training time.

**Acceptance Scenarios**:

1. **Given** the user is setting up a new classifier session, **When** they define class names and assign colors, **Then** the annotation tools display those class labels and colors consistently throughout the session.
2. **Given** the user is about to train, **When** they view the model selection panel, **Then** at least two model architectures are listed with names and brief descriptions of their trade-offs (speed vs. accuracy).
3. **Given** a classifier session is saved, **When** the user reopens the slide, **Then** the class definitions, annotations, and last-trained model are all restored.

---

### Edge Cases

- What happens when the user annotates only one class? The system should warn that at least two classes are required before training.
- What happens when training fails (e.g., insufficient memory, incompatible slide format)? The system should display an error message and allow the user to retry or adjust settings.
- What happens if the user closes the browser during training? Training should continue server-side; status should be recoverable upon return.
- What happens when two users annotate the same slide simultaneously? Concurrent edits should either be merged or the system should warn about conflicts.
- What happens when a slide used for inference has a different magnification or staining than the training slide? The system should warn the user; inference may still proceed at user discretion.
- What happens when the prediction overlay is very large (gigapixel slide)? The overlay must be streamed/tiled and not require the entire prediction to be downloaded at once.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to define 2–10 named tissue classes with distinct display colors before or during annotation.
- **FR-002**: Users MUST be able to paint pixel-level annotations using variable-size brush and fill tools, with each stroke assigned to a user-selected class.
- **FR-003**: Users MUST be able to erase or overwrite existing pixel annotations.
- **FR-004**: Users MUST be able to select a model architecture from a curated list of at least two options before initiating training.
- **FR-005**: System MUST train the selected model using all current pixel annotations when the user initiates training.
- **FR-006**: System MUST display training progress (e.g., progress bar, estimated time remaining) during model training.
- **FR-007**: System MUST display a tiled, color-coded prediction overlay on the slide upon training completion.
- **FR-008**: Users MUST be able to toggle the prediction overlay on and off without losing the overlay data.
- **FR-009**: Users MUST be able to add correction annotations on top of the prediction overlay using the same brush tools.
- **FR-010**: System MUST support iterative retraining, incorporating all annotations (original + corrections) from prior iterations.
- **FR-011**: System MUST save the trained model state at the end of each training iteration, allowing the user to stop and resume the active learning loop.
- **FR-012**: Users MUST be able to select one or more slides and apply a saved trained model to generate prediction overlays on those slides.
- **FR-013**: System MUST report per-slide job status (queued, running, completed, failed) for batch inference jobs.
- **FR-014**: Prediction overlays on additional slides MUST be viewable in the same way as overlays on the training slide.
- **FR-015**: System MUST prevent training from starting if fewer than two classes have annotations.

### Key Entities

- **Classifier Session**: A named workspace attached to a slide that holds class definitions, all annotation iterations, model selection, trained model state, and iteration history.
- **Pixel Annotation**: A set of painted regions on a slide, each pixel assigned a class label and iteration number.
- **Model Architecture**: A named, pre-configured classifier configuration selectable by the user, characterized by accuracy/speed trade-offs.
- **Trained Model**: A versioned snapshot of a model produced after one training iteration, stored and associated with a Classifier Session.
- **Prediction Overlay**: A tiled, class-colored pixel map generated by applying a Trained Model to a slide, stored as an overlay layer.
- **Inference Job**: An asynchronous task that applies a Trained Model to a target slide and produces a Prediction Overlay.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can complete an initial annotation-and-train cycle (annotate → select model → train → view overlay) in under 10 minutes for a representative slide region.
- **SC-002**: Each active learning iteration (add corrections → retrain → view updated overlay) completes and refreshes the overlay in under 5 minutes for slides up to 2 GB.
- **SC-003**: 90% of users can complete at least 3 active learning iterations on a single slide without requiring documentation or support.
- **SC-004**: Batch inference across 10 slides completes without manual intervention, with failed slides clearly reported and not blocking successful ones.
- **SC-005**: Prediction overlays are visible on slides with resolutions up to 100,000 × 100,000 pixels without browser crashes or full-overlay downloads.
- **SC-006**: A trained model applied to slides not in the training set produces visually consistent class predictions, with pathologist-assessed accuracy improving measurably compared to random baseline.

## Assumptions

- Users are pathologists or researchers already familiar with HistomicsUI's annotation tools; basic WSI navigation is not in scope.
- The active learning loop is initiated manually by the user — automatic suggestion of regions to annotate is out of scope for this version.
- Model training and batch inference run asynchronously on the server; the user's browser session does not need to remain open for jobs to complete.
- Annotation brushes operate at a fixed pixel resolution (e.g., the current viewed magnification level); sub-pixel precision is not required.
- Model architectures in the curated list are pre-validated for compatibility with DSA's supported WSI formats (SVS, NDPI, TIFF, etc.).
- Mobile/tablet support is out of scope; the feature targets desktop browsers only.
- A single Classifier Session is associated with one training slide; multi-slide joint training is out of scope for this version.
- Model sharing across users or projects is out of scope for this version; models are accessible only to the session owner.
- Real-time collaborative annotation on the same session is out of scope; concurrent access warnings are sufficient.
