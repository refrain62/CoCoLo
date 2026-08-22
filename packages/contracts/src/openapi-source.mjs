import {
  MAX_UPLOAD_BYTES,
  UPLOAD_SESSION_TTL_SECONDS,
} from './upload-contract.mjs';

export const openapiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'CoCoLo API',
    version: '1.0.0',
  },
  servers: [{ url: '/api/v1' }],
  security: [{ bearerAuth: [] }],
  paths: {
    '/uploads': {
      post: {
        operationId: 'createUploadSession',
        summary: '添付アップロードセッションを作成',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UploadSessionInput' },
            },
          },
        },
        responses: {
          201: {
            description: '署名URLを発行',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UploadSessionResponse' },
              },
            },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/uploads/{id}/complete': {
      post: {
        operationId: 'completeUpload',
        summary: '添付アップロードを完了',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UploadCompleteInput' },
            },
          },
        },
        responses: {
          200: { description: '検証済みの添付ファイル' },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
          409: { description: 'セッションの再利用またはリクエストの競合' },
        },
      },
    },
    '/members/promote': {
      post: {
        operationId: 'promoteMembers',
        summary: '年度繰り上げをプレビューまたは実行',
        parameters: [
          {
            name: 'Idempotency-Key',
            in: 'header',
            required: false,
            schema: { type: 'string', minLength: 1, maxLength: 128 },
            description:
              '実行モードでは必須です。同じリクエストの再送を安全に処理します。',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/PromotionRequest' },
            },
          },
        },
        responses: {
          200: {
            description: '年度繰り上げの計画または実行結果',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PromotionResponse' },
              },
            },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          409: {
            description: '同じキーのリクエスト競合または年度繰り上げの実行競合',
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      UploadSessionInput: {
        type: 'object',
        required: ['mediaType', 'byteSize', 'ownerUserId'],
        additionalProperties: false,
        properties: {
          mediaType: {
            type: 'string',
            enum: ['image/jpeg', 'image/png', 'application/pdf'],
          },
          byteSize: { type: 'integer', minimum: 1, maximum: MAX_UPLOAD_BYTES },
          ownerUserId: { type: 'string', minLength: 1, maxLength: 128 },
        },
      },
      UploadSessionResponse: {
        type: 'object',
        required: [
          'attachmentId',
          'uploadUrl',
          'expiresAt',
          'maxBytes',
          'mediaType',
        ],
        additionalProperties: false,
        properties: {
          attachmentId: { type: 'string', format: 'uuid' },
          uploadUrl: { type: 'string', format: 'uri' },
          expiresAt: { type: 'string', format: 'date-time' },
          maxBytes: { type: 'integer', const: MAX_UPLOAD_BYTES },
          mediaType: {
            type: 'string',
            enum: ['image/jpeg', 'image/png', 'application/pdf'],
          },
        },
      },
      UploadCompleteInput: {
        type: 'object',
        required: ['sha256', 'byteSize'],
        additionalProperties: false,
        properties: {
          sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
          byteSize: { type: 'integer', minimum: 1, maximum: MAX_UPLOAD_BYTES },
        },
      },
      PromotionRequest: {
        type: 'object',
        required: ['mode', 'fiscalYear'],
        additionalProperties: false,
        properties: {
          mode: { type: 'string', enum: ['preview', 'execute'] },
          fiscalYear: { type: 'integer', minimum: 2000, maximum: 2100 },
        },
      },
      PromotionResponse: {
        type: 'object',
        required: ['data'],
        properties: {
          data: {
            type: 'object',
            required: [
              'mode',
              'fiscalYear',
              'status',
              'previewCount',
              'promotedCount',
              'result',
            ],
            properties: {
              mode: { type: 'string', enum: ['preview', 'execute'] },
              fiscalYear: { type: 'integer', minimum: 2000, maximum: 2100 },
              status: {
                type: 'string',
                enum: ['preview', 'completed', 'failed'],
              },
              previewCount: { type: 'integer', minimum: 0 },
              promotedCount: { type: 'integer', minimum: 0 },
              result: { type: ['object', 'null'] },
            },
          },
        },
      },
      Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: { type: 'object' },
        },
      },
    },
    responses: {
      BadRequest: {
        description: '入力値が不正です。',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
          },
        },
      },
      Unauthorized: {
        description: '認証が必要です。',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
          },
        },
      },
      Forbidden: {
        description: 'この操作を実行する権限がありません。',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
          },
        },
      },
    },
  },
  'x-cocolo-upload-session-ttl-seconds': UPLOAD_SESSION_TTL_SECONDS,
};
