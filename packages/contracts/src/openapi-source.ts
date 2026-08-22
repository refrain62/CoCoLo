import {
  MAX_UPLOAD_BYTES,
  UPLOAD_SESSION_TTL_SECONDS,
} from './upload-contract.ts';

const commonFeatureErrors = {
  400: { $ref: '#/components/responses/BadRequest' },
  401: { $ref: '#/components/responses/Unauthorized' },
  403: { $ref: '#/components/responses/Forbidden' },
  404: { $ref: '#/components/responses/NotFound' },
  409: { $ref: '#/components/responses/Conflict' },
  503: { $ref: '#/components/responses/ServiceUnavailable' },
};

const featureResponse = {
  description: '機能データ',
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/FeatureEnvelope' },
    },
  },
};

function featureOperation(input: {
  operationId: string;
  summary: string;
  successStatus?: 200 | 201 | 202;
  requestSchema?: string;
  parameters?: unknown[];
  security?: unknown[];
}) {
  const successStatus = input.successStatus ?? 200;
  return {
    operationId: input.operationId,
    summary: input.summary,
    ...(input.parameters ? { parameters: input.parameters } : {}),
    ...(input.requestSchema
      ? {
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: `#/components/schemas/${input.requestSchema}` },
              },
            },
          },
        }
      : {}),
    ...(input.security ? { security: input.security } : {}),
    responses: {
      [successStatus]: featureResponse,
      ...commonFeatureErrors,
    },
  };
}

