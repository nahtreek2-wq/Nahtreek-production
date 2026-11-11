import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class FavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    // Saved merges engineers and service providers in one list, so each row
    // carries the professional's card fields — no per-row detail fetch.
    // F-004: professional is a real FK now, so one join replaces the manual
    // merge, and deleting a profile cascades its favorites (no null rows).
    const rows = await this.prisma.favorite.findMany({
      where: { userId },
      include: { professional: { select: { id: true, fullName: true, avatarUrl: true, title: true,
        verificationStatus: true, averageRating: true, totalReviewsCount: true,
        isAvailable: true, baseCity: true, startingPricePaisa: true,
        engineerProfile: { select: { consultationFeePaisa: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(row => ({ professionalId: row.professionalId, createdAt: row.createdAt,
      professional: row.professional }));
  }

  async add(userId: string, professionalId: string) {
    const professional = await this.prisma.professionalProfile.findUnique({ where: { id: professionalId } });
    if (!professional) throw new NotFoundException('Professional not found');
    return this.prisma.favorite.upsert({
      where: { userId_professionalId: { userId, professionalId } },
      create: { userId, professionalId },
      update: {},
      select: { professionalId: true, createdAt: true },
    });
  }

  async remove(userId: string, professionalId: string) {
    await this.prisma.favorite.deleteMany({ where: { userId, professionalId } });
    return { ok: true };
  }
}
