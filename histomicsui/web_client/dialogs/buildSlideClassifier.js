import $ from 'jquery';
import Backbone from 'backbone';

import {restRequest, getApiRoot} from '@girder/core/rest';
import {getCurrentUser, getCurrentToken} from '@girder/core/auth';
import events from '@girder/core/events';

import buildSlideClassifierTemplate from '../templates/dialogs/buildSlideClassifier.pug';

const STAGING_BASE = '/Export/Shared/DSA/AI_EXPERIMENTS';

const BuildSlideClassifierView = Backbone.View.extend({
    events: {
        'change #h-sc-feature-kind': '_onFeatureKindChange',
        'click .h-sc-submit': '_submit'
    },

    initialize(settings) {
        this._folderId = settings.folderId;
        this._experiment = settings.experiment || null;
        this._splitCounts = settings.splitCounts || null;
        this._cliId = null;
        this._defaultJobDir = '';
    },

    render() {
        this.$el.html(buildSlideClassifierTemplate({
            experiment: this._experiment,
            splitCounts: this._splitCounts,
            jobDir: ''
        }));
        this.$('.modal').modal('show');
        this.$('.modal').on('hidden.bs.modal', () => this.remove());

        this._loadCliInfo();
        this._loadDefaultJobDir();
        return this;
    },

    _onFeatureKindChange() {
        const kind = this.$('#h-sc-feature-kind').val();
        this.$('.h-sc-slide-encoder-group').toggle(kind === 'slide');
    },

    _loadCliInfo() {
        restRequest({url: 'slicer_cli_web/cli', error: null}).then((cliList) => {
            const entry = (cliList || []).find((c) => c.name === 'BuildSlideClassifier');
            if (entry) {
                this._cliId = entry._id;
            } else {
                this._showError(
                    'BuildSlideClassifier CLI is not registered in this DSA instance. ' +
                    'Rebuild the histomicstk worker image to pick up the new task.'
                );
            }
        });
    },

    _loadDefaultJobDir() {
        const user = getCurrentUser();
        const username = (user && user.get('login')) || 'user';
        const expName = ((this._experiment || {}).name || 'experiment')
            .replace(/[\s/\\]+/g, '_');
        this._defaultJobDir = `${STAGING_BASE}/${username}/${expName}`;
        this.$('#h-sc-job-dir').val(this._defaultJobDir);
    },

    _collectParams() {
        return {
            folder_id: this._folderId,
            feature_kind: this.$('#h-sc-feature-kind').val(),
            slide_encoder: this.$('#h-sc-slide-encoder').val() || '',
            model_type: this.$('#h-sc-model-type').val(),
            task_type: this.$('#h-sc-task-type').val(),
            regularization: this.$('#h-sc-c').val() || '1.0',
            max_iter: this.$('#h-sc-max-iter').val() || '1000',
            job_dir: this.$('#h-sc-job-dir').val().trim()
        };
    },

    _submit() {
        if (!this._cliId) {
            this._showError('BuildSlideClassifier CLI is not registered.');
            return;
        }
        const params = this._collectParams();
        if (!params.job_dir) {
            this._showError('Output directory is required.');
            return;
        }
        if (params.feature_kind === 'slide' && !params.slide_encoder) {
            this._showError('Slide Encoder Name is required when Feature Source is "slide".');
            return;
        }

        this.$('.h-sc-submit').prop('disabled', true).text('Submitting…');
        this.$('.h-sc-error').addClass('hidden');

        const rawToken = getCurrentToken();
        params.girderApiUrl = getApiRoot();
        params.girderToken = (rawToken && typeof rawToken === 'object')
            ? (rawToken.token || '') : (rawToken || '');

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
                text: 'Slide Classifier training job submitted.',
                type: 'success',
                timeout: 6000
            });
            if (jobId) {
                $('<div class="alert alert-info h-sc-job-link" style="position:fixed;bottom:60px;right:20px;z-index:9999;padding:10px 16px;">' +
                    '<a href="#job/' + jobId + '">View training job →</a>' +
                    '</div>').appendTo('body').delay(8000).fadeOut(400, function () {
                    $(this).remove();
                });
            }
        }).fail((resp) => {
            this.$('.h-sc-submit').prop('disabled', false).text('Run');
            const msg = ((resp.responseJSON || {}).message) || resp.statusText || 'Unknown error';
            this._showError('Submission failed: ' + msg);
        });
    },

    _showError(msg) {
        this.$('.h-sc-error').text(msg).removeClass('hidden');
    }
});

const showBuildSlideClassifierDialog = function (settings) {
    const view = new BuildSlideClassifierView({
        folderId: settings.folderId,
        experiment: settings.experiment || null,
        splitCounts: settings.splitCounts || null,
        el: $('<div/>').appendTo('body')
    });
    view.render();
    return view;
};

export default showBuildSlideClassifierDialog;
