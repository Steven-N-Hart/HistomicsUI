import $ from 'jquery';
import Backbone from 'backbone';

import {restRequest, getApiRoot} from '@girder/core/rest';
import {getCurrentToken} from '@girder/core/auth';
import events from '@girder/core/events';

import applyPixelClassifierTemplate from '../templates/dialogs/applyPixelClassifier.pug';

const STAGING_BASE = '/Export/Shared/DSA/pixel_classifier';

const ApplyPixelClassifierView = Backbone.View.extend({
    events: {
        'click .h-pc-apply-submit': '_submit'
    },

    initialize(settings) {
        this._modelItemId = settings.modelItemId;
        this._itemIds = settings.itemIds || [];
        this._cliId = null;
        this._modelMeta = null;
    },

    render() {
        this.$el.html(applyPixelClassifierTemplate({
            itemIds: this._itemIds,
            modelMeta: null,
            jobDir: `${STAGING_BASE}/apply`
        }));
        this.$('.modal').modal('show');
        this.$('.modal').on('hidden.bs.modal', () => this.remove());
        this._loadCliInfo();
        this._loadModelMeta();
        return this;
    },

    _loadCliInfo() {
        restRequest({url: 'slicer_cli_web/cli', error: null}).then((cliList) => {
            const entry = (cliList || []).find((c) => c.name === 'ApplyPixelClassifier');
            if (entry) {
                this._cliId = entry._id;
            } else {
                this._showError(
                    'ApplyPixelClassifier CLI is not registered. '
                    + 'Rebuild the histomicstk worker image.'
                );
            }
        });
    },

    _loadModelMeta() {
        if (!this._modelItemId) return;
        restRequest({url: `item/${this._modelItemId}`, error: null}).then((item) => {
            this._modelMeta = ((item || {}).meta || {}).pixelClassifierModel || null;
            if (this._modelMeta) {
                this.$el.html(applyPixelClassifierTemplate({
                    itemIds: this._itemIds,
                    modelMeta: this._modelMeta,
                    jobDir: `${STAGING_BASE}/apply`
                }));
            }
        });
    },

    _submit() {
        if (!this._cliId) {
            this._showError('ApplyPixelClassifier CLI is not registered.');
            return;
        }

        let itemIds = this._itemIds.slice();
        if (!itemIds.length) {
            const raw = (this.$('#h-pc-apply-item-ids').val() || '')
                .split(',').map((s) => s.trim()).filter(Boolean);
            itemIds = raw;
        }
        if (!itemIds.length) {
            this._showError('No slides selected. Enter item IDs or select slides in the folder browser.');
            return;
        }

        const jobDir = this.$('#h-pc-apply-job-dir').val().trim();
        if (!jobDir) {
            this._showError('Output directory is required.');
            return;
        }

        this.$('.h-pc-apply-submit').prop('disabled', true).text('Submitting…');
        this.$('.h-pc-apply-error').addClass('hidden');

        const rawToken = getCurrentToken();
        const token = (rawToken && typeof rawToken === 'object')
            ? (rawToken.token || '') : (rawToken || '');

        const submissions = itemIds.map((itemId) => restRequest({
            url: `slicer_cli_web/cli/${this._cliId}/run`,
            method: 'POST',
            data: {
                item_id: itemId,
                model_item_id: this._modelItemId,
                job_dir: jobDir,
                girderApiUrl: getApiRoot(),
                girderToken: token
            },
            error: null
        }));

        Promise.all(submissions).then((jobs) => {
            this.$('.modal').modal('hide');
            const n = jobs.length;
            events.trigger('g:alert', {
                icon: 'ok',
                text: `${n} Apply Pixel Classifier job${n === 1 ? '' : 's'} submitted.`,
                type: 'success',
                timeout: 6000
            });
        }).catch((resp) => {
            this.$('.h-pc-apply-submit').prop('disabled', false).text('Apply');
            const msg = ((resp.responseJSON || {}).message) || resp.statusText || 'Unknown error';
            this._showError('Submission failed: ' + msg);
        });
    },

    _showError(msg) {
        this.$('.h-pc-apply-error').text(msg).removeClass('hidden');
    }
});

const showApplyPixelClassifierDialog = function (settings) {
    const view = new ApplyPixelClassifierView({
        modelItemId: settings.modelItemId,
        itemIds: settings.itemIds || [],
        el: $('<div/>').appendTo('body')
    });
    view.render();
    return view;
};

export default showApplyPixelClassifierDialog;
