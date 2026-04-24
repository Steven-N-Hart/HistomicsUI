import _ from 'underscore';
import $ from 'jquery';

import {restRequest} from '@girder/core/rest';
import {AccessType} from '@girder/core/constants';
import eventStream from '@girder/core/utilities/EventStream';
import {getCurrentUser} from '@girder/core/auth';
import Panel from '@girder/slicer_cli_web/views/Panel';
import AnnotationModel from '@girder/large_image_annotation/models/AnnotationModel';
import {events as girderEvents} from '@girder/core';

import events from '../events';
import showSaveAnnotationDialog from '../dialogs/saveAnnotation';
import showEditTaxonomyDialog from '../dialogs/editTaxonomy';

import annotationSelectorWidget from '../templates/panels/annotationSelector.pug';
import '../stylesheets/panels/annotationSelector.styl';

/**
 * Create a panel controlling the visibility of annotations
 * on the image view.
 */
var AnnotationSelector = Panel.extend({
    events: _.extend(Panel.prototype.events, {
        'click .h-annotation-name': '_editAnnotation',
        'click .h-toggle-annotation': 'toggleAnnotation',
        'click .h-delete-annotation': 'deleteAnnotation',
        'click .h-create-annotation': 'createAnnotation',
        'click .h-edit-annotation-metadata': 'editAnnotationMetadata',
        'click .h-show-all-annotations': 'showAllAnnotations',
        'click .h-hide-all-annotations': 'hideAllAnnotations',
        'mouseenter .h-annotation': '_highlightAnnotation',
        'mouseleave .h-annotation': '_unhighlightAnnotation',
        'change #h-toggle-labels': 'toggleLabels',
        'change #h-toggle-interactive': 'toggleInteractiveMode',
        'input #h-annotation-opacity': '_changeGlobalOpacity',
        'input #h-annotation-fill-opacity': '_changeGlobalFillOpacity',
        'click .h-annotation-select-by-region': 'selectAnnotationByRegion',
        'click .h-annotation-group-name': '_toggleExpandGroup',
        'click .h-toggle-class': '_toggleClass',
        'click .h-class-header': '_handleClassClick',
        'click .h-class-tree-toggle': '_toggleTreeNode',
        'click .h-edit-taxonomy': '_openEditTaxonomyDialog'
    }),

    /**
     * Create the panel.
     *
     * @param {object} settings
     * @param {AnnotationCollection} settings.collection
     *     The collection representing the annotations attached
     *     to the current image.
     */
    initialize(settings = {}) {
        this._expandedGroups = new Set();
        this._hiddenGroups = new Set();
        this._annotationToGroups = new Map();
        this._activeGroup = null;
        this._opacity = settings.opacity || 0.9;
        this._fillOpacity = settings.fillOpacity || 1.0;
        this._showAllAnnotationsState = false;
        this.listenTo(this.collection, 'sync remove update reset change:displayed change:loading', this._debounceRender);
        this.listenTo(this.collection, 'change:highlight', this._changeAnnotationHighlight);
        this.listenTo(eventStream, 'g:event.job_status', _.debounce(this._onJobUpdate, 500));
        this.listenTo(eventStream, 'g:eventStream.start', this._refreshAnnotations);
        this.listenTo(eventStream, 'g:event.large_image_annotation.create', this._refreshAnnotationsCheck);
        this.listenTo(eventStream, 'g:event.large_image_annotation.remove', this._refreshAnnotationsCheck);
        this.listenTo(this.collection, 'h:revert:annotation', this._refreshAnnotations);
        this.listenTo(this.collection, 'change:annotation change:groups', this._saveAnnotation);
        this.listenTo(girderEvents, 'g:login', () => {
            this.collection.reset();
            this._parentId = undefined;
        });
    },

    _settingsFromConfig() {
        if (!this.parentView || !this.parentView._folderConfig || !this.parentView._folderConfig.settings) {
            return;
        }
        const settings = this.parentView._folderConfig.settings;
        if (this._showLabels === undefined && settings.annotationLabels !== undefined) {
            if (this._showLabels !== (settings.annotationLabels === true)) {
                this.toggleLabels();
            }
        }
        if (this._interactiveMode === undefined && settings.interactiveHover !== undefined) {
            if (this._interactiveMode !== (settings.interactiveHover === true)) {
                this.toggleInteractiveMode();
            }
        }
    },

    render() {
        this._settingsFromConfig();
        this._debounceRenderRequest = null;
        if (this.parentItem && this.parentItem.get('folderId')) {
            const annotationGroups = this._getAnnotationGroups();
            if (!this.viewer) {
                this.$el.empty();
                return;
            }
            if (this._activeGroup === null && this.parentView && this.parentView._defaultGroup) {
                this._activeGroup = this.parentView._defaultGroup;
            }
            const groupTree = this._buildGroupTree();
            this._groupTree = groupTree;
            if (groupTree && !this._treeInitialized) {
                this._treeInitialized = true;
                this._initExpandedTreeNodes(groupTree);
            }
            const activeGroupNode = groupTree ? this._findNodeInTree(groupTree, this._activeGroup) : null;
            this.$el.html(annotationSelectorWidget({
                id: 'annotation-panel-container',
                title: 'Annotations',
                activeAnnotation: this._activeAnnotation ? this._activeAnnotation.id : '',
                activeGroup: this._activeGroup,
                activeGroupNode,
                showLabels: this._showLabels,
                user: getCurrentUser() || {},
                creationAccess: this.creationAccess,
                writeAccessLevel: AccessType.WRITE,
                writeAccess: this._writeAccess,
                opacity: this._opacity,
                fillOpacity: this._fillOpacity,
                interactiveMode: this._interactiveMode,
                expandedGroups: this._expandedGroups,
                annotationGroups,
                groupTree,
                hiddenGroups: this._hiddenGroups,
                annotationAccess: this._annotationAccess,
                collapsed: this.$('.s-panel-content.collapse').length && !this.$('.s-panel-content').hasClass('in'),
                _
            }));
            this._attachDrawWidget();
            this._changeGlobalOpacity();
            this._changeGlobalFillOpacity();
            if (this._showAllAnnotationsState) {
                this.showAllAnnotations();
            }
            if (this._annotationAccess === undefined) {
                this._setCreationAccess(this, this.parentItem.get('folderId'));
            }
        }
        return this;
    },

    _debounceRender() {
        if (!this._debounceRenderRequest) {
            this._debounceRenderRequest = window.requestAnimationFrame(() => { this.render(); });
        }
        return this;
    },

    /**
     * Set the ItemModel associated with the annotation collection.
     * As a side effect, this resets the AnnotationCollection and
     * fetches annotations from the server associated with the
     * item.
     *
     * @param {ItemModel} item
     */
    setItem(item) {
        if (this._parentId === item.id) {
            return;
        }
        this.parentItem = item;
        this._parentId = item.id;
        this._activeGroup = null;
        this._hiddenGroups = new Set();
        this._treeInitialized = false;
        delete this._setCreationRequest;
        delete this._annotationAccess;

        if (!this._parentId) {
            this.collection.reset();
            this._debounceRender();
            return;
        }
        this.collection.offset = 0;
        this.collection.reset();
        this.collection.fetch({itemId: this._parentId}).then(() => {
            let update;
            this.collection.each((model) => {
                if (((model.get('annotation') || {}).display || {}).visible !== false) {
                    model.set('displayed', true);
                    update = true;
                }
            });
            if (update) {
                this._debounceRender();
            }
            return null;
        });
        return this;
    },

    /**
     * Set the image "viewer" instance.  This should be a subclass
     * of `large_image/imageViewerWidget` that is capable of rendering
     * annotations.
     */
    setViewer(viewer) {
        this.viewer = viewer;
        return this;
    },

    /**
     * Toggle the rendering of a specific annotation.  Sets the `displayed`
     * attribute of the `AnnotationModel`.
     */
    toggleAnnotation(evt) {
        var id = $(evt.currentTarget).parents('.h-annotation').data('id');
        var model = this.collection.get(id);

        // any manual change in the display state will reset the "forced display" behavior
        this._showAllAnnotationsState = false;
        model.set('displayed', !model.get('displayed'));
        if (!model.get('displayed')) {
            model.unset('highlight');
            this._deselectAnnotationElements(model);
            this._deactivateAnnotation(model);
        }
    },

    /**
     * Delete an annotation from the server.
     */
    deleteAnnotation(evt) {
        const id = $(evt.currentTarget).parents('.h-annotation').data('id');
        const model = this.collection.get(id);

        if (model) {
            const name = (model.get('annotation') || {}).name || 'unnamed annotation';
            events.trigger('h:confirmDialog', {
                title: 'Warning',
                message: `Are you sure you want to delete ${name}?`,
                submitButton: 'Delete',
                onSubmit: () => {
                    this.trigger('h:deleteAnnotation', model);
                    model.unset('displayed');
                    model.unset('highlight');
                    this.collection.remove(model);
                    if (model._saving) {
                        model._saveAgain = 'delete';
                    } else {
                        model.destroy();
                    }
                }
            });
        }
    },

    _debounceTriggerRedraw(annotation) {
        if (!this._debounceRedrawRequest) {
            this._debounceRedrawRequest = {};
        }
        if (!this._debounceRedrawRequest[annotation.id]) {
            this._debounceRedrawRequest[annotation.id] = window.requestAnimationFrame(() => {
                this._debounceRedrawRequest[annotation.id] = null;
                this.trigger('h:redraw', annotation);
            });
        }
    },

    editAnnotationMetadata(evt) {
        const id = $(evt.currentTarget).parents('.h-annotation').data('id');
        const model = this.collection.get(id);
        const defaultGroup = this.parentView._defaultGroup;
        this.listenToOnce(
            showSaveAnnotationDialog(model, {title: 'Edit annotation', viewer: this.viewer, defaultGroup}),
            'g:submit',
            () => {
                if (model.get('displayed')) {
                    this._debounceTriggerRedraw(model);
                }
            }
        );
    },

    _setCreationAccess(root, folderId) {
        if (!this._setCreationRequest) {
            this._setCreationRequest = restRequest({
                type: 'GET',
                url: 'annotation/folder/' + folderId + '/create',
                error: null
            });
        }
        this._setCreationRequest.done((createResp) => {
            root.creationAccess = createResp;
            root.$('.h-create-annotation').toggleClass('hidden', !createResp);
            if (this.parentItem && this.parentItem.get('folderId') === folderId) {
                this._annotationAccess = true;
                this._debounceRender();
            }
        }).fail(() => {
            root.$('.h-create-annotation').toggleClass('hidden', true);
            if (this.parentItem && this.parentItem.get('folderId') === folderId) {
                this._annotationAccess = false;
                this._debounceRender();
            }
        });
    },

    _onJobUpdate(evt) {
        if (this.parentItem && evt.data.status > 2) {
            this._refreshAnnotations();
        }
    },

    _refreshAnnotationsCheck(evt) {
        if (!evt.data || !evt.data.itemId) {
            return;
        }
        if (!this.parentItem || !this.parentItem.id || evt.data.itemId !== this.parentItem.id) {
            return;
        }
        this._refreshAnnotations();
    },

    _refreshAnnotations() {
        if (this._norefresh) {
            delete this._norefresh;
            return;
        }
        if (!this.parentItem || !this.parentItem.id || !this.viewer) {
            return;
        }
        // if any annotations are saving, defer this
        if (!this.viewer._saving) {
            this.viewer._saving = {};
        }
        delete this.viewer._saving.refresh;
        if (Object.keys(this.viewer._saving).length) {
            this.viewer._saving.refresh = true;
            return;
        }
        var models = this.collection.indexBy(_.property('id'));
        this.collection.offset = 0;
        this.collection.fetch({itemId: this.parentItem.id}).then(() => {
            var activeId = (this._activeAnnotation || {}).id;
            this.collection.each((model) => {
                if (!_.has(models, model.id)) {
                    if (((model.get('annotation') || {}).display || {}).visible !== false) {
                        model.set('displayed', true);
                    }
                } else {
                    let refreshed = false;
                    if (models[model.id].get('displayed')) {
                        if (model.get('_version') !== models[model.id].get('_version')) {
                            model.refresh(true);
                            model.set('displayed', true);
                            refreshed = true;
                        } else {
                            model._centroids = models[model.id]._centroids;
                            model._elements = models[model.id]._elements;
                            if (model.bindListeners) {
                                model.bindListeners();
                            }
                        }
                    }
                    if (!refreshed) {
                        // set without triggering a change; a change reloads
                        // and rerenders, which is only done if it has changed
                        // (above)
                        model.attributes.displayed = models[model.id].get('displayed');
                    }
                }
            });
            this._debounceRender();
            this._activeAnnotation = null;
            if (activeId) {
                this._setActiveAnnotation(this.collection.get(activeId));
            }
            // remove annotations that are displayed but have been deleted
            Object.keys(models).forEach((id) => {
                if (!this.collection.get(id) && models[id].get('displayed')) {
                    this._deselectAnnotationElements(models[id]);
                    this.viewer.removeAnnotation(models[id]);
                }
                if (activeId === id) {
                    this.trigger('h:deleteAnnotation', models[id]);
                }
            });
            this.collection.trigger('h:refreshed', this.collection);
            return null;
        });
    },

    toggleLabels(evt) {
        this._showLabels = !this._showLabels;
        this.trigger('h:toggleLabels', {
            show: this._showLabels
        });
    },

    toggleInteractiveMode(evt) {
        this._interactiveMode = !this._interactiveMode;
        this.trigger('h:toggleInteractiveMode', this._interactiveMode);
    },

    interactiveMode() {
        return this._interactiveMode;
    },

    _editAnnotation(evt) {
        var id = $(evt.currentTarget).parents('.h-annotation').data('id');
        this.editAnnotation(this.collection.get(id));
    },

    editAnnotation(model) {
        // deselect the annotation if it is already selected
        if (this._activeAnnotation && model && this._activeAnnotation.id === model.id) {
            this._activeAnnotation = null;
            this.trigger('h:editAnnotation', null);
            this._debounceRender();
            return;
        }

        if (!this._writeAccess(model)) {
            events.trigger('g:alert', {
                text: 'You do not have write access to this annotation.',
                type: 'warning',
                timeout: 2500,
                icon: 'info'
            });
            return;
        }
        this._setActiveAnnotation(model);
    },

    _setActiveAnnotation(model) {
        this._activeAnnotation = model || null;
        if (this._activeAnnotation === null) {
            return;
        }

        if (!((model.get('annotation') || {}).elements || []).length) {
            // Only load the annotation if it hasn't already been loaded.
            // Technically, an annotation *could* have 0 elements, in which
            // case loading it again should be quick.  There doesn't seem
            // to be any other way to detect an unloaded annotation.
            model.set('loading', true);
            model.fetch().done(() => {
                this._setActiveAnnotationWithoutLoad(model);
            }).always(() => {
                model.unset('loading');
            });
        } else {
            this._setActiveAnnotationWithoutLoad(model);
        }
    },

    _setActiveAnnotationWithoutLoad(model) {
        if (this._activeAnnotation && this._activeAnnotation.id !== model.id) {
            return;
        }
        model.set('displayed', true);

        this.trigger('h:editAnnotation', model);
    },

    createAnnotation(evt) {
        const groupTree = this._buildGroupTree();
        if (groupTree && this._activeGroup) {
            const node = this._findNodeInTree(groupTree, this._activeGroup);
            if (node) {
                const model = new AnnotationModel({
                    itemId: this.parentItem.id,
                    annotation: {name: node.label, display: {visible: true}}
                });
                this._norefresh = true;
                model.save().done(() => {
                    model.set('displayed', true);
                    this.collection.add(model);
                    this.trigger('h:editAnnotation', model);
                    this._activeAnnotation = model;
                });
                return;
            }
        }
        this._createAnnotationDefault();
    },

    _createAnnotationDefault() {
        var model = new AnnotationModel({
            itemId: this.parentItem.id,
            annotation: {}
        });
        this.listenToOnce(
            showSaveAnnotationDialog(model, {title: 'Create annotation'}),
            'g:submit',
            () => {
                this._norefresh = true;
                model.save().done(() => {
                    model.set('displayed', true);
                    this.collection.add(model);
                    this.trigger('h:editAnnotation', model);
                    this._activeAnnotation = model;
                });
            }
        );
    },

    _saveAnnotation(annotation, options) {
        if (options && options.delaySave) {
            return;
        }
        if (annotation._fromFetch || annotation._inBooleanOp) {
            return;
        }
        if (this.viewer && !this.viewer._saving) {
            this.viewer._saving = {};
        }
        const vsaving = (this.viewer || {})._saving || {};
        if (!annotation._saving && !annotation._inFetch && !annotation.get('loading')) {
            vsaving[annotation.id] = true;
            this.$el.addClass('saving');
            const lastSaveAgain = annotation._saveAgain;
            annotation._saving = true;
            annotation._saveAgain = false;
            if (annotation.elements().models.filter((model) => model.get('type') === 'pixelmap').length === 0) {
                this._debounceTriggerRedraw(annotation);
            }
            annotation.save().fail(() => {
                /* If we fail to save (possible because the server didn't
                 * respond), try again, gradually backing off the frequency
                 * of retries. */
                annotation._saveAgain = Math.min(lastSaveAgain ? lastSaveAgain * 2 : 5, 300);
            }).always(() => {
                annotation._saving = false;
                delete vsaving[annotation.id];
                if (annotation._saveAgain !== undefined && annotation._saveAgain !== false) {
                    if (annotation._saveAgain === 'delete') {
                        annotation.destroy();
                    } else if (!annotation._saveAgain) {
                        this._saveAnnotation(annotation);
                    } else {
                        vsaving[annotation.id] = true;
                        window.setTimeout(() => {
                            if (annotation._saveAgain !== undefined && annotation._saveAgain !== false) {
                                this._saveAnnotation(annotation);
                            }
                        }, annotation._saveAgain * 1000);
                    }
                }
                if (Object.keys(vsaving).length === 1 && vsaving.refresh) {
                    this._refreshAnnotations();
                }
                if (!Object.keys(vsaving).length || (Object.keys(vsaving).length === 1 && vsaving.refresh)) {
                    this.$el.removeClass('saving');
                }
            });
        } else if (!annotation._inFetch && !annotation.get('loading')) {
            /* if we are saving, flag that we need to save again after we
             * finish as there are newer changes. */
            if (annotation._saveAgain !== 'delete') {
                annotation._saveAgain = 0;
            }
            if (annotation.elements().models.filter((model) => model.get('type') === 'pixelmap').length === 0) {
                this._debounceTriggerRedraw(annotation);
            }
        } else {
            annotation._saveAgain = false;
            delete vsaving[annotation.id];
            if (annotation.elements().models.filter((model) => model.get('type') === 'pixelmap').length === 0) {
                this._debounceTriggerRedraw(annotation);
            }
            if (Object.keys(vsaving).length === 1 && vsaving.refresh) {
                this._refreshAnnotations();
            }
            if (!Object.keys(vsaving).length || (Object.keys(vsaving).length === 1 && vsaving.refresh)) {
                this.$el.removeClass('saving');
            }
        }
    },

    _writeAccess(annotation, needsOwn) {
        if (needsOwn) {
            return annotation.get('_accessLevel') >= AccessType.ADMIN;
        }
        return annotation.get('_accessLevel') >= AccessType.WRITE;
    },

    _deactivateAnnotation(model) {
        if (this._activeAnnotation && this._activeAnnotation.id === model.id) {
            this._activeAnnotation = null;
            this.trigger('h:editAnnotation', null);
            this._debounceRender();
        }
    },

    _deselectAnnotationElements(model) {
        this.parentView.trigger('h:deselectAnnotationElements', {model});
    },

    showAllAnnotations() {
        this._showAllAnnotationsState = true;
        this._hiddenGroups.clear();
        this.collection.each((model) => {
            model.set('displayed', true);
        });
    },

    hideAllAnnotations() {
        this._showAllAnnotationsState = false;
        this.collection.each((model) => {
            model.set('displayed', false);
            this._deselectAnnotationElements(model);
            this._deactivateAnnotation(model);
        });
    },

    selectAnnotationByRegionActive() {
        const btn = this.$('.h-annotation-select-by-region');
        return !!btn.hasClass('active');
    },

    selectAnnotationByRegion(polygon) {
        const btn = this.$('.h-annotation-select-by-region');
        // listen to escape key
        $(document).on('keydown.h-annotation-select-by-region', (evt) => {
            if (evt.keyCode === 27) {
                this.selectAnnotationByRegionCancel();
            }
        });
        this.listenToOnce(this.parentView, 'h:selectedElementsByRegion', () => {
            btn.removeClass('active');
            $(document).off('keydown.h-annotation-select-by-region');
        });

        if (!btn.hasClass('active')) {
            btn.addClass('active');
            this.parentView.trigger('h:selectElementsByRegion', {polygon: polygon === true});
        } else {
            this.selectAnnotationByRegionCancel();
        }
    },

    selectAnnotationByRegionCancel() {
        const btn = this.$('.h-annotation-select-by-region');
        if (btn.hasClass('active')) {
            btn.removeClass('active');
            $(document).off('keydown.h-annotation-select-by-region');
            this.parentView.trigger('h:selectElementsByRegionCancel');
        }
    },

    _highlightAnnotation(evt) {
        const id = $(evt.currentTarget).data('id');
        const model = this.collection.get(id);
        if (model.get('displayed')) {
            this.parentView.trigger('h:highlightAnnotation', id);
        }
    },

    _unhighlightAnnotation() {
        this.parentView.trigger('h:highlightAnnotation');
    },

    _changeAnnotationHighlight(model) {
        this.$(`.h-annotation[data-id="${model.id}"]`).toggleClass('h-highlight-annotation', model.get('highlighted'));
    },

    _changeGlobalOpacity() {
        this._opacity = this.$('#h-annotation-opacity').val();
        this.$('.h-annotation-opacity-container')
            .attr('title', `Annotation total opacity ${(this._opacity * 100).toFixed()}%`);
        this.trigger('h:annotationOpacity', this._opacity);
    },

    _changeGlobalFillOpacity() {
        this._fillOpacity = this.$('#h-annotation-fill-opacity').val();
        this.$('.h-annotation-fill-opacity-container')
            .attr('title', `Annotation fill opacity ${(this._fillOpacity * 100).toFixed()}%`);
        this.trigger('h:annotationFillOpacity', this._fillOpacity);
    },

    _toggleExpandGroup(evt) {
        const name = $(evt.currentTarget).parent().data('groupName');
        if (this._expandedGroups.has(name)) {
            this._expandedGroups.delete(name);
        } else {
            this._expandedGroups.add(name);
        }
        this._debounceRender();
    },

    _getAnnotationGroups() {
        // Annotations without elements don't have any groups, so we inject the null group
        // so that they are displayed in the panel.
        this.collection.each((a) => {
            const groups = a.get('groups') || [];
            if (!groups.length) {
                groups.push(null);
            }
        });
        const groupObject = {};
        const groups = _.union(...this.collection.map((a) => a.get('groups')));
        _.each(groups, (group) => {
            const groupList = this.collection.filter(
                (a) => _.contains(a.get('groups'), group));

            if (group === null) {
                group = 'Other';
            }
            groupObject[group] = _.sortBy(groupList, (a) => a.get('created'));
        });
        this._triggerGroupCountChange(groupObject);
        return groupObject;
    },

    _triggerGroupCountChange(groups) {
        const groupCount = {};
        _.each(groups, (annotations, name) => {
            if (name !== 'Other') {
                groupCount[name] = annotations.length;
            } else {
                groupCount[this.parentView._defaultGroup || 'default'] = annotations.length;
            }
        });
        this.trigger('h:groupCount', groupCount);
    },

    _buildGroupTree() {
        const configGroups = (
            this.parentView &&
            this.parentView._folderConfig &&
            this.parentView._folderConfig.annotationGroups &&
            this.parentView._folderConfig.annotationGroups.groups
        ) || null;
        if (!configGroups || !configGroups.length) {
            return null;
        }

        const counts = {};
        const annosByGroup = {};
        this.collection.each((model) => {
            const liveModels = model.elements ? model.elements().models : [];
            const elems = liveModels.length > 0
                ? liveModels.map((e) => ({group: e.get('group')}))
                : (model.get('annotation') || {}).elements || [];
            // If the annotation name matches a config group, bind the whole
            // annotation to that group so toggling is decoupled per annotation.
            const name = (model.get('annotation') || {}).name;
            const nameMatched = configGroups.find((g) => {
                let lbl = g.label;
                while (lbl && typeof lbl === 'object') { lbl = lbl.value; }
                return (lbl || g.id) === name || g.id === name;
            });
            if (nameMatched) {
                const g = nameMatched.id;
                counts[g] = (counts[g] || 0) + Math.max(elems.length, 1);
                if (!annosByGroup[g]) {
                    annosByGroup[g] = [];
                }
                if (!annosByGroup[g].includes(model)) {
                    annosByGroup[g].push(model);
                }
            } else {
                // No name match — fall back to grouping by each element's group.
                elems.forEach((e) => {
                    const g = e.group != null ? e.group : 'Other';
                    counts[g] = (counts[g] || 0) + 1;
                    if (!annosByGroup[g]) {
                        annosByGroup[g] = [];
                    }
                    if (!annosByGroup[g].includes(model)) {
                        annosByGroup[g].push(model);
                    }
                });
            }
        });

        this._annotationToGroups = new Map();
        Object.keys(annosByGroup).forEach((g) => {
            annosByGroup[g].forEach((model) => {
                if (!this._annotationToGroups.has(model.id)) {
                    this._annotationToGroups.set(model.id, new Set());
                }
                this._annotationToGroups.get(model.id).add(g);
            });
        });

        const nodeMap = {};
        configGroups.forEach((g) => {
            let rawLabel = g.label;
            while (rawLabel && typeof rawLabel === 'object') { rawLabel = rawLabel.value; }
            nodeMap[g.id] = {
                id: g.id,
                label: rawLabel || g.id,
                fillColor: g.fillColor || 'rgba(128,128,128,0.3)',
                lineColor: g.lineColor || 'rgb(128,128,128)',
                parent: g.parent || null,
                count: counts[g.id] || 0,
                annotations: annosByGroup[g.id] || [],
                children: [],
                depth: 0
            };
        });

        const roots = [];
        configGroups.forEach((g) => {
            const node = nodeMap[g.id];
            if (node.parent && nodeMap[node.parent]) {
                nodeMap[node.parent].children.push(node);
            } else {
                roots.push(node);
            }
        });

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

        const otherCount = counts['Other'] || 0;
        if (otherCount > 0) {
            roots.push({
                id: 'Other',
                label: 'Other',
                fillColor: 'rgba(150,150,150,0.2)',
                lineColor: 'rgb(150,150,150)',
                parent: null,
                count: otherCount,
                annotations: annosByGroup['Other'] || [],
                children: [],
                depth: 0
            });
        }

        return roots;
    },

    _initExpandedTreeNodes(nodes) {
        nodes.forEach((node) => {
            if (node.children.length) {
                this._expandedGroups.add('tree:' + node.id);
                this._initExpandedTreeNodes(node.children);
            }
        });
    },

    _findNodeInTree(nodes, id) {
        for (const node of nodes) {
            if (node.id === id) { return node; }
            const found = this._findNodeInTree(node.children, id);
            if (found) { return found; }
        }
        return null;
    },

    _setActiveGroup(groupId) {
        this._activeGroup = groupId;
        this._syncDrawWidgetStyle(groupId);
        this._debounceRender();
    },

    _syncDrawWidgetStyle(groupId) {
        if (!this._drawWidget || !this._drawWidget._groups) {
            return;
        }
        if (!this._drawWidget._groups.get(groupId)) {
            this._drawWidget._groups.add({id: groupId});
        }
        const style = this._drawWidget._groups.get(groupId);
        if (groupId !== 'Other' && !style.get('group')) {
            style.set('group', groupId);
        }
        this._drawWidget._setStyleGroup(style.toJSON());
    },

    _toggleClass(evt) {
        evt.stopPropagation();
        const groupId = $(evt.currentTarget).data('groupId');
        const node = this._groupTree ? this._findNodeInTree(this._groupTree, groupId) : null;
        if (!node) { return; }
        const nowHiding = !this._hiddenGroups.has(groupId);
        if (nowHiding) {
            this._hiddenGroups.add(groupId);
        } else {
            this._hiddenGroups.delete(groupId);
        }
        this._showAllAnnotationsState = false;
        node.annotations.forEach((a) => {
            if (nowHiding) {
                a.set('displayed', false);
            } else {
                // Only restore if none of this annotation's groups are still hidden.
                const modelGroups = this._annotationToGroups.get(a.id) || new Set([groupId]);
                if ([...modelGroups].every((g) => !this._hiddenGroups.has(g))) {
                    a.set('displayed', true);
                }
            }
        });
    },

    _handleClassClick(evt) {
        if ($(evt.target).closest('.h-class-tree-toggle, .h-class-expand-annotations, .h-toggle-class').length) {
            return;
        }
        const groupId = $(evt.currentTarget).closest('.h-class-node').data('groupId');
        if (!groupId) {
            return;
        }
        this._setActiveGroup(groupId);

        // Find the annotation to auto-open for this class.
        // Primary: use the loaded-element group tree (most accurate).
        // Fallback: use server-provided 'groups' metadata on each annotation model.
        let annotations = [];
        if (this._groupTree) {
            const node = this._findNodeInTree(this._groupTree, groupId);
            if (node) {
                annotations = node.annotations;
            }
        }
        if (!annotations.length) {
            // 'Other' represents null-group elements in the server metadata
            const metaGroup = groupId === 'Other' ? null : groupId;
            annotations = this.collection.filter((a) => {
                const groups = a.get('groups') || [];
                return groups.some((g) => g === metaGroup);
            });
        }

        if (annotations.length) {
            const annotation = annotations[annotations.length - 1];
            const already = this._activeAnnotation && this._activeAnnotation.id === annotation.id;
            if (!already) {
                this.editAnnotation(annotation);
            }
        } else {
            // No annotation exists for this class yet — deactivate editing so the
            // user must click "+ New" before drawing, preventing elements from
            // being added to a different class's annotation.
            if (this._activeAnnotation) {
                this._activeAnnotation = null;
                this.trigger('h:editAnnotation', null);
                this._debounceRender();
            }
        }
    },

    _toggleTreeNode(evt) {
        evt.stopPropagation();
        const groupId = $(evt.currentTarget).data('groupId');
        const key = 'tree:' + groupId;
        if (this._expandedGroups.has(key)) {
            this._expandedGroups.delete(key);
        } else {
            this._expandedGroups.add(key);
        }
        this._debounceRender();
    },

    setDrawWidget(widget) {
        this._drawWidget = widget || null;
        this._attachDrawWidget();
        return this;
    },

    _attachDrawWidget() {
        const $section = this.$('.h-draw-section');
        if (!$section.length) {
            return;
        }
        $section.empty();
        if (this._drawWidget) {
            $section.append(this._drawWidget.el);
            // Re-bind Backbone events: this.$el.html() above destroyed jQuery
            // event handlers on all descendants, including DrawWidget's el.
            this._drawWidget.delegateEvents();
            this._drawWidget.$('.h-dropdown-content').collapse({toggle: false});
        }
    },

    _openEditTaxonomyDialog() {
        showEditTaxonomyDialog({
            folderId: this.parentItem.get('folderId'),
            folderConfig: (this.parentView || {})._folderConfig,
            parentView: this.parentView
        });
    }
});

export default AnnotationSelector;
