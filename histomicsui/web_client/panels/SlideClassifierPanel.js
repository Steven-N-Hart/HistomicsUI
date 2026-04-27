import $ from 'jquery';
import Backbone from 'backbone';

import {restRequest} from '@girder/core/rest';
import {AccessType} from '@girder/core/constants';
import events from '@girder/core/events';

import showEditSlideClassifierDialog from '../dialogs/editSlideClassifier';
import showBuildSlideClassifierDialog from '../dialogs/buildSlideClassifier';
import showApplySlideClassifierDialog from '../dialogs/applySlideClassifier';
import slideClassifierPanelTemplate from '../templates/panels/slideClassifierPanel.pug';

const SlideClassifierPanel = Backbone.View.extend({
    events: {
        'click .h-sc-setup-btn': '_onSetup',
        'click .h-sc-edit-btn': '_onEdit',
        'click .h-sc-validate-btn': '_onValidate',
        'change .h-sc-split-radio': '_onSplitChange',
        'change .h-sc-label-cb': '_onLabelChange',
        'click .h-sc-run-btn': '_onRun',
        'click .h-sc-apply-btn': '_onApply'
    },

    initialize(settings) {
        this._folderId = settings.folderId;
        this._accessLevel = settings.accessLevel;
        this._experiment = null;
        this._checkedItemIds = [];
        this._splitCounts = {train: 0, test: 0, val: 0, unassigned: 0};
        this._labelCounts = {};
        this._unlabeledAssigned = 0;
        this._allItems = [];
        this._loading = true;
    },

    render() {
        this._renderTemplate();
        this._loadData();
        return this;
    },

    setCheckedItems(ids) {
        this._checkedItemIds = ids || [];
        if (!this._loading && this._experiment) {
            this._updateApplyButton();
        }
    },

    _updateApplyButton() {
        const count = this._checkedItemIds.length;
        this.$('.h-sc-apply-count').text(count > 0 ? ` (${count} selected)` : '');
    },

    _renderTemplate() {
        const classes = (this._experiment || {}).classes || [];
        const nonImageExt = /\.(yaml|yml|json|csv|txt|log|pkl|py|xml|md|sh|html|js|css|ini|cfg|toml|zip|tar|gz)$/i;
        const imageItems = this._allItems.filter(
            (item) => !nonImageExt.test(item.name) && !item.name.startsWith('.')
        );
        const imageItemIds = new Set(imageItems.map((item) => item._id));
        const items = imageItems.map((item) => ({
            _id: item._id,
            name: item.name,
            split: (item.meta || {})._aiSplit || null,
            labels: (item.meta || {})._slideClassifierLabels || null,
            prediction: (item.meta || {})._slideClassifierPrediction || null
        }));

        this.$el.html(slideClassifierPanelTemplate({
            loading: this._loading,
            experiment: this._experiment,
            splitCounts: this._splitCounts,
            labelCounts: this._labelCounts,
            unlabeledAssigned: this._unlabeledAssigned,
            classes,
            items,
            validation: this._experiment ? this._experiment.validation : null,
            canRun: this._splitCounts.train >= 2
        }));
    },

    _canWrite() {
        return this._accessLevel !== undefined && this._accessLevel >= AccessType.WRITE;
    },

    _loadData() {
        Promise.all([
            restRequest({url: `folder/${this._folderId}`, error: null}),
            restRequest({url: 'item', data: {folderId: this._folderId, limit: 10000}, error: null})
        ]).then(([folder, items]) => {
            this._experiment = ((folder || {}).meta || {})._aiExperiment || null;
            this._allItems = items || [];
            this._computeCounts();
            this._loading = false;
            this._renderTemplate();
        }).catch(() => {
            this._loading = false;
            this._renderTemplate();
        });
    },

    _computeCounts() {
        const splitCounts = {train: 0, test: 0, val: 0, unassigned: 0};
        const classes = (this._experiment || {}).classes || [];
        const labelCounts = {};
        classes.forEach((c) => { labelCounts[c] = 0; });
        let unlabeledAssigned = 0;

        this._allItems.forEach((item) => {
            const split = (item.meta || {})._aiSplit;
            const labelsDict = (item.meta || {})._slideClassifierLabels || null;

            if (split === 'train') { splitCounts.train++; }
            else if (split === 'test') { splitCounts.test++; }
            else if (split === 'val') { splitCounts.val++; }
            else { splitCounts.unassigned++; }

            if (split) {
                if (labelsDict) {
                    classes.forEach((c) => {
                        if (labelsDict[c]) labelCounts[c]++;
                    });
                } else {
                    unlabeledAssigned++;
                }
            }
        });

        this._splitCounts = splitCounts;
        this._labelCounts = labelCounts;
        this._unlabeledAssigned = unlabeledAssigned;
    },

    _updateCountDisplay() {
        const sc = this._splitCounts;
        let splitHtml = `<span class="label label-primary">Train: ${sc.train}</span> ` +
            `<span class="label label-warning">Test: ${sc.test}</span> `;
        if (sc.val > 0) {
            splitHtml += `<span class="label label-success">Val: ${sc.val}</span> `;
        }
        splitHtml += `<span class="label label-default">Unassigned: ${sc.unassigned}</span>`;
        this.$('.h-sc-split-counts').html(splitHtml);

        const classes = (this._experiment || {}).classes || [];
        const labelHtml = classes.map((c) =>
            `<span class="label label-default" style="margin-right:3px">${$('<span>').text(c + ': ' + (this._labelCounts[c] || 0)).html()}</span>`
        ).join('');
        this.$('.h-sc-label-counts').html(labelHtml);

        const canRun = sc.train >= 2;
        this.$('.h-sc-run-btn').prop('disabled', !canRun);
        this.$('.h-sc-run-warning').toggle(!canRun);
    },

    _onSplitChange(e) {
        const $radio = $(e.currentTarget);
        const itemId = $radio.data('item-id');
        const value = $radio.val() || null;
        this._saveItemMeta(itemId, '_aiSplit', value);
    },

    _onLabelChange(e) {
        const $cb = $(e.currentTarget);
        const itemId = $cb.data('item-id');
        const cls = $cb.data('class');
        const checked = $cb.prop('checked');

        const item = this._allItems.find((it) => it._id === itemId);
        const classes = (this._experiment || {}).classes || [];
        const current = Object.assign({}, (item && (item.meta || {})._slideClassifierLabels) || {});

        // Set the toggled class; initialise any unset classes to 0
        current[cls] = checked ? 1 : 0;
        classes.forEach((c) => {
            if (!Object.prototype.hasOwnProperty.call(current, c)) current[c] = 0;
        });

        this._saveItemMeta(itemId, '_slideClassifierLabels', current);
    },

    _saveItemMeta(itemId, key, value) {
        const isNull = value === null || value === undefined || value === '';
        restRequest({
            url: `item/${itemId}/metadata${isNull ? '?allowNull=true' : ''}`,
            method: 'PUT',
            contentType: 'application/json',
            data: JSON.stringify({[key]: isNull ? null : value}),
            error: null
        }).done(() => {
            const item = this._allItems.find((it) => it._id === itemId);
            if (item) {
                item.meta = item.meta || {};
                item.meta[key] = isNull ? null : value;
            }
            this._computeCounts();
            this._updateCountDisplay();
        }).fail(() => {
            events.trigger('g:alert', {
                icon: 'cancel',
                text: 'Failed to save assignment.',
                type: 'danger',
                timeout: 3000
            });
            this._renderTemplate();
        });
    },

    _onSetup() {
        this._openDialog(null);
    },

    _onEdit() {
        this._openDialog(this._experiment);
    },

    _openDialog(experiment) {
        showEditSlideClassifierDialog({
            folderId: this._folderId,
            experiment,
            onSave: (saved) => {
                this._experiment = saved;
                this._computeCounts();
                this._renderTemplate();
            }
        });
    },

    _onValidate() {
        if (!this._experiment) return;
        const assignedItems = this._allItems.filter((it) => (it.meta || {})._aiSplit);
        if (!assignedItems.length) {
            events.trigger('g:alert', {icon: 'info', text: 'No slides assigned to a split yet.', type: 'info', timeout: 3000});
            return;
        }

        const classes = this._experiment.classes || [];
        const missingTrainClasses = classes.filter((c) =>
            !this._allItems.some(
                (it) => (it.meta || {})._aiSplit === 'train' &&
                         ((it.meta || {})._slideClassifierLabels || {})[c]
            )
        );

        const checkedAt = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
        this._experiment = Object.assign({}, this._experiment, {
            validation: {checkedAt, missingTrainClasses}
        });
        this._renderTemplate();

        restRequest({
            url: `folder/${this._folderId}/metadata`,
            method: 'PUT',
            contentType: 'application/json',
            data: JSON.stringify({_aiExperiment: this._experiment}),
            error: null
        });
    },

    _onRun() {
        if (!this._experiment || this._splitCounts.train < 2) return;
        showBuildSlideClassifierDialog({
            folderId: this._folderId,
            experiment: this._experiment,
            splitCounts: this._splitCounts
        });
    },

    _onApply() {
        if (!this._experiment) return;
        showApplySlideClassifierDialog({
            folderId: this._folderId,
            experiment: this._experiment,
            selectedItemIds: this._checkedItemIds.slice()
        });
    }
});

export default SlideClassifierPanel;
