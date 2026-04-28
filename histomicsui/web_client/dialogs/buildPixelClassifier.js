import $ from 'jquery';
import Backbone from 'backbone';

import {restRequest, getApiRoot} from '@girder/core/rest';
import {getCurrentUser, getCurrentToken} from '@girder/core/auth';
import events from '@girder/core/events';

import buildPixelClassifierTemplate from '../templates/dialogs/buildPixelClassifier.pug';

const STAGING_BASE = '/Export/Shared/DSA/pixel_classifier';

const BuildPixelClassifierView = Backbone.View.extend({
    events: {
        'click .h-pc-build-submit': '_submit'
    },

    initialize(settings) {
        this._itemId = settings.itemId;
        this._session = settings.session || null;
        this._onSubmit = settings.onSubmit || function () {};
        this._cliId = null;
    },

    render() {
        const iterations = (this._session && this._session.iterations) || [];
        const iteration = iterations.length + 1;
        const lastIt = iterations[iterations.length - 1] || null;
        const patchCounts = lastIt ? null : null;

        const user = getCurrentUser();
        const username = (user && user.get('login')) || 'user';
        const sessionSlug = ((this._session && this._session.name) || 'session')
            .replace(/[\s/\\]+/g, '_');
        const jobDir = `${STAGING_BASE}/${username}/${sessionSlug}`;

        this.$el.html(buildPixelClassifierTemplate({
            session: this._session,
            iteration,
            patchCounts,
            jobDir
        }));
        this.$('.modal').modal('show');
        this.$('.modal').on('hidden.bs.modal', () => this.remove());
        this._loadCliInfo();
        return this;
    },

    _loadCliInfo() {
        restRequest({url: 'slicer_cli_web/cli', error: null}).then((cliList) => {
            const entry = (cliList || []).find((c) => c.name === 'BuildPixelClassifier');
            if (entry) {
                this._cliId = entry._id;
            } else {
                this._showError(
                    'BuildPixelClassifier CLI is not registered in this DSA instance. '
                    + 'Rebuild the histomicstk worker image to pick up the new task.'
                );
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

        if (!session.training_annotation_id) {
            this._showError('No training annotation found. Set up the session first and paint annotations.');
            return;
        }

        this.$('.h-pc-build-submit').prop('disabled', true).text('Submitting…');
        this.$('.h-pc-build-error').addClass('hidden');

        const rawToken = getCurrentToken();
        const token = (rawToken && typeof rawToken === 'object')
            ? (rawToken.token || '') : (rawToken || '');

        const params = {
            item_id: this._itemId,
            annotation_id: session.training_annotation_id,
            classes_json: JSON.stringify(session.classes || []),
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

            // Stamp skeleton iteration entry into session metadata
            const updatedIterations = iterations.concat([{
                num: iteration,
                job_id: jobId || null
            }]);
            restRequest({
                url: `item/${this._itemId}/metadata`,
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
                $('<div class="alert alert-info h-pc-job-link" style="position:fixed;bottom:60px;right:20px;z-index:9999;padding:10px 16px;">'
                    + `<a href="#job/${jobId}">View training job →</a>`
                    + '</div>').appendTo('body').delay(8000).fadeOut(400, function () {
                    $(this).remove();
                });
            }

            this._onSubmit({jobId, iteration, session});
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
        itemId: settings.itemId,
        session: settings.session || null,
        onSubmit: settings.onSubmit || function () {},
        el: $('<div/>').appendTo('body')
    });
    view.render();
    return view;
};

export default showBuildPixelClassifierDialog;
