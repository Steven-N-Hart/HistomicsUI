import $ from 'jquery';

import {wrap} from '@girder/core/utilities/PluginUtils';
import {restRequest} from '@girder/core/rest';
import HierarchyWidget from '@girder/core/views/widgets/HierarchyWidget';
import ItemCollection from '@girder/core/collections/ItemCollection';

import showTridentEmbeddingsDialog from '../dialogs/tridentEmbeddings';

let _tridentCliAvailable = null; // null = unchecked, true/false = resolved

function checkTridentCli() {
    if (_tridentCliAvailable !== null) {
        return Promise.resolve(_tridentCliAvailable);
    }
    return restRequest({
        url: 'slicer_cli_web/cli',
        error: null
    }).then((cliList) => {
        _tridentCliAvailable = !!(cliList || []).find((c) => c.name === 'TridentEmbeddings');
        return _tridentCliAvailable;
    }).fail(() => {
        _tridentCliAvailable = false;
        return false;
    });
}

wrap(HierarchyWidget, 'initialize', function (initialize, settings) {
    settings = settings || {};
    if (settings.paginated === undefined) {
        settings.paginated = true;
    }
    return initialize.call(this, settings);
});

wrap(HierarchyWidget, 'render', function (render) {
    render.call(this);

    const parentModel = this.parentModel;
    if (!parentModel || !['folder', 'collection'].includes(parentModel.resourceName)) {
        return this;
    }

    if (this.$('.h-trident-embeddings-btn').length) {
        return this;
    }

    const self = this;
    checkTridentCli().then((available) => {
        if (!available) {
            return null;
        }
        if (self.$('.h-trident-embeddings-btn').length) {
            return null;
        }
        const $btn = $('<button class="h-trident-embeddings-btn btn btn-default btn-sm" title="Generate TRIDENT embeddings for this folder">' +
            '<i class="icon-tasks"></i> TRIDENT Embeddings' +
            '</button>');
        $btn.on('click', () => {
            showTridentEmbeddingsDialog({
                folderId: parentModel.id,
                resourceType: parentModel.resourceName
            });
        });
        const $upload = self.$('.g-upload-here-button');
        if ($upload.length) {
            $upload.after($btn);
        } else {
            self.$('.g-folder-header-buttons').append($btn);
        }
        return null;
    });

    return this;
});

ItemCollection.prototype.pageLimit = Math.max(250, ItemCollection.prototype.pageLimit);
