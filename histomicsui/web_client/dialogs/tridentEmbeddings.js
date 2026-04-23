import $ from 'jquery';
import Backbone from 'backbone';

import {restRequest} from '@girder/core/rest';
import {getCurrentUser} from '@girder/core/auth';
import events from '@girder/core/events';

import tridentEmbeddingsTemplate from '../templates/dialogs/tridentEmbeddings.pug';

const DEFAULT_MODEL_DIR = '/Export/Shared/HF_MODELS';
const STAGING_BASE = '/Export/Shared/DSA/TRIDENT';

const ENCODER_RECOMMENDATIONS = {
    conch_v15: {mag: 20, patchSize: 512},
    conch_v1: {mag: 20, patchSize: 512},
    uni_v1: {mag: 20, patchSize: 256},
    uni_v2: {mag: 20, patchSize: 256},
    virchow: {mag: 20, patchSize: 224},
    virchow2: {mag: 20, patchSize: 224},
    phikon: {mag: 20, patchSize: 224},
    phikon_v2: {mag: 20, patchSize: 224},
    gigapath: {mag: 20, patchSize: 256},
    hoptimus0: {mag: 20, patchSize: 224},
    hoptimus1: {mag: 20, patchSize: 224},
    musk: {mag: 20, patchSize: 384},
    midnight12k: {mag: 20, patchSize: 224},
    'kaiko-vitb8': {mag: 20, patchSize: 256},
    'kaiko-vitb16': {mag: 20, patchSize: 256},
    'kaiko-vits8': {mag: 20, patchSize: 256},
    'kaiko-vits16': {mag: 20, patchSize: 256},
    'kaiko-vitl14': {mag: 20, patchSize: 256},
    'lunit-vits8': {mag: 20, patchSize: 224},
    hibou_l: {mag: 20, patchSize: 224},
    ctranspath: {mag: 10, patchSize: 256},
    resnet50: {mag: 20, patchSize: 256}
};

// Fallback lists used when no models are detected in the model base directory.
const ALL_PATCH_ENCODERS = [
    {id: 'conch_v15', label: 'CONCHv1.5'},
    {id: 'conch_v1', label: 'CONCH'},
    {id: 'uni_v1', label: 'UNI'},
    {id: 'uni_v2', label: 'UNI2-h'},
    {id: 'virchow', label: 'Virchow'},
    {id: 'virchow2', label: 'Virchow2'},
    {id: 'phikon', label: 'Phikon'},
    {id: 'phikon_v2', label: 'Phikon-v2'},
    {id: 'gigapath', label: 'Prov-GigaPath'},
    {id: 'hoptimus0', label: 'H-Optimus-0'},
    {id: 'hoptimus1', label: 'H-Optimus-1'},
    {id: 'musk', label: 'MUSK'},
    {id: 'midnight12k', label: 'Midnight-12k'},
    {id: 'kaiko-vitb8', label: 'Kaiko ViT-B/8'},
    {id: 'kaiko-vitb16', label: 'Kaiko ViT-B/16'},
    {id: 'kaiko-vits8', label: 'Kaiko ViT-S/8'},
    {id: 'kaiko-vits16', label: 'Kaiko ViT-S/16'},
    {id: 'kaiko-vitl14', label: 'Kaiko ViT-L/14'},
    {id: 'lunit-vits8', label: 'Lunit ViT-S/8'},
    {id: 'hibou_l', label: 'Hibou-L'},
    {id: 'ctranspath', label: 'CTransPath / CHIEF'},
    {id: 'resnet50', label: 'ResNet-50'}
];

