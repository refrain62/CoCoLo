import {
  DeleteObjectCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_SESSION_TTL_SECONDS,
  type AttachmentMediaType,
  type StoredAttachmentObject,
} from '@cocolo/domain/attachment';
import type {
  AttachmentObjectMetadata,
  AttachmentStorage,
  SignedDownload,
  SignedUpload,
} from './attachment-storage.js';

type AppEnvironment = 'local' | 'staging' | 'production';

type R2EnvironmentInput = Record<string, string | undefined>;

export type R2AttachmentStorageConfig = {
  appEnv: AppEnvironment;
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
};

export type R2AttachmentStorage = AttachmentStorage & {
  createSignedDelete: (input: {
    objectKey: string;
    expiresAt: Date;
  }) => Promise<{
    url: string;
    expiresAt: Date;
  }>;
};

const allowedBuckets: Record<AppEnvironment, string> = {
  local: 'cocolo-local',
  staging: 'cocolo-staging-private',
  production: 'cocolo-production-private',
};

const objectKeyPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/attachments\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class R2AttachmentStorageConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'R2AttachmentStorageConfigurationError';
  }
}

export class R2AttachmentStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'R2AttachmentStorageError';
  }
}

function required(environment: R2EnvironmentInput, name: string): string {
  const value = environment[name]?.trim();
  if (!value)
    throw new R2AttachmentStorageConfigurationError(`${name} が必要です。`);
  return value;
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  );
}

function assertEndpoint(appEnv: AppEnvironment, endpoint: string) {
  const parsed = new URL(endpoint);
  if (appEnv === 'local' && isLoopback(parsed.hostname)) return;
  if (appEnv !== 'local' && isLoopback(parsed.hostname))
    throw new R2AttachmentStorageConfigurationError(
      'staging / production の R2_ENDPOINT にローカルURLは使用できません。',
    );
  if (parsed.protocol !== 'https:')
    throw new R2AttachmentStorageConfigurationError(
      'R2_ENDPOINT には HTTPS のS3互換エンドポイントが必要です。',
    );
}

export function readR2AttachmentStorageConfig(
  environment: R2EnvironmentInput,
): R2AttachmentStorageConfig {
  const appEnv = environment.APP_ENV?.trim();
  if (appEnv !== 'local' && appEnv !== 'staging' && appEnv !== 'production')
    throw new R2AttachmentStorageConfigurationError(
      'APP_ENV には local / staging / production のいずれかを指定してください。',
    );

  const endpoint = required(environment, 'R2_ENDPOINT').replace(/\/$/, '');
  const bucket = required(environment, 'R2_BUCKET');
  const accessKeyId = required(environment, 'R2_ACCESS_KEY_ID');
  const secretAccessKey = required(environment, 'R2_SECRET_ACCESS_KEY');
  const region = environment.R2_REGION?.trim() || 'auto';

  assertEndpoint(appEnv, endpoint);
  if (bucket !== allowedBuckets[appEnv])
    throw new R2AttachmentStorageConfigurationError(
      'R2_BUCKET が環境の許可値と一致しません。',
    );
  if (accessKeyId.length < 8 || secretAccessKey.length < 8)
    throw new R2AttachmentStorageConfigurationError(
      'R2アクセスキーが短すぎます。',
    );

  return { appEnv, endpoint, bucket, accessKeyId, secretAccessKey, region };
}

function assertObjectKey(objectKey: string) {
  if (!objectKeyPattern.test(objectKey))
    throw new R2AttachmentStorageError(
      '添付オブジェクトキーのtenant/attachment境界が不正です。',
    );
}

function assertUploadInput(input: {
  mediaType: AttachmentMediaType;
  byteSize: number;
}) {
  if (!Number.isInteger(input.byteSize) || input.byteSize <= 0)
    throw new R2AttachmentStorageError('添付サイズが不正です。');
  if (input.byteSize > ATTACHMENT_MAX_BYTES)
    throw new R2AttachmentStorageError('添付サイズが上限を超えています。');
}

function signedUrlSeconds(now: Date, expiresAt: Date): number {
  const seconds = Math.floor((expiresAt.getTime() - now.getTime()) / 1000);
  if (!Number.isFinite(seconds) || seconds <= 0)
    throw new R2AttachmentStorageError('署名URL期限が現在時刻以前です。');
  if (seconds > ATTACHMENT_SESSION_TTL_SECONDS)
    throw new R2AttachmentStorageError('署名URL期限が許可上限を超えています。');
  return seconds;
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof S3ServiceException &&
    (error.$metadata.httpStatusCode === 404 ||
      error.name === 'NotFound' ||
      error.name === 'NoSuchKey')
  );
}

