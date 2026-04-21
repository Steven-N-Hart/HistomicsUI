import $ from 'jquery';
import _ from 'underscore';
import Backbone from 'backbone';

import {restRequest} from '@girder/core/rest';

import editTaxonomyTemplate from '../templates/dialogs/editTaxonomy.pug';
import '../stylesheets/dialogs/editTaxonomy.styl';

const DEFAULT_COLORS = [
    '#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4',
    '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#469990'
];

function rgbToHex(color) {
    const m = (color || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) {
        return '#000000';
    }
    return '#' + [m[1], m[2], m[3]].map((n) => parseInt(n, 10).toString(16).padStart(2, '0')).join('');
}

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) {
        return 'rgb(0,0,0)';
    }
    return `rgb(${parseInt(result[1], 16)},${parseInt(result[2], 16)},${parseInt(result[3], 16)})`;
}

function hexToRgba(hex, alpha) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) {
        return `rgba(0,0,0,${alpha})`;
    }
    return `rgba(${parseInt(result[1], 16)},${parseInt(result[2], 16)},${parseInt(result[3], 16)},${alpha})`;
}

const EditTaxonomyView = Backbone.View.extend({
    events: {
        'click .h-tax-add-class': '_addRow',
        'click .h-tax-delete-row': '_deleteRow',
        'click .h-tax-save': '_save',
        'click .h-tax-cancel': '_cancel'
    },

    initialize(settings) {
        this._folderId = settings.folderId;
        this._parentView = settings.parentView;
        this._classes = [];
        this._error = null;
    },

    render() {
        const classesForTemplate = this._classes.map((c) => _.extend({}, c, {
            colorHex: rgbToHex(c.lineColor)
        }));
        const allIds = this._classes.map((c) => ({id: c.id, label: c.label || c.id}));

        if (this.$('.modal').length) {
            // Modal is already open — update only the mutable content to avoid
            // creating a second Bootstrap backdrop (which would be orphaned on close).
            this._updateContent(classesForTemplate, allIds);
            return this;
        }

        this.$el.html(editTaxonomyTemplate({
            classes: classesForTemplate,
            allIds,
            error: this._error
        }));
        this.$('.modal').modal('show');
        this.$('.modal').on('hidden.bs.modal', () => this.remove());
        return this;
    },

    _updateContent(classesForTemplate, allIds) {
        this.$('.alert-danger').remove();
        if (this._error) {
            this.$('.modal-body').prepend(
                $('<div class="alert alert-danger"></div>').text(this._error)
            );
        }

        const $tbody = this.$('tbody');
        $tbody.empty();
        classesForTemplate.forEach((cls, idx) => {
            const $select = $('<select class="form-control input-sm h-tax-parent"></select>');
            $select.append('<option value="">— none (root class)</option>');
            allIds.forEach((opt) => {
                if (opt.id !== cls.id) {
                    $('<option></option>')
                        .val(opt.id)
                        .text(opt.label || opt.id)
                        .prop('selected', cls.parent === opt.id)
                        .appendTo($select);
                }
            });

            $('<tr class="h-tax-row"></tr>').attr('data-idx', idx).append(
                $('<td></td>').append(
                    $('<input class="form-control input-sm h-tax-id" type="text" placeholder="unique-id">').val(cls.id)
                ),
                $('<td></td>').append(
                    $('<input class="form-control input-sm h-tax-label" type="text" placeholder="Display Name">').val(cls.label)
                ),
                $('<td></td>').append(
                    $('<input class="h-tax-line-color" type="color">').val(cls.colorHex || '#000000')
                ),
                $('<td></td>').append($select),
                $('<td></td>').append(
                    $('<button class="btn btn-xs btn-danger h-tax-delete-row" type="button" title="Delete class"></button>')
                        .append('<span class="icon-cancel"></span>')
                )
            ).appendTo($tbody);
        });
    },

    _addRow() {
        this._classes = this._readRows();
        const hex = DEFAULT_COLORS[this._classes.length % DEFAULT_COLORS.length];
        this._classes.push({
            id: 'class_' + Date.now(),
            label: '',
            parent: '',
            lineColor: hexToRgb(hex),
            fillColor: hexToRgba(hex, 0.3)
        });
        this.render();
    },

    _deleteRow(evt) {
        this._classes = this._readRows();
        const idx = parseInt($(evt.currentTarget).closest('tr').data('idx'), 10);
        this._classes.splice(idx, 1);
        this.render();
    },

    _readRows() {
        const classes = [];
        this.$('.h-tax-row').each(function () {
            const row = $(this);
            const hex = row.find('.h-tax-line-color').val();
            const lineColor = hexToRgb(hex);
            const fillColor = hexToRgba(hex, 0.3);
            classes.push({
                id: row.find('.h-tax-id').val().trim(),
                label: row.find('.h-tax-label').val().trim(),
                parent: row.find('.h-tax-parent').val().trim() || undefined,
                lineColor: lineColor,
                fillColor: fillColor
            });
        });
        return classes;
    },

    _detectCycle(classes) {
        const parentMap = {};
        classes.forEach((c) => {
            if (c.parent) {
                parentMap[c.id] = c.parent;
            }
        });
        const ids = classes.map((c) => c.id);
        return ids.some((id) => {
            const visited = new Set();
            let cur = id;
            while (cur) {
                if (visited.has(cur)) {
                    return true;
                }
                visited.add(cur);
                cur = parentMap[cur];
            }
            return false;
        });
    },

    _save() {
        const classes = this._readRows();
        if (this._detectCycle(classes)) {
            this._error = 'Circular parent reference detected. Please fix before saving.';
            this.render();
            return;
        }
        const config = _.extend({}, this._parentView._folderConfig || {});
        config.annotationGroups = _.extend({}, config.annotationGroups || {});
        config.annotationGroups.groups = classes.map((c) => {
            const entry = {id: c.id, label: c.label, lineColor: c.lineColor, fillColor: c.fillColor};
            if (c.parent) {
                entry.parent = c.parent;
            }
            return entry;
        });
        const body = JSON.stringify(config, null, 2);
        restRequest({
            url: `folder/${this._folderId}/yaml_config/.histomicsui_config.yaml`,
            method: 'PUT',
            contentType: 'application/yaml',
            data: body,
            processData: false
        }).done(() => {
            this._parentView._getConfig(this._parentView.model.id);
            this.$('.modal').modal('hide');
        }).fail((resp) => {
            this._error = 'Save failed: ' + ((resp.responseJSON || {}).message || resp.statusText);
            this.render();
        });
    },

    _cancel() {
        this.$('.modal').modal('hide');
    }
});

var showEditTaxonomyDialog = function (settings) {
    const {folderId, folderConfig, parentView} = settings;
    const view = new EditTaxonomyView({
        folderId,
        parentView,
        el: $('<div/>').appendTo('body')
    });
    const groups = ((folderConfig || {}).annotationGroups || {}).groups || [];
    view._classes = groups.map((g) => ({
        id: g.id || '',
        label: g.label || '',
        parent: g.parent || '',
        lineColor: g.lineColor || 'rgb(0,0,0)',
        fillColor: g.fillColor || 'rgba(0,0,0,0.3)'
    }));
    view.render();
    return view;
};

export default showEditTaxonomyDialog;
