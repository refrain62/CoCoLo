import type {
  AttachmentObjectMetadata,
  AttachmentStorage,
  SignedDownload,
  SignedUpload,
} from './attachment-storage.js';

type Stored = {
  bytes: Uint8Array;
  contentType: string;
  metadata: Record<string, string>;
};

type SignedObject = {
  objectKey: string;
  mode: 'upload' | 'download' | 'delete';
  expiresAt: Date;
};

export type FakeAttachmentStorage = AttachmentStorage & {
  put: (url: string, bytes: Uint8Array, contentType: string) => void;
  objects: ReadonlyMap<string, Stored>;
  deletedObjectKeys: readonly string[];
};

// local/test用adapter。R2実接続とは別に、期限切れ署名・上書き不可・cleanupを再現する。
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
      if (objects.has(input.objectKey))
        throw new Error('fakeストレージは既存オブジェクトへ署名しません。');
      return {
        url: issueUrl({
          objectKey: input.objectKey,
          mode: 'upload',
          expiresAt: input.expiresAt,
        }),
        expiresAt: input.expiresAt,
      };
    },
    async readObjectMetadata({
      objectKey,
    }): Promise<AttachmentObjectMetadata | null> {
      const stored = objects.get(objectKey);
      return stored
        ? {
            byteSize: stored.bytes.length,
            contentType: stored.contentType,
            metadata: { ...stored.metadata },
          }
        : null;
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
      if (!objects.has(input.objectKey))
        throw new Error('fakeストレージに対象オブジェクトがありません。');
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
      const url = issueUrl({
        objectKey,
        mode: 'delete',
        expiresAt: new Date(now().getTime() + 60_000),
      });
      resolve(url, 'delete');
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
        metadata: {
          'cocolo-byte-size': String(bytes.length),
          'cocolo-content-type': contentType,
        },
      });
    },
    objects,
    deletedObjectKeys,
  };
}
