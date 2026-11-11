import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { NotificationKind, RequestStatus } from '@prisma/client';
import { randomInt } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateRequestDto } from './dto/create-request.dto';
import { CreateReviewDto } from './dto/create-review.dto';
import {pagination} from '../platform/platform.service';
import {ChatGateway} from '../chat/chat.gateway';
import {PushService} from '../notifications/push.service';
import {duesLimitPaisa, unsettledDuesPaisa} from '../payments/commission';
import {isPlusClient, plusClientIds} from '../memberships/membership-reads';
import {PaymentsService} from '../payments/payments.service';

const CLIENT_CANCELLABLE_STATUSES = new Set<RequestStatus>([
  RequestStatus.PENDING,
  RequestStatus.ACCEPTED,
]);

// Reviews render verbatim on profiles: collapse blank-line floods and padding
// spaces (mirrors cleanReviewComment in the Home app) so one paste cannot
// break every card that shows it.
function cleanReviewComment(value: string): string {
  return value.replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

const ENGINEER_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  DRAFT: [RequestStatus.PENDING],
  PENDING: [RequestStatus.ACCEPTED, RequestStatus.DECLINED],
  ACCEPTED: [RequestStatus.IN_PROGRESS, RequestStatus.CANCELLED],
  DECLINED: [],
  IN_PROGRESS: [RequestStatus.COMPLETED],
  COMPLETED: [],
  CANCELLED: [],
};

@Injectable()
export class RequestsService {
  constructor(private readonly prisma: PrismaService, private readonly realtime: ChatGateway, private readonly push: PushService,
    @Optional() private readonly payments?: PaymentsService) {}

  async create(dto: CreateRequestDto, userId: string) {
    const [client, engineer] = await Promise.all([
      this.prisma.clientProfile.findUnique({ where: { userId } }),
      this.prisma.engineerProfile.findUnique({
        where: { id: dto.engineerProfileId },
        include: { profile: {include: {user: true}} },
      }),
    ]);
    if (!client) throw new NotFoundException('Client profile not found');
    if (!engineer || engineer.profile.verificationStatus !== 'VERIFIED' || !engineer.profile.isAvailable || engineer.profile.user.status !== 'ACTIVE' || engineer.profile.user.deletedAt) {
      throw new NotFoundException('Verified engineer not found');
    }
    if (engineer.profile.userId === userId) throw new BadRequestException('You cannot send a request to yourself');

    const plus = await isPlusClient(this.prisma, userId);
    const created = await this.prisma.$transaction(async tx => {
      const request = await tx.engineerRequest.create({
        data: {
          clientProfileId: client.id,
          engineerProfileId: engineer.id,
          projectTitle: dto.projectTitle.trim(),
          projectDescription: dto.projectDescription.trim(),
          propertyType: dto.propertyType.trim(),
          projectSizeSqFt: dto.projectSizeSqFt,
          locationAddress: dto.locationAddress.trim(),
          latitude: dto.latitude,
          longitude: dto.longitude,
          preferredStartDate: dto.preferredStartDate ? new Date(dto.preferredStartDate) : undefined,
          budgetEstimatePaisa: dto.budgetEstimatePaisa,
          status: RequestStatus.PENDING,
        },
        include: { client: true, engineer: { include: { profile: true } } },
      });
      await tx.requestStatusHistory.create({
        data: {
          engineerRequestId: request.id,
          fromStatus: null,
          toStatus: RequestStatus.PENDING,
          changedByUserId: userId,
        },
      });
      await tx.notification.create({
        data: {
          userId: engineer.profile.userId,
          kind: NotificationKind.request,
          title: plus ? 'Plus priority request' : 'New client request',
          body: plus
            ? `${client.fullName} (Plus member) sent a priority request for ${request.projectTitle}.`
            : `${client.fullName} sent a request for ${request.projectTitle}.`,
          data: { destination: 'pro-request', requestId: request.id, engineerRequestId: request.id },
        },
      });
      await tx.auditLog.createMany({ data: [userId, engineer.profile.userId].map(owner => ({ userId: owner, action: 'REQUEST_PENDING', entity: 'EngineerRequest', entityId: request.id, metadata: { title: request.projectTitle } })) });
      return this.serialize(request);
    });
    this.realtime.emitUserUpdate(userId, 'requests');
    this.realtime.emitUserUpdate(userId, 'notifications');
    this.realtime.emitUserUpdate(engineer.profile.userId, 'requests');
    this.realtime.emitUserUpdate(engineer.profile.userId, 'notifications');
    void this.push.dispatch().catch(() => undefined);
    return created;
  }

