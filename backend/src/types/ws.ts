import { t, type Static } from 'elysia'

// ============================================================
// Domain Types
// ============================================================

export const LabelSchema = t.Object({
  language: t.String(),
  value: t.String(),
})

export const ExistingPageSchema = t.Object({
  url: t.String(),
})

export const CameraInfoSchema = t.Object({
  make: t.Optional(t.Nullable(t.String())),
  model: t.Optional(t.Nullable(t.String())),
  is_pano: t.Boolean(),
})

export const ImageDimensionsSchema = t.Object({
  width: t.Integer(),
  height: t.Integer(),
})

export const ImageUrlsSchema = t.Object({
  url: t.String(),
  original: t.String(),
  preview: t.String(),
  thumbnail: t.String(),
})

export const HandlerSchema = t.Literal('mapillary')

export const UploadStatusSchema = t.Union([
  t.Literal('queued'),
  t.Literal('in_progress'),
  t.Literal('completed'),
  t.Literal('failed'),
  t.Literal('duplicate'),
  t.Literal('duplicated_sdc_updated'),
  t.Literal('duplicated_sdc_not_updated'),
  t.Literal('cancelled'),
])

export const CreatorSchema = t.Object({
  id: t.String(),
  username: t.String(),
  profile_url: t.String(),
})

export const DatesSchema = t.Object({
  taken: t.String(),
})

export const GeoLocationSchema = t.Object({
  latitude: t.Number(),
  longitude: t.Number(),
  compass_angle: t.Optional(t.Nullable(t.Number())),
  city: t.Optional(t.Nullable(t.String())),
  county: t.Optional(t.Nullable(t.String())),
  state: t.Optional(t.Nullable(t.String())),
  country: t.Optional(t.Nullable(t.String())),
  country_code: t.Optional(t.Nullable(t.String())),
  postcode: t.Optional(t.Nullable(t.String())),
  accuracy: t.Optional(t.Nullable(t.Number())),
})

export const ErrorLinkSchema = t.Object({
  title: t.String(),
  url: t.String(),
})

export const StructuredErrorSchema = t.Union([
  t.Object({
    links: t.Array(ErrorLinkSchema),
    message: t.String(),
    type: t.Literal('duplicate'),
  }),
  t.Object({
    links: t.Array(ErrorLinkSchema),
    message: t.String(),
    type: t.Literal('duplicated_sdc_not_updated'),
  }),
  t.Object({
    links: t.Array(ErrorLinkSchema),
    message: t.String(),
    type: t.Literal('duplicated_sdc_updated'),
  }),
  t.Object({ message: t.String(), type: t.Literal('error') }),
  t.Object({ message: t.String(), type: t.Literal('title_blacklisted') }),
  t.Object({ message: t.String() }),
])

export const MediaImageSchema = t.Object({
  id: t.String(),
  title: t.String(),
  dates: DatesSchema,
  creator: CreatorSchema,
  location: GeoLocationSchema,
  urls: ImageUrlsSchema,
  dimensions: ImageDimensionsSchema,
  camera: CameraInfoSchema,
  existing: t.Array(ExistingPageSchema),
  description: t.Optional(t.Nullable(t.String())),
  license: t.Optional(t.Nullable(t.String())),
  tags: t.Optional(t.Nullable(t.Array(t.String()))),
})

export const BatchStatsSchema = t.Object({
  queued: t.Integer({ default: 0 }),
  in_progress: t.Integer({ default: 0 }),
  completed: t.Integer({ default: 0 }),
  failed: t.Integer({ default: 0 }),
  cancelled: t.Integer({ default: 0 }),
  duplicate: t.Integer({ default: 0 }),
  total: t.Integer({ default: 0 }),
})

export const BatchItemSchema = t.Object({
  id: t.Integer(),
  created_at: t.String(),
  updated_at: t.String(),
  edit_group_id: t.Nullable(t.String()),
  username: t.String(),
  userid: t.String(),
  stats: BatchStatsSchema,
})

export const BatchUploadItemSchema = t.Object({
  id: t.Integer(),
  batchid: t.Integer(),
  status: UploadStatusSchema,
  key: t.String(),
  handler: HandlerSchema,
  filename: t.String(),
  wikitext: t.String(),
  error: t.Nullable(StructuredErrorSchema),
  success: t.Nullable(t.String()),
})

