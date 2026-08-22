import type {
  AttachmentStorage,
  SignedDownload,
  SignedUpload,
} from './attachment-storage.js';

type Stored = {
  bytes: Uint8Array;
  contentType: string;
};

type SignedObject = {
  objectKey: string;
  mode: 'upload' | 'download';
  expiresAt: Date;
};

export type FakeAttachmentStorage = AttachmentStorage & {
  put: (url: string, bytes: Uint8Array, contentType: string) => void;
  objects: ReadonlyMap<string, Stored>;
  deletedObjectKeys: readonly string[];
};

// local検証ではR2を公開せず、署名URLの対象・期限・PUT経路を同じ境界で再現する。
export function createFakeAttachmentStorage(
  now: () => Date = () => new Date(),
): FakeAttachmentStorage {
  const objects = new Map<string, Stored>();
  const signedObjects = new Map<string, SignedObject>();
  const deletedObjectKeys: string[] = [];

  function issueUrl(input: SignedObject): string {
    const token = `fake-${signedObjects.size + 1}`;
    signedObjects.set(token, input);
    return `https://fake-r2.local/${input.mode}/${token}`;
  }

  function resolve(url: string, mode: SignedObject['mode']): SignedObject {
    const token = new URL(url).pathname.split('/').at(-1);
    const signed = token ? signedObjects.get(token) : undefined;
    if (!signed || signed.mode !== mode || signed.expiresAt <= now())
      throw new Error('fake署名URLが無効または期限切れです。');
    return signed;
  }

  return {
    async createSignedUpload(input): Promise<SignedUpload> {
      return {
        url: issueUrl({
          objectKey: input.objectKey,
          mode: 'upload',
          expiresAt: input.expiresAt,
        }),
        expiresAt: input.expiresAt,
      };
    },
    async readObject({ objectKey }) {
      const stored = objects.get(objectKey);
      return stored
        ? {
            bytes: new Uint8Array(stored.bytes),
            contentType: stored.contentType,
          }
        : null;
    },
    async createSignedDownload(input): Promise<SignedDownload> {
      return {
        url: issueUrl({
          objectKey: input.objectKey,
          mode: 'download',
          expiresAt: input.expiresAt,
        }),
        expiresAt: input.expiresAt,
      };
    },
    async deleteObject({ objectKey }) {
      objects.delete(objectKey);
      deletedObjectKeys.push(objectKey);
    },
    put(url, bytes, contentType) {
      const signed = resolve(url, 'upload');
      if (objects.has(signed.objectKey))
        throw new Error('fakeストレージは既存オブジェクトを上書きしません。');
      objects.set(signed.objectKey, {
        bytes: new Uint8Array(bytes),
        contentType,
      });
    },
    objects,
    deletedObjectKeys,
  };
}
