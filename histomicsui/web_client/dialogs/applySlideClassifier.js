import $ from 'jquery';
import Backbone from 'backbone';

import {restRequest, getApiRoot} from '@girder/core/rest';
import {getCurrentUser, getCurrentToken} from '@girder/core/auth';
import events from '@girder/core/events';

import applySlideClassifierTemplate from '../templates/dialogs/applySlideClassifier.pug';

const STAGING_BASE = '/Export/Shared/DSA/AI_EXPERIMENTS';

const ApplySlideClassifierView = Backbone.View.extend({
    events: {
        'click .h-sc-apply-submit': '_submit'
    },

    initialize(settings) {
        this._folderId = settings.folderId;
        this._experiment = settings.experiment || null;
        this._selectedItemIds = settings.selectedItemIds || [];
        this._cliId = null;
    },

    render() {
        const user = getCurrentUser();
        const username = (user && user.get('login')) || 'user';
        const expName = ((this._experiment || {}).name || 'experiment')
            .replace(/[\s/\\]+/g, '_');
        const defaultModelPath = `${STAGING_BASE}/${username}/${expName}/model.pkl`;

        this.$el.html(applySlideClassifierTemplate({
            experiment: this._experiment,
            defaultModelPath,
            defaultJobDir: `${STAGING_BASE}/${username}/${expName}`,
            selectedCount: this._selectedItemIds.length
        }));
        this.$('.modal').modal('show');
        this.$('.modal').on('hidden.bs.modal', () => this.remove());

        this._loadCliInfo();
        return this;
    },

    _loadCliInfo() {
        restRequest({url: 'slicer_cli_web/cli', error: null}).then((cliList) => {
            const entry = (cliList || []).find((c) => c.name === 'ApplySlideClassifier');
            if (entry) {
                this._cliId = entry._id;
            } else {
                this._showError(
                    'ApplySlideClassifier CLI is not registered in this DSA instance.'
                );
            }
        });
    },

    _submit() {
        if (!this._cliId) {
            this._showError('ApplySlideClassifier CLI is not registered.');
            return;
        }

        const modelPath = this.$('#h-sc-model-path').val().trim();
        const jobDir = this.$('#h-sc-apply-job-dir').val().trim();
        const targetFolderId = this._folderId;

        if (!modelPath) {
            this._showError('Model path is required.');
            return;
        }

        this.$('.h-sc-apply-submit').prop('disabled', true).text('Submitting…');
        this.$('.h-sc-apply-error').addClass('hidden');

        const rawToken = getCurrentToken();
        const params = {
            folder_id: targetFolderId,
            model_path: modelPath,
            job_dir: jobDir,
            item_ids: this._selectedItemIds.length ? this._selectedItemIds.join(',') : '',
            girderApiUrl: getApiRoot(),
            girderToken: (rawToken && typeof rawToken === 'object')
                ? (rawToken.token || '') : (rawToken || '')
        };

        restRequest({
            url: `slicer_cli_web/cli/${this._cliId}/run`,
            method: 'POST',
            data: params,
            error: null
        }).done((job) => {
            this.$('.modal').modal('hide');
            const jobId = (job || {})._id;
            events.trigger('g:alert', {
                icon: 'ok',
                text: 'Slide Classifier apply job submitted.',
                type: 'success',
                timeout: 6000
            });
            if (jobId) {
                $('<div class="alert alert-info h-sc-apply-job-link" style="position:fixed;bottom:60px;right:20px;z-index:9999;padding:10px 16px;">' +
                    '<a href="#job/' + jobId + '">View apply job →</a>' +
                    '</div>').appendTo('body').delay(8000).fadeOut(400, function () {
                    $(this).remove();
                });
            }
        }).fail((resp) => {
            this.$('.h-sc-apply-submit').prop('disabled', false).text('Apply');
            const msg = ((resp.responseJSON || {}).message) || resp.statusText || 'Unknown error';
            this._showError('Submission failed: ' + msg);
        });
    },

    _showError(msg) {
        this.$('.h-sc-apply-error').text(msg).removeClass('hidden');
    }
});

const showApplySlideClassifierDialog = function (settings) {
    const view = new ApplySlideClassifierView({
        folderId: settings.folderId,
        experiment: settings.experiment || null,
        selectedItemIds: settings.selectedItemIds || [],
        el: $('<div/>').appendTo('body')
    });
    view.render();
    return view;
};

export default showApplySlideClassifierDialog;