export const UploadUpdateItemSchema = t.Object({
  id: t.Integer(),
  batchid: t.Integer(),
  status: UploadStatusSchema,
  key: t.String(),
  error: t.Nullable(StructuredErrorSchema),
  success: t.Nullable(t.String()),
  handler: HandlerSchema,
})

export const UploadCreatedItemSchema = t.Object({
  id: t.Integer(),
  status: UploadStatusSchema,
  image_id: t.String(),
  input: t.String(),
  batchid: t.Integer(),
})

export const UploadSliceAckItemSchema = t.Object({
  id: t.String(),
  status: UploadStatusSchema,
})

export const PresetItemSchema = t.Object({
  id: t.Integer(),
  title: t.String(),
  title_template: t.String(),
  labels: t.Optional(t.Nullable(LabelSchema)),
  categories: t.String(),
  exclude_from_date_category: t.Boolean(),
  handler: HandlerSchema,
  is_default: t.Boolean(),
  created_at: t.String(),
  updated_at: t.String(),
})

export const UploadItemSchema = t.Object({
  id: t.String(),
  input: t.String(),
  title: t.String(),
  wikitext: t.String(),
  labels: t.Optional(t.Nullable(LabelSchema)),
  copyright_override: t.Optional(t.Boolean()),
})

// ============================================================
// Client Message Schemas (browser → server)
// ============================================================

export const FetchBatchesSchema = t.Object({
  type: t.Literal('FETCH_BATCHES'),
  data: t.Object({
    page: t.Integer({ default: 1, minimum: 1 }),
    limit: t.Integer({ default: 100, minimum: 1 }),
    userid: t.Optional(t.String()),
    filter: t.Optional(t.String()),
  }),
})

export const FetchBatchUploadsSchema = t.Object({
  type: t.Literal('FETCH_BATCH_UPLOADS'),
  data: t.Object({
    batch_id: t.Integer(),
    page_size: t.Integer(),
  }),
})

export const FetchBatchSchema = t.Object({
  type: t.Literal('FETCH_BATCH'),
  data: t.Integer(),
})

export const RetryUploadsSchema = t.Object({
  type: t.Literal('RETRY_UPLOADS'),
  data: t.Integer(),
})

export const CancelBatchSchema = t.Object({
  type: t.Literal('CANCEL_BATCH'),
  data: t.Integer(),
})

export const SubscribeBatchSchema = t.Object({
  type: t.Literal('SUBSCRIBE_BATCH'),
  data: t.Integer(),
})

export const SubscribeBatchesListSchema = t.Object({
  type: t.Literal('SUBSCRIBE_BATCHES_LIST'),
  data: t.Object({
    userid: t.Optional(t.String()),
    filter: t.Optional(t.String()),
  }),
})

export const UnsubscribeBatchSchema = t.Object({
  type: t.Literal('UNSUBSCRIBE_BATCH'),
})

export const UnsubscribeBatchesListSchema = t.Object({
  type: t.Literal('UNSUBSCRIBE_BATCHES_LIST'),
})

export const CreateBatchSchema = t.Object({
  type: t.Literal('CREATE_BATCH'),
})

export const DeletePresetSchema = t.Object({
  type: t.Literal('DELETE_PRESET'),
  data: t.Object({
    preset_id: t.Integer(),
  }),
})

export const FetchImagesSchema = t.Object({
  type: t.Literal('FETCH_IMAGES'),
  data: t.String(),
  handler: t.Literal('mapillary'),
})

export const FetchPresetsSchema = t.Object({
  type: t.Literal('FETCH_PRESETS'),
  data: t.Object({
    handler: t.Literal('mapillary'),
  }),
})

export const SavePresetSchema = t.Object({
  type: t.Literal('SAVE_PRESET'),
  data: t.Object({
    preset_id: t.Optional(t.Integer()),
    title: t.String(),
    title_template: t.String(),
    labels: t.Optional(t.Nullable(LabelSchema)),
    categories: t.String(),
    exclude_from_date_category: t.Optional(t.Boolean()),
    is_default: t.Optional(t.Boolean()),
    handler: HandlerSchema,
  }),
})

