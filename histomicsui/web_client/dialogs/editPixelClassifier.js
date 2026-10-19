import $ from 'jquery';
import Backbone from 'backbone';

import {restRequest} from '@girder/core/rest';

import editPixelClassifierTemplate from '../templates/dialogs/editPixelClassifier.pug';

const MODEL_DESCRIPTIONS = {
    trident_linear: 'Fastest — logistic regression on pre-computed TRIDENT patch embeddings.',
    trident_mlp: 'MLP head on pre-computed TRIDENT embeddings. Slightly slower to train.',
    resnet_linear: 'GPU ResNet-18 features (no TRIDENT required). Good fallback.',
    random_forest: 'CPU-only. No GPU or TRIDENT required. Slower inference.'
};

const EditPixelClassifierView = Backbone.View.extend({
    events: {
        'change #h-pc-model-type': '_updateModelDesc',
        'click .h-pc-save-btn': '_save',
        'click .btn-default': '_cancel',
        'click .close': '_cancel'
    },

    initialize(settings) {
        this._folderId = settings.folderId;
        this._checkedItemIds = settings.checkedItemIds || [];
        this._session = settings.session || null;
        this._onSave = settings.onSave || function () {};
        this._annotationNames = [];
    },

    render() {
        this.$el.html(editPixelClassifierTemplate({
            session: this._session,
            annotationNames: this._annotationNames,
            noSlidesChecked: !this._checkedItemIds.length
        }));
        this.$('.modal').modal('show');
        this.$('.modal').on('hidden.bs.modal', () => this.remove());
        this._updateModelDesc();
        this._loadAnnotationNames();
        return this;
    },

    _cancel() {
        this.$('.modal').modal('hide');
    },

    _loadAnnotationNames() {
        const itemIds = this._checkedItemIds;
        if (!itemIds.length) {
            // Initial render already shows the "check slides" message — nothing to update.
            return;
        }

        const chunkSize = 5;
        let i = 0;
        const allResults = [];

        const processChunk = () => {
            const chunk = itemIds.slice(i, i + chunkSize);
            if (!chunk.length) {
                // all done
                const nameSet = new Set();
                (allResults || []).forEach((anns) => {
                    (anns || []).forEach((ann) => {
                        const name = (ann.annotation || {}).name;
                        if (name) nameSet.add(name);
                    });
                });
                this._annotationNames = Array.from(nameSet).sort();
                this._rerenderDropdowns();
                return;
            }

            Promise.all(
                chunk.map((id) => new Promise((resolve) => {
                    restRequest({url: 'annotation', data: {itemId: id, limit: 500}, error: null})
                        .then(resolve)
                        .fail(() => resolve(null));
                }))
            ).then((results) => {
                allResults.push(...results);
                i += chunkSize;
                processChunk();
            });
        };

        processChunk();
    },

    _rerenderDropdowns() {
        const names = this._annotationNames;
        const savedAnn = (this._session || {}).positive_annotation_name || '';
        const savedRoi = (this._session || {}).roi_annotation_name || '';

        const makeSelect = (id, blankLabel, selectedValue) => {
            const $select = $(`<select id="${id}" class="form-control">`);
            $select.append($('<option>').val('').text(blankLabel));
            names.forEach((name) => {
                $select.append($('<option>').val(name).text(name).prop('selected', name === selectedValue));
            });
            return $select;
        };

        // Replace the loading spinners with dropdowns in-place — never touch .modal itself.
        this.$('label[for="h-pc-ann-name"]').siblings('.text-muted').replaceWith(
            makeSelect('h-pc-ann-name', '— Select annotation —', savedAnn)
        );
        this.$('label[for="h-pc-roi-name"]').siblings('.text-muted').replaceWith(
            makeSelect('h-pc-roi-name', '— None (use whole slide) —', savedRoi)
        );

        this.delegateEvents();
    },

    _updateModelDesc() {
        const type = this.$('#h-pc-model-type').val();
        this.$('.h-pc-model-desc').text(MODEL_DESCRIPTIONS[type] || '');
    },

    _save() {
        const name = this.$('#h-pc-session-name').val().trim();
        const annName = (this.$('#h-pc-ann-name').val() || '').trim();

        if (!name) {
            this.$('.h-pc-edit-error').text('Experiment name is required.').removeClass('hidden');
            return;
        }
        if (!annName) {
            this.$('.h-pc-edit-error').text('Annotation name is required.').removeClass('hidden');
            return;
        }
        this.$('.h-pc-edit-error').addClass('hidden');
        this.$('.h-pc-save-btn').prop('disabled', true).text('Saving…');

        const now = new Date().toISOString();
        const session = Object.assign({}, this._session || {}, {
            name,
            positive_annotation_name: annName,
            roi_annotation_name: (this.$('#h-pc-roi-name').val() || '').trim() || null,
            magnification: parseInt(this.$('#h-pc-magnification').val(), 10),
            model_type: this.$('#h-pc-model-type').val(),
            patch_size: parseInt(this.$('#h-pc-patch-size').val(), 10),
            updated_at: now
        });
        if (!this._session) {
            session.created_at = now;
            session.iterations = [];
        }

        restRequest({
            url: `folder/${this._folderId}/metadata`,
            method: 'PUT',
            contentType: 'application/json',
            data: JSON.stringify({_pixelClassifierSession: session}),
            error: null
        }).then(() => {
            this.$('.modal').modal('hide');
            this._onSave(session);
        }).catch((resp) => {
            this.$('.h-pc-save-btn').prop('disabled', false).text('Save');
            const msg = ((resp.responseJSON || {}).message) || resp.statusText || 'Unknown error';
            this.$('.h-pc-edit-error').text('Save failed: ' + msg).removeClass('hidden');
        });
    }
});

const showEditPixelClassifierDialog = function (settings) {
    const view = new EditPixelClassifierView({
        folderId: settings.folderId,
        checkedItemIds: settings.checkedItemIds || [],
        session: settings.session || null,
        onSave: settings.onSave || function () {},
        el: $('<div/>').appendTo('body')
    });
    view.render();
    return view;
};

export default showEditPixelClassifierDialog;
