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
    '/auth/context': {
      get: {
        operationId: 'getAuthContext',
        summary: '認証済み利用者の現在の所属roleを取得',
        responses: {
          200: {
            description: '現在の所属コンテキスト',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AuthContextResponse' },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          429: { $ref: '#/components/responses/TooManyRequests' },
          500: { $ref: '#/components/responses/InternalServerError' },
          503: { $ref: '#/components/responses/ServiceUnavailable' },
        },
      },
    },
    '/auth/invitations': {
      get: {
        operationId: 'listAuthInvitations',
        summary: 'チームの招待一覧を取得',
        responses: {
          200: {
            description: '招待一覧',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/InvitationListResponse' },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          429: { $ref: '#/components/responses/TooManyRequests' },
          500: { $ref: '#/components/responses/InternalServerError' },
          503: { $ref: '#/components/responses/ServiceUnavailable' },
        },
      },
      post: {
        operationId: 'createAuthInvitation',
        summary: '対象memberへの招待を発行',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/InvitationCreateInput' },
            },
          },
        },
        responses: {
          201: {
            description: '招待を発行',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/InvitationCreateResponse',
                },
              },
            },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
          409: { $ref: '#/components/responses/Conflict' },
          429: { $ref: '#/components/responses/TooManyRequests' },
          500: { $ref: '#/components/responses/InternalServerError' },
          503: { $ref: '#/components/responses/ServiceUnavailable' },
        },
      },
    },
    '/auth/invitations/accept': {
      post: {
        operationId: 'acceptAuthInvitation',
        summary: 'OAuth認証済み利用者が招待を受諾',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/InvitationAcceptInput' },
            },
          },
        },
        responses: {
          200: {
            description: '招待を受諾',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/InvitationAcceptResponse',
                },
              },
            },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { $ref: '#/components/responses/NotFound' },
          409: { $ref: '#/components/responses/Conflict' },
          429: { $ref: '#/components/responses/TooManyRequests' },
          500: { $ref: '#/components/responses/InternalServerError' },
          503: { $ref: '#/components/responses/ServiceUnavailable' },
        },
      },
    },
    '/auth/invitations/{invitationId}/revoke': {
      post: {
        operationId: 'revokeAuthInvitation',
        summary: '招待を取り消す',
        parameters: [
          {
            name: 'invitationId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          200: {
            description: '招待を取り消す',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/InvitationResponse' },
              },
            },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
          409: { $ref: '#/components/responses/Conflict' },
          429: { $ref: '#/components/responses/TooManyRequests' },
          500: { $ref: '#/components/responses/InternalServerError' },
          503: { $ref: '#/components/responses/ServiceUnavailable' },
        },
      },
    },
    '/feature-contract': {
      get: {
        operationId: 'getFeatureContract',
        summary: '選択中チームの有効機能契約を取得',
        responses: {
          200: {
            description: '有効機能契約',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/FeatureContractResponse',
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          429: { $ref: '#/components/responses/TooManyRequests' },
          500: { $ref: '#/components/responses/InternalServerError' },
          503: { $ref: '#/components/responses/ServiceUnavailable' },
        },
      },
    },
    '/feature-contract/{featureKey}': {
      patch: {
        operationId: 'updateFreeFeatureFlag',
        summary: 'チームの無償feature flagを変更',
        parameters: [
          {
            name: 'featureKey',
            in: 'path',
            required: true,
            schema: {
              type: 'string',
              pattern: '^[a-z][a-z0-9._-]{1,63}$',
            },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/FeatureFlagUpdate' },
            },
          },
        },
        responses: {
          200: {
            description: 'feature flag変更後の有効機能契約',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/FeatureContractResponse',
                },
              },
            },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
          429: { $ref: '#/components/responses/TooManyRequests' },
          500: { $ref: '#/components/responses/InternalServerError' },
          503: { $ref: '#/components/responses/ServiceUnavailable' },
        },
      },
    },
    '/events': {
      get: {
        operationId: 'listEvents',
        summary: '期間内の予定一覧を取得',
        parameters: [
          {
            name: 'from',
            in: 'query',
            required: true,
            schema: { type: 'string', format: 'date-time' },
          },
          {
            name: 'to',
            in: 'query',
            required: true,
            schema: { type: 'string', format: 'date-time' },
          },
        ],
        responses: {
          200: {
            description: '予定一覧',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/EventListResponse' },
              },
            },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
          429: { $ref: '#/components/responses/TooManyRequests' },
          500: { $ref: '#/components/responses/InternalServerError' },
          503: { $ref: '#/components/responses/ServiceUnavailable' },
        },
      },
      post: {
        operationId: 'createEvent',
        summary: '予定を登録',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/EventInput' },
            },
          },
        },
        responses: {
          201: {
            description: '予定を登録',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/EventMutationResponse' },
              },
            },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          429: { $ref: '#/components/responses/TooManyRequests' },
          500: { $ref: '#/components/responses/InternalServerError' },
          503: { $ref: '#/components/responses/ServiceUnavailable' },
        },
      },
    },
    '/events/{eventId}': {
      get: {
        operationId: 'getEvent',
        summary: '予定詳細を取得',
        parameters: [
          {
            name: 'eventId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          200: {
            description: '予定詳細',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/EventMutationResponse' },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { $ref: '#/components/responses/NotFound' },
          429: { $ref: '#/components/responses/TooManyRequests' },
          500: { $ref: '#/components/responses/InternalServerError' },
          503: { $ref: '#/components/responses/ServiceUnavailable' },
        },
      },
      patch: {
        operationId: 'updateEvent',
        summary: '予定を編集',
        parameters: [
          {
            name: 'eventId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/EventUpdateInput' },
            },
          },
        },
        responses: {
          200: {
            description: '予定を更新',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/EventMutationResponse' },
              },
            },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
          429: { $ref: '#/components/responses/TooManyRequests' },
          500: { $ref: '#/components/responses/InternalServerError' },
          503: { $ref: '#/components/responses/ServiceUnavailable' },
        },
      },
    },
    '/events/{eventId}/attendance': {
      get: {
        operationId: 'getCurrentAttendance',
        summary: '現在の出欠回答を取得',
        parameters: [
          {
            name: 'eventId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          200: {
            description: '現在の出欠回答',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AttendanceListResponse',
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          404: { $ref: '#/components/responses/NotFound' },
          429: { $ref: '#/components/responses/TooManyRequests' },
          500: { $ref: '#/components/responses/InternalServerError' },
          503: { $ref: '#/components/responses/ServiceUnavailable' },
        },
      },
      put: {
        operationId: 'upsertEventAttendance',
        summary: '予定の出欠を登録または修正',
        parameters: [
          {
            name: 'eventId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AttendanceInput' },
            },
          },
        },
        responses: {
          200: {
            description: '出欠回答',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/AttendanceResponse' },
              },
            },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
          409: { $ref: '#/components/responses/Conflict' },
          429: { $ref: '#/components/responses/TooManyRequests' },
          500: { $ref: '#/components/responses/InternalServerError' },
          503: { $ref: '#/components/responses/ServiceUnavailable' },
        },
      },
    },
    '/events/{eventId}/attendance/summary': {
      get: {
        operationId: 'getEventAttendanceSummary',
        summary: '予定の出欠集計を取得',
        parameters: [
          {
            name: 'eventId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          200: {
            description: '出欠集計',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/AttendanceSummaryResponse',
                },
              },
            },
          },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
          429: { $ref: '#/components/responses/TooManyRequests' },
          500: { $ref: '#/components/responses/InternalServerError' },
          503: { $ref: '#/components/responses/ServiceUnavailable' },
        },
      },
    },
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
    '/notifications/line/{notificationId}/retry': {
      post: {
        operationId: 'retryLineNotification',
        summary: '失敗したLINE通知を再試行',
        parameters: [
          {
            name: 'notificationId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          202: {
            description: '通知を再試行待ちへ戻す',
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
        additionalProperties: false,
        properties: {
          data: {
            type: 'object',
            required: ['notificationId', 'status'],
            additionalProperties: false,
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
      AuthContextResponse: {
        type: 'object',
        required: ['data'],
        additionalProperties: false,
        properties: {
          data: {
            type: 'object',
            required: ['tenantId', 'role'],
            additionalProperties: false,
            properties: {
              tenantId: { type: 'string', format: 'uuid' },
              role: {
                type: 'string',
                enum: ['owner', 'admin', 'staff', 'guardian'],
              },
            },
          },
        },
      },
      InvitationCreateInput: {
        type: 'object',
        required: ['memberId', 'role', 'relationship'],
        additionalProperties: false,
        properties: {
          memberId: { type: 'string', format: 'uuid' },
          role: { type: 'string', const: 'guardian' },
          relationship: { type: 'string', minLength: 1, maxLength: 100 },
          expiresInHours: {
            type: 'integer',
            minimum: 1,
            maximum: 168,
            default: 72,
          },
        },
      },
      InvitationAcceptInput: {
        type: 'object',
        required: ['token', 'provider'],
        additionalProperties: false,
        properties: {
          token: { type: 'string', minLength: 32, maxLength: 256 },
          provider: { type: 'string', enum: ['google', 'line'] },
        },
      },
      InvitationItem: {
        type: 'object',
        required: [
          'id',
          'memberId',
          'role',
          'relationship',
          'status',
          'expiresAt',
          'acceptedAt',
        ],
        additionalProperties: false,
        properties: {
          id: { type: 'string', format: 'uuid' },
          memberId: { type: 'string', format: 'uuid' },
          role: { type: 'string', const: 'guardian' },
          relationship: { type: 'string', minLength: 1, maxLength: 100 },
          status: {
            type: 'string',
            enum: ['pending', 'accepted', 'expired', 'revoked'],
          },
          expiresAt: { type: 'string', format: 'date-time' },
          acceptedAt: { type: ['string', 'null'], format: 'date-time' },
        },
      },
      InvitationListResponse: {
        type: 'object',
        required: ['data'],
        additionalProperties: false,
        properties: {
          data: {
            type: 'array',
            items: { $ref: '#/components/schemas/InvitationItem' },
          },
        },
      },
      InvitationResponse: {
        type: 'object',
        required: ['data'],
        additionalProperties: false,
        properties: {
          data: { $ref: '#/components/schemas/InvitationItem' },
        },
      },
      InvitationCreateResponse: {
        type: 'object',
        required: ['data'],
        additionalProperties: false,
        properties: {
          data: {
            type: 'object',
            required: [
              'id',
              'memberId',
              'role',
              'relationship',
              'token',
              'expiresAt',
            ],
            additionalProperties: false,
            properties: {
              id: { type: 'string', format: 'uuid' },
              memberId: { type: 'string', format: 'uuid' },
              role: { type: 'string', const: 'guardian' },
              relationship: { type: 'string', minLength: 1, maxLength: 100 },
              token: { type: 'string', minLength: 32, maxLength: 256 },
              expiresAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
      InvitationAcceptResponse: {
        type: 'object',
        required: ['data'],
        additionalProperties: false,
        properties: {
          data: {
            type: 'object',
            required: ['tenantId', 'memberId', 'role', 'linkStatus'],
            additionalProperties: false,
            properties: {
              tenantId: { type: 'string', format: 'uuid' },
              memberId: { type: 'string', format: 'uuid' },
              role: { type: 'string', const: 'guardian' },
              linkStatus: { type: 'string', const: 'active' },
            },
          },
        },
      },
      FeatureFlagUpdate: {
        type: 'object',
        required: ['enabled', 'reason'],
        additionalProperties: false,
        properties: {
          enabled: { type: 'boolean' },
          reason: { type: 'string', minLength: 1, maxLength: 500 },
        },
      },
      FeatureContractResponse: {
        type: 'object',
        required: ['data'],
        additionalProperties: false,
        properties: {
          data: {
            type: 'object',
            required: ['planKey', 'planStatus', 'features'],
            additionalProperties: false,
            properties: {
              planKey: { type: ['string', 'null'], maxLength: 100 },
              planStatus: {
                type: ['string', 'null'],
                enum: [
                  'active',
                  'trialing',
                  'past_due',
                  'canceled',
                  'expired',
                  null,
                ],
              },
              features: {
                type: 'array',
                items: {
                  type: 'object',
                  required: [
                    'key',
                    'billingType',
                    'displayName',
                    'enabled',
                    'reason',
                  ],
                  additionalProperties: false,
                  properties: {
                    key: {
                      type: 'string',
                      pattern: '^[a-z][a-z0-9_.-]{0,63}$',
                    },
                    billingType: { type: 'string', enum: ['free', 'paid'] },
                    displayName: {
                      type: 'string',
                      minLength: 1,
                      maxLength: 200,
                    },
                    enabled: { type: 'boolean' },
                    reason: {
                      type: 'string',
                      enum: ['default', 'flag', 'plan', 'unavailable'],
                    },
                  },
                },
              },
            },
          },
        },
      },
      EventInput: {
        type: 'object',
        required: [
          'title',
          'type',
          'startsAt',
          'endsAt',
          'fee',
          'transportationRequired',
          'attendanceDeadline',
        ],
        additionalProperties: false,
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 200 },
          type: { type: 'string', enum: ['practice', 'match', 'event'] },
          startsAt: { type: 'string', format: 'date-time' },
          endsAt: { type: 'string', format: 'date-time' },
          location: { type: ['string', 'null'], maxLength: 500 },
          itemsToBring: { type: ['string', 'null'], maxLength: 2000 },
          fee: { type: 'integer', minimum: 0, maximum: 1000000 },
          announcementImageAttachmentId: {
            type: ['string', 'null'],
            format: 'uuid',
          },
          opponent: { type: ['string', 'null'], maxLength: 200 },
          meetingTime: {
            type: ['string', 'null'],
            format: 'date-time',
          },
          transportationRequired: { type: 'boolean' },
          attendanceDeadline: { type: 'string', format: 'date-time' },
        },
      },
      EventUpdateInput: {
        type: 'object',
        minProperties: 1,
        additionalProperties: false,
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 200 },
          type: { type: 'string', enum: ['practice', 'match', 'event'] },
          startsAt: { type: 'string', format: 'date-time' },
          endsAt: { type: 'string', format: 'date-time' },
          location: { type: ['string', 'null'], maxLength: 500 },
          itemsToBring: { type: ['string', 'null'], maxLength: 2000 },
          fee: { type: 'integer', minimum: 0, maximum: 1000000 },
          announcementImageAttachmentId: {
            type: ['string', 'null'],
            format: 'uuid',
          },
          opponent: { type: ['string', 'null'], maxLength: 200 },
          meetingTime: {
            type: ['string', 'null'],
            format: 'date-time',
          },
          transportationRequired: { type: 'boolean' },
          attendanceDeadline: { type: 'string', format: 'date-time' },
        },
      },
      EventResponse: {
        type: 'object',
        required: [
          'id',
          'title',
          'type',
          'startsAt',
          'endsAt',
          'location',
          'itemsToBring',
          'fee',
          'announcementImageAttachmentId',
          'opponent',
          'meetingTime',
          'transportationRequired',
          'attendanceDeadline',
          'createdAt',
          'updatedAt',
        ],
        additionalProperties: false,
        properties: {
          id: { type: 'string', format: 'uuid' },
          title: { type: 'string', minLength: 1, maxLength: 200 },
          type: { type: 'string', enum: ['practice', 'match', 'event'] },
          startsAt: { type: 'string', format: 'date-time' },
          endsAt: { type: 'string', format: 'date-time' },
          location: { type: ['string', 'null'], maxLength: 500 },
          itemsToBring: { type: ['string', 'null'], maxLength: 2000 },
          fee: { type: 'integer', minimum: 0, maximum: 1000000 },
          announcementImageAttachmentId: {
            type: ['string', 'null'],
            format: 'uuid',
          },
          opponent: { type: ['string', 'null'], maxLength: 200 },
          meetingTime: {
            type: ['string', 'null'],
            format: 'date-time',
          },
          transportationRequired: { type: 'boolean' },
          attendanceDeadline: { type: 'string', format: 'date-time' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      EventListResponse: {
        type: 'object',
        required: ['data'],
        additionalProperties: false,
        properties: {
          data: {
            type: 'array',
            maxItems: 500,
            items: { $ref: '#/components/schemas/EventResponse' },
          },
        },
      },
      EventMutationResponse: {
        type: 'object',
        required: ['data'],
        additionalProperties: false,
        properties: {
          data: { $ref: '#/components/schemas/EventResponse' },
        },
      },
      AttendanceInput: {
        type: 'object',
        required: ['memberId', 'response'],
        additionalProperties: false,
        properties: {
          memberId: { type: 'string', format: 'uuid' },
          response: {
            type: 'string',
            enum: ['attending', 'absent', 'pending'],
          },
          correctionReason: { type: 'string', minLength: 1, maxLength: 500 },
        },
      },
      AttendanceResponse: {
        type: 'object',
        required: ['data'],
        additionalProperties: false,
        properties: {
          data: {
            type: 'object',
            required: ['eventId', 'memberId', 'response', 'updatedAt'],
            additionalProperties: false,
            properties: {
              eventId: { type: 'string', format: 'uuid' },
              memberId: { type: 'string', format: 'uuid' },
              response: {
                type: 'string',
                enum: ['attending', 'absent', 'pending'],
              },
              updatedAt: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
      AttendanceListResponse: {
        type: 'object',
        required: ['data'],
        additionalProperties: false,
        properties: {
          data: {
            type: 'array',
            items: {
              type: 'object',
              required: ['eventId', 'memberId', 'response', 'updatedAt'],
              additionalProperties: false,
              properties: {
                eventId: { type: 'string', format: 'uuid' },
                memberId: { type: 'string', format: 'uuid' },
                response: {
                  type: 'string',
                  enum: ['attending', 'absent', 'pending'],
                },
                updatedAt: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
      },
      AttendanceSummaryResponse: {
        type: 'object',
        required: ['data'],
        additionalProperties: false,
        properties: {
          data: {
            type: 'object',
            required: [
              'totalMembers',
              'attending',
              'absent',
              'pending',
              'unanswered',
              'unansweredMemberIds',
            ],
            additionalProperties: false,
            properties: {
              totalMembers: { type: 'integer', minimum: 0 },
              attending: { type: 'integer', minimum: 0 },
              absent: { type: 'integer', minimum: 0 },
              pending: { type: 'integer', minimum: 0 },
              unanswered: { type: 'integer', minimum: 0 },
              unansweredMemberIds: {
                type: 'array',
                items: { type: 'string', format: 'uuid' },
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
              requestId: { type: 'string', format: 'uuid' },
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