export const UploadSliceSchema = t.Object({
  type: t.Literal('UPLOAD_SLICE'),
  data: t.Object({
    batchid: t.Integer(),
    sliceid: t.Integer(),
    items: t.Array(UploadItemSchema),
    handler: t.Optional(HandlerSchema),
  }),
})

export const CheckCategoriesDeletedSchema = t.Object({
  type: t.Literal('CHECK_CATEGORIES_DELETED'),
  data: t.Object({
    titles: t.Array(t.String()),
  }),
})

export const CreateCategorySchema = t.Object({
  type: t.Literal('CREATE_CATEGORY'),
  data: t.Object({
    title: t.String(),
    text: t.String(),
    wikidata_qid: t.Optional(t.String()),
  }),
})

export const RecategorizeFilesSchema = t.Object({
  type: t.Literal('RECATEGORIZE_FILES'),
  data: t.Object({
    source: t.String(),
    target: t.String(),
  }),
})

// ============================================================
// Server Message Schemas (server → browser)
// ============================================================

export const BatchesListSchema = t.Object({
  type: t.Literal('BATCHES_LIST'),
  data: t.Object({
    items: t.Array(BatchItemSchema),
    total: t.Integer(),
  }),
  partial: t.Boolean(),
  nonce: t.String(),
})

export const BatchUploadsListSchema = t.Object({
  type: t.Literal('BATCH_UPLOADS_LIST'),
  data: t.Object({
    batch_id: t.Integer(),
    uploads: t.Array(BatchUploadItemSchema),
    partial: t.Boolean(),
  }),
  nonce: t.String(),
})

export const BatchInfoSchema = t.Object({
  type: t.Literal('BATCH_INFO'),
  data: t.Object({
    batch: BatchItemSchema,
  }),
})

export const CollectionImagesSchema = t.Object({
  type: t.Literal('COLLECTION_IMAGES'),
  data: t.Object({
    images: t.Array(MediaImageSchema),
    creator: CreatorSchema,
    sequence_id: t.String(),
  }),
  nonce: t.String(),
})

export const CollectionImageIdsSchema = t.Object({
  type: t.Literal('COLLECTION_IMAGE_IDS'),
  data: t.Array(t.String()),
  nonce: t.String(),
})

export const PartialCollectionImagesSchema = t.Object({
  type: t.Literal('PARTIAL_COLLECTION_IMAGES'),
  data: t.Object({
    images: t.Array(MediaImageSchema),
    collection: t.String(),
  }),
  nonce: t.String(),
})

export const BatchCreatedSchema = t.Object({
  type: t.Literal('BATCH_CREATED'),
  data: t.Integer(),
  nonce: t.String(),
})

export const SubscribedSchema = t.Object({
  type: t.Literal('SUBSCRIBED'),
  data: t.Integer(),
  nonce: t.String(),
})

export const UploadsUpdateSchema = t.Object({
  type: t.Literal('UPLOADS_UPDATE'),
  data: t.Array(UploadUpdateItemSchema),
  partial: t.Boolean(),
  nonce: t.String(),
})

export const UploadsCompleteSchema = t.Object({
  type: t.Literal('UPLOADS_COMPLETE'),
  data: t.Integer(),
  nonce: t.String(),
})

export const UploadCreatedSchema = t.Object({
  type: t.Literal('UPLOAD_CREATED'),
  data: t.Array(UploadCreatedItemSchema),
  nonce: t.String(),
})

export const UploadSliceAckSchema = t.Object({
  type: t.Literal('UPLOAD_SLICE_ACK'),
  data: t.Array(UploadSliceAckItemSchema),
  sliceid: t.Integer(),
  nonce: t.String(),
})

export const PresetsListSchema = t.Object({
  type: t.Literal('PRESETS_LIST'),
  data: t.Object({
    handler: t.String(),
    presets: t.Array(PresetItemSchema),
  }),
  nonce: t.String(),
})

export const CategoriesDeletedResponseSchema = t.Object({
  type: t.Literal('CATEGORIES_DELETED_RESPONSE'),
  data: t.Object({
    deleted: t.Array(t.String()),
  }),
  nonce: t.String(),
})

