import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomInt, randomUUID } from "crypto";
import * as QRCode from "qrcode";
import { signedAssetUrl, uploadAsset } from "../../common/storage";
import { Prisma, RequestStatus, Role } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import {isPlusClient, plusClientIds} from "../memberships/membership-reads";
import { normalizePlace } from "../../common/place";
import {resolveServiceCategory, serviceCategoryKeys} from './service-category';
import {
  CreateServiceRequestDto,
  CreateAvailabilitySlotDto,
  ProfessionalIdentityDraftDto,
  ProfessionalPhotoDto,
  PortfolioPhotoDto,
  ProfessionalSetupDto,
  ServiceCategoryDto,
  TransitionDto,
  VerificationDocumentUploadDto,
} from "./platform.dto";

const providerSelect = {
  id: true,
  fullName: true,
  avatarUrl: true,
  title: true,
  bio: true,
  yearsOfExperience: true,
  verificationStatus: true,
  averageRating: true,
  totalReviewsCount: true,
  isAvailable: true,
  baseCity: true,
  baseState: true,
  baseLatitude: true,
  baseLongitude: true,
  serviceCategories: true,
  startingPrice: true,
  memberPriority: true,
} satisfies Prisma.ProfessionalProfileSelect;
const requestInclude = {
  journey: {select: {stage: true}},
  category: true,
  provider: { select: providerSelect },
  client: { select: { fullName: true, avatarUrl: true } },
  statusHistory: { orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.ServiceRequestInclude;
export const PROVIDER_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  DRAFT: ["PENDING"],
  PENDING: ["ACCEPTED", "DECLINED"],
  ACCEPTED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED"],
  DECLINED: [],
  COMPLETED: [],
  CANCELLED: [],
};

function hasValidDocumentSignature(content: Buffer, mimeType: string) {
  if (mimeType === "application/pdf") return content.subarray(0, 5).toString() === "%PDF-";
  if (mimeType === "image/jpeg") return content.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  if (mimeType === "image/png") return content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return mimeType === "image/webp" && content.subarray(0, 4).toString() === "RIFF" && content.subarray(8, 12).toString() === "WEBP";
}

export function pagination(pageValue?: string, limitValue?: string) {
  const page = Number(pageValue ?? 1);
  const limit = Number(limitValue ?? 20);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    throw new BadRequestException(
      "Use a positive page and a limit between 1 and 100"
    );
  }
  return { page, limit, skip: (page - 1) * limit };
}

@Injectable()
export class PlatformService {
  constructor(private readonly prisma: PrismaService) {}

