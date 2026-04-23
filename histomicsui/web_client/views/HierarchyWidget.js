import $ from 'jquery';

import {wrap} from '@girder/core/utilities/PluginUtils';
import {restRequest} from '@girder/core/rest';
import {AccessType} from '@girder/core/constants';
import events from '@girder/core/events';
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

    const self = this;

    if (!this.$('.h-trident-embeddings-btn').length) {
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
                const checkedItemIds = [];
                const checkedFolderIds = [];
                if (self.folderListView && self.folderListView.checked) {
                    self.folderListView.checked.forEach((cid) => {
                        const folder = self.folderListView.collection.get(cid);
                        if (folder) { checkedFolderIds.push(folder.id); }
                    });
                }
                if (self.itemListView && self.itemListView.checked) {
                    self.itemListView.checked.forEach((cid) => {
                        const item = self.itemListView.collection.get(cid);
                        if (item) { checkedItemIds.push(item.id); }
                    });
                }
                showTridentEmbeddingsDialog({
                    folderId: parentModel.id,
                    resourceType: parentModel.resourceName,
                    checkedItemIds: checkedItemIds.length ? checkedItemIds : null,
                    checkedFolderIds: checkedFolderIds.length ? checkedFolderIds : null
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
    }

    const accessLevel = this.parentModel && this.parentModel.get('_accessLevel');
    if (!this.$('.h-delete-checked-btn').length && accessLevel !== undefined && accessLevel >= AccessType.WRITE) {
        const $deleteBtn = $('<button class="h-delete-checked-btn btn btn-danger btn-sm" title="Delete selected items and folders" style="display:none">' +
            '<i class="icon-trash"></i> Delete Selected' +
            '</button>');
        $deleteBtn.on('click', () => {
            const checkedItems = [];
            const checkedFolders = [];
            if (self.folderListView && self.folderListView.checked) {
                self.folderListView.checked.forEach((cid) => {
                    const folder = self.folderListView.collection.get(cid);
                    if (folder) { checkedFolders.push(folder); }
                });
            }
            if (self.itemListView && self.itemListView.checked) {
                self.itemListView.checked.forEach((cid) => {
                    const item = self.itemListView.collection.get(cid);
                    if (item) { checkedItems.push(item); }
                });
            }
            const total = checkedItems.length + checkedFolders.length;
            if (!total) {
                return;
            }
            const parts = [];
            if (checkedItems.length) { parts.push(`${checkedItems.length} item(s)`); }
            if (checkedFolders.length) { parts.push(`${checkedFolders.length} folder(s)`); }

            events.trigger('h:confirmDialog', {
                title: 'Delete Selected',
                message: `Permanently delete ${parts.join(' and ')}? This cannot be undone.`,
                submitButton: 'Delete',
                onSubmit: () => {
                    const requests = [
                        ...checkedItems.map((item) => restRequest({type: 'DELETE', url: 'item/' + item.id, error: null})),
                        ...checkedFolders.map((folder) => restRequest({type: 'DELETE', url: 'folder/' + folder.id, error: null}))
                    ];
                    Promise.all(requests).then(() => {
                        events.trigger('g:alert', {
                            icon: 'ok',
                            text: `Deleted ${parts.join(' and ')}.`,
                            type: 'success',
                            timeout: 4000
                        });
                        if (self.setCurrentModel && self.parentModel) {
                            self.setCurrentModel(self.parentModel, {setRoute: false});
                        }
                    }).catch(() => {
                        events.trigger('g:alert', {
                            icon: 'cancel',
                            text: 'One or more deletions failed.',
                            type: 'danger',
                            timeout: 4000
                        });
                        if (self.setCurrentModel && self.parentModel) {
                            self.setCurrentModel(self.parentModel, {setRoute: false});
                        }
                    });
                }
            });
        });

        const $upload2 = self.$('.g-upload-here-button');
        if ($upload2.length) {
            $upload2.after($deleteBtn);
        } else {
            self.$('.g-folder-header-buttons').append($deleteBtn);
        }

        function updateDeleteBtnVisibility() {
            const anyChecked = (
                (self.folderListView && self.folderListView.checked && self.folderListView.checked.length) ||
                (self.itemListView && self.itemListView.checked && self.itemListView.checked.length)
            );
            $deleteBtn.toggle(!!anyChecked);
        }

        if (self.folderListView) {
            self.listenTo(self.folderListView, 'change:checked', updateDeleteBtnVisibility);
        }
        if (self.itemListView) {
            self.listenTo(self.itemListView, 'change:checked', updateDeleteBtnVisibility);
        }
    }

    return this;
});

ItemCollection.prototype.pageLimit = Math.max(250, ItemCollection.prototype.pageLimit);
