import mimetypes
import os
import threading
import traceback

from girder import logger
from girder.api import access
from girder.api.describe import Description, autoDescribeRoute, describeRoute
from girder.api.rest import Resource, filtermodel
from girder.constants import AccessType, TokenScope
from girder.exceptions import RestException
from girder.models.assetstore import Assetstore
from girder.models.file import File
from girder.models.folder import Folder
from girder.models.item import Item
from girder.models.setting import Setting
from girder.models.upload import Upload
from girder.utility import assetstore_utilities
from girder.utility.model_importer import ModelImporter

# Alias map: normalized directory/file name → TRIDENT encoder ID.
# Normalization: lowercase, then -, ., ' ' replaced with _.
# This handles HuggingFace-style nested layout (org/model) and plain filenames.
_ENCODER_ALIASES = {
    # --- patch encoders ---
    'conchv1_5': 'conch_v15', 'conch_v1_5': 'conch_v15',
    'conch_v15': 'conch_v15', 'conchv15': 'conch_v15',
    'conchv1': 'conch_v1', 'conch_v1': 'conch_v1', 'conch': 'conch_v1',
    'uni_v2': 'uni_v2', 'uni2': 'uni_v2', 'uni2_h': 'uni_v2', 'univ2': 'uni_v2',
    'uni_v1': 'uni_v1', 'uni': 'uni_v1', 'univ1': 'uni_v1',
    'virchow2': 'virchow2',
    'virchow': 'virchow',
    'phikon_v2': 'phikon_v2', 'phikonv2': 'phikon_v2',
    'phikon': 'phikon',
    'gigapath': 'gigapath', 'prov_gigapath': 'gigapath', 'provgigapath': 'gigapath',
    'hoptimus0': 'hoptimus0', 'h_optimus_0': 'hoptimus0',
    'hoptimus1': 'hoptimus1', 'h_optimus_1': 'hoptimus1',
    'musk': 'musk',
    'midnight12k': 'midnight12k',
    'kaiko_vitb8': 'kaiko-vitb8', 'kaiko_vitb16': 'kaiko-vitb16',
    'kaiko_vits8': 'kaiko-vits8', 'kaiko_vits16': 'kaiko-vits16',
    'kaiko_vitl14': 'kaiko-vitl14',
    'lunit_vits8': 'lunit-vits8',
    'hibou_l': 'hibou_l', 'hiboul': 'hibou_l',
    'ctranspath': 'ctranspath',
    'resnet50': 'resnet50',
    # --- slide encoders that need own checkpoint ---
    'threads': 'threads', 'titan': 'titan', 'prism': 'prism',
    'chief': 'chief', 'madeleine': 'madeleine', 'feather': 'feather', 'abmil': 'abmil',
}
_PATCH_ENCODER_IDS = {eid for eid, _ in [
    ('conch_v15', ''), ('conch_v1', ''), ('uni_v1', ''), ('uni_v2', ''),
    ('virchow', ''), ('virchow2', ''), ('phikon', ''), ('phikon_v2', ''),
    ('gigapath', ''), ('hoptimus0', ''), ('hoptimus1', ''), ('musk', ''),
    ('midnight12k', ''), ('kaiko-vitb8', ''), ('kaiko-vitb16', ''),
    ('kaiko-vits8', ''), ('kaiko-vits16', ''), ('kaiko-vitl14', ''),
    ('lunit-vits8', ''), ('hibou_l', ''), ('ctranspath', ''), ('resnet50', ''),
]}
_SLIDE_CHECKPOINT_IDS = {'threads', 'titan', 'prism', 'chief', 'gigapath',
                         'madeleine', 'feather', 'abmil'}


def _norm(name):
    """Normalize a directory/file name for alias lookup."""
    return name.lower().replace('-', '_').replace('.', '_').replace(' ', '_')


