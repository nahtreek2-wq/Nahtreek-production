import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { normalizePlace } from '../../common/place';
import {pagination} from '../platform/platform.service';
import {haversineKm, scoreEngineer} from './rank';

// Ranking pool cap: top-sort scores in memory, so bound the candidate set.
// 500 verified profiles per city filter is far beyond current supply.
const RANK_POOL_SIZE = 500;

function parseCoords(lat?: string, lng?: string) {
  if (lat === undefined || lng === undefined) return undefined;
  const parsedLat = Number(lat);
  const parsedLng = Number(lng);
  if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) return undefined;
  if (Math.abs(parsedLat) > 90 || Math.abs(parsedLng) > 180) return undefined;
  return {lat: parsedLat, lng: parsedLng};
}

const engineerInclude = () => ({
  specializations: { include: { specialization: true } },
  profile: {
    include: {
      portfolioItems: { orderBy: { createdAt: 'desc' as const } },
      serviceAreas: { orderBy: { name: 'asc' as const } },
      availabilitySlots: { where: { isAvailable: true, startsAt: { gte: new Date() } }, orderBy: { startsAt: 'asc' as const }, take: 1 },
      reviewsReceived: {
        // Select only fields used by the public engineer card. Keeping this
        // projection explicit prevents unrelated review schema additions
        // from breaking discovery during a staged database migration.
        select: {
          rating: true,
          comment: true,
          createdAt: true,
          client: {select: {fullName: true}},
        },
        orderBy: { createdAt: 'desc' as const },
        take: 10,
      },
    },
  },
} satisfies Prisma.EngineerProfileInclude);

@Injectable()
export class DiscoveryService {
  constructor(private readonly prisma: PrismaService) {}