async function bodyToBytes(
  body: GetObjectCommandOutput['Body'],
): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  if (
    typeof body === 'object' &&
    'transformToByteArray' in body &&
    typeof body.transformToByteArray === 'function'
  )
    return body.transformToByteArray();

  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array | string>) {
    chunks.push(
      typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk,
    );
  }
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function createClient(config: R2AttachmentStorageConfig): S3Client {
  return new S3Client({
    region: config.region ?? 'auto',
    endpoint: config.endpoint,
    forcePathStyle: true,
    maxAttempts: 1,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export function createR2AttachmentStorage(
  config: R2AttachmentStorageConfig,
  options: { now?: () => Date; client?: S3Client } = {},
): R2AttachmentStorage {
  const client = options.client ?? createClient(config);
  const now = options.now ?? (() => new Date());

  async function readObjectMetadata({
    objectKey,
  }: {
    objectKey: string;
  }): Promise<AttachmentObjectMetadata | null> {
    assertObjectKey(objectKey);
    try {
      const head = await client.send(
        new HeadObjectCommand({
          Bucket: config.bucket,
          Key: objectKey,
        }),
      );
      if (head.ContentLength === undefined || head.ContentLength < 0)
        throw new R2AttachmentStorageError(
          'R2オブジェクトのサイズメタデータが不正です。',
        );
      if (head.ContentLength > ATTACHMENT_MAX_BYTES)
        throw new R2AttachmentStorageError(
          'R2オブジェクトが添付サイズ上限を超えています。',
        );
      return {
        byteSize: head.ContentLength,
        contentType: head.ContentType ?? 'application/octet-stream',
        metadata: { ...(head.Metadata ?? {}) },
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async function assertAbsent(objectKey: string) {
    const metadata = await readObjectMetadata({ objectKey });
    if (metadata)
      throw new R2AttachmentStorageError(
        'R2オブジェクトが既に存在するため署名しません。',
      );
  }

  async function assertPresent(objectKey: string) {
    const metadata = await readObjectMetadata({ objectKey });
    if (!metadata)
      throw new R2AttachmentStorageError(
        'R2オブジェクトが存在しないため署名しません。',
      );
  }

  return {
    async createSignedUpload(input): Promise<SignedUpload> {
      assertObjectKey(input.objectKey);
      assertUploadInput(input);
      await assertAbsent(input.objectKey);
      const expiresIn = signedUrlSeconds(now(), input.expiresAt);
      const command = new PutObjectCommand({
        Bucket: config.bucket,
        Key: input.objectKey,
        ContentType: input.mediaType,
        ContentLength: input.byteSize,
        IfNoneMatch: '*',
        Metadata: {
          'cocolo-byte-size': String(input.byteSize),
          'cocolo-content-type': input.mediaType,
        },
      });
      return {
        url: await getSignedUrl(client, command, { expiresIn }),
        expiresAt: input.expiresAt,
      };
    },
    readObjectMetadata,
    async readObject({ objectKey }): Promise<StoredAttachmentObject | null> {
      const metadata = await readObjectMetadata({ objectKey });
      if (!metadata) return null;
      const object = await client.send(
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: objectKey,
        }),
      );
      const bytes = await bodyToBytes(object.Body);
      if (bytes.length !== metadata.byteSize)
        throw new R2AttachmentStorageError(
          'R2オブジェクト本文とサイズメタデータが一致しません。',
        );
      return {
        bytes,
        contentType: object.ContentType ?? metadata.contentType,
      };
    },
    async createSignedDownload(input): Promise<SignedDownload> {
      assertObjectKey(input.objectKey);
      await assertPresent(input.objectKey);
      const expiresIn = signedUrlSeconds(now(), input.expiresAt);
      const command = new GetObjectCommand({
        Bucket: config.bucket,
        Key: input.objectKey,
      });
      return {
        url: await getSignedUrl(client, command, { expiresIn }),
        expiresAt: input.expiresAt,
      };
    },
    async createSignedDelete(input) {
      assertObjectKey(input.objectKey);
      const expiresIn = signedUrlSeconds(now(), input.expiresAt);
      const command = new DeleteObjectCommand({
        Bucket: config.bucket,
        Key: input.objectKey,
      });
      return {
        url: await getSignedUrl(client, command, { expiresIn }),
        expiresAt: input.expiresAt,
      };
    },
    async deleteObject({ objectKey }) {
      assertObjectKey(objectKey);
      const expiresAt = new Date(now().getTime() + 60_000);
      const signed = await this.createSignedDelete({ objectKey, expiresAt });
      const response = await fetch(signed.url, { method: 'DELETE' });
      if (!response.ok && response.status !== 404)
        throw new R2AttachmentStorageError(
          'R2オブジェクト削除に失敗しました。',
        );
    },
  };
}

export function createR2AttachmentStorageFromEnv(
  environment: R2EnvironmentInput,
  options: { now?: () => Date; client?: S3Client } = {},
): R2AttachmentStorage {
  return createR2AttachmentStorage(
    readR2AttachmentStorageConfig(environment),
    options,
  );
}