def _collect_items_recursive(folder, user):
    """Return all items in *folder* and every descendant folder."""
    items = list(Folder().childItems(folder, user=user))
    for subfolder in Folder().childFolders(parent=folder, parentType='folder', user=user):
        items.extend(_collect_items_recursive(subfolder, user))
    return items


def _export_dicomweb_item_as_dicoms(item, wsi_dir):
    """
    Download a DICOMweb-backed Girder item's instances into ``wsi_dir/<item_name>/``
    as raw .dcm files. TRIDENT reads the series directly via OpenSlide
    (reader_type=openslide auto-discovers sibling instances in the directory) —
    no TIFF conversion needed.

    Idempotent: if the directory already contains at least as many .dcm files
    as the item has instances, returns immediately without re-downloading.
    Per-file re-download is also skipped when the file already exists on disk.

    Returns the on-disk directory path on success, or None if the item cannot
    be exported.
    """
    import requests

    try:
        from large_image_source_dicom.assetstore import DICOMWEB_META_KEY
        from girder.models.assetstore import Assetstore as _Assetstore

        files = list(Item().childFiles(item))
        if not files:
            return None
        dicom_uids = files[0].get('dicom_uids')
        if not dicom_uids:
            return None

        study_uid = dicom_uids.get('study_uid', '')
        series_uid = dicom_uids.get('series_uid', '')
        if not (study_uid and series_uid):
            return None

        instance_files = [
            f for f in files if (f.get('dicom_uids') or {}).get('instance_uid')
        ]
        if not instance_files:
            return None

        item_dir = os.path.join(wsi_dir, item['name'])
        if os.path.isdir(item_dir):
            existing = [n for n in os.listdir(item_dir) if n.endswith('.dcm')]
            if len(existing) >= len(instance_files):
                return item_dir

        store = _Assetstore().load(files[0]['assetstoreId'])
        meta = store.get(DICOMWEB_META_KEY) or {}
        base_url = meta.get('url', '')
        token = meta.get('auth_token', '')
        if not base_url:
            return None

        from dicomweb_client.api import DICOMwebClient
        session = requests.Session()
        if token:
            session.headers['Authorization'] = f'Bearer {token}'
        client = DICOMwebClient(
            url=base_url,
            qido_url_prefix=meta.get('qido_prefix'),
            wado_url_prefix=meta.get('wado_prefix'),
            session=session,
        )

        os.makedirs(item_dir, exist_ok=True)
        for f in instance_files:
            dest = os.path.join(item_dir, f['name'])
            if os.path.exists(dest):
                continue
            dataset = client.retrieve_instance(
                study_uid, series_uid, f['dicom_uids']['instance_uid'],
            )
            dataset.save_as(dest, write_like_original=False)
        return item_dir

    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 401:
            logger.warning(
                'DICOMweb export for %s failed with 401 Unauthorized. '
                'The assetstore auth token has likely expired; refresh it via '
                'POST /api/v1/dicom_import/refresh_token with a fresh '
                '`gcloud auth print-access-token`.',
                item.get('name'),
            )
        else:
            logger.warning('DICOMweb export failed for %s: %s', item.get('name'), exc)
        return None
    except Exception as exc:
        logger.warning('DICOMweb export failed for %s: %s', item.get('name'), exc)
        return None


def _resolve_trident_items(item_ids_param, folder_ids_param, resource, resource_type, user):
    """Return the explicit list of items to stage, given dialog inputs."""
    if item_ids_param or folder_ids_param:
        items = []
        if item_ids_param:
            for iid in item_ids_param.split(','):
                iid = iid.strip()
                if iid:
                    item = Item().load(iid, user=user, level=AccessType.READ, exc=False)
                    if item:
                        items.append(item)
        if folder_ids_param:
            for fid in folder_ids_param.split(','):
                fid = fid.strip()
                if fid:
                    folder = Folder().load(fid, user=user, level=AccessType.READ, exc=False)
                    if folder:
                        items.extend(_collect_items_recursive(folder, user))
        return items

    if resource_type == 'folder':
        return list(Folder().childItems(resource, user=user))

    items = []
    for folder in Folder().childFolders(
            parent=resource, parentType=resource_type, user=user):
        items.extend(Folder().childItems(folder, user=user))
    return items


