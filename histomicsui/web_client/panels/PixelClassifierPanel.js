import $ from 'jquery';
import Backbone from 'backbone';

import {restRequest} from '@girder/core/rest';
import {AccessType} from '@girder/core/constants';
import events from '@girder/core/events';

import showEditPixelClassifierDialog from '../dialogs/editPixelClassifier';
import showBuildPixelClassifierDialog from '../dialogs/buildPixelClassifier';
import showApplyPixelClassifierDialog from '../dialogs/applyPixelClassifier';
import pixelClassifierPanelTemplate from '../templates/panels/pixelClassifierPanel.pug';
import '../stylesheets/panels/pixelClassifierPanel.styl';

const PixelClassifierPanel = Backbone.View.extend({
    events: {
        'click .h-pc-setup-btn': '_onSetup',
        'click .h-pc-edit-btn': '_onEdit',
        'click .h-pc-train-btn': '_onTrain',
        'click .h-pc-apply-btn': '_onApply',
        'change .h-pc-split-radio': '_onSplitChange'
    },

    initialize(settings) {
        this._folderId = settings.folderId;
        this._accessLevel = settings.accessLevel;
        this._session = null;
        this._checkedItemIds = [];
        this._splitCounts = {train: 0, test: 0, val: 0, unassigned: 0};
        this._allItems = [];
        this._loading = true;
    },

    render() {
        this.$el.hide();
        this._loadData();
        return this;
    },

    setCheckedItems(ids) {
        this._checkedItemIds = ids || [];
        const count = this._checkedItemIds.length;
        this.$('.h-pc-apply-count').text(count > 0 ? ` (${count})` : '');
    },

    _renderTemplate() {
        const nonImageExt = /\.(yaml|yml|json|csv|txt|log|pkl|py|xml|md|sh|html|js|css|ini|cfg|toml|zip|tar|gz)$/i;
        const items = this._allItems
            .filter((item) => !nonImageExt.test(item.name) && !item.name.startsWith('.'))
            .map((item) => ({
                _id: item._id,
                name: item.name,
                split: (item.meta || {})._pixelClassifierSplit || null
            }));

        const iterations = (this._session && this._session.iterations) || [];
        const lastIt = iterations.length ? iterations[iterations.length - 1] : null;

        this.$el.html(pixelClassifierPanelTemplate({
            loading: this._loading,
            session: this._session,
            splitCounts: this._splitCounts,
            items,
            lastIt,
            canTrain: this._splitCounts.train >= 1,
            checkedCount: this._checkedItemIds.length
        }));
    },

    _loadData() {
        const nonImageExt = /\.(yaml|yml|json|csv|txt|log|pkl|py|xml|md|sh|html|js|css|ini|cfg|toml|zip|tar|gz)$/i;
        Promise.all([
            restRequest({url: `folder/${this._folderId}`, error: null}),
            restRequest({url: 'item', data: {folderId: this._folderId, limit: 10000}, error: null})
        ]).then(([folder, items]) => {
            this._session = ((folder || {}).meta || {})._pixelClassifierSession || null;
            this._allItems = items || [];
            const hasSlides = this._allItems.some(
                (item) => !nonImageExt.test(item.name) && !item.name.startsWith('.')
            );
            this.$el.toggle(hasSlides);
            this._computeCounts();
            this._loading = false;
            if (hasSlides) {
                this._renderTemplate();
            }
        }).catch(() => {
            this.$el.hide();
            this._loading = false;
        });
    },

    _computeCounts() {
        const counts = {train: 0, test: 0, val: 0, unassigned: 0};
        this._allItems.forEach((item) => {
            const split = (item.meta || {})._pixelClassifierSplit;
            if (split === 'train') { counts.train++; }
            else if (split === 'test') { counts.test++; }
            else if (split === 'val') { counts.val++; }
            else { counts.unassigned++; }
        });
        this._splitCounts = counts;
    },

    _onSplitChange(e) {
        const $radio = $(e.currentTarget);
        const itemId = $radio.data('item-id');
        const value = $radio.val() || null;
        this._saveItemMeta(itemId, '_pixelClassifierSplit', value);
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
                text: 'Failed to save split assignment.',
                type: 'danger',
                timeout: 3000
            });
            this._renderTemplate();
        });
    },

    _updateCountDisplay() {
        const sc = this._splitCounts;
        this.$('.h-pc-split-counts').html(
            `<span class="label label-primary">Train: ${sc.train}</span> ` +
            `<span class="label label-warning">Test: ${sc.test}</span> ` +
            (sc.val > 0 ? `<span class="label label-success">Val: ${sc.val}</span> ` : '') +
            `<span class="label label-default">Unassigned: ${sc.unassigned}</span>`
        );
        const canTrain = sc.train >= 1;
        this.$('.h-pc-train-btn').prop('disabled', !canTrain);
        this.$('.h-pc-train-warning').toggle(!canTrain);
    },

    _onSetup() {
        this._openEditDialog(null);
    },

    _onEdit() {
        this._openEditDialog(this._session);
    },

    _openEditDialog(session) {
        showEditPixelClassifierDialog({
            folderId: this._folderId,
            checkedItemIds: this._checkedItemIds.slice(),
            session,
            onSave: (saved) => {
                this._session = saved;
                this._renderTemplate();
            }
        });
    },

    _onTrain() {
        if (!this._session || this._splitCounts.train < 1) return;
        showBuildPixelClassifierDialog({
            folderId: this._folderId,
            session: this._session,
            splitCounts: this._splitCounts
        });
    },

    _onApply() {
        if (!this._session || !this._session.current_model_item_id) return;
        showApplyPixelClassifierDialog({
            modelItemId: this._session.current_model_item_id,
            itemIds: this._checkedItemIds.slice(),
            session: this._session
        });
    }
});

export default PixelClassifierPanel;
