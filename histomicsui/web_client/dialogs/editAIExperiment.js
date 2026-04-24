import $ from 'jquery';
import Backbone from 'backbone';

import {restRequest} from '@girder/core/rest';
import events from '@girder/core/events';

import editAIExperimentTemplate from '../templates/dialogs/editAIExperiment.pug';

const SCAN_CHUNK = 20;

const EditAIExperimentView = Backbone.View.extend({
    events: {
        'change input[name="h-ai-scope"]': '_onScopeChange',
        'click .h-ai-save-btn': '_onSave'
    },

    initialize(settings) {
        this._folderId = settings.folderId;
        this._experiment = settings.experiment || null;
        this._onSaveCallback = settings.onSave || null;
        this._annotationNames = [];
        this._scanning = true;
    },

    render() {
        const exp = this._experiment || {};
        this.$el.html(editAIExperimentTemplate({name: exp.name || ''}));
        this.$('.modal').modal('show');
        this.$('.modal').on('hidden.bs.modal', () => this.remove());

        // Set scope radio from existing config
        const scope = exp.scope || 'whole_slide';
        this.$(`input[name="h-ai-scope"][value="${scope}"]`).prop('checked', true);
        if (scope === 'roi') {
            this.$('.h-ai-roi-group').show();
        }

        this._scanAnnotations();
        return this;
    },

    _scanAnnotations() {
        restRequest({
            url: 'item',
            data: {folderId: this._folderId, limit: 10000},
            error: null
        }).then((items) => {
            const nameSet = new Set();
            const chunks = [];
            for (let i = 0; i < (items || []).length; i += SCAN_CHUNK) {
                chunks.push(items.slice(i, i + SCAN_CHUNK));
            }
            return chunks.reduce((p, chunk) =>
                p.then(() =>
                    Promise.all(chunk.map((item) =>
                        restRequest({
                            url: 'annotation',
                            data: {itemId: item._id},
                            error: null
                        }).then((annotations) => {
                            (annotations || []).forEach((a) => {
                                const name = (a.annotation || {}).name;
                                if (name) nameSet.add(name);
                            });
                        }).catch(() => {})
                    ))
                ),
                Promise.resolve()
            ).then(() => Array.from(nameSet).sort());
        }).then((names) => {
            this._annotationNames = names;
            this._scanning = false;
            this._populateAnnotationControls();
        }).catch(() => {
            this._annotationNames = [];
            this._scanning = false;
            this._populateAnnotationControls();
        });
    },

    _populateAnnotationControls() {
        const exp = this._experiment || {};
        const selectedTargets = exp.targets || [];
        const currentRoi = exp.roiAnnotation || '';

        this.$('.h-ai-scanning').hide();

        const $targetList = this.$('.h-ai-target-list');
        if (!this._annotationNames.length) {
            $targetList.html('<p class="text-muted small">No annotations found in this folder.</p>');
        } else {
            $targetList.html(this._annotationNames.map((name) => {
                const checked = selectedTargets.includes(name) ? ' checked' : '';
                const escaped = $('<span>').text(name).html();
                return `<div class="checkbox"><label>` +
                    `<input class="h-ai-target-checkbox" type="checkbox" value="${escaped}"${checked}> ` +
                    `${escaped}</label></div>`;
            }).join(''));
        }

        const $roiSelect = this.$('#h-ai-roi-annotation');
        $roiSelect.find('option:not([value=""])').remove();
        this._annotationNames.forEach((name) => {
            const escaped = $('<span>').text(name).html();
            const selected = name === currentRoi ? ' selected' : '';
            $roiSelect.append(`<option value="${escaped}"${selected}>${escaped}</option>`);
        });
    },

    _getSelectedTargets() {
        const targets = [];
        this.$('.h-ai-target-checkbox:checked').each(function () {
            targets.push($(this).val());
        });
        return targets;
    },

    _onScopeChange() {
        const scope = this.$('input[name="h-ai-scope"]:checked').val();
        this.$('.h-ai-roi-group').toggle(scope === 'roi');
    },

    _onSave() {
        const name = this.$('#h-ai-exp-name').val().trim();
        const targets = this._getSelectedTargets();
        const scope = this.$('input[name="h-ai-scope"]:checked').val() || 'whole_slide';
        const roiAnnotation = scope === 'roi' ? (this.$('#h-ai-roi-annotation').val() || '') : null;

        const $err = this.$('.g-validation-failed-message');
        if (!targets.length) {
            $err.text('Select at least one target annotation.').removeClass('hidden');
            return;
        }
        if (scope === 'roi' && !roiAnnotation) {
            $err.text('Select an ROI annotation.').removeClass('hidden');
            return;
        }
        $err.addClass('hidden');

        const updated = Object.assign({}, this._experiment || {}, {
            name: name || undefined,
            targets,
            scope,
            roiAnnotation: roiAnnotation || null,
            validation: null  // clear stale validation on config change
        });

        this.$('.h-ai-save-btn').prop('disabled', true).text('Saving…');

        restRequest({
            url: `folder/${this._folderId}/metadata`,
            method: 'PUT',
            contentType: 'application/json',
            data: JSON.stringify({_aiExperiment: updated}),
            error: null
        }).done(() => {
            this.$('.modal').modal('hide');
            if (this._onSaveCallback) {
                this._onSaveCallback(updated);
            }
        }).fail(() => {
            this.$('.h-ai-save-btn').prop('disabled', false).text('Save');
            $err.text('Failed to save experiment configuration.').removeClass('hidden');
        });
    }
});

var showEditAIExperimentDialog = function (settings) {
    const view = new EditAIExperimentView({
        folderId: settings.folderId,
        experiment: settings.experiment || null,
        onSave: settings.onSave || null,
        el: $('<div/>').appendTo('body')
    });
    view.render();
    return view;
};

export default showEditAIExperimentDialog;