function idParameter(name: string) {
  return {
    name,
    in: 'path',
    required: true,
    schema: {
      type: 'string',
      pattern:
        '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    },
  };
}

const centralFeaturePaths = {
  '/session': {
    get: featureOperation({
      operationId: 'getSession',
      summary: '現在の認証セッション所属を取得',
    }),
  },
  '/members': {
    get: featureOperation({
      operationId: 'listMembers',
      summary: '部員一覧を取得',
    }),
    post: featureOperation({
      operationId: 'createMember',
      summary: '部員を登録',
      successStatus: 201,
      requestSchema: 'MemberCreateInput',
    }),
  },
  '/members/{memberId}': {
    patch: featureOperation({
      operationId: 'updateMember',
      summary: '部員を編集',
      parameters: [idParameter('memberId')],
      requestSchema: 'MemberUpdateInput',
    }),
  },
  '/members/{memberId}/retire': {
    post: featureOperation({
      operationId: 'retireMember',
      summary: '部員を退部に変更',
      parameters: [idParameter('memberId')],
    }),
  },
  '/events': {
    get: featureOperation({
      operationId: 'listEvents',
      summary: '予定を期間検索',
    }),
    post: featureOperation({
      operationId: 'createEvent',
      summary: '予定を登録',
      successStatus: 201,
      requestSchema: 'EventInput',
    }),
  },
  '/events/{eventId}': {
    patch: featureOperation({
      operationId: 'updateEvent',
      summary: '予定を編集',
      parameters: [idParameter('eventId')],
      requestSchema: 'EventInput',
    }),
  },
  '/events/{eventId}/attendance': {
    put: featureOperation({
      operationId: 'upsertAttendance',
      summary: '出欠を登録',
      parameters: [idParameter('eventId')],
      requestSchema: 'AttendanceInput',
    }),
  },
  '/events/{eventId}/attendance/summary': {
    get: featureOperation({
      operationId: 'summarizeAttendance',
      summary: '出欠を集計',
      parameters: [idParameter('eventId')],
    }),
  },
  '/board-members': {
    get: featureOperation({
      operationId: 'listBoardMembers',
      summary: '役員連絡先を一覧表示',
    }),
    post: featureOperation({
      operationId: 'createBoardMember',
      summary: '役員連絡先を登録',
      successStatus: 201,
      requestSchema: 'BoardMemberInput',
    }),
  },
  '/board-members/copy-year': {
    post: featureOperation({
      operationId: 'copyBoardMembers',
      summary: '役員連絡先を年度引き継ぎ',
      successStatus: 201,
      requestSchema: 'BoardMemberCopyInput',
    }),
  },
  '/board-members/{boardMemberId}': {
    patch: featureOperation({
      operationId: 'updateBoardMember',
      summary: '役員連絡先を編集',
      parameters: [idParameter('boardMemberId')],
      requestSchema: 'BoardMemberInput',
    }),
    delete: featureOperation({
      operationId: 'deleteBoardMember',
      summary: '役員連絡先を削除',
      parameters: [idParameter('boardMemberId')],
    }),
  },
  '/orders': {
    get: featureOperation({
      operationId: 'listOrders',
      summary: '注文案件を一覧表示',
    }),
    post: featureOperation({
      operationId: 'createOrder',
      summary: '注文案件を作成',
      successStatus: 201,
      requestSchema: 'OrderInput',
    }),
  },
  '/orders/{orderId}': {
    get: featureOperation({
      operationId: 'getOrder',
      summary: '注文案件を取得',
      parameters: [idParameter('orderId')],
    }),
  },
  '/orders/{orderId}/products': {
    post: featureOperation({
      operationId: 'createOrderProduct',
      summary: '注文商品を追加',
      successStatus: 201,
      parameters: [idParameter('orderId')],
      requestSchema: 'OrderProductInput',
    }),
  },
  '/orders/{orderId}/status': {
    patch: featureOperation({
      operationId: 'updateOrderStatus',
      summary: '注文案件状態を変更',
      parameters: [idParameter('orderId')],
      requestSchema: 'OrderStatusInput',
    }),
  },
  '/orders/{orderId}/entries': {
    get: featureOperation({
      operationId: 'listOrderEntries',
      summary: '注文明細を一覧表示',
      parameters: [idParameter('orderId')],
    }),
    post: featureOperation({
      operationId: 'createOrderEntry',
      summary: '注文明細を登録',
      successStatus: 201,
      parameters: [idParameter('orderId')],
      requestSchema: 'OrderEntryInput',
    }),
  },
  '/orders/{orderId}/entries/{entryId}/payment': {
    patch: featureOperation({
      operationId: 'updatePaymentStatus',
      summary: '支払状態を変更',
      parameters: [idParameter('orderId'), idParameter('entryId')],
      requestSchema: 'PaymentInput',
    }),
  },
  '/orders/{orderId}/summary': {
    get: featureOperation({
      operationId: 'getOrderSummary',
      summary: '注文集計を取得',
      parameters: [idParameter('orderId')],
    }),
  },
  '/orders/{orderId}/unpaid': {
    get: featureOperation({
      operationId: 'listUnpaidOrders',
      summary: '未払い注文を一覧表示',
      parameters: [idParameter('orderId')],
    }),
  },
  '/orders/{orderId}/export.csv': {
    get: {
      operationId: 'exportOrdersCsv',
      summary: '注文をCSV出力',
      parameters: [idParameter('orderId')],
      responses: {
        200: { description: 'CSVファイル' },
        ...commonFeatureErrors,
      },
    },
  },
  '/uploads/cleanup-expired': {
    post: featureOperation({
      operationId: 'cleanupExpiredUploads',
      summary: '期限切れ添付をcleanup',
    }),
  },
  '/uploads/{id}/download': {
    get: featureOperation({
      operationId: 'createAttachmentDownloadUrl',
      summary: '添付ダウンロードURLを発行',
      parameters: [idParameter('id')],
    }),
  },
  '/uploads/{id}/cleanup': {
    post: featureOperation({
      operationId: 'cleanupAttachment',
      summary: '検証失敗添付をcleanup',
      parameters: [idParameter('id')],
    }),
  },
  '/line/status': {
    get: featureOperation({
      operationId: 'getLineStatus',
      summary: 'LINE接続状態を取得',
    }),
  },
  '/line/connect': {
    post: featureOperation({
      operationId: 'connectLineGroup',
      summary: 'LINEグループを接続',
      successStatus: 201,
      requestSchema: 'LineConnectInput',
    }),
    delete: featureOperation({
      operationId: 'disconnectLineGroup',
      summary: 'LINEグループを解除',
    }),
  },
  '/line/notifications': {
    post: featureOperation({
      operationId: 'enqueueLineNotification',
      summary: 'LINE通知をキューへ登録',
      successStatus: 202,
      requestSchema: 'LineNotificationInput',
    }),
  },
  '/line/notifications/{notificationId}/retry': {
    post: featureOperation({
      operationId: 'retryLineNotification',
      summary: 'LINE通知を再試行',
      parameters: [idParameter('notificationId')],
    }),
  },
  '/line/webhook': {
    post: featureOperation({
      operationId: 'receiveLineWebhook',
      summary: 'LINE webhookを受信',
      requestSchema: 'LineWebhookInput',
      security: [],
    }),
  },
  '/ride-plans': {
    post: featureOperation({
      operationId: 'createRidePlan',
      summary: '送迎予定を作成',
      successStatus: 201,
      requestSchema: 'RidePlanInput',
    }),
  },
  '/ride-plans/{planId}': {
    get: featureOperation({
      operationId: 'getRidePlan',
      summary: '送迎予定を取得',
      parameters: [idParameter('planId')],
    }),
  },
  '/ride-plans/{planId}/offers': {
    post: featureOperation({
      operationId: 'createRideOffer',
      summary: '送迎車を登録',
      successStatus: 201,
      parameters: [idParameter('planId')],
      requestSchema: 'RideOfferInput',
    }),
  },
  '/ride-plans/{planId}/requests': {
    post: featureOperation({
      operationId: 'createRideRequest',
      summary: '乗車希望を登録',
      successStatus: 201,
      parameters: [idParameter('planId')],
      requestSchema: 'RideRequestInput',
    }),
  },
  '/ride-plans/{planId}/match': {
    post: featureOperation({
      operationId: 'matchRideRequests',
      summary: '乗車希望を自動マッチング',
      parameters: [idParameter('planId')],
    }),
  },
  '/ride-plans/{planId}/assignments': {
    post: featureOperation({
      operationId: 'assignRide',
      summary: '送迎を手動割当',
      successStatus: 201,
      parameters: [idParameter('planId')],
      requestSchema: 'RideAssignmentInput',
    }),
  },
  '/ride-plans/{planId}/dispatch': {
    get: featureOperation({
      operationId: 'getRideDispatch',
      summary: '送迎配車を取得',
      parameters: [idParameter('planId')],
    }),
  },
  '/ride-plans/{planId}/metrics': {
    get: featureOperation({
      operationId: 'getRideMetrics',
      summary: '送迎指標を取得',
      parameters: [idParameter('planId')],
    }),
  },
  '/announcements': {
    get: featureOperation({
      operationId: 'listAnnouncements',
      summary: '回覧板を一覧表示',
    }),
    post: featureOperation({
      operationId: 'publishAnnouncement',
      summary: '回覧板を掲載',
      successStatus: 201,
      requestSchema: 'AnnouncementInput',
    }),
  },
  '/announcements/{announcementId}': {
    get: featureOperation({
      operationId: 'getAnnouncement',
      summary: '回覧板を取得',
      parameters: [idParameter('announcementId')],
    }),
  },
  '/announcements/{announcementId}/read': {
    post: featureOperation({
      operationId: 'markAnnouncementRead',
      summary: '回覧板を既読にする',
      parameters: [idParameter('announcementId')],
    }),
  },
  '/announcements/{announcementId}/unread': {
    get: featureOperation({
      operationId: 'listAnnouncementUnreadMembers',
      summary: '回覧板の未読者を取得',
      parameters: [idParameter('announcementId')],
    }),
  },
  '/auth/teams': {
    get: featureOperation({
      operationId: 'listTeams',
      summary: '選択可能なチームを取得',
    }),
  },
  '/auth/teams/select': {
    post: featureOperation({
      operationId: 'selectTeam',
      summary: '利用チームを選択',
      requestSchema: 'TeamSelectionInput',
    }),
  },
} as const;

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
    ...centralFeaturePaths,
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
      FeatureEnvelope: {
        type: 'object',
        required: ['data'],
        properties: { data: {} },
        additionalProperties: true,
      },
      MemberCreateInput: { type: 'object', additionalProperties: true },
      MemberUpdateInput: { type: 'object', additionalProperties: true },
      EventInput: { type: 'object', additionalProperties: true },
      AttendanceInput: { type: 'object', additionalProperties: true },
      BoardMemberInput: { type: 'object', additionalProperties: true },
      BoardMemberCopyInput: { type: 'object', additionalProperties: true },
      OrderInput: { type: 'object', additionalProperties: true },
      OrderProductInput: { type: 'object', additionalProperties: true },
      OrderStatusInput: { type: 'object', additionalProperties: true },
      OrderEntryInput: { type: 'object', additionalProperties: true },
      PaymentInput: { type: 'object', additionalProperties: true },
      LineConnectInput: { type: 'object', additionalProperties: true },
      LineNotificationInput: { type: 'object', additionalProperties: true },
      LineWebhookInput: { type: 'object', additionalProperties: true },
      RidePlanInput: { type: 'object', additionalProperties: true },
      RideOfferInput: { type: 'object', additionalProperties: true },
      RideRequestInput: { type: 'object', additionalProperties: true },
      RideAssignmentInput: { type: 'object', additionalProperties: true },
      AnnouncementInput: { type: 'object', additionalProperties: true },
      TeamSelectionInput: { type: 'object', additionalProperties: true },
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
      NotFound: {
        description: '対象が見つかりません。',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
          },
        },
      },
      Conflict: {
        description: '状態遷移または同時実行が競合しました。',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
          },
        },
      },
      ServiceUnavailable: {
        description: '外部サービスまたはfeature依存性を利用できません。',
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
