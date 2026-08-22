import type {
  AttachmentMediaType,
  StoredAttachmentObject,
} from '@cocolo/domain/attachment';
import type {
  AttachmentStorage,
  SignedDownload,
  SignedUpload,
} from './attachment-storage.js';

export type R2AttachmentBindings = {
  signUpload: (input: {
    objectKey: string;
    mediaType: AttachmentMediaType;
    byteSize: number;
    expiresAt: Date;
  }) => Promise<SignedUpload>;
  read: (input: {
    objectKey: string;
  }) => Promise<StoredAttachmentObject | null>;
  signDownload: (input: {
    objectKey: string;
    expiresAt: Date;
  }) => Promise<SignedDownload>;
  remove: (input: { objectKey: string }) => Promise<void>;
};

// Cloudflare固有のSDKをAPIへ漏らさず、署名・読み取り・削除だけをR2 adapterへ委譲する。
export function createR2AttachmentStorage(
  bindings: R2AttachmentBindings,
): AttachmentStorage {
  return {
    createSignedUpload: bindings.signUpload,
    readObject: bindings.read,
    createSignedDownload: bindings.signDownload,
    deleteObject: bindings.remove,
  };
}
