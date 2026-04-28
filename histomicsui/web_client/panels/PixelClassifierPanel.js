import $ from 'jquery';
import Backbone from 'backbone';

import {restRequest} from '@girder/core/rest';
import events from '@girder/core/events';

import showEditPixelClassifierDialog from '../dialogs/editPixelClassifier';
import showBuildPixelClassifierDialog from '../dialogs/buildPixelClassifier';
import showApplyPixelClassifierDialog from '../dialogs/applyPixelClassifier';
import pixelClassifierPanelTemplate from '../templates/panels/pixelClassifierPanel.pug';
import '../stylesheets/panels/pixelClassifierPanel.styl';

const JOB_POLL_INTERVAL_MS = 5000;

const PixelClassifierPanel = Backbone.View.extend({
    initialize(settings) {
        this._itemId = settings.itemId;
        this._accessLevel = settings.accessLevel;
        this._session = null;
        this._loading = true;
        this._checkedItemIds = [];
        this._pendingJobId = null;
        this._pollTimer = null;
    },

    render() {
        this._renderTemplate();
        if (this._itemId) {
            this._loadSession();
        }
        return this;
    },

    setItem(itemId) {
        this._itemId = itemId || null;
        this._session = null;
        this._loading = !!itemId;
        this._pendingJobId = null;
        this._stopPolling();
        this._renderTemplate();
        if (this._itemId) {
            this._loadSession();
        }
        return this;
    },

    _renderTemplate() {
        const noItemSelected = !this._itemId;
        const iterations = (this._session && this._session.iterations) || [];
        const lastIteration = iterations.length ? iterations[iterations.length - 1] : null;

        this.$el.html(pixelClassifierPanelTemplate({
            loading: !noItemSelected && this._loading,
            session: this._session,
            lastIteration,
            pendingJobId: this._pendingJobId,
            checkedCount: this._checkedItemIds.length,
            noItemSelected
        }));

        this.$('.h-pc-setup-btn').on('click', () => this._onSetup());
        this.$('.h-pc-edit-btn').on('click', () => this._onEdit());
        this.$('.h-pc-train-btn').on('click', () => this._onTrain());
        this.$('.h-pc-apply-btn').on('click', () => this._onApply());
        this.$('.h-pc-view-overlay').on('click', (e) => this._onViewOverlay(e));
    },

    setCheckedItems(ids) {
        this._checkedItemIds = ids || [];
        if (!this._loading) {
            const count = this._checkedItemIds.length;
            this.$('.h-pc-apply-count').text(count > 0 ? ` (${count})` : '');
        }
    },

    remove() {
        this._stopPolling();
        return Backbone.View.prototype.remove.apply(this, arguments);
    },

    _loadSession() {
        restRequest({url: `item/${this._itemId}`, error: null}).then((item) => {
            this._session = ((item || {}).meta || {})._pixelClassifierSession || null;
            this._loading = false;

            if (this._session) {
                const iters = this._session.iterations || [];
                const last = iters[iters.length - 1];
                if (last && last.job_id && !last.trained_at) {
                    this._startPolling(last.job_id);
                }
            }

            this._renderTemplate();
        }).catch(() => {
            this._loading = false;
            this._renderTemplate();
        });
    },

    _startPolling(jobId) {
        this._pendingJobId = jobId;
        this._stopPolling();
        this._pollTimer = setInterval(() => this._pollJobStatus(jobId), JOB_POLL_INTERVAL_MS);
    },

    _stopPolling() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
        this._pendingJobId = null;
    },

    _pollJobStatus(jobId) {
        restRequest({url: `job/${jobId}`, error: null}).then((job) => {
            const status = (job || {}).status;
            if (status === 3) {
                this._stopPolling();
                events.trigger('g:alert', {
                    icon: 'ok',
                    text: 'Pixel Classifier training complete.',
                    type: 'success',
                    timeout: 6000
                });
                this._loadSession();
            } else if (status === 4 || status === 5) {
                this._stopPolling();
                events.trigger('g:alert', {
                    icon: 'cancel',
                    text: `Pixel Classifier job ${status === 4 ? 'failed' : 'cancelled'}.`,
                    type: 'danger',
                    timeout: 8000
                });
                this._loadSession();
            }
        });
    },

    _onSetup() {
        if (!this._itemId) {
            events.trigger('g:alert', {
                icon: 'info',
                text: 'Check a single slide above to select it, then click Set Up Classifier.',
                type: 'info',
                timeout: 4000
            });
            return;
        }
        showEditPixelClassifierDialog({
            itemId: this._itemId,
            session: null,
            onSave: (session) => {
                this._session = session;
                this._renderTemplate();
            }
        });
    },

    _onEdit() {
        showEditPixelClassifierDialog({
            itemId: this._itemId,
            session: this._session,
            onSave: (session) => {
                this._session = session;
                this._renderTemplate();
            }
        });
    },

    _onTrain() {
        showBuildPixelClassifierDialog({
            itemId: this._itemId,
            session: this._session,
            onSubmit: ({jobId}) => {
                if (jobId) {
                    this._startPolling(jobId);
                    this._renderTemplate();
                }
            }
        });
    },

    _onApply() {
        if (!this._session || !this._session.current_model_item_id) return;
        showApplyPixelClassifierDialog({
            modelItemId: this._session.current_model_item_id,
            itemIds: this._checkedItemIds.slice()
        });
    },

    _onViewOverlay(e) {
        e.preventDefault();
        const annotationId = $(e.currentTarget).data('annotation-id');
        if (annotationId) {
            events.trigger('h:highlightAnnotation', {id: annotationId});
        }
    }
});

export default PixelClassifierPanel;
