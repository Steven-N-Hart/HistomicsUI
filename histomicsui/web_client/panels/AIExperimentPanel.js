import $ from 'jquery';
import Backbone from 'backbone';

import {restRequest} from '@girder/core/rest';
import {AccessType} from '@girder/core/constants';
import events from '@girder/core/events';

import showEditAIExperimentDialog from '../dialogs/editAIExperiment';
import aiExperimentPanelTemplate from '../templates/panels/aiExperimentPanel.pug';

const VALIDATE_CHUNK = 20;

const AIExperimentPanel = Backbone.View.extend({
    events: {
        'click .h-ai-setup-btn': '_onSetup',
        'click .h-ai-edit-btn': '_onEdit',
        'click .h-ai-validate-btn': '_onValidate',
        'click .h-ai-assign-btn': '_onAssign',
        'click .h-ai-show-missing': '_onShowMissing'
    },

    initialize(settings) {
        this._folderId = settings.folderId;
        this._accessLevel = settings.accessLevel;
        this._experiment = null;
        this._splitCounts = {train: 0, test: 0, val: 0, unassigned: 0};
        this._allItems = [];
        this._checkedItemIds = [];
        this._validating = false;
        this._loading = true;
    },

    render() {
        this._renderTemplate();
        this._loadData();
        return this;
    },

    setCheckedItems(ids) {
        this._checkedItemIds = ids || [];
        console.log('[AIExperiment] setCheckedItems:', ids, 'canWrite:', this._canWrite(), 'accessLevel:', this._accessLevel);
        this._renderTemplate();
    },

    _renderTemplate() {
        this.$el.html(aiExperimentPanelTemplate({
            loading: this._loading,
            experiment: this._experiment,
            splitCounts: this._splitCounts,
            selectedCount: this._canWrite() ? this._checkedItemIds.length : 0,
            validation: this._experiment ? this._experiment.validation : null,
            validating: this._validating
        }));
    },

    _canWrite() {
        return this._accessLevel !== undefined && this._accessLevel >= AccessType.WRITE;
    },

    _loadData() {
        const folderReq = restRequest({url: `folder/${this._folderId}`, error: null});
        const itemsReq = restRequest({
            url: 'item',
            data: {folderId: this._folderId, limit: 10000},
            error: null
        });

        Promise.all([folderReq, itemsReq]).then(([folder, items]) => {
            this._experiment = ((folder || {}).meta || {})._aiExperiment || null;
            this._allItems = items || [];
            this._computeSplitCounts();
            this._loading = false;
            this._renderTemplate();
        }).catch(() => {
            this._loading = false;
            this._renderTemplate();
        });
    },

    _computeSplitCounts() {
        const counts = {train: 0, test: 0, val: 0, unassigned: 0};
        this._allItems.forEach((item) => {
            const split = (item.meta || {})._aiSplit;
            if (split === 'train') { counts.train++; }
            else if (split === 'test') { counts.test++; }
            else if (split === 'val') { counts.val++; }
            else { counts.unassigned++; }
        });
        this._splitCounts = counts;
    },

    _onSetup() {
        this._openDialog(null);
    },

    _onEdit() {
        this._openDialog(this._experiment);
    },

    _openDialog(experiment) {
        showEditAIExperimentDialog({
            folderId: this._folderId,
            experiment,
            onSave: (saved) => {
                this._experiment = saved;
                this._renderTemplate();
            }
        });
    },

    _onAssign(e) {
        const split = $(e.currentTarget).data('split') || null;
        const ids = this._checkedItemIds.slice();
        if (!ids.length) return;

        const isUnassign = !split;
        const requests = ids.map((id) =>
            restRequest({
                url: `item/${id}/metadata${isUnassign ? '?allowNull=true' : ''}`,
                method: 'PUT',
                contentType: 'application/json',
                data: JSON.stringify({_aiSplit: split}),
                error: null
            })
        );

        Promise.all(requests).then(() => {
            ids.forEach((id) => {
                const item = this._allItems.find((it) => it._id === id);
                if (item) {
                    item.meta = item.meta || {};
                    item.meta._aiSplit = split;
                }
            });
            this._computeSplitCounts();
            this._checkedItemIds = [];
            this._renderTemplate();
        }).catch(() => {
            events.trigger('g:alert', {
                icon: 'cancel',
                text: 'Failed to assign splits.',
                type: 'danger',
                timeout: 4000
            });
        });
    },

    _onValidate() {
        if (!this._experiment) return;

        const assignedItems = this._allItems.filter((it) => (it.meta || {})._aiSplit);
        if (!assignedItems.length) {
            events.trigger('g:alert', {
                icon: 'info',
                text: 'No items have been assigned to a split yet.',
                type: 'info',
                timeout: 3000
            });
            return;
        }

        this._validating = true;
        this._renderTemplate();

        const targets = this._experiment.targets || [];
        const roiAnnotation = this._experiment.scope === 'roi' ? this._experiment.roiAnnotation : null;
        const missingTargets = {};
        targets.forEach((t) => { missingTargets[t] = []; });
        const missingRoi = [];

        const checkItem = (item) =>
            restRequest({
                url: 'annotation',
                data: {itemId: item._id},
                error: null
            }).then((annotations) => {
                const names = new Set((annotations || []).map((a) => (a.annotation || {}).name));
                targets.forEach((t) => {
                    if (!names.has(t)) missingTargets[t].push(item._id);
                });
                if (roiAnnotation && !names.has(roiAnnotation)) {
                    missingRoi.push(item._id);
                }
            }).catch(() => {});

        const runChunked = (items) => {
            const chunks = [];
            for (let i = 0; i < items.length; i += VALIDATE_CHUNK) {
                chunks.push(items.slice(i, i + VALIDATE_CHUNK));
            }
            return chunks.reduce(
                (p, chunk) => p.then(() => Promise.all(chunk.map(checkItem))),
                Promise.resolve()
            );
        };

        runChunked(assignedItems).then(() => {
            const now = new Date();
            const checkedAt = now.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
            this._experiment = Object.assign({}, this._experiment, {
                validation: {checkedAt, missingTargets, missingRoi}
            });
            this._validating = false;
            this._renderTemplate();
            return restRequest({
                url: `folder/${this._folderId}/metadata`,
                method: 'PUT',
                contentType: 'application/json',
                data: JSON.stringify({_aiExperiment: this._experiment}),
                error: null
            });
        }).catch(() => {
            this._validating = false;
            events.trigger('g:alert', {
                icon: 'cancel',
                text: 'Validation failed.',
                type: 'danger',
                timeout: 4000
            });
            this._renderTemplate();
        });
    },

    _onShowMissing(e) {
        e.preventDefault();
        const key = $(e.currentTarget).data('key');
        const validation = (this._experiment || {}).validation || {};
        const ids = key === '__roi__'
            ? (validation.missingRoi || [])
            : ((validation.missingTargets || {})[key] || []);

        const names = ids.map((id) => {
            const item = this._allItems.find((it) => it._id === id);
            return item ? item.name : id;
        });

        events.trigger('g:alert', {
            icon: 'attention',
            text: `Missing "${key === '__roi__' ? this._experiment.roiAnnotation : key}": ${names.join(', ')}`,
            type: 'warning',
            timeout: 10000
        });
    }
});

export default AIExperimentPanel;
