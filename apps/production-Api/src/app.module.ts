import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule } from "./modules/auth/auth.module";
import { DiscoveryModule } from "./modules/discovery/discovery.module";
import { RequestsModule } from "./modules/requests/requests.module";
import { ChatModule } from "./modules/chat/chat.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { FavoritesModule } from "./modules/favorites/favorites.module";
import { PrismaModule } from "./common/prisma/prisma.module";
import { ClientsModule } from "./modules/clients/clients.module";
import { PlatformModule } from "./modules/platform/platform.module";
import { AiModule } from "./modules/ai/ai.module";
import { HealthController } from "./health.controller";
import { AdminModule } from "./modules/admin/admin.module";
import { PaymentsModule } from "./modules/payments/payments.module";
import { MembershipsModule } from "./modules/memberships/memberships.module";
import { SupportModule } from "./modules/support/support.module";

@Module({
  controllers: [HealthController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    ClientsModule,
    PlatformModule,
    AuthModule,
    DiscoveryModule,
    RequestsModule,
    ChatModule,
    NotificationsModule,
    FavoritesModule,
    AiModule,
    AdminModule,
    PaymentsModule,
    MembershipsModule,
    SupportModule,
  ],
})
export class AppModule {}
