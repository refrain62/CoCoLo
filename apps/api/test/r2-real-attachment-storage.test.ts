import assert from 'node:assert/strict';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import test from 'node:test';
import {
  createFakeAttachmentStorage,
  type FakeAttachmentStorage,
} from '../dist/features/attachments/fake-attachment-storage.js';
import {
  createR2AttachmentStorage,
  R2AttachmentStorageConfigurationError,
  R2AttachmentStorageError,
  readR2AttachmentStorageConfig,
} from '../dist/features/attachments/r2-real-attachment-storage.js';

const TENANT_ID = '00000000-0000-7000-8000-000000000001';
const ATTACHMENT_ID = '00000000-0000-7000-8000-000000000101';
const OBJECT_KEY = `${TENANT_ID}/attachments/${ATTACHMENT_ID}`;
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01,
]);

type RequestRecord = {
  method: string;
  url: URL;
};

async function startStub(
  handler: (
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ) => void,
) {
  const requests: RequestRecord[] = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    requests.push({ method: request.method ?? 'GET', url });
    handler(request, response, url);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address === 'object');
  return {
    endpoint: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function config(endpoint: string) {
  return readR2AttachmentStorageConfig({
    APP_ENV: 'local',
    R2_ENDPOINT: endpoint,
    R2_BUCKET: 'cocolo-local',
    R2_ACCESS_KEY_ID: 'local-access-key',
    R2_SECRET_ACCESS_KEY: 'local-secret-key',
  });
}

test('R2環境変数はAPP_ENVごとにfail-closedで検証する', () => {
  assert.throws(
    () =>
      readR2AttachmentStorageConfig({
        APP_ENV: 'production',
        R2_ENDPOINT: 'http://127.0.0.1:9000',
        R2_BUCKET: 'cocolo-production-private',
        R2_ACCESS_KEY_ID: 'production-access-key',
        R2_SECRET_ACCESS_KEY: 'production-secret-key',
      }),
    R2AttachmentStorageConfigurationError,
  );
  assert.throws(
    () =>
      readR2AttachmentStorageConfig({
        APP_ENV: 'staging',
        R2_ENDPOINT:
          'https://00000000000000000000000000000000.r2.cloudflarestorage.com',
        R2_BUCKET: 'cocolo-production-private',
        R2_ACCESS_KEY_ID: 'staging-access-key',
        R2_SECRET_ACCESS_KEY: 'staging-secret-key',
      }),
    /R2_BUCKET が環境の許可値と一致しません。/,
  );
});

test('署名PUTは既存objectを確認し、期限とprivate bucketのkeyだけを含める', async () => {
  const stub = await startStub((_request, response) => {
    response.statusCode = 404;
    response.setHeader('content-type', 'application/xml');
    response.end('<Error><Code>NoSuchKey</Code></Error>');
  });
  try {
    const storage = createR2AttachmentStorage(config(stub.endpoint), {
      now: () => new Date('2026-08-22T00:00:00.000Z'),
    });
    const signed = await storage.createSignedUpload({
      objectKey: OBJECT_KEY,
      mediaType: 'image/png',
      byteSize: PNG.length,
      expiresAt: new Date('2026-08-22T00:02:00.000Z'),
    });
    const url = new URL(signed.url);
    assert.equal(url.origin, stub.endpoint);
    assert.equal(url.pathname, `/cocolo-local/${OBJECT_KEY}`);
    assert.equal(url.searchParams.get('X-Amz-Expires'), '120');
    assert.ok(url.searchParams.has('X-Amz-Signature'));
    assert.ok(!signed.url.includes('local-secret-key'));
    assert.deepEqual(
      stub.requests.map((request) => request.method),
      ['HEAD'],
    );
  } finally {
    await stub.close();
  }
});

test('既存objectと長すぎる署名期限にはPUT署名を発行しない', async () => {
  let headCount = 0;
  const stub = await startStub((_request, response) => {
    headCount += 1;
    if (headCount === 1) {
      response.statusCode = 200;
      response.setHeader('content-length', String(PNG.length));
      response.setHeader('content-type', 'image/png');
      response.end();
      return;
    }
    response.statusCode = 404;
    response.setHeader('content-type', 'application/xml');
    response.end();
  });
  try {
    const storage = createR2AttachmentStorage(config(stub.endpoint), {
      now: () => new Date('2026-08-22T00:00:00.000Z'),
    });
    await assert.rejects(
      storage.createSignedUpload({
        objectKey: OBJECT_KEY,
        mediaType: 'image/png',
        byteSize: PNG.length,
        expiresAt: new Date('2026-08-22T00:02:00.000Z'),
      }),
      R2AttachmentStorageError,
    );
    await assert.rejects(
      storage.createSignedUpload({
        objectKey: OBJECT_KEY,
        mediaType: 'image/png',
        byteSize: PNG.length,
        expiresAt: new Date('2026-08-22T00:20:00.000Z'),
      }),
      R2AttachmentStorageError,
    );
  } finally {
    await stub.close();
  }
});

test('object存在とmetadataを確認してからGET署名と実体読み取りを行う', async () => {
  const stub = await startStub((request, response) => {
    if (request.method === 'HEAD') {
      response.statusCode = 200;
      response.setHeader('content-length', String(PNG.length));
      response.setHeader('content-type', 'image/png');
      response.setHeader('x-amz-meta-cocolo-byte-size', String(PNG.length));
      response.end();
      return;
    }
    response.statusCode = 200;
    response.setHeader('content-length', String(PNG.length));
    response.setHeader('content-type', 'image/png');
    response.end(PNG);
  });
  try {
    const storage = createR2AttachmentStorage(config(stub.endpoint), {
      now: () => new Date('2026-08-22T00:00:00.000Z'),
    });
    assert.deepEqual(
      await storage.readObjectMetadata?.({ objectKey: OBJECT_KEY }),
      {
        byteSize: PNG.length,
        contentType: 'image/png',
        metadata: { 'cocolo-byte-size': String(PNG.length) },
      },
    );
    assert.deepEqual(await storage.readObject({ objectKey: OBJECT_KEY }), {
      bytes: PNG,
      contentType: 'image/png',
    });
    const signed = await storage.createSignedDownload({
      objectKey: OBJECT_KEY,
      expiresAt: new Date('2026-08-22T00:05:00.000Z'),
    });
    const url = new URL(signed.url);
    assert.equal(url.searchParams.get('X-Amz-Expires'), '300');
    assert.ok(url.searchParams.has('X-Amz-Signature'));
  } finally {
    await stub.close();
  }
});

test('DELETEは短期署名URLで実行し、404は安全な冪等削除として扱う', async () => {
  const stub = await startStub((request, response, url) => {
    if (request.method === 'DELETE') {
      assert.ok(url.searchParams.has('X-Amz-Signature'));
      response.statusCode = 404;
      response.end();
      return;
    }
    response.statusCode = 500;
    response.end();
  });
  try {
    const storage = createR2AttachmentStorage(config(stub.endpoint), {
      now: () => new Date('2026-08-22T00:00:00.000Z'),
    });
    await storage.deleteObject({ objectKey: OBJECT_KEY });
    assert.deepEqual(
      stub.requests.map((request) => request.method),
      ['DELETE'],
    );
  } finally {
    await stub.close();
  }
});

test('fake/local adapterは期限切れ署名と上書きをR2実接続adapterと別に検証する', async () => {
  let current = new Date('2026-08-22T00:00:00.000Z');
  const storage: FakeAttachmentStorage = createFakeAttachmentStorage(
    () => current,
  );
  const signed = await storage.createSignedUpload({
    objectKey: OBJECT_KEY,
    mediaType: 'image/png',
    byteSize: PNG.length,
    expiresAt: new Date('2026-08-22T00:01:00.000Z'),
  });
  storage.put(signed.url, PNG, 'image/png');
  assert.throws(() => storage.put(signed.url, PNG, 'image/png'), /上書き/);
  current = new Date('2026-08-22T00:02:00.000Z');
  assert.throws(() => storage.put(signed.url, PNG, 'image/png'), /期限切れ/);
});
