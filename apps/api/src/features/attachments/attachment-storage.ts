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

export type AttachmentStorage = {
  createSignedUpload: (input: {
    objectKey: string;
    mediaType: AttachmentMediaType;
    byteSize: number;
    expiresAt: Date;
  }) => Promise<SignedUpload>;
  readObject: (input: {
    objectKey: string;
  }) => Promise<StoredAttachmentObject | null>;
  createSignedDownload: (input: {
    objectKey: string;
    expiresAt: Date;
  }) => Promise<SignedDownload>;
  deleteObject: (input: { objectKey: string }) => Promise<void>;
};
