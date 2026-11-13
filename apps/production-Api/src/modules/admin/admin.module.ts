import { Module } from "@nestjs/common";
import {
  AdminController,
  AdminOperationsController,
} from "./admin.controller";
import { AdminService } from "./admin.service";
import { NotificationsModule } from "../notifications/notifications.module";
import { ChatModule } from "../chat/chat.module";

@Module({
  imports: [NotificationsModule, ChatModule],
  controllers: [AdminController, AdminOperationsController],
  providers: [AdminService],
})
export class AdminModule {}
