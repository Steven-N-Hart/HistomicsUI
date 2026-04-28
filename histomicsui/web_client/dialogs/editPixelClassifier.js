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
        'click .h-pc-save-btn': '_save'
    },

    initialize(settings) {
        this._itemId = settings.itemId;
        this._session = settings.session || null;
        this._onSave = settings.onSave || function () {};
        this._annotations = [];
    },

    render() {
        this.$el.html(editPixelClassifierTemplate({
            session: this._session,
            annotations: this._annotations
        }));
        this.$('.modal').modal('show');
        this.$('.modal').on('hidden.bs.modal', () => this.remove());
        this._updateModelDesc();
        this._loadAnnotations();
        return this;
    },

    _loadAnnotations() {
        restRequest({
            url: `annotation?itemId=${this._itemId}&limit=200&sort=lowerName`,
            error: null
        }).then((anns) => {
            this._annotations = anns || [];
            // Re-render only the dropdown to avoid losing other form state
            const currentVal = this.$('#h-pc-existing-ann-id').val();
            const $select = this.$('#h-pc-existing-ann-id');
            $select.empty().append('<option value="">— Draw with brush (new blank annotation) —</option>');
            this._annotations.forEach((ann) => {
                const name = (ann.annotation && ann.annotation.name) || ann._id;
                const selected = currentVal === ann._id ||
                    (!currentVal && this._session &&
                     this._session.training_annotation_id === ann._id);
                $select.append(
                    $('<option>')
                        .val(ann._id)
                        .text(name)
                        .prop('selected', selected)
                );
            });
        });
    },

    _updateModelDesc() {
        const type = this.$('#h-pc-model-type').val();
        this.$('.h-pc-model-desc').text(MODEL_DESCRIPTIONS[type] || '');
    },

    _validate(name) {
        if (!name) {
            return 'Session name is required.';
        }
        return null;
    },

    _save() {
        const name = this.$('#h-pc-session-name').val().trim();
        const existingAnnId = this.$('#h-pc-existing-ann-id').val().trim();
        // Classes always auto-detected by the CLI from the annotation
        const classes = [];
        const error = this._validate(name);
        if (error) {
            this.$('.h-pc-edit-error').text(error).removeClass('hidden');
            return;
        }
        this.$('.h-pc-edit-error').addClass('hidden');
        this.$('.h-pc-save-btn').prop('disabled', true).text('Saving…');

        const isNew = !this._session;
        const now = new Date().toISOString();

        const session = Object.assign({}, this._session || {}, {
            name,
            classes,
            magnification: parseInt(this.$('#h-pc-magnification').val(), 10),
            model_type: this.$('#h-pc-model-type').val(),
            patch_size: parseInt(this.$('#h-pc-patch-size').val(), 10),
            updated_at: now
        });
        if (isNew) {
            session.created_at = now;
            session.iterations = [];
        }

        const saveSession = () => restRequest({
            url: `item/${this._itemId}/metadata`,
            method: 'PUT',
            contentType: 'application/json',
            data: JSON.stringify({_pixelClassifierSession: session}),
            error: null
        });

        const linkAnnotation = () => {
            if (existingAnnId) {
                return Promise.resolve(existingAnnId);
            }
            if (session.training_annotation_id) {
                return Promise.resolve(session.training_annotation_id);
            }
            // Brush path: create a blank pixelmap annotation to draw on
            return restRequest({
                url: `annotation?itemId=${this._itemId}`,
                method: 'POST',
                contentType: 'application/json',
                data: JSON.stringify({
                    annotation: {
                        name: `PixelClassifier Training — ${session.name}`,
                        elements: [{
                            type: 'pixelmap',
                            values: '',
                            categories: [],
                            boundaries: {x: 0, y: 0, width: 0, height: 0}
                        }]
                    }
                }),
                error: null
            }).then((ann) => ann._id);
        };

        saveSession()
            .then(() => linkAnnotation())
            .then((annId) => {
                session.training_annotation_id = annId;
                return restRequest({
                    url: `item/${this._itemId}/metadata`,
                    method: 'PUT',
                    contentType: 'application/json',
                    data: JSON.stringify({_pixelClassifierSession: session}),
                    error: null
                });
            })
            .then(() => {
                this.$('.modal').modal('hide');
                this._onSave(session);
            })
            .catch((resp) => {
                this.$('.h-pc-save-btn').prop('disabled', false).text('Save');
                const msg = ((resp.responseJSON || {}).message) ||
                    resp.statusText || 'Unknown error';
                this.$('.h-pc-edit-error').text('Save failed: ' + msg).removeClass('hidden');
            });
    }
});


const showEditPixelClassifierDialog = function (settings) {
    const view = new EditPixelClassifierView({
        itemId: settings.itemId,
        session: settings.session || null,
        onSave: settings.onSave || function () {},
        el: $('<div/>').appendTo('body')
    });
    view.render();
    return view;
};

export default showEditPixelClassifierDialog;
