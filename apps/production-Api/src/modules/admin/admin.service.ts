import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  AccountStatus,
  Prisma,
  Role,
  NotificationKind,
  VerificationStatus,
} from "@prisma/client";
import { signedAssetUrl } from "../../common/storage";
import { normalizePlace } from "../../common/place";
import { PrismaService } from "../../common/prisma/prisma.service";
import { pagination } from "../platform/platform.service";
import { PushService } from "../notifications/push.service";
import { ChatGateway } from "../chat/chat.gateway";
import {
  AdminProfileDto,
  AdminUpdateUserDto,
  DocumentReviewDto,
  ProfileReviewDto,
  UserStatusDto,
} from "./admin.dto";

const detailInclude = {
  user: {
    select: { email: true, phoneNumber: true, status: true, roles: true },
  },
  engineerProfile: {
    include: { specializations: { include: { specialization: true } } },
  },
  serviceAreas: { orderBy: { name: "asc" as const } },
  portfolioItems: { orderBy: { createdAt: "desc" as const } },
  verificationDocuments: { orderBy: { uploadedAt: "desc" as const } },
} satisfies Prisma.ProfessionalProfileInclude;

const userInclude = {
  roles: { select: { role: true } },
  clientProfile: {
    select: { fullName: true, avatarUrl: true, city: true, state: true },
  },
  professionalProfile: {
    select: {
      fullName: true,
      avatarUrl: true,
      title: true,
      baseCity: true,
      baseState: true,
      verificationStatus: true,
    },
  },
  _count: { select: { sessions: true, notifications: true } },
} satisfies Prisma.UserInclude;

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService, private readonly push: PushService,
    private readonly realtime: ChatGateway) {}

  // A verification decision must reach the pro's phone now, not on the next
  // poll: push the notification row and wake every open app surface.
  private async notifyPro(userId: string) {
    await this.push.dispatch().catch(() => undefined);
    this.realtime.emitUserUpdate(userId, 'notifications');
  }

  async adminProfile(adminId: string) {
    const admin = await this.prisma.user.findFirst({
      where: { id: adminId, roles: { some: { role: Role.ADMIN } } },
      select: {
        id: true,
        displayName: true,
        email: true,
        phoneNumber: true,
        createdAt: true,
      },
    });
    if (!admin) throw new NotFoundException("Administrator account not found");
    return {
      ...admin,
      displayName: admin.displayName || "NAHTREEK Administrator",
    };
  }

  async updateAdminProfile(adminId: string, dto: AdminProfileDto) {
    const admin = await this.prisma.user.findFirst({
      where: { id: adminId, roles: { some: { role: Role.ADMIN } } },
      select: { id: true },
    });
    if (!admin) throw new NotFoundException("Administrator account not found");
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: adminId },
        data: { displayName: dto.displayName.trim() },
        select: {
          id: true,
          displayName: true,
          email: true,
          phoneNumber: true,
          createdAt: true,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: adminId,
          action: "ADMIN_PROFILE_UPDATED",
          entity: "User",
          entityId: adminId,
          metadata: { changedFields: ["displayName"] },
        },
      });
      return updated;
    });
  }

  async summary() {
    const grouped = await this.prisma.professionalProfile.groupBy({
      by: ["verificationStatus"],
      _count: { _all: true },
    });
    const counts = Object.fromEntries(
      Object.values(VerificationStatus).map((status) => [status, 0])
    );
    grouped.forEach(
      (row) => (counts[row.verificationStatus] = row._count._all)
    );
    return counts;
  }

  async overview() {
    const nonAdmin = { roles: { none: { role: Role.ADMIN } } };
    const [
      pending,
      active,
      suspended,
      deactivated,
      clients,
      engineers,
      serviceProviders,
      engineerRequests,
      serviceRequests,
    ] = await this.prisma.$transaction([
      this.prisma.user.count({ where: { ...nonAdmin, status: AccountStatus.PENDING_VERIFICATION } }),
      this.prisma.user.count({ where: { ...nonAdmin, status: AccountStatus.ACTIVE } }),
      this.prisma.user.count({ where: { ...nonAdmin, status: AccountStatus.SUSPENDED } }),
      this.prisma.user.count({ where: { ...nonAdmin, status: AccountStatus.DEACTIVATED } }),
      this.prisma.user.count({ where: { ...nonAdmin, deletedAt: null, roles: { some: { role: Role.CLIENT }, none: { role: Role.ADMIN } } } }),
      this.prisma.user.count({ where: { ...nonAdmin, deletedAt: null, roles: { some: { role: Role.ENGINEER }, none: { role: Role.ADMIN } } } }),
      this.prisma.user.count({ where: { ...nonAdmin, deletedAt: null, roles: { some: { role: Role.SERVICE_PROVIDER }, none: { role: Role.ADMIN } } } }),
      this.prisma.engineerRequest.count(),
      this.prisma.serviceRequest.count(),
    ]);
    const userStatuses = {
      [AccountStatus.PENDING_VERIFICATION]: pending,
      [AccountStatus.ACTIVE]: active,
      [AccountStatus.SUSPENDED]: suspended,
      [AccountStatus.DEACTIVATED]: deactivated,
    };
    const userRoles = {
      [Role.CLIENT]: clients,
      [Role.ENGINEER]: engineers,
      [Role.SERVICE_PROVIDER]: serviceProviders,
    };
    return {
      users: {
        total: Object.values(userStatuses).reduce((sum, value) => sum + value, 0),
        byStatus: userStatuses,
        byRole: userRoles,
      },
      requests: {
        total: engineerRequests + serviceRequests,
        engineer: engineerRequests,
        service: serviceRequests,
      },
    };
  }

  async listUsers(query: {
    role?: string;
    status?: string;
    search?: string;
    page?: string;
    limit?: string;
  }) {
    const { page, limit, skip } = pagination(query.page, query.limit);
    const role = query.role?.trim();
    const allowedRoles: Role[] = [
      Role.CLIENT,
      Role.ENGINEER,
      Role.SERVICE_PROVIDER,
    ];
    if (role && !allowedRoles.includes(role as Role)) {
      throw new BadRequestException("Invalid user role");
    }
    const status = query.status?.trim();
    if (status && !Object.values(AccountStatus).includes(status as AccountStatus)) {
      throw new BadRequestException("Invalid account status");
    }
    const search = query.search?.trim();
    const where: Prisma.UserWhereInput = {
      roles: {
        none: { role: Role.ADMIN },
        ...(role ? { some: { role: role as Role } } : {}),
      },
      ...(status ? { status: status as AccountStatus } : {}),
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: "insensitive" } },
              { phoneNumber: { contains: search } },
              {
                clientProfile: {
                  fullName: { contains: search, mode: "insensitive" },
                },
              },
              {
                professionalProfile: {
                  fullName: { contains: search, mode: "insensitive" },
                },
              },
            ],
          }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        include: userInclude,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      data: data.map((user) => this.serializeUser(user)),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async userDetail(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, roles: { none: { role: Role.ADMIN } } },
      include: userInclude,
    });
    if (!user) throw new NotFoundException("User account not found");
    return this.serializeUser(user);
  }

  async updateUserDetails(
    userId: string,
    adminId: string,
    dto: AdminUpdateUserDto
  ) {
    const changedFields = Object.entries(dto)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key);
    if (!changedFields.length) {
      throw new BadRequestException("Choose at least one detail to update");
    }
    const user = await this.prisma.user.findFirst({
      where: { id: userId, roles: { none: { role: Role.ADMIN } } },
      include: userInclude,
    });
    if (!user) throw new NotFoundException("User account not found");
    const profile = user.clientProfile || user.professionalProfile;
    if (!profile) throw new BadRequestException("This user has not completed a profile");
    if (dto.professionalTitle !== undefined && !user.professionalProfile) {
      throw new BadRequestException("Professional title applies only to professional accounts");
    }
    return this.prisma.$transaction(async (tx) => {
      if (user.clientProfile) {
        await tx.clientProfile.update({
          where: { userId },
          data: {
            ...(dto.fullName !== undefined ? { fullName: dto.fullName.trim() } : {}),
            ...(dto.city !== undefined ? { city: dto.city.trim() } : {}),
            ...(dto.state !== undefined ? { state: dto.state.trim() } : {}),
          },
        });
      } else {
        await tx.professionalProfile.update({
          where: { userId },
          data: {
            ...(dto.fullName !== undefined ? { fullName: dto.fullName.trim() } : {}),
            ...(dto.city !== undefined
              ? { baseCity: dto.city.trim(), baseCityNorm: normalizePlace(dto.city) }
              : {}),
            ...(dto.state !== undefined
              ? { baseState: dto.state.trim(), baseStateNorm: normalizePlace(dto.state) }
              : {}),
            ...(dto.professionalTitle !== undefined
              ? { title: dto.professionalTitle.trim() }
              : {}),
          },
        });
      }
      await tx.auditLog.create({
        data: {
          userId: adminId,
          action: "USER_DETAILS_UPDATED",
          entity: "User",
          entityId: userId,
          metadata: { changedFields },
        },
      });
      const updated = await tx.user.findUnique({
        where: { id: userId },
        include: userInclude,
      });
      if (!updated) throw new NotFoundException("User account not found");
      return this.serializeUser(updated);
    });
  }

  async activity(pageValue?: string, limitValue?: string) {
    const { page, limit, skip } = pagination(pageValue, limitValue);
    const where: Prisma.AuditLogWhereInput = {
      user: { roles: { some: { role: Role.ADMIN } } },
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          user: { select: { displayName: true, email: true } },
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      data: data.map((item) => ({
        id: item.id,
        action: item.action,
        entity: item.entity,
        entityId: item.entityId,
        metadata: item.metadata,
        createdAt: item.createdAt,
        administrator:
          item.user?.displayName || item.user?.email || "Administrator",
      })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async changeUserStatus(
    userId: string,
    adminId: string,
    dto: UserStatusDto
  ) {
    if (userId === adminId) {
      throw new BadRequestException("Administrators cannot modify themselves");
    }
    if (dto.status !== AccountStatus.ACTIVE && !dto.reason?.trim()) {
      throw new BadRequestException("Give a reason for restricting this account");
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: true },
    });
    if (!user || user.roles.some(({ role }) => role === Role.ADMIN)) {
      throw new NotFoundException("User account not found");
    }
    if (user.status === dto.status) {
      throw new BadRequestException(`Account is already ${dto.status}`);
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          status: dto.status,
          deletedAt:
            dto.status === AccountStatus.DEACTIVATED ? new Date() : null,
          authVersion: { increment: 1 },
        },
        include: userInclude,
      });
      if (dto.status !== AccountStatus.ACTIVE) {
        await tx.session.deleteMany({ where: { userId } });
      }
      await tx.auditLog.create({
        data: {
          userId: adminId,
          action: `USER_${dto.status}`,
          entity: "User",
          entityId: userId,
          metadata: {
            previousStatus: user.status,
            reason: dto.reason?.trim(),
            reversible: true,
          },
        },
      });
      return this.serializeUser(updated);
    });
  }

  async list(query: {
    status?: string;
    search?: string;
    page?: string;
    limit?: string;
  }) {
    const { page, limit, skip } = pagination(query.page, query.limit);
    const status = query.status?.trim();
    if (
      status &&
      !Object.values(VerificationStatus).includes(status as VerificationStatus)
    ) {
      throw new BadRequestException("Invalid verification status");
    }
    const search = query.search?.trim();
    const where: Prisma.ProfessionalProfileWhereInput = {
      ...(status ? { verificationStatus: status as VerificationStatus } : {}),
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: "insensitive" } },
              { title: { contains: search, mode: "insensitive" } },
              { baseCity: { contains: search, mode: "insensitive" } },
              { user: { email: { contains: search, mode: "insensitive" } } },
              { user: { phoneNumber: { contains: search } } },
            ],
          }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.professionalProfile.findMany({
        where,
        include: detailInclude,
        orderBy: { updatedAt: "asc" },
        skip,
        take: limit,
      }),
      this.prisma.professionalProfile.count({ where }),
    ]);
    return {
      data: await Promise.all(
        data.map((profile) => this.serialize(profile, false))
      ),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async detail(profileId: string) {
    const profile = await this.prisma.professionalProfile.findUnique({
      where: { id: profileId },
      include: detailInclude,
    });
    if (!profile) throw new NotFoundException("Verification request not found");
    return this.serialize(profile, true);
  }

  async reviewDocument(
    profileId: string,
    documentId: string,
    adminId: string,
    dto: DocumentReviewDto
  ) {
    if (dto.status === "REJECTED" && !dto.reason?.trim()) {
      throw new BadRequestException("Give a reason for rejecting the document");
    }
    let notifyUserId: string | null = null;
    let wroteNotification = false;
    const result = await this.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ProfessionalProfile" WHERE "id" = ${profileId} FOR UPDATE`;
    const document = await tx.verificationDocument.findFirst({
      where: { id: documentId, professionalProfileId: profileId },
      include: { profile: true },
    });
    notifyUserId = document?.profile.userId ?? null;
    if (!document)
      throw new NotFoundException("Verification document not found");
      const updated = await tx.verificationDocument.update({
        where: { id: documentId },
        data: {
          status: dto.status,
          rejectionReason:
            dto.status === "REJECTED" ? dto.reason?.trim() : null,
          reviewedAt: new Date(),
          reviewedByUserId: adminId,
        },
      });
      if (dto.status === 'REJECTED' && document.profile.verificationStatus === 'VERIFIED') {
        await tx.professionalProfile.update({where: {id: profileId}, data: {verificationStatus: 'REJECTED', onboardingStep: 'REVIEW', isAvailable: false}});
        await tx.providerPresence.updateMany({where: {professionalProfileId: profileId}, data: {online: false}});
        await tx.notification.create({data: {userId: document.profile.userId, kind: NotificationKind.verification, title: 'Verification needs attention', body: dto.reason!.trim(), data: {professionalProfileId: profileId}}});
        wroteNotification = true;
      }
      await tx.auditLog.create({
        data: {
          userId: adminId,
          action: `VERIFICATION_DOCUMENT_${dto.status}`,
          entity: "VerificationDocument",
          entityId: documentId,
          metadata: { profileId, reason: dto.reason?.trim() },
        },
      });
      return updated;
    });
    if (notifyUserId && wroteNotification) await this.notifyPro(notifyUserId);
    return result;
  }

  async reviewProfile(
    profileId: string,
    adminId: string,
    dto: ProfileReviewDto
  ) {
    if (dto.status === "REJECTED" && !dto.reason?.trim()) {
      throw new BadRequestException("Give a reason for rejecting the profile");
    }
    let notifyUserId: string | null = null;
    const result = await this.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ProfessionalProfile" WHERE "id" = ${profileId} FOR UPDATE`;
    const profile = await tx.professionalProfile.findUnique({
      where: { id: profileId },
      include: {
        user: { include: { roles: true } },
        verificationDocuments: true,
      },
    });
    if (!profile) throw new NotFoundException("Verification request not found");
    notifyUserId = profile.userId;
    const allowed: Record<VerificationStatus, VerificationStatus[]> = {
      NOT_SUBMITTED: [],
      PENDING: [VerificationStatus.UNDER_REVIEW, VerificationStatus.REJECTED],
      UNDER_REVIEW: [VerificationStatus.VERIFIED, VerificationStatus.REJECTED],
      VERIFIED: [],
      REJECTED: [VerificationStatus.UNDER_REVIEW],
    };
    if (!allowed[profile.verificationStatus].includes(dto.status)) {
      throw new BadRequestException(
        `Cannot change verification from ${profile.verificationStatus} to ${dto.status}`
      );
    }
    if (dto.status === "VERIFIED") {
      const engineer = profile.user.roles.some(
        ({ role }) => role === Role.ENGINEER
      );
      const required = engineer
        ? ["identity-proof", "address-proof", "qualification"]
        : ["identity-proof", "address-proof", "work-sample"];
      const approved = new Set(
        profile.verificationDocuments
          .filter((document) => document.status === "APPROVED")
          .map((document) => document.documentType)
      );
      const missing = required.filter((item) => !approved.has(item));
      if (missing.length) {
        throw new BadRequestException(
          `Approve required documents first: ${missing.join(", ")}`
        );
      }
    }
      const updated = await tx.professionalProfile.update({
        where: { id: profileId },
        data: {
          verificationStatus: dto.status,
          onboardingStep: dto.status === "VERIFIED" ? "COMPLETED" : "REVIEW",
          ...(dto.status === "REJECTED" ? {isAvailable: false} : {}),
        },
      });
      if (dto.status === "REJECTED") {
        await tx.providerPresence.updateMany({where: {professionalProfileId: profileId}, data: {online: false}});
      }
      await tx.notification.create({
        data: {
          userId: profile.userId,
          kind: NotificationKind.verification,
          title:
            dto.status === "VERIFIED"
              ? "Profile verified"
              : dto.status === "REJECTED"
              ? "Verification needs attention"
              : "Verification review started",
          body:
            dto.status === "VERIFIED"
              ? "Your profile is verified and can now appear to clients."
              : dto.reason?.trim() || "Our team is reviewing your documents.",
          data: { professionalProfileId: profileId, status: dto.status },
        },
      });
      await tx.auditLog.createMany({
        data: [adminId, profile.userId].map((userId) => ({
          userId,
          action: `VERIFICATION_${dto.status}`,
          entity: "ProfessionalProfile",
          entityId: profileId,
          metadata: { reason: dto.reason?.trim() },
        })),
      });
      return updated;
    });
    if (notifyUserId) await this.notifyPro(notifyUserId);
    return result;
  }

  private serializeUser(
    user: Prisma.UserGetPayload<{ include: typeof userInclude }>
  ) {
    const roles = user.roles.map(({ role }) => role);
    const profile = user.clientProfile || user.professionalProfile;
    const city = user.clientProfile?.city || user.professionalProfile?.baseCity;
    const state = user.clientProfile?.state || user.professionalProfile?.baseState;
    return {
      id: user.id,
      fullName: profile?.fullName || "Profile not completed",
      avatarUrl: profile?.avatarUrl,
      email: user.email,
      phoneNumber: user.phoneNumber,
      roles,
      status: user.status,
      isPhoneVerified: user.isPhoneVerified,
      isEmailVerified: user.isEmailVerified,
      location: [city, state].filter(Boolean).join(", "),
      city,
      state,
      professionalTitle: user.professionalProfile?.title,
      verificationStatus: user.professionalProfile?.verificationStatus,
      activeSessions: user._count.sessions,
      notificationCount: user._count.notifications,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      deactivatedAt: user.deletedAt,
    };
  }

  private async serialize(
    profile: Prisma.ProfessionalProfileGetPayload<{
      include: typeof detailInclude;
    }>,
    signDocuments: boolean
  ) {
    const roles = profile.user.roles.map(({ role }) => role);
    return {
      id: profile.id,
      fullName: profile.fullName,
      title: profile.title,
      bio: profile.bio,
      avatarUrl: profile.avatarUrl,
      yearsOfExperience: profile.yearsOfExperience,
      verificationStatus: profile.verificationStatus,
      isAvailable: profile.isAvailable,
      baseCity: profile.baseCity,
      baseState: profile.baseState,
      serviceCategories: profile.serviceCategories,
      startingPricePaisa: profile.startingPricePaisa,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      accountType: roles.includes(Role.ENGINEER)
        ? "ENGINEER"
        : "SERVICE_PROVIDER",
      user: {
        email: profile.user.email,
        phoneNumber: profile.user.phoneNumber,
        status: profile.user.status,
      },
      engineer: profile.engineerProfile
        ? {
            qualificationDegree: profile.engineerProfile.qualificationDegree,
            institution: profile.engineerProfile.institution,
            graduationYear: profile.engineerProfile.graduationYear,
            licenseNumber: profile.engineerProfile.licenseNumber,
            consultationFeePaisa: profile.engineerProfile.consultationFeePaisa,
            specializations: profile.engineerProfile.specializations.map(
              ({ specialization }) => specialization.name
            ),
          }
        : null,
      serviceAreas: profile.serviceAreas.map(({ name, city }) => ({
        name,
        city,
      })),
      portfolio: profile.portfolioItems.map(({ id, title, imageUrl }) => ({
        id,
        title,
        imageUrl,
      })),
      documents: await Promise.all(
        profile.verificationDocuments.map(async (document) => ({
          id: document.id,
          documentType: document.documentType,
          status: document.status,
          rejectionReason: document.rejectionReason,
          uploadedAt: document.uploadedAt,
          documentUrl: signDocuments
            ? await signedAssetUrl(document.documentUrl)
            : undefined,
        }))
      ),
    };
  }
}
