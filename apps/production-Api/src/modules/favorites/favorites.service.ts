import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class FavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    // Saved merges engineers and service providers in one list, so each row
    // carries the professional's card fields — no per-row detail fetch, and
    // no schema change (Favorite has no Prisma relation to join on).
    const rows = await this.prisma.favorite.findMany({
      where: { userId },
      select: { professionalId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!rows.length) return [];
    const profiles = await this.prisma.professionalProfile.findMany({
      where: { id: { in: rows.map(row => row.professionalId) } },
      select: { id: true, fullName: true, avatarUrl: true, title: true,
        verificationStatus: true, averageRating: true, totalReviewsCount: true,
        isAvailable: true, baseCity: true, startingPrice: true,
        engineerProfile: { select: { consultationFee: true } } },
    });
    const byId = new Map(profiles.map(profile => [profile.id, profile]));
    return rows.map(row => ({ professionalId: row.professionalId, createdAt: row.createdAt,
      professional: byId.get(row.professionalId) ?? null }));
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
