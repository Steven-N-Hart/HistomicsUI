import $ from 'jquery';
import Backbone from 'backbone';

import {restRequest} from '@girder/core/rest';

import editSlideClassifierTemplate from '../templates/dialogs/editSlideClassifier.pug';

const EditSlideClassifierView = Backbone.View.extend({
    events: {
        'click .h-sc-add-class-btn': '_onAddClass',
        'click .h-sc-remove-class-btn': '_onRemoveClass',
        'click .h-sc-save-btn': '_onSave'
    },

    initialize(settings) {
        this._folderId = settings.folderId;
        this._experiment = settings.experiment || null;
        this._onSaveCallback = settings.onSave || null;
    },

    render() {
        const exp = this._experiment || {};
        this.$el.html(editSlideClassifierTemplate({
            name: exp.name || '',
            classes: (exp.classes || []).slice()
        }));
        this.$('.modal').modal('show');
        this.$('.modal').on('hidden.bs.modal', () => this.remove());
        return this;
    },

    _onAddClass() {
        const $input = this.$('.h-sc-new-class-input');
        const name = $input.val().trim();
        if (!name) return;

        const existing = this._getClasses();
        if (existing.includes(name)) {
            $input.val('');
            return;
        }

        const escaped = $('<span>').text(name).html();
        this.$('.h-sc-class-list').append(
            `<div class="h-sc-class-item" style="display:flex;align-items:center;margin-bottom:4px">` +
            `<span class="h-sc-class-name" style="flex:1">${escaped}</span>` +
            `<button type="button" class="btn btn-xs btn-danger h-sc-remove-class-btn" ` +
            `data-name="${escaped}">` +
            `<i class="icon-cancel"></i></button></div>`
        );
        $input.val('');
        this.$('.h-sc-no-classes-msg').hide();
    },

    _onRemoveClass(e) {
        $(e.currentTarget).closest('.h-sc-class-item').remove();
        if (!this.$('.h-sc-class-item').length) {
            this.$('.h-sc-no-classes-msg').show();
        }
    },

    _getClasses() {
        const classes = [];
        this.$('.h-sc-class-name').each(function () {
            classes.push($(this).text().trim());
        });
        return classes;
    },

    _onSave() {
        const name = this.$('#h-sc-exp-name').val().trim();
        const classes = this._getClasses();

        const $err = this.$('.g-validation-failed-message');
        if (classes.length < 1) {
            $err.text('Add at least one class.').removeClass('hidden');
            return;
        }
        $err.addClass('hidden');

        const updated = Object.assign({}, this._experiment || {}, {
            name: name || undefined,
            classes,
            validation: null
        });

        // Remove old annotation-based fields if present
        delete updated.targets;
        delete updated.scope;
        delete updated.roiAnnotation;

        this.$('.h-sc-save-btn').prop('disabled', true).text('Saving…');

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
            this.$('.h-sc-save-btn').prop('disabled', false).text('Save');
            $err.text('Failed to save configuration.').removeClass('hidden');
        });
    }
});

const showEditSlideClassifierDialog = function (settings) {
    const view = new EditSlideClassifierView({
        folderId: settings.folderId,
        experiment: settings.experiment || null,
        onSave: settings.onSave || null,
        el: $('<div/>').appendTo('body')
    });
    view.render();
    return view;
};

export default showEditSlideClassifierDialog;