  async specializations() {
    return this.prisma.specialization.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, description: true, iconUrl: true },
    });
  }

  async getEngineers(query: { specialization?: string; sort?: string; page?: string; limit?: string; city?: string; state?: string; lat?: string; lng?: string }) {
    const {page, limit} = pagination(query.page, query.limit);
    const coords = parseCoords(query.lat, query.lng);
    const where = {
      profile: {
        verificationStatus: 'VERIFIED' as const,
        user: { status: 'ACTIVE' as const, deletedAt: null },
        ...(query.city?.trim() ? { baseCityNorm: normalizePlace(query.city) } : {}),
        ...(query.state?.trim() ? { baseStateNorm: normalizePlace(query.state) } : {}),
        ...(query.sort === 'available' ? { isAvailable: true } : {}),
      },
      ...(query.specialization
        ? { specializations: { some: { specialization: { name: { equals: query.specialization, mode: 'insensitive' as const } } } } }
        : {}),
    };
    if (query.sort === undefined || query.sort === 'top') {
      const [pool, total] = await this.prisma.$transaction([
        this.prisma.engineerProfile.findMany({where, include: engineerInclude(), take: RANK_POOL_SIZE}),
        this.prisma.engineerProfile.count({where}),
      ]);
      const ranked = pool
        .map(engineer => ({engineer, rank: this.rankEngineer(engineer, coords)}))
        .sort((a, b) => b.rank.rankScore - a.rank.rankScore || b.engineer.profile.averageRating - a.engineer.profile.averageRating);
      const items = ranked.slice((page - 1) * limit, page * limit);
      return {
        data: items.map(({engineer, rank}) => this.serializeEngineer(engineer, rank)),
        meta: {page, limit, total, totalPages: Math.ceil(total / limit)},
      };
    }
    const [engineers, total] = await this.prisma.$transaction([
      this.prisma.engineerProfile.findMany({
        where,
        include: engineerInclude(),
        orderBy: this.orderFor(query.sort),
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.engineerProfile.count({ where }),
    ]);
    return {
      data: engineers.map(engineer => this.serializeEngineer(engineer, this.rankEngineer(engineer, coords))),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async getEngineer(id: string) {
    // Saved hearts and QR links carry the professional profile id, discovery
    // cards the engineer id — accept both so either entry opens the profile.
    const engineer = await this.prisma.engineerProfile.findFirst({
      where: { OR: [{ id }, { professionalProfileId: id }],
        profile: { verificationStatus: 'VERIFIED', user: { status: 'ACTIVE', deletedAt: null } } },
      include: engineerInclude(),
    });
    if (!engineer) throw new NotFoundException('Engineer not found');
    return this.serializeEngineer(engineer, this.rankEngineer(engineer));
  }

  // Public provider card + reviews for the QR ratings landing. Only active,
  // non-deleted accounts; verification status is exposed so the app can say
  // whether the pro is currently verified.
  async getProvider(id: string) {
    const profile = await this.prisma.professionalProfile.findFirst({
      where: {id, user: {status: 'ACTIVE', deletedAt: null}},
      include: {reviewsReceived: {orderBy: {createdAt: 'desc'}, take: 10,
        include: {client: {select: {fullName: true}}}}},
    });
    if (!profile) throw new NotFoundException('Professional not found');
    return {
      id: profile.id, fullName: profile.fullName, avatarUrl: profile.avatarUrl, title: profile.title,
      bio: profile.bio, baseCity: profile.baseCity, baseState: profile.baseState,
      yearsOfExperience: profile.yearsOfExperience, serviceCategories: profile.serviceCategories,
      averageRating: profile.averageRating, totalReviewsCount: profile.totalReviewsCount,
      verificationStatus: profile.verificationStatus, isMember: profile.memberPriority,
      reviews: profile.reviewsReceived.map(review => ({id: review.id, rating: review.rating,
        comment: review.comment, createdAt: review.createdAt, clientName: review.client.fullName})),
    };
  }

  async getProviderByCode(code: string) {
    const normalized = code.trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(normalized)) throw new BadRequestException('Enter the 6-character code under the QR');
    const profile = await this.prisma.professionalProfile.findUnique({where: {reviewCode: normalized}, select: {id: true}});
    if (!profile) throw new NotFoundException('Code not recognized. Check it and try again.');
    return {professionalProfileId: profile.id};
  }

  async search(query: string, city?: string, state?: string, lat?: string, lng?: string) {
    const term = query.trim();
    if (term.length < 2) {
      throw new BadRequestException('Search query must contain at least two characters');
    }
    const coords = parseCoords(lat, lng);
    const engineers = await this.prisma.engineerProfile.findMany({
      where: {
        profile: {
          verificationStatus: 'VERIFIED',
          user: { status: 'ACTIVE', deletedAt: null },
          ...(city?.trim() ? { baseCityNorm: normalizePlace(city) } : {}),
          ...(state?.trim() ? { baseStateNorm: normalizePlace(state) } : {}),
        },
        OR: [
          {
            profile: {
              verificationStatus: 'VERIFIED',
              OR: [
                { fullName: { contains: term, mode: 'insensitive' } },
                { title: { contains: term, mode: 'insensitive' } },
              ],
            },
          },
          {
            profile: { verificationStatus: 'VERIFIED' },
            specializations: { some: { specialization: { name: { contains: term, mode: 'insensitive' } } } },
          },
        ],
      },
      include: engineerInclude(),
      take: 20,
    });
    const ranked = engineers
      .map(engineer => ({engineer, rank: this.rankEngineer(engineer, coords)}))
      .sort((a, b) => b.rank.rankScore - a.rank.rankScore);
    return { engineers: ranked.map(({engineer, rank}) => this.serializeEngineer(engineer, rank)) };
  }

  private rankEngineer(
    engineer: {profile: {
      averageRating: number; totalReviewsCount: number; isAvailable: boolean;
      memberPriority: boolean; yearsOfExperience: number;
      baseLatitude: number; baseLongitude: number;
      availabilitySlots: {startsAt: Date}[];
    }},
    coords?: {lat: number; lng: number},
  ) {
    const distanceKm = coords
      ? Math.round(haversineKm(coords.lat, coords.lng, engineer.profile.baseLatitude, engineer.profile.baseLongitude) * 10) / 10
      : undefined;
    const {score, factors} = scoreEngineer({
      averageRating: engineer.profile.averageRating,
      totalReviewsCount: engineer.profile.totalReviewsCount,
      isAvailable: engineer.profile.isAvailable,
      memberPriority: engineer.profile.memberPriority,
      yearsOfExperience: engineer.profile.yearsOfExperience,
      nextSlotStartsAt: engineer.profile.availabilitySlots[0]?.startsAt,
      distanceKm,
    });
    return {distanceKm, rankScore: score, rankFactors: factors};
  }

  private orderFor(sort?: string) {
    const membersFirst = { profile: { memberPriority: 'desc' as const } };
    switch (sort) {
      case 'fee':
        return [membersFirst, { consultationFeePaisa: 'asc' as const }];
      case 'available':
        return [membersFirst, { profile: { isAvailable: 'desc' as const } }];
      default:
        return [membersFirst, { profile: { averageRating: 'desc' as const } }];
    }
  }

  private serializeEngineer(engineer: {
    id: string;
    professionalProfileId: string;
    consultationFeePaisa: number | null;
    qualificationDegree: string;
    institution: string;
    graduationYear: number;
    licenseNumber: string | null;
    specializations: { specialization: { name: string } }[];
    profile: {
      fullName: string;
      avatarUrl: string | null;
      coverUrl: string | null;
      title: string;
      bio: string | null;
      yearsOfExperience: number;
      verificationStatus: string;
      averageRating: number;
      totalReviewsCount: number;
      isAvailable: boolean;
      baseCity: string;
      baseLatitude: number;
      baseLongitude: number;
      memberPriority: boolean;
      portfolioItems: { title: string; description: string | null; imageUrl: string; createdAt: Date }[];
      serviceAreas: { name: string }[];
      availabilitySlots: { startsAt: Date }[];
      reviewsReceived: { rating: number; comment: string; createdAt: Date; client: { fullName: string } }[];
    };
  }, extras?: {distanceKm?: number; rankScore?: number; rankFactors?: string[]}) {
    return {
      id: engineer.id,
      ...(extras?.distanceKm !== undefined ? {distanceKm: extras.distanceKm} : {}),
      ...(extras?.rankScore !== undefined ? {rankScore: extras.rankScore, rankFactors: extras.rankFactors ?? []} : {}),
      professionalProfileId: engineer.professionalProfileId,
      fullName: engineer.profile.fullName,
      avatarUrl: engineer.profile.avatarUrl ?? undefined,
      coverUrl: engineer.profile.coverUrl ?? undefined,
      title: engineer.profile.title,
      qualificationDegree: engineer.qualificationDegree,
      institution: engineer.institution,
      graduationYear: engineer.graduationYear,
      licenseNumber: engineer.licenseNumber ?? undefined,
      bio: engineer.profile.bio ?? undefined,
      yearsOfExperience: engineer.profile.yearsOfExperience,
      verificationStatus: engineer.profile.verificationStatus,
      averageRating: engineer.profile.averageRating,
      totalReviewsCount: engineer.profile.totalReviewsCount,
      isAvailable: engineer.profile.isAvailable,
      baseCity: engineer.profile.baseCity,
      baseLatitude: engineer.profile.baseLatitude,
      baseLongitude: engineer.profile.baseLongitude,
      isMember: engineer.profile.memberPriority,
      specializations: engineer.specializations.map(item => item.specialization.name),
      consultationFeePaisa: engineer.consultationFeePaisa ?? undefined,
      nextSlot: engineer.profile.availabilitySlots[0]?.startsAt.toISOString(),
      serviceAreas: engineer.profile.serviceAreas.map(area => area.name),
      portfolio: engineer.profile.portfolioItems.map(item => ({
        title: item.title,
        meta: item.description ?? '',
        imageUrl: item.imageUrl,
      })),
      reviews: engineer.profile.reviewsReceived.map(review => ({
        name: review.client.fullName,
        rating: review.rating,
        comment: review.comment,
        date: review.createdAt.toISOString(),
      })),
    };
  }
}
