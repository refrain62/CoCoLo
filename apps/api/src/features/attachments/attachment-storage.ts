import type {
  AttachmentMediaType,
  StoredAttachmentObject,
} from '@cocolo/domain/attachment';

export type SignedUpload = {
  url: string;
  expiresAt: Date;
};

export type SignedDownload = {
  url: string;
  expiresAt: Date;
};

export type AttachmentObjectMetadata = {
  byteSize: number;
  contentType: string;
  metadata: Readonly<Record<string, string>>;
};
export type AttachmentStorage = {
  createSignedUpload: (input: {
    objectKey: string;
    mediaType: AttachmentMediaType;
    byteSize: number;
    expiresAt: Date;
  }) => Promise<SignedUpload>;
  readObjectMetadata?: (input: {
    objectKey: string;
  }) => Promise<AttachmentObjectMetadata | null>;
  readObject: (input: {
    objectKey: string;
  }) => Promise<StoredAttachmentObject | null>;
  createSignedDownload: (input: {
    objectKey: string;
    expiresAt: Date;
  }) => Promise<SignedDownload>;
  deleteObject: (input: { objectKey: string }) => Promise<void>;
};
