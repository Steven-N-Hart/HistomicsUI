import $ from 'jquery';
import {wrap} from '@girder/core/utilities/PluginUtils';
import {restRequest} from '@girder/core/rest';
import {getCurrentUser} from '@girder/core/auth';
import JobListWidget from '@girder/jobs/views/JobListWidget';

import events from '../events';
import '../dialogs/confirmDialog';

wrap(JobListWidget, '_renderData', function (_renderData) {
    _renderData.call(this);

    const user = getCurrentUser();
    if (!user || !user.get('admin')) {
        return;
    }

    const $cancelLi = this.$el.find('a.g-jobs-list-cancel').closest('li');
    if (!$cancelLi.length) {
        return;
    }

    const widget = this;
    const $deleteLink = $('<a>', {class: 'g-jobs-list-delete'})
        .html('<i class="icon-trash"></i> Delete')
        .on('click', function (e) {
            e.preventDefault();
            const checkedIds = Object.keys(widget.jobCheckedStates || {}).filter(
                (id) => widget.jobCheckedStates[id]
            );
            if (!checkedIds.length) {
                return;
            }
            events.trigger('h:confirmDialog', {
                title: 'Delete Jobs',
                message: `Are you sure you want to permanently delete ${checkedIds.length} job(s)?`,
                submitButton: 'Delete',
                onSubmit: () => {
                    $.when.apply($, checkedIds.map((jobId) =>
                        restRequest({method: 'DELETE', url: `job/${jobId}`})
                    )).always(() => {
                        widget.jobCheckedStates = {};
                        widget.collection.fetch();
                    });
                }
            });
        });

    $cancelLi.after($('<li>').append($deleteLink));
});
