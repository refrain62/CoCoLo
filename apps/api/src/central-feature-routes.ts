import type { TokenVerifier } from '@cocolo/auth';
import type { MemberRole } from '@cocolo/contracts/member';
import type { AuthTeamSelectionRepository } from '@cocolo/db/auth-team-selection';
import type { BulletinBoardRepository } from '@cocolo/db/bulletin-board';
import type { Context, Hono } from 'hono';
import type { ApiEnv } from './app.js';
import { createAuthTeamSelectionApp } from './features/auth-team-selection/app.js';
import {
  type BoardContactRepository,
  createBoardContactApp,
} from './features/board-contact/index.js';
import { createBulletinBoardApp } from './features/bulletin-board/bulletin-board-app.js';
import {
  type RideRouteApp,
  registerRideRoutes,
} from './features/ride-operations/ride-routes.js';
import type { RideService } from './features/ride-operations/ride-service.js';

export type CentralFeatureMembershipRepository = {
  findActiveByUserId: (
    userId: string,
  ) => Promise<{ tenantId: string; role: MemberRole } | null>;
};

export type CentralFeatureRoutes = {
  authTeamSelection?: { repository: AuthTeamSelectionRepository };
  boardContact?: { repository: BoardContactRepository };
  bulletinBoard?: { repository: BulletinBoardRepository };
  ride?: { service: RideService };
};

export type CentralFeatureRouteOptions = {
  verifyToken?: TokenVerifier;
  membershipRepository?: CentralFeatureMembershipRepository;
  features?: CentralFeatureRoutes;
  rideApp: Hono<ApiEnv>;
  getRideAuth: (context: Context) => {
    tenantId: string;
    userId: string;
    role: MemberRole;
  } | null;
};

// 各featureの認証・認可・入力検証を再実装せず、現行developのroute factoryを中央APIへ接続する。
export function mountCentralFeatureRoutes(options: CentralFeatureRouteOptions) {
  const { features } = options;
  const common = {
    verifyToken: options.verifyToken,
    membershipRepository: options.membershipRepository,
  };

  if (features?.authTeamSelection)
    options.rideApp.route(
      '/api/v1/auth',
      createAuthTeamSelectionApp({
        verifyToken: options.verifyToken,
        repository: features.authTeamSelection.repository,
      }),
    );

  if (features?.boardContact)
    options.rideApp.route(
      '/',
      createBoardContactApp({
        ...common,
        boardContactRepository: features.boardContact.repository,
        useCentralAuth: true,
      }),
    );

  if (features?.bulletinBoard)
    options.rideApp.route(
      '/',
      createBulletinBoardApp({
        ...common,
        bulletinBoardRepository: features.bulletinBoard.repository,
        useCentralAuth: true,
      }),
    );

  if (features?.ride) {
    registerRideRoutes(options.rideApp as unknown as RideRouteApp, {
      service: features.ride.service,
      getAuth: options.getRideAuth,
    });
  }
}