  async list(userId: string, query: { status?: string; page?: string; limit?: string }) {
    const {page, limit} = pagination(query.page, query.limit);
    const status = query.status ? this.parseStatus(query.status) : undefined;
    const where = { OR: [{ client: { userId } }, { engineer: { profile: { userId } } }], ...(status ? { status } : {}) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.engineerRequest.findMany({
        where,
        include: { client: true, engineer: { include: { profile: true } }, reviews: { select: { rating: true, comment: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.engineerRequest.count({ where }),
    ]);
    // Pro-side sync: each row flags Plus for its engineer in one batched
    // lookup, so the inbox shows priority before opening the detail.
    const mine = items.filter(item => item.engineer.profile.userId === userId);
    const plusIds = await plusClientIds(this.prisma, mine.map(item => item.client.userId));
    return {
      data: items.map(item => ({...this.serialize(item),
        ...(item.engineer.profile.userId === userId ? {clientPlus: plusIds.has(item.client.userId)} : {})})),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async detail(id: string, userId: string) {
    const request = await this.prisma.engineerRequest.findFirst({ where: { id, OR: [{ client: { userId } }, { engineer: { profile: { userId } } }] }, include: { client: true, engineer: { include: { profile: true } }, statusHistory: { orderBy: { createdAt: 'asc' } }, reviews: { select: { rating: true, comment: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 } } });
    if (!request) throw new NotFoundException('Request not found');
    const viewer = request.client.userId === userId ? 'client' : 'engineer';
    const plus = viewer === 'engineer' ? await isPlusClient(this.prisma, request.client.userId) : false;
    return {...this.serialize(request, true, viewer), ...(viewer === 'engineer' ? {clientPlus: plus} : {})};
  }

  async cancel(id: string, userId: string) {
    const request = await this.findByEitherParty(id, userId);
    // Engineers cancel too (emergency, overbooked): same early stages as the
    // client, the other side notified, paid fees refunded by the shared path.
    const byClient = request.client.userId === userId;
    if (!CLIENT_CANCELLABLE_STATUSES.has(request.status)) {
      throw new BadRequestException(`Cannot cancel from status ${request.status}`);
    }
    const cancelled = await this.prisma.$transaction(async tx => {
      const changed = await tx.engineerRequest.updateMany({ where: { id: request.id, status: request.status }, data: { status: RequestStatus.CANCELLED, completionCode: null } });
      if (changed.count !== 1) throw new ConflictException('The request changed. Refresh and try again');
      const updated = await tx.engineerRequest.update({
        where: { id: request.id },
        data: { status: RequestStatus.CANCELLED },
        include: { client: true, engineer: { include: { profile: true } } },
      });
      await tx.requestStatusHistory.create({
        data: {
          engineerRequestId: request.id,
          fromStatus: request.status,
          toStatus: RequestStatus.CANCELLED,
          changedByUserId: userId,
        },
      });
      await tx.notification.create({
        data: {
          userId: byClient ? request.engineer.profile.userId : request.client.userId,
          kind: NotificationKind.request,
          title: byClient ? 'Client cancelled a request' : 'Engineer cancelled a request',
          body: byClient
            ? `${request.projectTitle} was cancelled by the client.`
            : `${request.projectTitle} was cancelled by the engineer. Book again whenever you are ready.`,
          data: byClient
            ? { destination: 'pro-request', requestId: request.id, engineerRequestId: request.id }
            : { destination: 'request', requestId: request.id, engineerRequestId: request.id },
        },
      });
      await tx.auditLog.createMany({ data: [request.client.userId, request.engineer.profile.userId].map(owner => ({ userId: owner, action: 'REQUEST_CANCELLED', entity: 'EngineerRequest', entityId: request.id, metadata: { title: request.projectTitle } })) });
      return this.serialize(updated);
    });
    this.realtime.emitUserUpdate(userId, 'requests');
    this.realtime.emitUserUpdate(userId, 'notifications');
    this.realtime.emitUserUpdate(request.engineer.profile.userId, 'requests');
    this.realtime.emitUserUpdate(request.engineer.profile.userId, 'notifications');
    void this.push.dispatch().catch(() => undefined);
    // A consultation paid before cancellation must fail safe: unpaid orders
    // are voided, captured fees are refunded. Never throws.
    await this.payments?.cancelUnpaidOrRefundEngineer(request.id, userId).catch(() => undefined);
    return cancelled;
  }

  // Consultation reschedule, mirroring the service-visit flow: the client
  // picks a new preferred date on an upcoming request, the engineer is
  // notified to review it. Same 30-minute / 30-day window as visits.
  async reschedule(id: string, userId: string, scheduledAt: string) {
    const request = await this.findOwnedByClient(id, userId);
    if (!([RequestStatus.PENDING, RequestStatus.ACCEPTED] as RequestStatus[]).includes(request.status))
      throw new BadRequestException('Only upcoming requests can be rescheduled');
    const when = new Date(scheduledAt);
    if (!Number.isFinite(when.getTime()) || when.getTime() < Date.now() + 30 * 60000 || when.getTime() > Date.now() + 30 * 86400000)
      throw new BadRequestException('Choose a visit between 30 minutes and 30 days from now');
    const updated = await this.prisma.$transaction(async tx => {
      const next = await tx.engineerRequest.update({where: {id: request.id},
        data: {preferredStartDate: when},
        include: {client: true, engineer: {include: {profile: true}}}});
      await tx.requestStatusHistory.create({data: {engineerRequestId: request.id,
        fromStatus: request.status, toStatus: request.status, changedByUserId: userId}});
      await tx.notification.create({data: {userId: request.engineer.profile.userId, kind: NotificationKind.request,
        title: 'Consultation time changed',
        body: `The client picked a new time for ${request.projectTitle}. Tap to review it.`,
        data: {destination: 'pro-request', requestId: request.id, engineerRequestId: request.id}}});
      return this.serialize(next);
    });
    this.realtime.emitUserUpdate(userId, 'requests');
    this.realtime.emitUserUpdate(request.engineer.profile.userId, 'requests');
    void this.push.dispatch().catch(() => undefined);
    return updated;
  }

  async addReview(id: string, userId: string, review: CreateReviewDto) {
    const request = await this.findOwnedByClient(id, userId);
    if (request.status !== RequestStatus.COMPLETED) {
      throw new BadRequestException('Reviews are allowed only after completion');
    }
    const existing = await this.prisma.review.findUnique({ where: { engineerRequestId: request.id } });
    if (existing) throw new ConflictException('A review has already been submitted for this request');
    const created = await this.prisma.review.create({
      data: {
        clientProfileId: request.clientProfileId,
        professionalProfileId: request.engineer.professionalProfileId,
        engineerRequestId: request.id,
        rating: review.rating,
        comment: cleanReviewComment(review.comment),
      },
    });
    await this.recalculateRating(request.engineer.professionalProfileId);
    await this.prisma.notification.create({
      data: {
        userId: request.engineer.profile.userId,
        kind: NotificationKind.review,
        title: 'New client review',
        body: `You received a ${review.rating}-star review for ${request.projectTitle}.`,
        data: { destination: 'pro-reviews', requestId: request.id, engineerRequestId: request.id, rating: review.rating },
      },
    });
    this.realtime.emitUserUpdate(request.engineer.profile.userId, 'notifications');
    void this.push.dispatch().catch(() => undefined);
    return created;
  }

  async addServiceReview(id: string, userId: string, review: CreateReviewDto) {
    const comment = cleanReviewComment(review.comment);
    if (comment.length < 3) throw new BadRequestException('Write at least 3 characters about your experience');
    const request = await this.prisma.serviceRequest.findFirst({
      where: {id, client: {userId}},
      select: {id: true, status: true, clientProfileId: true, professionalProfileId: true},
    });
    if (!request) throw new NotFoundException('Service request not found');
    if (request.status !== RequestStatus.COMPLETED) {
      throw new BadRequestException('Reviews are available after the service is completed');
    }
    let created;
    try {
      created = await this.prisma.review.create({
        data: {
          clientProfileId: request.clientProfileId,
          professionalProfileId: request.professionalProfileId,
          serviceRequestId: request.id,
          rating: review.rating,
          comment,
        },
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
        throw new ConflictException('A review has already been submitted for this service');
      }
      throw error;
    }
    await this.recalculateRating(request.professionalProfileId);
    return created;
  }

  async transitionForEngineer(
    id: string,
    engineerUserId: string,
    nextStatus: RequestStatus,
    reason?: string,
    opts?: { code?: string; latitude?: number; longitude?: number },
  ) {
    const request = await this.prisma.engineerRequest.findFirst({
      where: { id, engineer: { profile: { userId: engineerUserId } } },
      include: { client: true, engineer: { include: { profile: true } } },
    });
    if (!request) throw new NotFoundException('Request not found');
    if (!ENGINEER_TRANSITIONS[request.status].includes(nextStatus)) {
      throw new BadRequestException(`Cannot transition from ${request.status} to ${nextStatus}`);
    }
    if (nextStatus === RequestStatus.ACCEPTED) {
      const dues = await unsettledDuesPaisa(this.prisma, request.engineer.profile.id).catch(() => 0);
      const limit = await duesLimitPaisa(this.prisma, request.engineer.profile.id);
      if (dues >= limit)
        throw new ConflictException(`Clear your ₹${(dues / 100).toLocaleString('en-IN')} commission dues to accept new work`);
    }
    // Completion proof: the 6-digit code shown only to the client. The
    // engineer cannot mark work complete without it, so fake completions
    // from the phone alone are impossible. Mirrors the service START code:
    // attempt-capped, single-use, nulled on success.
    if (nextStatus === RequestStatus.COMPLETED) {
      if (!request.completionCode) {
        // Requests accepted before this check shipped have no code: issue
        // one now so the next attempt can complete normally.
        const fresh = String(randomInt(100000, 1000000));
        await this.prisma.engineerRequest.update({ where: { id }, data: { completionCode: fresh, completionCodeAttempts: 0 } });
        await this.prisma.notification.create({ data: {
          userId: request.client.userId,
          kind: NotificationKind.request,
          title: 'Completion code',
          body: `${request.engineer.profile.fullName} is finishing ${request.projectTitle}. Your completion code is ${fresh} — share it only after the work is done.`,
          data: { destination: 'engineer-request', requestId: id, engineerRequestId: id, status: request.status },
        }});
        this.realtime.emitUserUpdate(request.client.userId, 'notifications');
        void this.push.dispatch().catch(() => undefined);
        throw new BadRequestException('A fresh completion code was just sent to the client. Enter it to complete.');
      }
      if ((request.completionCodeAttempts ?? 0) >= 5)
        throw new BadRequestException('Code attempts exhausted. Contact support.');
      if (!opts?.code || opts.code !== request.completionCode) {
        await this.prisma.engineerRequest.update({ where: { id }, data: { completionCodeAttempts: { increment: 1 } } });
        throw new BadRequestException('Incorrect completion code. Ask the client for the 6-digit code shown in the request.');
      }
    }
    const issuedCode = nextStatus === RequestStatus.ACCEPTED ? String(randomInt(100000, 1000000)) : undefined;
    const updatedRequest = await this.prisma.$transaction(async tx => {
      const changed = await tx.engineerRequest.updateMany({ where: { id, status: request.status },
        data: { status: nextStatus,
          ...(issuedCode ? { completionCode: issuedCode, completionCodeAttempts: 0 } : {}),
          ...(nextStatus === RequestStatus.COMPLETED ? { completionCode: null } : {}) } });
      if (changed.count !== 1) throw new ConflictException('The request changed. Refresh and try again');
      const updated = await tx.engineerRequest.update({
        where: { id },
        data: { status: nextStatus },
        include: { client: true, engineer: { include: { profile: true } } },
      });
      await tx.requestStatusHistory.create({
        data: {
          engineerRequestId: id,
          fromStatus: request.status,
          toStatus: nextStatus,
          changedByUserId: engineerUserId,
          reason: reason?.trim(),
          latitude: Number.isFinite(opts?.latitude) ? opts!.latitude : undefined,
          longitude: Number.isFinite(opts?.longitude) ? opts!.longitude : undefined,
        },
      });
      const fee = request.engineer.consultationFeePaisa;
      await tx.notification.create({
        data: {
          userId: request.client.userId,
          kind: NotificationKind.request,
          title: nextStatus === RequestStatus.COMPLETED ? 'Work completed' : nextStatus === RequestStatus.ACCEPTED ? 'Engineer accepted' : 'Request status updated',
          body: nextStatus === RequestStatus.COMPLETED && fee !== null && fee !== undefined
            ? `${request.engineer.profile.fullName} marked ${request.projectTitle} complete. The ₹${(fee / 100).toLocaleString('en-IN')} consultation fee can now be paid in the request.`
            : nextStatus === RequestStatus.ACCEPTED
            ? `${request.engineer.profile.fullName} accepted ${request.projectTitle}. Your completion code is ${issuedCode} — share it only after the work is done.`
            : `${request.engineer.profile.fullName} changed ${request.projectTitle} to ${nextStatus.replace('_', ' ').toLowerCase()}.`,
          data: { destination: 'engineer-request', requestId: id, engineerRequestId: id, status: nextStatus },
        },
      });
      await tx.auditLog.createMany({ data: [request.client.userId, engineerUserId].map(owner => ({ userId: owner, action: `REQUEST_${nextStatus}`, entity: 'EngineerRequest', entityId: id, metadata: { title: request.projectTitle } })) });
      return this.serialize(updated);
    });
    this.realtime.emitUserUpdate(engineerUserId, 'requests');
    this.realtime.emitUserUpdate(engineerUserId, 'notifications');
    this.realtime.emitUserUpdate(request.client.userId, 'requests');
    this.realtime.emitUserUpdate(request.client.userId, 'notifications');
    void this.push.dispatch().catch(() => undefined);
    return updatedRequest;
  }

  private async findOwnedByClient(id: string, userId: string) {
    const request = await this.prisma.engineerRequest.findFirst({
      where: { id, client: { userId } },
      include: {
        engineer: { include: { profile: true } },
        statusHistory: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!request) throw new NotFoundException('Request not found');
    return request;
  }

  private async findByEitherParty(id: string, userId: string) {
    const request = await this.prisma.engineerRequest.findFirst({
      where: { id, OR: [{ client: { userId } }, { engineer: { profile: { userId } } }] },
      include: {
        client: true,
        engineer: { include: { profile: true } },
        statusHistory: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!request) throw new NotFoundException('Request not found');
    return request;
  }

  private parseStatus(value: string): RequestStatus {
    if (!Object.values(RequestStatus).includes(value as RequestStatus)) {
      throw new BadRequestException('Invalid request status');
    }
    return value as RequestStatus;
  }

  private serialize(
    request: {
      id: string;
      clientProfileId: string;
      engineerProfileId: string;
      projectTitle: string;
      projectDescription: string;
      propertyType: string;
      projectSizeSqFt: number | null;
      preferredStartDate?: Date | string | null;
      locationAddress: string;
      latitude: number;
      longitude: number;
      status: RequestStatus;
      createdAt: Date;
      completionCode?: string | null;
      engineer: { profile: { fullName: string; avatarUrl?: string | null }; consultationFeePaisa?: number | null };
      client?: { fullName: string; avatarUrl?: string | null };
      statusHistory?: unknown[];
      reviews?: { rating: number; comment: string; createdAt: Date }[];
    },
    includeHistory = false,
    // The completion code is client-eyes-only: the engineer must collect it
    // from the client, never read it from their own API responses.
    viewer: 'client' | 'engineer' = 'engineer',
  ) {
    const review = request.reviews?.[0];
    return {
      id: request.id,
      clientProfileId: request.clientProfileId,
      engineerProfileId: request.engineerProfileId,
      engineerName: request.engineer.profile.fullName,
      engineerAvatarUrl: request.engineer.profile.avatarUrl ?? undefined,
      consultationFeePaisa: request.engineer.consultationFeePaisa ?? undefined,
      preferredStartDate: request.preferredStartDate
        ? (request.preferredStartDate instanceof Date ? request.preferredStartDate.toISOString() : request.preferredStartDate)
        : undefined,
      clientName: request.client?.fullName,
      clientAvatarUrl: request.client?.avatarUrl ?? undefined,
      projectTitle: request.projectTitle,
      projectDescription: request.projectDescription,
      propertyType: request.propertyType,
      projectSizeSqFt: request.projectSizeSqFt ?? undefined,
      locationAddress: request.locationAddress,
      latitude: request.latitude,
      longitude: request.longitude,
      status: request.status,
      createdAt: request.createdAt,
      ...(includeHistory ? { statusHistory: request.statusHistory ?? [] } : {}),
      ...(review ? { review: { rating: review.rating, comment: review.comment, date: review.createdAt } } : {}),
      ...(viewer === 'client' && request.completionCode ? { completionCode: request.completionCode } : {}),
    };
  }

  private async recalculateRating(professionalProfileId: string) {
    const aggregate = await this.prisma.review.aggregate({
      where: { professionalProfileId },
      _avg: { rating: true },
      _count: { rating: true },
    });
    await this.prisma.professionalProfile.update({
      where: { id: professionalProfileId },
      data: {
        averageRating: aggregate._avg.rating ?? 0,
        totalReviewsCount: aggregate._count.rating,
      },
    });
  }
}