def _stage_one_item(item, wsi_dir):
    """Stage a single item into wsi_dir.

    Returns one of: 'staged', 'skipped' (no usable file or symlink failed),
    'skipped_dicomweb' (DICOMweb item where TIFF export failed).
    """
    files = list(Item().childFiles(item, limit=1))
    if not files:
        return 'skipped'
    file = files[0]

    src = None
    try:
        store = Assetstore().load(file['assetstoreId'])
        adapter = assetstore_utilities.getAssetstoreAdapter(store)
        src = adapter.fullPath(file)
    except Exception:
        pass

    if src is None:
        item_dir = _export_dicomweb_item_as_dicoms(item, wsi_dir)
        return 'staged' if item_dir else 'skipped_dicomweb'

    dest = os.path.join(wsi_dir, item['name'])
    if os.path.islink(dest) or os.path.exists(dest):
        try:
            os.remove(dest)
        except OSError:
            return 'skipped'
    try:
        os.symlink(src, dest)
        return 'staged'
    except OSError:
        return 'skipped'


def _run_trident_staging_job(job_id):
    """Background worker for the TRIDENT staging Girder Job."""
    from bson import ObjectId
    from girder_jobs.constants import JobStatus
    from girder_jobs.models.job import Job

    job_model = Job()

    def _reload():
        return job_model.load(job_id, force=True)

    def _log(msg):
        job_model.updateJob(_reload(), log=msg + '\n', overwrite=False)

    job = _reload()
    try:
        kwargs = _reload()['kwargs']
        item_ids = kwargs['item_ids']
        wsi_dir = kwargs['wsi_dir']
        total = len(item_ids)

        job_model.updateJob(
            job, status=JobStatus.RUNNING,
            progressTotal=total, progressCurrent=0,
            progressMessage='Staging slides…',
        )

        staged = []
        skipped = []
        skipped_dicomweb = []
        for idx, iid in enumerate(item_ids, 1):
            item = Item().load(iid, force=True)
            if not item:
                skipped.append(iid)
                _log(f'[{idx}/{total}] {iid}: item not found')
                job_model.updateJob(
                    _reload(), progressCurrent=idx,
                    progressMessage=f'Skipped {iid} (not found)',
                )
                continue
            name = item.get('name') or iid
            job_model.updateJob(
                _reload(), progressCurrent=idx - 1,
                progressMessage=f'Staging {name}…',
            )
            outcome = _stage_one_item(item, wsi_dir)
            _log(f'[{idx}/{total}] {name}: {outcome}')
            job_model.updateJob(
                _reload(), progressCurrent=idx,
                progressMessage=f'{name}: {outcome}',
            )
            if outcome == 'staged':
                staged.append(name)
            elif outcome == 'skipped_dicomweb':
                skipped_dicomweb.append(name)
            else:
                skipped.append(name)

        summary = (
            f'Done. {len(staged)} staged, {len(skipped)} skipped, '
            f'{len(skipped_dicomweb)} DICOMweb export failures.'
        )
        _log(summary)
        # Stash the result on `meta` (filtered through to the REST response,
        # unlike custom top-level fields which are stripped by @filtermodel).
        final_job = _reload()
        meta = final_job.get('meta') or {}
        meta['trident_staging_result'] = {
            'staged': staged,
            'skipped': skipped,
            'skipped_dicomweb': skipped_dicomweb,
        }
        final_job['meta'] = meta
        Job().save(final_job)

        final_status = JobStatus.SUCCESS if staged else JobStatus.ERROR
        job_model.updateJob(
            _reload(), status=final_status,
            progressMessage=summary,
        )

    except Exception:
        job_model.updateJob(
            _reload(), status=JobStatus.ERROR,
            log=traceback.format_exc(), overwrite=False,
        )


