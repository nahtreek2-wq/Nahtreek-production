import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import {DEFAULT_NOTIFICATION_PREFERENCES} from './preferences';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async preferences(userId: string) {
    const row = await this.prisma.notificationPreference.findUnique({where: {userId}});
    return row ? {requestUpdates: row.requestUpdates, messages: row.messages, offers: row.offers} : DEFAULT_NOTIFICATION_PREFERENCES;
  }

  async updatePreferences(userId: string, data: Partial<typeof DEFAULT_NOTIFICATION_PREFERENCES>) {
    await this.prisma.notificationPreference.upsert({where: {userId}, create: {userId, ...data}, update: data});
    return this.preferences(userId);
  }

  async list(userId: string, query: { page?: string; limit?: string }) {
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    const where = { userId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
    ]);
    return {
      data: items.map(item => ({
        id: item.id,
        kind: item.kind,
        title: item.title,
        body: item.body,
        time: item.createdAt,
        isRead: item.isRead,
        data: item.data ?? undefined,
      })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true } });
    return { ok: true };
  }

  async markRead(id: string, userId: string) {
    const updated = await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true },
    });
    if (!updated.count) throw new NotFoundException('Notification not found');
    return { ok: true };
  }

  async push(userId: string, notification: { kind: NotificationKind; title: string; body: string; data?: Prisma.InputJsonValue }) {
    return this.prisma.notification.create({
      data: {
        userId,
        kind: notification.kind,
        title: notification.title,
        body: notification.body,
        data: notification.data,
      },
    });
  }
}
