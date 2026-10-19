import $ from 'jquery';
import Backbone from 'backbone';

import {restRequest, getApiRoot} from '@girder/core/rest';
import {getCurrentToken, getCurrentUser} from '@girder/core/auth';
import events from '@girder/core/events';

import buildPixelClassifierTemplate from '../templates/dialogs/buildPixelClassifier.pug';

const BuildPixelClassifierView = Backbone.View.extend({
    events: {
        'click .h-pc-build-submit': '_submit'
    },

    initialize(settings) {
        this._folderId = settings.folderId;
        this._session = settings.session || null;
        this._splitCounts = settings.splitCounts || null;
        this._cliId = null;
    },

    render() {
        const iterations = (this._session && this._session.iterations) || [];
        const session = this._session || {};

        this.$el.html(buildPixelClassifierTemplate({
            session,
            splitCounts: this._splitCounts,
            iteration: iterations.length + 1,
            jobDir: ''
        }));
        this.$('.modal').modal('show');
        this.$('.modal').on('hidden.bs.modal', () => this.remove());
        this._loadCliInfo();
        this._loadDefaultJobDir();
        return this;
    },

    _loadDefaultJobDir() {
        const session = this._session || {};
        const sessionSlug = (session.name || 'session').replace(/[\s/\\]+/g, '_');
        const user = getCurrentUser();
        const username = (user && user.get('login')) || 'user';

        restRequest({url: `folder/${this._folderId}`, error: null}).then((folder) => {
            const folderName = (folder && folder.name) ? folder.name.replace(/[\s/\\]+/g, '_') : 'folder';
            const jobDir = `/Export/Shared/DSA/AI_EXPERIMENTS/${username}/${folderName}/pixel_classifier/${sessionSlug}`;
            this.$('#h-pc-job-dir').val(jobDir);
        });
    },

    _loadCliInfo() {
        restRequest({url: 'slicer_cli_web/cli', error: null}).then((cliList) => {
            const entry = (cliList || []).find((c) => c.name === 'BuildPixelClassifier');
            if (entry) {
                this._cliId = entry._id;
            } else {
                this._showError('BuildPixelClassifier CLI is not registered. Rebuild the histomicstk image.');
            }
        });
    },

    _submit() {
        if (!this._cliId) {
            this._showError('BuildPixelClassifier CLI is not registered.');
            return;
        }
        const session = this._session || {};
        const iterations = session.iterations || [];
        const iteration = iterations.length + 1;
        const jobDir = this.$('#h-pc-job-dir').val().trim();

        if (!jobDir) {
            this._showError('Output directory is required.');
            return;
        }

        this.$('.h-pc-build-submit').prop('disabled', true).text('Submitting…');
        this.$('.h-pc-build-error').addClass('hidden');

        const rawToken = getCurrentToken();
        const token = (rawToken && typeof rawToken === 'object')
            ? (rawToken.token || '') : (rawToken || '');

        const params = {
            folder_id: this._folderId,
            positive_annotation_name: session.positive_annotation_name || '',
            roi_annotation_name: session.roi_annotation_name || '',
            session_name: session.name || 'PixelClassifier',
            iteration,
            model_type: session.model_type || 'trident_linear',
            magnification: session.magnification || 20,
            patch_size: session.patch_size || 512,
            job_dir: jobDir,
            output_folder_id: '',
            girderApiUrl: getApiRoot(),
            girderToken: token
        };

        restRequest({
            url: `slicer_cli_web/cli/${this._cliId}/run`,
            method: 'POST',
            data: params,
            error: null
        }).done((job) => {
            const jobId = (job || {})._id;

            // Stamp skeleton iteration into folder session metadata
            const updatedIterations = iterations.concat([{num: iteration, job_id: jobId || null}]);
            restRequest({
                url: `folder/${this._folderId}/metadata`,
                method: 'PUT',
                contentType: 'application/json',
                data: JSON.stringify({
                    _pixelClassifierSession: Object.assign({}, session, {
                        iterations: updatedIterations,
                        updated_at: new Date().toISOString()
                    })
                }),
                error: null
            });

            this.$('.modal').modal('hide');
            events.trigger('g:alert', {
                icon: 'ok',
                text: `Pixel Classifier training job submitted (Iteration ${iteration}).`,
                type: 'success',
                timeout: 6000
            });

            if (jobId) {
                $(`<div class="alert alert-info" style="position:fixed;bottom:60px;right:20px;z-index:9999;padding:10px 16px;">
                    <a href="#job/${jobId}">View training job →</a>
                   </div>`).appendTo('body').delay(8000).fadeOut(400, function () {
                    $(this).remove();
                });
            }
        }).fail((resp) => {
            this.$('.h-pc-build-submit').prop('disabled', false).text('Train');
            const msg = ((resp.responseJSON || {}).message) || resp.statusText || 'Unknown error';
            this._showError('Submission failed: ' + msg);
        });
    },

    _showError(msg) {
        this.$('.h-pc-build-error').text(msg).removeClass('hidden');
    }
});

const showBuildPixelClassifierDialog = function (settings) {
    const view = new BuildPixelClassifierView({
        folderId: settings.folderId,
        session: settings.session || null,
        splitCounts: settings.splitCounts || null,
        el: $('<div/>').appendTo('body')
    });
    view.render();
    return view;
};

export default showBuildPixelClassifierDialog;