def _ensure_folder_path(rel_path, root_folder, user):
    """
    Walk *rel_path* (e.g. '5x_512px_0px_overlap/features_conch_v15') and
    create any missing Girder folders under *root_folder*, returning the
    deepest folder.
    """
    parts = rel_path.replace('\\', '/').split('/')
    current = root_folder
    for part in parts:
        if not part or part == '.':
            continue
        children = list(Folder().childFolders(
            parent=current, parentType='folder', user=user,
            filters={'name': part}, limit=1))
        if children:
            current = children[0]
        else:
            current = Folder().createFolder(
                parent=current, name=part, creator=user,
                parentType='folder', reuseExisting=True)
    return current


# Ordered list of known TRIDENT patch encoder IDs and display labels.
_PATCH_ENCODER_META = [
    ('conch_v15', 'CONCHv1.5'),
    ('conch_v1', 'CONCH'),
    ('uni_v1', 'UNI'),
    ('uni_v2', 'UNI2-h'),
    ('virchow', 'Virchow'),
    ('virchow2', 'Virchow2'),
    ('phikon', 'Phikon'),
    ('phikon_v2', 'Phikon-v2'),
    ('gigapath', 'Prov-GigaPath'),
    ('hoptimus0', 'H-Optimus-0'),
    ('hoptimus1', 'H-Optimus-1'),
    ('musk', 'MUSK'),
    ('midnight12k', 'Midnight-12k'),
    ('kaiko-vitb8', 'Kaiko ViT-B/8'),
    ('kaiko-vitb16', 'Kaiko ViT-B/16'),
    ('kaiko-vits8', 'Kaiko ViT-S/8'),
    ('kaiko-vits16', 'Kaiko ViT-S/16'),
    ('kaiko-vitl14', 'Kaiko ViT-L/14'),
    ('lunit-vits8', 'Lunit ViT-S/8'),
    ('hibou_l', 'Hibou-L'),
    ('ctranspath', 'CTransPath / CHIEF'),
    ('resnet50', 'ResNet-50'),
]

# Slide encoder entries: (id, label, needs_own_checkpoint).
# Mean-pool encoders (needs_own_checkpoint=False) are always listed because they
# require no separate weights — they pool patch features at inference time.
_SLIDE_ENCODER_META = [
    ('threads', 'THREADS', True),
    ('titan', 'TITAN', True),
    ('prism', 'PRISM', True),
    ('chief', 'CHIEF', True),
    ('gigapath', 'GigaPath (slide)', True),
    ('madeleine', 'Madeleine', True),
    ('feather', 'Feather', True),
    ('abmil', 'ABMIL', True),
    ('mean-conch_v15', 'Mean Pool – CONCHv1.5', False),
    ('mean-conch_v1', 'Mean Pool – CONCH', False),
    ('mean-uni_v1', 'Mean Pool – UNI', False),
    ('mean-uni_v2', 'Mean Pool – UNI2', False),
    ('mean-ctranspath', 'Mean Pool – CTransPath', False),
    ('mean-phikon', 'Mean Pool – Phikon', False),
    ('mean-resnet50', 'Mean Pool – ResNet-50', False),
    ('mean-gigapath', 'Mean Pool – GigaPath', False),
]

from .. import handlers
from ..constants import PluginSettings
from .system import allChildFolders, allChildItems