  async categories() {
    const categories = await this.prisma.serviceCategory.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
    });
    return categories.sort(
      (a, b) =>
        Number(b.group === "Home Services") -
        Number(a.group === "Home Services")
    );
  }

  async saveCategory(dto: ServiceCategoryDto, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const category = await tx.serviceCategory.upsert({
        where: { slug: dto.slug },
        create: dto,
        update: dto,
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: "SERVICE_UPDATED",
          entity: "ServiceCategory",
          entityId: category.id,
        },
      });
      return category;
    });
  }

  async providers(query: {
    city?: string;
    state?: string;
    serviceId?: string;
    page?: string;
    limit?: string;
  }) {
    const { page, limit, skip } = pagination(query.page, query.limit);
    const category = query.serviceId
      ? await resolveServiceCategory(this.prisma, query.serviceId)
      : null;
    const where: Prisma.ProfessionalProfileWhereInput = {
      verificationStatus: "VERIFIED",
      user: {
        status: "ACTIVE",
        deletedAt: null,
        roles: { some: { role: Role.SERVICE_PROVIDER } },
      },
      ...(query.city?.trim() ? { baseCityNorm: normalizePlace(query.city) } : {}),
      ...(query.state?.trim()
        ? { baseStateNorm: normalizePlace(query.state) }
        : {}),
      ...(category
        ? { serviceCategories: { hasSome: serviceCategoryKeys(category) } }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.professionalProfile.findMany({
        where,
        select: {...providerSelect, portfolioItems: {orderBy: {createdAt: 'desc'}}},
        skip,
        take: limit,
        orderBy: [{ memberPriority: "desc" }, { averageRating: "desc" }],
      }),
      this.prisma.professionalProfile.count({ where }),
    ]);
    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // Provider ratings QR: a scannable link to this pro's public reviews plus a
  // 6-character manual code (no ambiguous 0/O/1/I). The code is minted once
  // and kept stable so printed cards keep working.
  async reviewQr(userId: string) {
    const profile = await this.prisma.professionalProfile.findUnique({where: {userId}});
    if (!profile) throw new NotFoundException('Professional profile not found');
    let code = profile.reviewCode;
    if (!code) {
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      for (let attempt = 0; attempt < 5 && !code; attempt++) {
        const candidate = Array.from({length: 6}, () => alphabet[randomInt(alphabet.length)]).join('');
        try {
          const minted = await this.prisma.professionalProfile.updateMany({where: {id: profile.id, reviewCode: null},
            data: {reviewCode: candidate}});
          if (minted.count === 1) code = candidate;
        } catch {
          // Candidate collision on the unique code — retry with a fresh one.
        }
        if (!code) code = (await this.prisma.professionalProfile.findUnique({where: {id: profile.id}, select: {reviewCode: true}}))?.reviewCode ?? null;
      }
      if (!code) throw new ServiceUnavailableException('Could not mint a review code. Try again.');
    }
    const base = (process.env.PUBLIC_WEB_URL || 'https://nahtreek-website.vercel.app').replace(/\/$/, '');
    const url = `${base}/p/${profile.id}`;
    const qrPng = await QRCode.toDataURL(url, {width: 512, margin: 2, errorCorrectionLevel: 'M'});
    return {url, code, qrPng, fullName: profile.fullName,
      averageRating: profile.averageRating, totalReviewsCount: profile.totalReviewsCount};
  }

  async professional(userId: string) {
    const account = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        roles: { select: { role: true } },
        professionalProfile: {
          include: {
            portfolioItems: {orderBy: {createdAt: 'desc'}},
            reviewsReceived: {
              orderBy: {createdAt: 'desc'},
              take: 50,
              select: {
                id: true,
                rating: true,
                comment: true,
                createdAt: true,
                client: {select: {fullName: true}},
                engineerRequest: {select: {projectTitle: true}},
                serviceRequest: {select: {category: {select: {title: true}}}},
              },
            },
            _count: {select: {serviceRequests: {where: {status: 'COMPLETED'}}}},
            engineerProfile: {
              include: {
                _count: {select: {requests: {where: {status: 'COMPLETED'}}}},
                specializations: { include: { specialization: true } },
              },
            },
          },
        },
      },
    });
    if (!account) throw new NotFoundException("Professional account not found");
    const professionalType = account.roles.some(
      ({ role }) => role === Role.ENGINEER
    )
      ? "CIVIL_ENGINEER"
      : "SERVICE_PROFESSIONAL";
    const profile = account.professionalProfile;
    return {
      professionalType,
      profile: profile ? {
        ...profile,
        completedJobs: profile._count.serviceRequests + (profile.engineerProfile?._count.requests ?? 0),
        rating: profile.totalReviewsCount > 0 ? profile.averageRating : null,
        reviewCount: profile.totalReviewsCount,
      } : null,
      onboarding: {
        currentStep: profile?.onboardingStep ?? "IDENTITY",
        identityCompleted: Boolean(
          profile?.fullName && profile.baseCity && profile.baseState
        ),
        canSubmitVerification: Boolean(
          profile?.fullName &&
            profile.title &&
            profile.baseCity &&
            profile.baseState &&
            profile.baseLatitude != null &&
            profile.baseLongitude != null
        ),
      },
    };
  }

  async saveProfessionalIdentity(
    userId: string,
    dto: ProfessionalIdentityDraftDto
  ) {
    const allowed = await this.prisma.userRole.findFirst({
      where: {
        userId,
        role: { in: [Role.ENGINEER, Role.SERVICE_PROVIDER] },
      },
    });
    if (!allowed) throw new NotFoundException("Professional account not found");
    return this.prisma.$transaction(async (tx) => {
      const profile = await tx.professionalProfile.upsert({
        where: { userId },
        create: {
          userId,
          fullName: dto.fullName.trim(),
          baseCity: dto.baseCity.trim(),
          baseState: dto.baseState.trim(),
          baseCityNorm: normalizePlace(dto.baseCity),
          baseStateNorm: normalizePlace(dto.baseState),
          onboardingStep: "CAPABILITIES",
        },
        update: {
          fullName: dto.fullName.trim(),
          baseCity: dto.baseCity.trim(),
          baseState: dto.baseState.trim(),
          baseCityNorm: normalizePlace(dto.baseCity),
          baseStateNorm: normalizePlace(dto.baseState),
          onboardingStep: "CAPABILITIES",
        },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: "PROFESSIONAL_IDENTITY_SAVED",
          entity: "ProfessionalProfile",
          entityId: profile.id,
        },
      });
      return profile;
    });
  }

  async professionalPhoto(userId: string, dto: ProfessionalPhotoDto) {
    const profile = await this.prisma.professionalProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) throw new NotFoundException("Complete your identity first");

    const content = Buffer.from(dto.contentBase64, "base64");
    const extension =
      dto.mimeType === "image/jpeg"
        ? "jpg"
        : dto.mimeType === "image/png"
        ? "png"
        : "webp";
    const valid =
      extension === "jpg"
        ? content.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
        : extension === "png"
        ? content
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : content.subarray(0, 4).toString() === "RIFF" &&
          content.subarray(8, 12).toString() === "WEBP";
    if (!valid || content.length > 1000000) {
      throw new BadRequestException(
        "Choose a JPG, PNG or WebP image under 1 MB"
      );
    }

    const filename = `${randomUUID()}.${extension}`;
    const avatarUrl = await uploadAsset(
      "avatars",
      filename,
      content,
      dto.mimeType
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.professionalProfile.update({
        where: { id: profile.id },
        data: { avatarUrl },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: "PROFESSIONAL_PHOTO_UPDATED",
          entity: "ProfessionalProfile",
          entityId: profile.id,
        },
      });
    });
    return { avatarUrl };
  }

  async addPortfolio(userId: string, dto: PortfolioPhotoDto) {
    if (dto.title.trim().length < 2) throw new BadRequestException('Add a short title for this work');
    const profile = await this.prisma.professionalProfile.findUnique({where: {userId}});
    if (!profile) throw new NotFoundException('Complete your profile first');
    const content = Buffer.from(dto.contentBase64, 'base64');
    if (!content.length || content.length > 1000000 || !hasValidDocumentSignature(content, dto.mimeType)) {
      throw new BadRequestException('Choose a valid JPG, PNG or WebP photo under 1 MB');
    }
    const extension = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'}[dto.mimeType];
    const imageUrl = await uploadAsset('work-photos', `${randomUUID()}.${extension}`, content, dto.mimeType);
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "ProfessionalProfile" WHERE "id" = ${profile.id} FOR UPDATE`;
      if (await tx.portfolioItem.count({where: {professionalProfileId: profile.id}}) >= 20) {
        throw new BadRequestException('You can display up to 20 work photos. Remove one before adding another.');
      }
      return tx.portfolioItem.create({data: {professionalProfileId: profile.id, title: dto.title.trim(), description: dto.description?.trim(), imageUrl}});
    });
  }

  async removePortfolio(userId: string, id: string) {
    const result = await this.prisma.portfolioItem.deleteMany({where: {id, profile: {userId}}});
    if (!result.count) throw new NotFoundException('Work photo not found');
    return {ok: true};
  }

  async verificationDocuments(userId: string) {
    const profile = await this.prisma.professionalProfile.findUnique({
      where: { userId },
      include: { verificationDocuments: { orderBy: { uploadedAt: "desc" } } },
    });
    if (!profile) throw new NotFoundException("Complete your profile first");
    // This screen needs review status, not signed file URLs. Admin signs documents
    // only when reviewing them; avoid a storage round-trip per proof on every visit.
    return profile.verificationDocuments.map(({documentUrl, ...document}) => document);
  }

  async uploadVerificationDocument(
    userId: string,
    dto: VerificationDocumentUploadDto
  ) {
    const profile = await this.prisma.professionalProfile.findUnique({
      where: { userId },
    });
    if (!profile) throw new NotFoundException("Complete your profile first");
    const extension: Record<string, string> = {
      "application/pdf": "pdf",
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
    };
    const content = Buffer.from(dto.contentBase64, "base64");
    if (!content.length || content.length > 1100000 || !hasValidDocumentSignature(content, dto.mimeType)) {
      throw new BadRequestException("Choose a valid PDF, JPG, PNG or WebP document under 1 MB");
    }
    const filename = `${userId}-${dto.documentType}-${randomUUID()}.${
      extension[dto.mimeType]
    }`;
    const documentUrl = await uploadAsset(
      "verification-documents",
      filename,
      content,
      dto.mimeType
    );
    return this.prisma.$transaction(async (tx) => {
      const document = await tx.verificationDocument.create({
        data: {
          professionalProfileId: profile.id,
          documentType: dto.documentType,
          documentUrl,
        },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: "VERIFICATION_DOCUMENT_UPLOADED",
          entity: "VerificationDocument",
          entityId: document.id,
          metadata: { documentType: dto.documentType },
        },
      });
      return { ...document, documentUrl: await signedAssetUrl(documentUrl) };
    });
  }

  async submitVerification(userId: string) {
    return this.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ProfessionalProfile" WHERE "userId" = ${userId} FOR UPDATE`;
    const profile = await tx.professionalProfile.findUnique({
      where: { userId },
      include: {
        user: { include: { roles: true } },
        verificationDocuments: true,
      },
    });
    if (!profile) throw new NotFoundException("Complete your profile first");
    if (profile.verificationStatus === 'VERIFIED') throw new BadRequestException('Your profile is already verified.');
    const engineer = profile.user.roles.some(
      ({ role }) => role === Role.ENGINEER
    );
    const required = engineer
      ? ["identity-proof", "address-proof", "qualification"]
      : ["identity-proof", "address-proof", "work-sample"];
    const uploaded = new Set(
      profile.verificationDocuments.filter(item => item.status !== 'REJECTED').map((item) => item.documentType)
    );
    const missing = required.filter((item) => !uploaded.has(item));
    if (missing.length) {
      throw new BadRequestException(
        `Upload required documents: ${missing.join(", ")}`
      );
    }
      const updated = await tx.professionalProfile.update({
        where: { id: profile.id },
        data: { verificationStatus: "UNDER_REVIEW", onboardingStep: "REVIEW" },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: "VERIFICATION_SUBMITTED",
          entity: "ProfessionalProfile",
          entityId: profile.id,
        },
      });
      return updated;
    });
  }

  async availability(userId: string, range: { from?: string; to?: string }) {
    const from = range.from ? new Date(range.from) : new Date();
    const to = range.to
      ? new Date(range.to)
      : new Date(from.getTime() + 30 * 24 * 60 * 60 * 1000);
    if (
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime()) ||
      to <= from ||
      to.getTime() - from.getTime() > 93 * 24 * 60 * 60 * 1000
    ) {
      throw new BadRequestException(
        "Choose a valid availability range up to 93 days"
      );
    }
    const profile = await this.prisma.professionalProfile.findUnique({
      where: { userId },
      select: { id: true, isAvailable: true },
    });
    if (!profile) throw new NotFoundException("Complete your identity first");
    const slots = await this.prisma.availabilitySlot.findMany({
      where: {
        professionalProfileId: profile.id,
        startsAt: { lt: to },
        endsAt: { gt: from },
      },
      orderBy: { startsAt: "asc" },
    });
    return { isAvailable: profile.isAvailable, slots };
  }

  async createAvailability(userId: string, dto: CreateAvailabilitySlotDto) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (
      Number.isNaN(startsAt.getTime()) ||
      Number.isNaN(endsAt.getTime()) ||
      startsAt < new Date() ||
      endsAt <= startsAt ||
      endsAt.getTime() - startsAt.getTime() > 24 * 60 * 60 * 1000
    ) {
      throw new BadRequestException(
        "Choose a future time slot lasting no more than 24 hours"
      );
    }
    const profile = await this.prisma.professionalProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) throw new NotFoundException("Complete your identity first");
    const overlap = await this.prisma.availabilitySlot.findFirst({
      where: {
        professionalProfileId: profile.id,
        startsAt: { lt: endsAt },
        endsAt: { gt: startsAt },
      },
    });
    if (overlap)
      throw new ConflictException("This time overlaps an existing slot");
    return this.prisma.$transaction(async (tx) => {
      const slot = await tx.availabilitySlot.create({
        data: {
          professionalProfileId: profile.id,
          startsAt,
          endsAt,
          isAvailable: true,
        },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: "AVAILABILITY_ADDED",
          entity: "AvailabilitySlot",
          entityId: slot.id,
        },
      });
      return slot;
    });
  }

  async deleteAvailability(userId: string, slotId: string) {
    const slot = await this.prisma.availabilitySlot.findFirst({
      where: { id: slotId, profile: { userId } },
      select: { id: true, startsAt: true },
    });
    if (!slot) throw new NotFoundException("Availability slot not found");
    if (slot.startsAt <= new Date()) {
      throw new BadRequestException("Past availability cannot be changed");
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.availabilitySlot.delete({ where: { id: slot.id } });
      await tx.auditLog.create({
        data: {
          userId,
          action: "AVAILABILITY_REMOVED",
          entity: "AvailabilitySlot",
          entityId: slot.id,
        },
      });
    });
    return { ok: true };
  }

  async setWorkStatus(userId: string, isAvailable: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.professionalProfile.updateMany({
        where: { userId, ...(isAvailable ? { verificationStatus: "VERIFIED" } : {}) },
        data: { isAvailable },
      });
      if (changed.count !== 1) {
        const exists = await tx.professionalProfile.findUnique({
          where: { userId },
          select: { id: true },
        });
        if (!exists) throw new NotFoundException("Complete your identity first");
        throw new BadRequestException("Your profile must be approved before you can become available for work");
      }
      const updated = await tx.professionalProfile.findUnique({
        where: { userId },
        select: { id: true, isAvailable: true },
      });
      if (!updated) throw new NotFoundException("Complete your identity first");
      const activeServiceCount = !isAvailable
        ? await tx.serviceRequest.count({
            where: {professionalProfileId: updated.id, status: {in: [RequestStatus.ACCEPTED, RequestStatus.IN_PROGRESS]}},
          })
        : 0;
      await tx.auditLog.create({
        data: {
          userId,
          action: isAvailable ? "WORK_STATUS_AVAILABLE" : "WORK_STATUS_PAUSED",
          entity: "ProfessionalProfile",
          entityId: updated.id,
        },
      });
      return {isAvailable: updated.isAvailable, retainLocationSharing: activeServiceCount > 0};
    });
  }

  async setup(userId: string, dto: ProfessionalSetupDto) {
    const account = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { roles: { select: { role: true } } },
    });
    const expectedRole =
      dto.kind === "engineer" ? Role.ENGINEER : Role.SERVICE_PROVIDER;
    if (!account?.roles.some(({ role }) => role === expectedRole)) {
      throw new BadRequestException(
        "This profile type does not match the professional account"
      );
    }
    if (
      dto.kind === "engineer" &&
      (!dto.qualificationDegree?.trim() ||
        !dto.institution?.trim() ||
        !dto.graduationYear ||
        dto.graduationYear > new Date().getFullYear())
    ) {
      throw new BadRequestException(
        "Engineers must provide their degree, institution and valid graduation year"
      );
    }
    const specializationIds = [...new Set(dto.specializationIds ?? [])];
    if (dto.kind === "engineer") {
      if (!specializationIds.length) {
        throw new BadRequestException(
          "Choose at least one engineering specialization"
        );
      }
      const count = await this.prisma.specialization.count({
        where: { id: { in: specializationIds } },
      });
      if (count !== specializationIds.length) {
        throw new BadRequestException(
          "One or more engineering specializations are unavailable"
        );
      }
    }
    const services = [...new Set(dto.serviceCategories ?? [])];
    if (dto.kind === "service-provider") {
      if (!services.length)
        throw new BadRequestException("Choose at least one service");
      const count = await this.prisma.serviceCategory.count({
        where: { slug: { in: services }, isActive: true },
      });
      if (count !== services.length)
        throw new BadRequestException("One or more services are unavailable");
    }
    return this.prisma.$transaction(async (tx) => {
      const data = {
        fullName: dto.fullName.trim(),
        title: dto.title.trim(),
        bio: dto.bio?.trim(),
        baseCity: dto.baseCity.trim(),
        baseState: dto.baseState.trim(),
        baseCityNorm: normalizePlace(dto.baseCity),
        baseStateNorm: normalizePlace(dto.baseState),
        baseLatitude: dto.baseLatitude,
        baseLongitude: dto.baseLongitude,
        yearsOfExperience: dto.yearsOfExperience,
        // New submissions stay unavailable until an administrator approves them.
        isAvailable: false,
        verificationStatus: "PENDING" as const,
        onboardingStep: "SUBMITTED",
        ...(dto.kind === "service-provider"
          ? { serviceCategories: services, startingPrice: dto.startingPrice }
          : {}),
      };
      const profile = await tx.professionalProfile.upsert({
        where: { userId },
        create: { userId, ...data },
        update: data,
      });
      await tx.providerPresence.updateMany({
        where: {professionalProfileId: profile.id},
        data: {online: false},
      });
      if (dto.kind === "engineer") {
        const engineerData = {
          qualificationDegree: dto.qualificationDegree.trim(),
          institution: dto.institution.trim(),
          graduationYear: dto.graduationYear,
          licenseNumber: dto.licenseNumber?.trim(),
          consultationFee: dto.consultationFee,
        };
        const engineer = await tx.engineerProfile.upsert({
          where: { professionalProfileId: profile.id },
          create: { professionalProfileId: profile.id, ...engineerData },
          update: engineerData,
        });
        if (dto.specializationIds) {
          await tx.engineerSpecialization.deleteMany({
            where: { engineerProfileId: engineer.id },
          });
          await tx.engineerSpecialization.createMany({
            data: specializationIds.map((specializationId) => ({
              engineerProfileId: engineer.id,
              specializationId,
            })),
          });
        }
      }
      await tx.auditLog.create({
        data: {
          userId,
          action: "PROFILE_SUBMITTED",
          entity: "ProfessionalProfile",
          entityId: profile.id,
        },
      });
      return profile;
    });
  }

  async createRequest(userId: string, dto: CreateServiceRequestDto) {
    if (
      dto.description.trim().length < 10 ||
      dto.locationAddress.trim().length < 5
    )
      throw new BadRequestException("Add your work details and full address");
    return this.prisma.$transaction(async (tx) => {
      const client = await tx.clientProfile.findUnique({ where: { userId } });
      const category = await resolveServiceCategory(tx, dto.serviceId);
      const provider = await tx.professionalProfile.findFirst({
        where: {
          id: dto.professionalProfileId,
          verificationStatus: "VERIFIED",
          isAvailable: true,
          serviceCategories: { hasSome: serviceCategoryKeys(category) },
          user: {
            status: "ACTIVE",
            deletedAt: null,
            roles: { some: { role: Role.SERVICE_PROVIDER } },
          },
        },
      });
      if (!client || !provider || !category)
        throw new NotFoundException(
          "This service or professional is not available"
        );
      if (provider.userId === userId)
        throw new BadRequestException("You cannot send a request to yourself");
      const request = await tx.serviceRequest.create({
        data: {
          clientProfileId: client.id,
          professionalProfileId: provider.id,
          serviceCategoryId: category.id,
          description: dto.description.trim(),
          locationAddress: dto.locationAddress.trim(),
          latitude: dto.latitude,
          longitude: dto.longitude,
          statusHistory: {
            create: { toStatus: "PENDING", changedByUserId: userId },
          },
        },
        include: requestInclude,
      });
      await tx.notification.create({
        data: {
          userId: provider.userId,
          kind: "request",
          title: "New service request",
          body: `You received a ${category.title} request.`,
          data: { serviceRequestId: request.id },
        },
      });
      await tx.auditLog.createMany({
        data: [userId, provider.userId].map((owner) => ({
          userId: owner,
          action: "REQUEST_PENDING",
          entity: "ServiceRequest",
          entityId: request.id,
          metadata: { title: category.title },
        })),
      });
      return request;
    });
  }

  async requests(userId: string, query: { page?: string; limit?: string }) {
    const { page, limit, skip } = pagination(query.page, query.limit);
    const where = { OR: [{ client: { userId } }, { provider: { userId } }] };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.serviceRequest.findMany({
        where,
        include: {...requestInclude,
          provider: {select: {...providerSelect, userId: true}},
          client: {select: {fullName: true, userId: true, avatarUrl: true}}},
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.serviceRequest.count({ where }),
    ]);
    // Pro-side sync: each row flags Plus for its provider in one batched
    // lookup, so the inbox shows priority before opening the detail.
    const mine = data.filter(row => row.provider.userId === userId);
    const plusIds = await plusClientIds(this.prisma, mine.map(row => row.client.userId));
    return {
      data: data.map(row => ({...row,
        ...(row.provider.userId === userId ? {clientPlus: plusIds.has(row.client.userId)} : {})})),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async detail(userId: string, id: string) {
    const request = await this.prisma.serviceRequest.findFirst({
      where: { id, OR: [{ client: { userId } }, { provider: { userId } }] },
      include: {
        ...requestInclude,
        provider: {select: {...providerSelect, userId: true}},
        client: {select: {fullName: true, userId: true, avatarUrl: true}},
        reviews: {select: {id: true, rating: true, comment: true, createdAt: true}},
      },
    });
    if (!request) throw new NotFoundException("Request not found");
    if (request.provider.userId !== userId) return request;
    return {...request, clientPlus: await isPlusClient(this.prisma, request.client.userId)};
  }

  async transition(userId: string, id: string, dto: TransitionDto) {
    if (await this.prisma.serviceJourney.findUnique({where: {requestId: id}, select: {requestId: true}}))
      throw new BadRequestException('Update this booking from the live service workflow. Please update the app.');
    return this.prisma.$transaction(async (tx) => {
      const request = await tx.serviceRequest.findFirst({
        where: { id, OR: [{ client: { userId } }, { provider: { userId } }] },
        include: { client: true, provider: true, category: true },
      });
      if (!request) throw new NotFoundException("Request not found");
      const clientAction = request.client.userId === userId;
      const allowed = clientAction
        ? dto.status === "CANCELLED" &&
          ["PENDING", "ACCEPTED"].includes(request.status)
        : PROVIDER_TRANSITIONS[request.status].includes(dto.status);
      if (!allowed)
        throw new BadRequestException("This status change is not allowed");
      const changed = await tx.serviceRequest.updateMany({
        where: { id, status: request.status },
        data: { status: dto.status },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          "The request changed. Refresh and try again"
        );
      await tx.serviceRequestStatusHistory.create({
        data: {
          serviceRequestId: id,
          fromStatus: request.status,
          toStatus: dto.status,
          changedByUserId: userId,
          reason: dto.reason?.trim(),
        },
      });
      await tx.notification.create({
        data: {
          userId: clientAction
            ? request.provider.userId
            : request.client.userId,
          kind: "request",
          title: "Service request updated",
          body: `${request.category.title}: ${dto.status
            .replace(/_/g, " ")
            .toLowerCase()}`,
          data: { serviceRequestId: id, status: dto.status },
        },
      });
      await tx.auditLog.createMany({
        data: [request.client.userId, request.provider.userId].map((owner) => ({
          userId: owner,
          action: `REQUEST_${dto.status}`,
          entity: "ServiceRequest",
          entityId: id,
          metadata: { title: request.category.title },
        })),
      });
      return tx.serviceRequest.findUnique({
        where: { id },
        include: requestInclude,
      });
    });
  }

  async history(userId: string, query: { page?: string; limit?: string }) {
    const { page, limit, skip } = pagination(query.page, query.limit);
    const [data, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where: { userId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take: limit,
        select: {
          id: true,
          action: true,
          entity: true,
          entityId: true,
          metadata: true,
          createdAt: true,
        },
      }),
      this.prisma.auditLog.count({ where: { userId } }),
    ]);
    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }
}
