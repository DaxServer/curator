export interface DuplicateLink {
  title: string
  url: string
}

export class DuplicateUploadError extends Error {
  duplicates: DuplicateLink[]

  constructor(duplicates: DuplicateLink[], message: string) {
    super(message)
    this.name = 'DuplicateUploadError'
    this.duplicates = duplicates
  }
}

export class HashLockError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HashLockError'
  }
}

export class StorageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorageError'
  }
}

export class SourceCdnError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SourceCdnError'
  }
}

export class MediaWikiServerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MediaWikiServerError'
  }
}