class HistomicsUIResource(Resource):
    def __init__(self):
        super().__init__()
        self.resourceName = 'histomicsui'

        self.route('GET', ('settings',), self.getPublicSettings)
        self.route('PUT', ('quarantine', ':id'), self.putQuarantine)
        self.route('PUT', ('quarantine', ':id', 'restore'), self.restoreQuarantine)
        # The route function tells girder to route calls to the endpoint to
        # a specific function.  The arguments here mean:
        #  1st: This is for GET requests
        #  2nd: This describes the path of the endpoint.
        #  3rd: The function that will be called.
        #
        # The `:id` component in the path is a wildcard that matches any string
        # The value matched will be passed as an argument to the function.  As
        # an example if you make a GET request to
        #   `/api/v1/histomicsui/child_metadata/foobar`
        # the function `self.getChildMetadata` will be called with the parameter
        # `id="foobar"`.
        self.route('GET', ('child_metadata', ':id'), self.getChildMetadata)

        # Similarly, this route handles calls to:
        #  `GET /api/v1/histomicsui/query_metadata`
        self.route('GET', ('query_metadata',), self.findItemsByMetadata)

        self.route('GET', ('trident', 'encoders'), self.listTridentEncoders)
        self.route('GET', ('trident', 'stage'), self.stageTridentJob)
        self.route('POST', ('trident', 'stage'), self.stageTridentJob)
        self.route('POST', ('trident', 'import'), self.importTridentResults)

    @describeRoute(
        Description('Get public settings for HistomicsUI.'),
    )
    @access.public(scope=TokenScope.DATA_READ)
    def getPublicSettings(self, params):
        keys = [
            PluginSettings.HUI_BRAND_NAME,
            PluginSettings.HUI_DEFAULT_DRAW_STYLES,
            PluginSettings.HUI_LOGIN_TEXT,
            PluginSettings.HUI_PANEL_LAYOUT,
            PluginSettings.HUI_QUARANTINE_FOLDER,
            PluginSettings.HUI_WEBROOT_PATH,
        ]
        result = {k: Setting().get(k) for k in keys}
        result[PluginSettings.HUI_QUARANTINE_FOLDER] = bool(
            result[PluginSettings.HUI_QUARANTINE_FOLDER])
        return result

    @autoDescribeRoute(
        Description('Move an item to the quarantine folder.')
        .responseClass('Item')
        .modelParam('id', model=Item, level=AccessType.WRITE)
        .errorResponse('ID was invalid.')
        .errorResponse('Write access was denied for the item', 403),
    )
    @access.user(scope=TokenScope.DATA_WRITE)
    @filtermodel(model=Item)
    def putQuarantine(self, item):
        return handlers.quarantine_item(item, self.getCurrentUser())

    @autoDescribeRoute(
        Description('Restore a quarantined item to its original folder.')
        .responseClass('Item')
        .modelParam('id', model=Item, level=AccessType.WRITE)
        .errorResponse('ID was invalid.')
        .errorResponse('Write access was denied for the item', 403),
    )
    @access.admin
    @filtermodel(model=Item)
    def restoreQuarantine(self, item):
        return handlers.restore_quarantine_item(item, self.getCurrentUser())

    # The `autoDescrbeRoute` (and `describeRoute` used in older code)
    # serves to generate the swagger documentation that looks like:
    #   https://data.kitware.com/api/v1
    #
    # The api for this is described at https://goo.gl/hnU3ws.
    @autoDescribeRoute(
        # Instantiate the instance with a basic description of the endpoint.
        Description('Get all metadata for a resource and all folders and '
                    'items that are children of a resource.')
        # Add a required "path" parameter (this is the `:id` component in the
        # route).
        .param('id', 'The ID of the resource.', paramType='path')
        # Add a required "query" parameter... e.g. `?type=collection`.
        .param('type', 'The type of the resource',
               enum=['folder', 'collection', 'user'])
        # The following to lines document common rest errors that can occur
        # when calling this endpoint.  This is for documentation only.
        .errorResponse('ID was invalid.')
        .errorResponse('Access was denied for the resource.', 403),
    )
    # This makes the endpoint accessible without logging in.
    @access.public(scope=TokenScope.DATA_READ)
    def getChildMetadata(self, id, params):
        # The `autoDescribeRoute` decorator processes the incoming request and
        # populates the function arguments.  Path parameters are added as
        # individual arguments, while query parameters are packed into the
        # `params` dictionary.
        user = self.getCurrentUser()
        modelType = params['type']
        model = ModelImporter.model(modelType)
        doc = model.load(id=id, user=user, level=AccessType.READ)
        if not doc:
            msg = 'Resource not found.'
            raise RestException(msg)
        results = {}
        if doc.get('meta'):
            results[str(doc['_id'])] = doc['meta']
        logger.info('Getting child metadata')
        for folder in allChildFolders(parentType=modelType, parent=doc,
                                      user=user, limit=0, offset=0):
            if folder.get('meta'):
                results[str(folder['_id'])] = folder['meta']
        for item in allChildItems(parentType=modelType, parent=doc,
                                  user=user, limit=0, offset=0):
            if item.get('meta'):
                results[str(item['_id'])] = item['meta']
        # By default, responses to girder endpoints are json encoded when
        # returned to the client.  In this case, it is a dictionary mapping
        # `id` -> `metadata`.
        return results

    # This endpoint returns a paginated list of all items with a given
    # (key, value) pair in their metadata.  This endpoint can be called as
    # follows:
    #
    # /histomicsui/query_metadata?
    #   key=doctor&value="John Doe"&limit=10&sort=created&sortdir=-1
    #
    # This will return a list of items matched as `{'meta': {'doctor':
    # 'John Doe'}}`.  It will return at most 10 items starting from the most
    # recently created.
    @autoDescribeRoute(
        Description('Get a list of items with a specific metadata value.')
        # This is a required string parameter representing the key in the
        # metadata.
        .param('key', 'The metadata key')
        # This is the value which should be json encoded.
        .jsonParam('value', 'The (json encoded) metadata value')
        # This adds paging parameters "limit", "offset", and "sort".  By
        # default it sorts by the `name` field of the item in ascending order.
        .pagingParams('name')
        # The following to lines document common rest errors that can occur
        # when calling this endpoint.  This is for documentation only.
        .errorResponse('Required parameters were not provided.')
        .errorResponse('Invalid value provided.'),
    )
    @access.public(scope=TokenScope.DATA_READ)
    def findItemsByMetadata(self, key, value, limit, offset, sort):
        # Construct a mongo query from the parameters given.  Developers should
        # be careful when constructing these queries to ensure that private
        # information is not leaked.  In this example, the user could pass an
        # arbitrary dictionary which could involve an aggregation pipeline, so
        # we check that only simple types are accepted.
        if isinstance(value, (list, dict)):
            # This is a special type of exception that tells girder to respond
            # with an HTTP response with the given code and message.
            msg = 'The value must not be a dictionary or list.'
            raise RestException(msg, code=400)

        query = {
            'meta': {
                key: value,
            },
        }

        # This gets the logged in user who created the request.  If it is an
        # anonymous request, this value will be `None`.
        user = self.getCurrentUser()

        # Here, item is a "model" class which is a single instance providing an
        # api that wraps traditional mongo queries.  This API is described at:
        # http://girder.readthedocs.io/en/latest/api-docs.html?#models
        item = Item()

        # This runs a "find" operation on the item collection returning a mongo
        # cursor.
        cursor = item.find(query, sort=sort)

        # The `filterResultsByPermission` allows paged access to a mongo query
        # while filtering out documents that the current user doesn't have
        # access to.  In this case, it requires the current user have read
        # access to the items.  The return value is an iterator that begins at
        # `offset` and ends at `offset + limit`.
        response = item.filterResultsByPermission(
            cursor,
            user=user, level=AccessType.READ,
            limit=limit, offset=offset,
        )

        # Finally, we turn the iterator into an explicit list for return to the
        # user.  Girder handles json encoding the response.
        return list(response)

    @autoDescribeRoute(
        Description('List available TRIDENT encoder models by scanning a directory.')
        .param('path', 'Top-level directory containing model checkpoint subdirectories.',
               required=False, default='/Export/Shared/HF_MODELS'),
    )
    @access.user(scope=TokenScope.DATA_READ)
    def listTridentEncoders(self, path):
        # Scan up to 2 levels deep: flat layout (path/model_name) AND
        # HuggingFace org layout (path/org/model_name).
        # Returns the actual found filesystem path for each encoder so the UI
        # can auto-fill checkpoint fields precisely.
        found_patch = {}   # encoder_id → full_path
        found_slide_ckpt = {}  # encoder_id → full_path

        def _check(name, full_path):
            eid = _ENCODER_ALIASES.get(_norm(os.path.splitext(name)[0]))
            if eid is None:
                return
            if eid in _PATCH_ENCODER_IDS:
                found_patch[eid] = full_path
            elif eid in _SLIDE_CHECKPOINT_IDS:
                found_slide_ckpt[eid] = full_path

        try:
            top_entries = os.listdir(path)
        except OSError:
            top_entries = []

        for entry in top_entries:
            entry_path = os.path.join(path, entry)
            if os.path.isfile(entry_path):
                _check(entry, entry_path)
            elif os.path.isdir(entry_path):
                # Try the directory name itself (flat layout)
                _check(entry, entry_path)
                # Also scan one level deeper (org/model layout)
                try:
                    for child in os.listdir(entry_path):
                        child_path = os.path.join(entry_path, child)
                        _check(child, child_path)
                except OSError:
                    pass

        patch = [
            {'id': eid, 'label': label, 'foundPath': found_patch[eid]}
            for eid, label in _PATCH_ENCODER_META
            if eid in found_patch
        ]
        slide = []
        for eid, label, needs in _SLIDE_ENCODER_META:
            if needs:
                if eid in found_slide_ckpt:
                    slide.append({'id': eid, 'label': label, 'needsCheckpoint': True,
                                  'foundPath': found_slide_ckpt[eid]})
            else:
                # Mean-pool: only available if the underlying patch encoder was found.
                patch_id = eid[len('mean-'):]
                if patch_id in found_patch:
                    slide.append({'id': eid, 'label': label, 'needsCheckpoint': False,
                                  'foundPath': ''})
        return {'path': path, 'patch_encoders': patch, 'slide_encoders': slide}

    @describeRoute(
        Description('Stage a Girder resource for a TRIDENT job.')
        .param('resourceId', 'The Girder resource ID (folder, collection, or user).')
        .param('resourceType', 'The resource type.', required=False, default='folder',
               enum=['folder', 'collection', 'user'])
        .param('itemIds', 'Comma-separated Girder item IDs to stage. '
               'When provided, only these items (and any folderIds) are staged.',
               required=False)
        .param('folderIds', 'Comma-separated Girder folder IDs to stage recursively. '
               'When provided, all items within these folders (and sub-folders) are staged.',
               required=False)
        .errorResponse('Resource not found or access denied.', 403)
        .errorResponse('Staging area is not writable on the server.', 500),
    )
    @access.user(scope=TokenScope.DATA_READ)
    def stageTridentJob(self, params):
        user = self.getCurrentUser()
        resource_id = params.get('resourceId')
        if not resource_id:
            raise RestException('Parameter "resourceId" is required.')
        resource_type = params.get('resourceType', 'folder')

        model = ModelImporter.model(resource_type)
        resource = model.load(resource_id, user=user, level=AccessType.READ, exc=True)

        staging_base = '/Export/Shared/DSA/TRIDENT'
        username = user['login']
        project_name = resource['name'].replace('/', '_').replace('\\', '_')
        job_dir = os.path.join(staging_base, username, project_name)
        wsi_dir = os.path.join(job_dir, 'wsi')

        try:
            os.makedirs(wsi_dir, exist_ok=True)
        except OSError as e:
            raise RestException(
                f'Cannot create staging directory {wsi_dir}: {e}. '
                'Ensure /Export/Shared/DSA/TRIDENT is writable by the server.',
                code=500,
            )

        items = _resolve_trident_items(
            params.get('itemIds', ''),
            params.get('folderIds', ''),
            resource, resource_type, user,
        )

        from girder_jobs.constants import JobStatus
        from girder_jobs.models.job import Job

        job = Job().createJob(
            title=f'TRIDENT staging ({len(items)} item{"s" if len(items) != 1 else ""})',
            type='trident_staging',
            user=user,
            public=False,
        )
        Job().updateJob(job, status=JobStatus.QUEUED, log=(
            f'Staging {len(items)} item(s) into {wsi_dir}\n'
        ), overwrite=True)
        job['kwargs'] = {
            'item_ids': [str(it['_id']) for it in items],
            'user_id': str(user['_id']),
            'wsi_dir': wsi_dir,
            'job_dir': job_dir,
        }
        Job().save(job)

        t = threading.Thread(target=_run_trident_staging_job, args=(job['_id'],), daemon=True)
        t.start()

        return {
            'wsi_dir': wsi_dir,
            'job_dir': job_dir,
            'jobId': str(job['_id']),
            'totalItems': len(items),
            'itemIds': [str(it['_id']) for it in items],
        }

    @describeRoute(
        Description('Import TRIDENT output files from the filesystem into a Girder folder.')
        .param('jobDir', 'Path to the TRIDENT job output directory (must be under '
               '/Export/Shared/DSA/TRIDENT).')
        .param('folderId', 'Girder folder ID to import results into.')
        .errorResponse('Access denied or invalid path.', 403),
    )
    @access.user(scope=TokenScope.DATA_WRITE)
    def importTridentResults(self, params):
        user = self.getCurrentUser()
        job_dir = params.get('jobDir', '').rstrip('/')
        folder_id = params.get('folderId')

        staging_base = '/Export/Shared/DSA/TRIDENT'
        if not job_dir or not os.path.realpath(job_dir).startswith(
                os.path.realpath(staging_base) + os.sep):
            raise RestException(
                f'jobDir must be a path under {staging_base}.', code=400)
        if not os.path.isdir(job_dir):
            raise RestException(f'jobDir does not exist: {job_dir}', code=400)

        folder = Folder().load(folder_id, user=user, level=AccessType.WRITE, exc=True)

        # Filesystem assetstore for registering files in-place.
        fs_store = Assetstore().findOne({'type': 0})
        if fs_store is None:
            raise RestException('No filesystem assetstore found.', code=500)
        fs_adapter = assetstore_utilities.getAssetstoreAdapter(fs_store)

        imported = []
        skipped = []

        for dirpath, dirnames, filenames in os.walk(job_dir):
            # Skip the wsi/ staging directory (symlinks to original slides).
            dirnames[:] = [d for d in dirnames if d != 'wsi']

            rel = os.path.relpath(dirpath, job_dir)
            # Find or create the matching Girder (sub)folder.
            if rel == '.':
                target_folder = folder
            else:
                target_folder = _ensure_folder_path(rel, folder, user)

            for fname in filenames:
                fpath = os.path.join(dirpath, fname)
                if os.path.islink(fpath):
                    skipped.append(fname if rel == '.' else os.path.join(rel, fname))
                    continue
                try:
                    item = Item().createItem(
                        name=fname,
                        creator=user,
                        folder=target_folder,
                        reuseExisting=True,
                    )
                    mime = mimetypes.guess_type(fname)[0] or 'application/octet-stream'
                    fs_adapter.importFile(item, fpath, user, name=fname, mimeType=mime)
                    path_label = fname if rel == '.' else os.path.join(rel, fname)
                    imported.append(path_label)
                except Exception as exc:
                    logger.warning('Failed to import %s: %s', fpath, exc)
                    path_label = fname if rel == '.' else os.path.join(rel, fname)
                    skipped.append(path_label)

        return {'imported': imported, 'skipped': skipped}