export const CategoryCreatedResponseSchema = t.Object({
  type: t.Literal('CATEGORY_CREATED_RESPONSE'),
  data: t.Object({
    title: t.String(),
  }),
  nonce: t.String(),
})

export const RecategorizeFilesResponseSchema = t.Object({
  type: t.Literal('RECATEGORIZE_FILES_RESPONSE'),
  data: t.Object({
    source: t.String(),
    count: t.Integer(),
  }),
  nonce: t.String(),
})

export const RetryUploadsResponseSchema = t.Object({
  type: t.Literal('RETRY_UPLOADS_RESPONSE'),
  data: t.Integer(),
  nonce: t.String(),
})

export const TryBatchRetrievalSchema = t.Object({
  type: t.Literal('TRY_BATCH_RETRIEVAL'),
  data: t.String(),
  nonce: t.String(),
})

export const ErrorSchema = t.Object({
  type: t.Literal('ERROR'),
  data: t.String(),
  nonce: t.String(),
})

// ============================================================
// Discriminated Unions
// ============================================================

export const ClientMessage = t.Union([
  FetchBatchesSchema,
  FetchBatchUploadsSchema,
  FetchBatchSchema,
  RetryUploadsSchema,
  CancelBatchSchema,
  SubscribeBatchSchema,
  SubscribeBatchesListSchema,
  UnsubscribeBatchSchema,
  UnsubscribeBatchesListSchema,
  CreateBatchSchema,
  DeletePresetSchema,
  FetchImagesSchema,
  FetchPresetsSchema,
  SavePresetSchema,
  UploadSliceSchema,
  CheckCategoriesDeletedSchema,
  CreateCategorySchema,
  RecategorizeFilesSchema,
])

export const ServerMessage = t.Union([
  BatchesListSchema,
  BatchUploadsListSchema,
  BatchInfoSchema,
  CollectionImagesSchema,
  CollectionImageIdsSchema,
  PartialCollectionImagesSchema,
  BatchCreatedSchema,
  SubscribedSchema,
  UploadsUpdateSchema,
  UploadsCompleteSchema,
  UploadCreatedSchema,
  UploadSliceAckSchema,
  PresetsListSchema,
  CategoriesDeletedResponseSchema,
  CategoryCreatedResponseSchema,
  RecategorizeFilesResponseSchema,
  RetryUploadsResponseSchema,
  TryBatchRetrievalSchema,
  ErrorSchema,
])

// ============================================================
// TypeScript Types
// ============================================================

export type ClientMessage = Static<typeof ClientMessage>
export type ServerMessage = Static<typeof ServerMessage>

export type Handler = Static<typeof HandlerSchema>
export type UploadStatus = Static<typeof UploadStatusSchema>

export type Label = Static<typeof LabelSchema>
export type ExistingPage = Static<typeof ExistingPageSchema>
export type CameraInfo = Static<typeof CameraInfoSchema>
export type ImageDimensions = Static<typeof ImageDimensionsSchema>
export type ImageUrls = Static<typeof ImageUrlsSchema>
export type Creator = Static<typeof CreatorSchema>
export type Dates = Static<typeof DatesSchema>
export type GeoLocation = Static<typeof GeoLocationSchema>
export type MediaImage = Static<typeof MediaImageSchema>
export type BatchStats = Static<typeof BatchStatsSchema>
export type BatchItem = Static<typeof BatchItemSchema>
export type BatchUploadItem = Static<typeof BatchUploadItemSchema>
export type UploadUpdateItem = Static<typeof UploadUpdateItemSchema>
export type UploadCreatedItem = Static<typeof UploadCreatedItemSchema>
export type UploadSliceAckItem = Static<typeof UploadSliceAckItemSchema>
export type PresetItem = Static<typeof PresetItemSchema>
export type UploadItem = Static<typeof UploadItemSchema>
export type SavePreset = Static<typeof SavePresetSchema>
export type FetchImages = Static<typeof FetchImagesSchema>
export type PresetsList = Static<typeof PresetsListSchema>
export type ErrorLink = Static<typeof ErrorLinkSchema>
export type StructuredError = Static<typeof StructuredErrorSchema>