const ALL_SLIDE_ENCODERS = [
    {id: 'threads', label: 'THREADS', needsCheckpoint: true},
    {id: 'titan', label: 'TITAN', needsCheckpoint: true},
    {id: 'prism', label: 'PRISM', needsCheckpoint: true},
    {id: 'chief', label: 'CHIEF', needsCheckpoint: true},
    {id: 'gigapath', label: 'GigaPath (slide)', needsCheckpoint: true},
    {id: 'madeleine', label: 'Madeleine', needsCheckpoint: true},
    {id: 'feather', label: 'Feather', needsCheckpoint: true},
    {id: 'abmil', label: 'ABMIL', needsCheckpoint: true},
    {id: 'mean-conch_v15', label: 'Mean Pool – CONCHv1.5', needsCheckpoint: false},
    {id: 'mean-conch_v1', label: 'Mean Pool – CONCH', needsCheckpoint: false},
    {id: 'mean-uni_v1', label: 'Mean Pool – UNI', needsCheckpoint: false},
    {id: 'mean-uni_v2', label: 'Mean Pool – UNI2', needsCheckpoint: false},
    {id: 'mean-ctranspath', label: 'Mean Pool – CTransPath', needsCheckpoint: false},
    {id: 'mean-phikon', label: 'Mean Pool – Phikon', needsCheckpoint: false},
    {id: 'mean-resnet50', label: 'Mean Pool – ResNet-50', needsCheckpoint: false},
    {id: 'mean-gigapath', label: 'Mean Pool – GigaPath', needsCheckpoint: false}
];

