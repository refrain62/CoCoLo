import {
  MAX_UPLOAD_BYTES,
  UPLOAD_SESSION_TTL_SECONDS,
} from './upload-contract.ts';

// Zod契約と同じ制約を公開API仕様へ投影する生成元。openapi.yamlを直接編集しない。
export const openapiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'CoCoLo API',
    version: '1.0.0',
  },
  servers: [{ url: '/api/v1' }],
  security: [{ bearerAuth: [] }],
  paths: {
    '/notifications/line': {
      post: {
        operationId: 'publishLineNotification',
        summary: 'LINE通知をoutboxへ登録',
        parameters: [
          {
            name: 'Idempotency-Key',
            in: 'header',
            required: true,
            schema: { type: 'string', minLength: 1, maxLength: 128 },
            description:
              '同じpayloadの再送では同じ値を使い、通知の重複登録を防ぎます。',
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/LineDeliveryPublishInput' },
            },
          },
        },
        responses: {
          202: {
            description: '通知をoutboxへ登録',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/LineDeliveryPublishResponse',
                },
              },
            },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          409: { $ref: '#/components/responses/Conflict' },
          429: { $ref: '#/components/responses/TooManyRequests' },
          500: { $ref: '#/components/responses/InternalServerError' },
          503: { $ref: '#/components/responses/ServiceUnavailable' },
        },
      },
    },
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
          403: { $ref: '#/components/responses/Forbidden' },
          503: { $ref: '#/components/responses/ServiceUnavailable' },
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
          409: { $ref: '#/components/responses/Conflict' },
          422: { description: '添付本体の検証失敗' },
          503: { $ref: '#/components/responses/ServiceUnavailable' },
        },
      },
    },
    '/uploads/{id}/download': {
      get: {
        operationId: 'createAttachmentDownloadUrl',
        summary: '認可済み添付の短期ダウンロードURLを作成',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          200: {
            description: '短期ダウンロードURL',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/DownloadResponse' },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { description: '添付が見つかりません。' },
        },
      },
    },
    '/uploads/{id}/cleanup': {
      post: {
        operationId: 'cleanupRejectedAttachment',
        summary: '検証失敗した添付本体の削除を再試行',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          200: { description: '削除完了' },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { description: 'cleanup対象が見つかりません。' },
          503: { $ref: '#/components/responses/ServiceUnavailable' },
        },
      },
    },
    '/uploads/cleanup-expired': {
      post: {
        operationId: 'cleanupExpiredAttachments',
        summary: '期限切れアップロードセッションのcleanupを実行',
        responses: {
          200: { description: '期限切れcleanupの結果' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          503: { $ref: '#/components/responses/ServiceUnavailable' },
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
          409: { $ref: '#/components/responses/Conflict' },
          429: { $ref: '#/components/responses/TooManyRequests' },
          500: { $ref: '#/components/responses/InternalServerError' },
          503: { $ref: '#/components/responses/ServiceUnavailable' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      LineDeliveryPublishInput: {
        type: 'object',
        required: ['sourceId', 'destination', 'title', 'body', 'deepLink'],
        additionalProperties: false,
        properties: {
          sourceId: { type: 'string', minLength: 1, maxLength: 128 },
          destination: { type: 'string', minLength: 1, maxLength: 128 },
          title: { type: 'string', minLength: 1, maxLength: 200 },
          body: { type: 'string', minLength: 1, maxLength: 4000 },
          deepLink: {
            type: 'string',
            minLength: 1,
            maxLength: 2048,
            pattern: '^https://|^http://localhost(:[0-9]+)?/',
          },
        },
      },
      LineDeliveryPublishResponse: {
        type: 'object',
        required: ['data'],
        properties: {
          data: {
            type: 'object',
            required: ['notificationId', 'status'],
            properties: {
              notificationId: { type: 'string', format: 'uuid' },
              status: { type: 'string', const: 'pending' },
            },
          },
        },
      },
      UploadSessionInput: {
        type: 'object',
        required: ['mediaType', 'byteSize'],
        additionalProperties: false,
        properties: {
          mediaType: {
            type: 'string',
            enum: ['image/jpeg', 'image/png', 'application/pdf'],
          },
          byteSize: { type: 'integer', minimum: 1, maximum: MAX_UPLOAD_BYTES },
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
      DownloadResponse: {
        type: 'object',
        required: ['data'],
        properties: {
          data: {
            type: 'object',
            required: ['attachmentId', 'downloadUrl', 'expiresAt'],
            properties: {
              attachmentId: { type: 'string', format: 'uuid' },
              downloadUrl: { type: 'string', format: 'uri' },
              expiresAt: { type: 'string', format: 'date-time' },
            },
          },
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
        additionalProperties: false,
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
            additionalProperties: false,
            properties: {
              mode: { type: 'string', enum: ['preview', 'execute'] },
              fiscalYear: { type: 'integer', minimum: 2000, maximum: 2100 },
              status: {
                type: 'string',
                enum: ['preview', 'completed', 'failed'],
              },
              previewCount: { type: 'integer', minimum: 0 },
              promotedCount: { type: 'integer', minimum: 0 },
              result: {
                oneOf: [
                  { type: 'null' },
                  {
                    type: 'object',
                    required: ['promotedCount', 'changes'],
                    additionalProperties: false,
                    properties: {
                      promotedCount: { type: 'integer', minimum: 0 },
                      changes: {
                        type: 'array',
                        maxItems: 10000,
                        items: {
                          type: 'object',
                          required: ['id', 'fromGradeLevel', 'toGradeLevel'],
                          additionalProperties: false,
                          properties: {
                            id: { type: 'string', format: 'uuid' },
                            fromGradeLevel: {
                              type: 'integer',
                              minimum: 1,
                              maximum: 99,
                            },
                            toGradeLevel: {
                              type: 'integer',
                              minimum: 1,
                              maximum: 99,
                            },
                          },
                        },
                      },
                    },
                  },
                  {
                    type: 'object',
                    required: ['errorCode'],
                    additionalProperties: false,
                    properties: {
                      errorCode: {
                        type: 'string',
                        enum: ['PROMOTION_GRADE_LIMIT'],
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
      Error: {
        type: 'object',
        required: ['error'],
        additionalProperties: false,
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message', 'details', 'requestId'],
            additionalProperties: false,
            properties: {
              code: { type: 'string', minLength: 1, maxLength: 128 },
              message: { type: 'string', minLength: 1, maxLength: 512 },
              details: {},
              requestId: { type: 'string', minLength: 1, maxLength: 128 },
            },
          },
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
      Conflict: {
        description: 'リクエストが現在の状態と競合しました。',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
          },
        },
      },
      NotFound: {
        description: '指定されたリソースが見つかりません。',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
          },
        },
      },
      TooManyRequests: {
        description: 'リクエスト数の上限を超えました。',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
          },
        },
      },
      InternalServerError: {
        description: '内部エラーが発生しました。',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
          },
        },
      },
      ServiceUnavailable: {
        description: '外部サービスまたは依存サービスが利用できません。',
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