const TridentEmbeddingsView = Backbone.View.extend({
    events: {
        'change #h-trident-patch-encoder': '_updateEncoderRec',
        'change #h-trident-slide-encoder': '_updateSlideEncoderVisibility',
        'change #h-trident-task': '_updateSegmentationVisibility',
        'click #h-trident-scan-models': '_rescanEncoders',
        'input #h-trident-patch-ckpt': '_markPatchCkptManual',
        'input #h-trident-slide-ckpt': '_markSlideCkptManual',
        'click .h-trident-submit': '_submit'
    },

    initialize(settings) {
        this._folderId = settings.folderId;
        this._resourceType = settings.resourceType || 'folder';
        this._wsiDir = '';
        this._cliId = null;
        this._error = null;
        this._modelBaseDir = DEFAULT_MODEL_DIR;
        // Map encoder id → foundPath returned by the scan endpoint.
        this._encoderPaths = {};
        this._slideEncoderPaths = {};
    },

    render() {
        if (this.$('.modal').length) {
            return this;
        }
        this.$el.html(tridentEmbeddingsTemplate({error: this._error}));
        this.$('.modal').modal('show');
        this.$('.modal').on('hidden.bs.modal', () => this.remove());

        this._loadCliInfo();
        return this;
    },

    _loadCliInfo() {
        this.$('#h-trident-model-dir').val(this._modelBaseDir);

        // Path and CLI requests — failure only affects staging display and submit guard.
        const pathReq = restRequest({
            url: `resource/${this._folderId}/path`,
            data: {type: this._resourceType},
            error: null
        });
        const cliReq = restRequest({url: 'slicer_cli_web/cli', error: null});

        const applyStaging = (folderPath) => {
            this._wsiDir = folderPath || '';
            const staging = this._stagingDir(this._wsiDir);
            this.$('#h-trident-wsi-dir').val(`${staging}/wsi`);
            this.$('#h-trident-job-dir').val(staging);
            this.$('#h-trident-staging-display').text(staging);
        };

        pathReq.then((resp) => {
            applyStaging(resp || '');
        }).fail(() => applyStaging(''));

        cliReq.then((cliList) => {
            const cliEntry = (cliList || []).find((c) => c.name === 'TridentEmbeddings');
            if (cliEntry) {
                this._cliId = cliEntry._id;
            }
        });

        // Encoder scan runs independently — a failed path/CLI request cannot affect it.
        restRequest({
            url: 'histomicsui/trident/encoders',
            data: {path: this._modelBaseDir},
            error: null
        }).then((encoders) => {
            this._populateEncoders(encoders);
        }).fail(() => {
            this._populateEncoders({patch_encoders: [], slide_encoders: [], path: this._modelBaseDir});
        });
    },

    _stagingDir(virtualPath) {
        // /Export/Shared/DSA/TRIDENT/{username}/{project_name}
        const parts = (virtualPath || '').split('/').filter(Boolean);
        const projectName = (parts[1] || 'project').replace(/[\s/\\]+/g, '_');
        const user = getCurrentUser();
        const username = (user && user.get('login')) || 'user';
        return `${STAGING_BASE}/${username}/${projectName}`;
    },

    _populateEncoders(encoders) {
        const patchList = (encoders || {}).patch_encoders || [];
        const slideList = (encoders || {}).slide_encoders || [];
        const scanPath = (encoders || {}).path || this._modelBaseDir;

        const $patchSelect = this.$('#h-trident-patch-encoder');
        const $slideSelect = this.$('#h-trident-slide-encoder');
        const $warning = this.$('.h-trident-encoder-warning');

        // Build path lookup maps for checkpoint auto-fill.
        this._encoderPaths = {};
        patchList.forEach(({id, foundPath}) => {
            if (foundPath) {
                this._encoderPaths[id] = foundPath;
            }
        });
        this._slideEncoderPaths = {};
        slideList.forEach(({id, foundPath}) => {
            if (foundPath) {
                this._slideEncoderPaths[id] = foundPath;
            }
        });

        $patchSelect.empty();
        if (patchList.length > 0) {
            $warning.hide();
            patchList.forEach(({id, label}) => {
                $patchSelect.append($('<option>', {value: id}).text(label));
            });
        } else {
            $warning.text(
                `No model checkpoints detected in ${scanPath}. ` +
                'Update the Model Base Directory and click Scan.'
            ).show();
        }

        // Keep the hardcoded "none" option, append discovered slide encoders.
        $slideSelect.find('option[value!="none"]').remove();
        const slideSource = slideList.length > 0 ? slideList : ALL_SLIDE_ENCODERS;
        slideSource.forEach(({id, label}) => {
            $slideSelect.append($('<option>', {value: id}).text(label));
        });

        this._updateEncoderRec();
        this._updateSlideEncoderVisibility();
        this._updateSegmentationVisibility();
    },

    _rescanEncoders() {
        const dir = this.$('#h-trident-model-dir').val().trim();
        if (!dir) {
            return;
        }
        this._modelBaseDir = dir;
        this.$('#h-trident-scan-models').prop('disabled', true).text('Scanning…');

        restRequest({
            url: 'histomicsui/trident/encoders',
            data: {path: dir},
            error: null
        }).then((encoders) => {
            this._populateEncoders(encoders);
        }).fail(() => {
            this._populateEncoders({patch_encoders: [], slide_encoders: [], path: dir});
        }).always(() => {
            this.$('#h-trident-scan-models').prop('disabled', false).text('Scan');
        });
    },

    _updateEncoderRec() {
        const encoder = this.$('#h-trident-patch-encoder').val();
        const rec = ENCODER_RECOMMENDATIONS[encoder];
        if (rec) {
            this.$('.h-trident-rec-settings').text(
                `Recommended: ${rec.mag}× magnification, ${rec.patchSize}px patch size`
            );
            this.$('#h-trident-mag').val(String(rec.mag));
            this.$('#h-trident-patch-size').val(String(rec.patchSize));
        } else {
            this.$('.h-trident-rec-settings').text('');
        }
        // Auto-fill checkpoint with the exact found path (or best-guess fallback).
        const $ckpt = this.$('#h-trident-patch-ckpt');
        if (encoder) {
            const found = this._encoderPaths[encoder];
            $ckpt.val(found || '').removeData('manual');
        }
    },

    _updateSlideEncoderVisibility() {
        const slideEncoder = this.$('#h-trident-slide-encoder').val();
        if (slideEncoder && slideEncoder !== 'none') {
            this.$('.h-trident-slide-ckpt-row').show();
            const enc = ALL_SLIDE_ENCODERS.find((e) => e.id === slideEncoder);
            const $ckpt = this.$('#h-trident-slide-ckpt');
            if (enc && !enc.needsCheckpoint) {
                $ckpt.val('').removeData('manual');
            } else if (!$ckpt.data('manual')) {
                const found = this._slideEncoderPaths[slideEncoder];
                $ckpt.val(found || '');
            }
        } else {
            this.$('.h-trident-slide-ckpt-row').hide();
        }
    },

    _updateSegmentationVisibility() {
        const task = this.$('#h-trident-task').val();
        if (task === 'seg' || task === 'all') {
            this.$('.h-trident-seg-section').show();
        } else {
            this.$('.h-trident-seg-section').hide();
        }
    },

    _markPatchCkptManual() {
        this.$('#h-trident-patch-ckpt').data('manual', true);
    },

    _markSlideCkptManual() {
        this.$('#h-trident-slide-ckpt').data('manual', true);
    },

    _collectParams() {
        const params = {};
        this.$('.h-trident-form').find('[name]').each(function () {
            const $el = $(this);
            const name = $el.attr('name');
            if ($el.is(':checkbox')) {
                params[name] = $el.is(':checked') ? 'true' : 'false';
            } else {
                const val = $el.val();
                if (val !== '' && val !== null && val !== undefined) {
                    params[name] = val;
                }
            }
        });
        return params;
    },

    _submit() {
        if (!this._cliId) {
            this._showError('TridentEmbeddings CLI is not registered in this DSA instance.');
            return;
        }
        if (!this._folderId) {
            this._showError('No folder selected.');
            return;
        }

        this.$('.h-trident-submit').prop('disabled', true).text('Staging files…');
        this.$('.alert-danger').remove();

        restRequest({
            url: 'histomicsui/trident/stage',
            data: {resourceId: this._folderId, resourceType: this._resourceType},
            error: null
        }).then((staging) => {
            this.$('.h-trident-submit').text('Submitting…');

            const params = this._collectParams();
            params.wsi_dir = staging.wsi_dir;
            params.job_dir = staging.job_dir;

            if (staging.skipped && staging.skipped.length) {
                console.warn('TRIDENT staging: skipped items', staging.skipped);
            }

            return restRequest({
                url: `slicer_cli_web/cli/${this._cliId}/run`,
                method: 'POST',
                data: params,
                error: null
            });
        }).done((job) => {
            this.$('.modal').modal('hide');
            const jobId = (job || {})._id;
            events.trigger('g:alert', {
                icon: 'ok',
                text: 'TRIDENT job submitted.',
                type: 'success',
                timeout: 6000
            });
            if (jobId) {
                $('<div class="alert alert-info h-trident-job-link" style="position:fixed;bottom:60px;right:20px;z-index:9999;padding:10px 16px;">' +
                    '<a href="#jobs/' + jobId + '">View TRIDENT job →</a>' +
                    '</div>').appendTo('body').delay(6000).fadeOut(400, function () {
                    $(this).remove();
                });
            }
        }).fail((resp) => {
            this.$('.h-trident-submit').prop('disabled', false).text('Generate Embeddings');
            const msg = ((resp.responseJSON || {}).message) || resp.statusText || 'Unknown error';
            this._showError('Failed: ' + msg);
        });
    },

    _showError(msg) {
        this.$('.alert-danger').remove();
        this.$('.modal-body').prepend(
            $('<div class="alert alert-danger"></div>').text(msg)
        );
    }
});

var showTridentEmbeddingsDialog = function (settings) {
    const view = new TridentEmbeddingsView({
        folderId: settings.folderId,
        resourceType: settings.resourceType,
        el: $('<div/>').appendTo('body')
    });
    view.render();
    return view;
};

export default showTridentEmbeddingsDialog;
