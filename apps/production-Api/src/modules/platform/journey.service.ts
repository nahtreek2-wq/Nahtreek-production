import {BadRequestException, ConflictException, Injectable, NotFoundException, Optional, ServiceUnavailableException} from '@nestjs/common';
import {createHash, randomInt} from 'crypto';
import {Prisma, RequestStatus} from '@prisma/client';
import {PrismaService} from '../../common/prisma/prisma.service';
import {PushService} from '../notifications/push.service';
import {BookDto, JourneyActionDto, MatchDto, PresenceDto} from './journey.dto';
import {ACTIVE_STAGES, actionStage, demoEtaMinutes, distanceKm, freshLocation} from './journey.rules';
import {ChatGateway} from '../chat/chat.gateway';
import {duesLimitPaisa, unsettledDuesPaisa, PLUS_ACCEPT_WINDOW_MS, PLUS_ARRIVAL_GRACE_MS,
  PENALTY_LATE_ACCEPT_Paisa, PENALTY_LATE_ARRIVAL_Paisa} from '../payments/commission';
import {isPlusClient} from '../memberships/membership-reads';
import {PaymentsService} from '../payments/payments.service';
import {resolveServiceCategory, serviceCategoryKeys} from './service-category';

function journeyNotification(action: string, stage: string) {
  const messages: Record<string, [string, string]> = {
    RESCHEDULE: ['Visit time changed', 'The customer picked a new visit time. Tap to review it.'],
    ACCEPT: ['Booking confirmed', 'Your professional accepted. Tap to track the visit.'],
    DECLINE: ['That pro can’t make it', 'No replacement was assigned. Pick another verified pro in one tap.'],
    DEPART: ['Your pro is on the way', 'Follow the visit live and keep your start code ready.'],
    ARRIVE: ['Your pro has arrived', 'Share your 6-digit start code so work can begin.'],
    QUOTE: ['Your quote is ready', 'Review the price and scope, then approve in one tap.'],
    APPROVE_QUOTE: ['Quote approved, start work', 'The customer approved it. Stick to the agreed scope and price.'],
    START: ['Work started', 'Your request is in progress. Track it live here.'],
    FINISH: ['Work done, confirm it', 'Check the completion summary and confirm if everything is done.'],
    CONFIRM: ['Customer confirmed, job closed', 'This request is marked complete. Payment is handled separately.'],
    ISSUE: ['A customer flagged a concern', 'Open the request to review it. It stays open for support.'],
    CANCEL: ['This visit was cancelled', 'The customer cancelled. It stays in your request history.'],
  };
  const message = messages[action];
  if (message) return {title: message[0], body: message[1]};
  const byStage: Record<string, [string, string]> = {
    COMPLETED: ['Service complete', 'Nicely done. Rate your experience from the request.'],
    CANCELLED: ['Visit cancelled', 'This request was cancelled. Book again whenever you are ready.'],
    DECLINED: ['Request declined', 'The professional declined. No replacement was assigned.'],
    DISPUTED: ['Issue received', 'The booking stays open for support review.'],
  };
  const fallback = byStage[stage] ?? ['Your work has an update', 'Tap to see the latest on your request.'];
  return {title: fallback[0], body: fallback[1]};
}

@Injectable()
export class JourneyService {
  constructor(private readonly db: PrismaService, private readonly push: PushService, private readonly realtime: ChatGateway,
    @Optional() private readonly payments?: PaymentsService) {}

  async presence(userId: string, dto: PresenceDto) {
    const profile = await this.db.professionalProfile.findFirst({where: {userId, user: {roles: {some: {role: 'SERVICE_PROVIDER'}}}}});
    if (!profile) throw new NotFoundException('Service provider account required');
    const receivedAt = new Date();
    const observedAt = new Date(dto.observedAt);
    if (dto.online && profile.verificationStatus === 'VERIFIED' && !profile.isAvailable) {
      const activeJourney = await this.db.serviceJourney.findFirst({
        where: {stage: {in: ACTIVE_STAGES}, request: {professionalProfileId: profile.id}},
        select: {requestId: true},
      });
      if (!activeJourney) {
        throw new ConflictException('Location sharing stopped because you are paused and have no active service visit.');
      }
    }
    if (dto.online && (!freshLocation({...dto, observedAt}, receivedAt.getTime()) || profile.verificationStatus !== 'VERIFIED'))
      throw new BadRequestException('Go available and allow accurate current location before accepting nearby jobs');
    // A device clock ahead of the server must not extend the location's lifetime.
    const recordedAt = new Date(Math.min(observedAt.getTime(), receivedAt.getTime()));
    await this.db.providerPresence.upsert({where: {professionalProfileId: profile.id},
      create: {professionalProfileId: profile.id, ...dto, observedAt: recordedAt}, update: {...dto, observedAt: recordedAt}});
    return {online: dto.online, updatedAt: new Date().toISOString()};
  }

  private async route(from: {latitude: number; longitude: number}, to: {latitude: number; longitude: number}) {
    // A road-routing API cannot route between the same point. If the provider
    // is already at the service address, treat the travel time as zero.
    if (distanceKm(from.latitude, from.longitude, to.latitude, to.longitude) < 0.01) return 0;
    const key = process.env.GEOAPIFY_API_KEY;
    // A routing outage must never block a pro from accepting work: fall back
    // to a straight-line estimate (distance at 30 km/h) whenever the key is
    // missing or the road-routing call fails. The client already sees the
    // "estimated arrival, not a guarantee" notice, and live tracking plus the
    // at-address arrival check keep enforcing reality.
    if (!key) return demoEtaMinutes(from, to);
    const url = new URL('https://api.geoapify.com/v1/routing');
    url.search = new URLSearchParams({waypoints: `${from.latitude},${from.longitude}|${to.latitude},${to.longitude}`, mode: 'drive', apiKey: key}).toString();
    try {
      const response = await fetch(url, {signal: AbortSignal.timeout(6000)});
      if (!response.ok) throw new Error('route');
      const json = await response.json() as any;
      const seconds = json.features?.[0]?.properties?.time;
      if (!Number.isFinite(seconds) || seconds < 0) throw new Error('route');
      return Math.ceil(seconds / 60);
    } catch {return demoEtaMinutes(from, to);}
  }

  async matches(userId: string, dto: MatchDto) {
    const category = await resolveServiceCategory(this.db, dto.serviceId);
    const latDelta = 50 / 111;
    const lonDelta = 50 / (111 * Math.max(0.05, Math.cos(dto.latitude * Math.PI / 180)));
    const candidates = await this.db.professionalProfile.findMany({where: {
      ...(dto.professionalProfileId ? {id: dto.professionalProfileId} : {}),
      userId: {not: userId}, verificationStatus: 'VERIFIED', isAvailable: true,
      serviceCategories: {hasSome: serviceCategoryKeys(category)}, user: {status: 'ACTIVE', deletedAt: null, roles: {some: {role: 'SERVICE_PROVIDER'}}},
      serviceRequests: {none: {status: {in: ['ACCEPTED', 'IN_PROGRESS']}}},
      ...(dto.mode === 'ASAP' ? {presence: {is: {online: true, accuracy: {lte: 100}, observedAt: {gte: new Date(Date.now()-120000)}, latitude: {gte: dto.latitude-latDelta, lte: dto.latitude+latDelta}, longitude: {gte: dto.longitude-lonDelta, lte: dto.longitude+lonDelta}}}} :
        {baseLatitude: {gte: dto.latitude-latDelta, lte: dto.latitude+latDelta}, baseLongitude: {gte: dto.longitude-lonDelta, lte: dto.longitude+lonDelta}}),
    }, include: {presence: true}, take: 100});
    const near = candidates.map(p => ({p, distance: distanceKm(dto.latitude, dto.longitude,
      dto.mode === 'ASAP' ? p.presence!.latitude : p.baseLatitude!, dto.mode === 'ASAP' ? p.presence!.longitude : p.baseLongitude!)}))
      .filter(({p, distance}) => distance <= (p.presence?.radiusKm ?? 10) && (dto.mode !== 'ASAP' || freshLocation(p.presence)))
      .sort((a,b) => a.distance-b.distance).slice(0,5);
    const routeResults = await Promise.allSettled(near.map(async ({p, distance}) => {
      const etaMinutes = dto.mode === 'ASAP' ? (await this.route(p.presence!, dto)) + 5 : null;
      return {id: p.id, fullName: p.fullName, title: p.title, distanceKm: Math.round(distance*10)/10, etaMinutes,
        startingPrice: p.startingPrice, eligible: etaMinutes === null || etaMinutes <= 30};
    }));
    const rows = routeResults.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    const eligible = rows.filter(p => p.eligible).sort((a,b)=>(a.etaMinutes??0)-(b.etaMinutes??0));
    if (!eligible.length && routeResults.some(result => result.status === 'rejected'))
      throw new ServiceUnavailableException('Could not estimate the journey. Try again or schedule a visit.');
    return {data: eligible, estimateNotice: 'Estimated arrival, not a guarantee. Road conditions may change.'};
  }

  async book(userId: string, dto: BookDto) {
    if (!dto.recipientConsent || dto.description.trim().length < 10 || dto.locationAddress.trim().length < 5 || dto.recipientName.trim().length < 2)
      throw new BadRequestException('Confirm the recipient and complete the address and work details');
    const key = createHash('sha256').update(`${userId}:${dto.idempotencyKey}`).digest('hex');
    const hash = createHash('sha256').update(JSON.stringify(dto)).digest('hex');
    const existing = await this.db.serviceJourney.findUnique({where: {idempotencyKey: key}});
    if (existing) {
      if (existing.payloadHash !== hash) throw new ConflictException('This submission has already been used. Start a new request.');
      return {id: existing.requestId};
    }
    const scheduled = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
    if (dto.mode === 'SCHEDULED' && (!scheduled || scheduled.getTime() < Date.now()+30*60000 || scheduled.getTime() > Date.now()+30*86400000))
      throw new BadRequestException('Choose a visit between 30 minutes and 30 days from now');
    const match = (await this.matches(userId, dto)).data[0];
    if (!match) throw new ConflictException('No eligible professional at this address. Change the address, professional or visit time.');
    // Plus speed promise: scheduled Plus bookings get a 15-minute accept
    // window instead of 60 (ASAP is already 2). The pro sees the priority.
    const plus = await isPlusClient(this.db, userId);
    try {
      const result = await this.db.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "ProfessionalProfile" WHERE "id" = ${match.id} FOR UPDATE`;
        const p = await tx.professionalProfile.findUniqueOrThrow({where: {id: match.id}, include: {presence: true}});
        if (!p.isAvailable || p.verificationStatus !== 'VERIFIED' || (dto.mode === 'ASAP' && !freshLocation(p.presence))) throw new ConflictException('Availability changed. Please search again.');
        if (await tx.serviceRequest.count({where: {professionalProfileId: p.id, status: {in: ['ACCEPTED','IN_PROGRESS']}}})) throw new ConflictException('Professional is busy. Please search again.');
        const client = await tx.clientProfile.findUniqueOrThrow({where: {userId}});
        const category = await resolveServiceCategory(tx, dto.serviceId);
        const request = await tx.serviceRequest.create({data: {clientProfileId: client.id, professionalProfileId: p.id, serviceCategoryId: category.id,
          description: dto.description.trim(), locationAddress: dto.locationAddress.trim(), latitude: dto.latitude, longitude: dto.longitude, preferredStartDate: scheduled,
          journey: {create: {idempotencyKey: key, payloadHash: hash, mode: dto.mode, recipientName: dto.recipientName.trim(), recipientPhone: dto.recipientPhone,
            scheduledAt: scheduled, expiresAt: new Date(Date.now()+(dto.mode === 'ASAP' ? 120000 : plus ? PLUS_ACCEPT_WINDOW_MS : 3600000)), etaMinutes: match.etaMinutes}},
          statusHistory: {create: {toStatus: 'PENDING', changedByUserId: userId}},
        }});
        await this.notify(tx, p.userId, request.id, plus ? 'Plus priority request' : 'New service request nearby', plus
          ? 'A Plus member needs this job. Accept fast — ignoring it while online adds a penalty to your dues.'
          : 'Review the requested work, address and timing before you accept.', 'PENDING');
        return {id: request.id, providerUserId: p.userId};
      });
      await this.push.dispatch(result.id).catch(() => undefined); // durable cron retries remain if FCM is unavailable
      this.realtime.emitUserUpdate(userId, 'service-requests');
      this.realtime.emitUserUpdate(userId, 'notifications');
      this.realtime.emitUserUpdate(result.providerUserId, 'service-requests');
      this.realtime.emitUserUpdate(result.providerUserId, 'notifications');
      return {id: result.id};
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.db.serviceJourney.findUnique({where: {idempotencyKey: key}});
        if (raced?.payloadHash === hash) return {id: raced.requestId};
      }
      throw error;
    }
  }

  private async notify(tx: Prisma.TransactionClient, userId: string, id: string, title: string, body: string, stage: string) {
    await tx.notification.create({data: {userId, kind: 'request', title, body, data: {serviceRequestId: id, stage}}});
  }

  async read(userId: string, id: string) {
    await this.expire(id);
    const j = await this.db.serviceJourney.findFirst({where: {requestId: id, request: {OR: [{client: {userId}}, {provider: {userId}}]}},
      include: {request: {include: {client: true, provider: {include: {presence: true}}}}}});
    if (!j) throw new NotFoundException('Booking workflow not found');
    const client = j.request.client.userId === userId;
    const p = j.request.provider.presence;
    const {request, payloadHash, idempotencyKey, startCode, ...safe} = j;
    // Plus terms travel with the booking so neither app hardcodes penalty or
    // window figures — the values below are the same constants enforcement
    // uses, and null for non-Plus bookings.
    const plus = await isPlusClient(this.db, j.request.client.userId).catch(() => false);
    return {...safe, startCode: client && ['ARRIVED'].includes(j.stage) ? startCode : undefined,
      tracking: j.stage === 'EN_ROUTE' && p ? {latitude: p.latitude, longitude: p.longitude, updatedAt: p.observedAt, stale: !freshLocation(p)} : null,
      plusTerms: plus ? {acceptWindowMs: PLUS_ACCEPT_WINDOW_MS, arrivalGraceMs: PLUS_ARRIVAL_GRACE_MS,
        lateAcceptPenaltyPaisa: PENALTY_LATE_ACCEPT_Paisa, lateArrivalPenaltyPaisa: PENALTY_LATE_ARRIVAL_Paisa} : null,
      serverTime: new Date().toISOString()};
  }

  async action(userId: string, id: string, dto: JourneyActionDto) {
    await this.expire(id);
    const snapshot = await this.db.serviceJourney.findFirst({where: {requestId: id, request: {OR: [{client: {userId}}, {provider: {userId}}]}}, include: {request: {include: {provider: {include: {presence: true}}, client: true}}}});
    if (!snapshot) throw new NotFoundException('Booking not found');
    const isClient = snapshot.request.client.userId === userId;
    if (!actionStage(snapshot.stage, dto.action, isClient)) throw new BadRequestException('That action is not available at this stage');
    let eta: number | undefined;
    if (['ACCEPT','DEPART'].includes(dto.action)) {
      const presence = snapshot.request.provider.presence;
      if (!freshLocation(presence)) throw new BadRequestException('Share a fresh, accurate location before accepting or departing');
      eta = await this.route(presence!, snapshot.request);
      if (snapshot.mode === 'ASAP' && dto.action === 'ACCEPT' && eta+5 > 30) throw new ConflictException('You can no longer reach this address within the arrival target. Decline this request.');
    }
    if (dto.action === 'ACCEPT') {
      const dues = await unsettledDuesPaisa(this.db, snapshot.request.professionalProfileId).catch(() => 0);
      const limit = await duesLimitPaisa(this.db, snapshot.request.professionalProfileId);
      if (dues >= limit) throw new ConflictException(`Clear your ₹${(dues / 100).toLocaleString('en-IN')} commission dues to accept new work`);
    }
    // Paid-before-work gate. No-op while payments are unconfigured so the
    // booking flow keeps working in development and existing tests.
    // Pay-at-home bookings skip it: the provider collects at the door.
    if (dto.action === 'START' && this.payments && snapshot.collectionMode !== 'AT_HOME') await this.payments.requirePaid(id);
    if (dto.action === 'CONFIRM' && snapshot.collectionMode === 'AT_HOME' && this.payments) {
      await this.payments.ensureAtHomeCollection(id).catch(() => null);
      const recorded = await this.db.payment.findUnique({where: {serviceRequestId: id}}).catch(() => null);
      if (!recorded) throw new ConflictException('Collection is still recording. Try again in a moment.');
    }
    let arrivalTarget: Date | null = null;
    const outcome = await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "ProfessionalProfile" WHERE "id" = ${snapshot.request.professionalProfileId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "requestId" FROM "ServiceJourney" WHERE "requestId" = ${id} FOR UPDATE`;
      const j = await tx.serviceJourney.findUniqueOrThrow({where: {requestId: id}});
      if (dto.action === 'ARRIVE') arrivalTarget = j.arrivalTarget;
      if (j.revision !== dto.revision) throw new ConflictException('Booking changed. Refresh before trying again.');
      const stage = actionStage(j.stage, dto.action, isClient);
      if (!stage || (j.stage === 'PENDING' && j.expiresAt.getTime() <= Date.now())) throw new ConflictException('This request is no longer available');
      const patch: Prisma.ServiceJourneyUpdateInput = {stage, revision: {increment: 1}};
      if (dto.action === 'ACCEPT') {
        const p = await tx.professionalProfile.findUniqueOrThrow({where: {id: snapshot.request.professionalProfileId}, include: {presence: true}});
        if (!p.isAvailable || p.verificationStatus !== 'VERIFIED' || !freshLocation(p.presence)) throw new ConflictException('You are no longer available');
        if (await tx.serviceRequest.count({where: {professionalProfileId: p.id, id: {not: id}, status: {in: ['ACCEPTED','IN_PROGRESS']}}})) throw new ConflictException('Complete your active job before accepting another');
        patch.etaMinutes = eta!+5;
        patch.arrivalTarget = j.mode === 'ASAP' ? new Date(Date.now()+(eta!+5)*60000) : j.scheduledAt;
      }
      if (dto.action === 'DEPART') {
        if (j.scheduledAt && j.scheduledAt.getTime() > Date.now()+3600000) throw new BadRequestException('Start travel within an hour of the agreed visit');
        patch.etaMinutes = eta!; patch.arrivalTarget = new Date(Date.now()+eta!*60000);
      }
      if (dto.action === 'ARRIVE') {
        const p = await tx.providerPresence.findUnique({where: {professionalProfileId: snapshot.request.professionalProfileId}});
        if (!freshLocation(p) || distanceKm(p!.latitude,p!.longitude,snapshot.request.latitude,snapshot.request.longitude) > 0.3) throw new BadRequestException('Update your location at the service address before marking arrival');
        patch.startCode = String(randomInt(100000,1000000));
      }
      if (dto.action === 'QUOTE') {
        if (dto.amount === undefined || !dto.note || dto.note.trim().length < 10) throw new BadRequestException('Add the agreed work scope and full price');
        patch.quoteAmount = dto.amount; patch.quoteScope = dto.note.trim(); patch.quoteAccepted = false;
      }
      if (dto.action === 'APPROVE_QUOTE') {
        if (j.quoteAmount === null) throw new BadRequestException('Wait for a quote first');
        patch.quoteAccepted = true;
        patch.collectionMode = dto.collectionMode ?? 'ONLINE';
      }
      if (dto.action === 'START') {
        if (!j.quoteAccepted) throw new BadRequestException('Customer must approve the quote first');
        // In-transaction recheck: a refund racing START must not let unpaid work begin.
        // Pay-at-home bookings skip it: the provider collects at the door.
        if (this.payments?.enabled && j.collectionMode !== 'AT_HOME') {
          const pay = await tx.payment.findUnique({where: {serviceRequestId: id}});
          if (!pay || !['PAID', 'HELD', 'RELEASE_PENDING', 'RELEASED'].includes(pay.status))
            throw new BadRequestException('Complete payment for the approved quote before work starts');
        }
        if (j.codeAttempts >= 5) throw new BadRequestException('Code attempts exhausted. Contact support.');
        if (!dto.code || dto.code !== j.startCode) {
          await tx.serviceJourney.update({where: {requestId: id}, data: {codeAttempts: {increment: 1}}});
          return {error: 'Incorrect service-start code'};
        }
        patch.startCode = null;
      }
      if (dto.action === 'FINISH') {
        if (!j.quoteAccepted || !dto.note || dto.note.trim().length < 10) throw new BadRequestException('Get price approval and add a completion summary');
        patch.completionSummary = dto.note.trim();
        if (j.collectionMode === 'AT_HOME') {
          if (!dto.collectedAmountPaisa || dto.collectedAmountPaisa < 100 || !dto.collectedMethod)
            throw new BadRequestException('Enter the amount collected at home and how it was paid');
          patch.collectedAmountPaisa = dto.collectedAmountPaisa;
          patch.collectedMethod = dto.collectedMethod;
          patch.collectedAt = new Date();
        }
      }
      if (dto.action === 'ISSUE') {
        if (!dto.note || dto.note.trim().length < 10) throw new BadRequestException('Explain the issue so it can be reviewed');
        patch.issue = dto.note.trim();
      }
      if (dto.action === 'RESCHEDULE') {
        const when = dto.scheduledAt ? new Date(dto.scheduledAt) : null;
        if (!when || !Number.isFinite(when.getTime()) || when.getTime() < Date.now()+30*60000 || when.getTime() > Date.now()+30*86400000)
          throw new BadRequestException('Choose a visit between 30 minutes and 30 days from now');
        patch.scheduledAt = when;
        patch.mode = 'SCHEDULED';
        if (j.stage === 'PENDING') {
          const plus = await isPlusClient(this.db, snapshot.request.client.userId).catch(() => false);
          patch.expiresAt = new Date(Date.now() + (plus ? PLUS_ACCEPT_WINDOW_MS : 3600000));
        }
      }
      await tx.serviceJourney.update({where: {requestId: id}, data: patch});
      const status: RequestStatus = stage === 'COMPLETED' ? 'COMPLETED' : stage === 'CANCELLED' ? 'CANCELLED' : stage === 'DECLINED' ? 'DECLINED' :
        ['IN_PROGRESS','AWAITING_CONFIRMATION','DISPUTED'].includes(stage) ? 'IN_PROGRESS' : 'ACCEPTED';
      await tx.serviceRequest.update({where: {id}, data: {status, statusHistory: {create: {toStatus: status, changedByUserId: userId, reason: `${dto.action}: ${stage}`}}}});
      const notice = journeyNotification(dto.action, stage);
      await this.notify(tx, isClient ? snapshot.request.provider.userId : snapshot.request.client.userId, id, notice.title, notice.body, stage);
      await tx.auditLog.createMany({data: [snapshot.request.client.userId, snapshot.request.provider.userId].map(owner => ({userId: owner, entity: 'ServiceRequest', entityId: id, action: `SERVICE_${dto.action}`, metadata: {stage}}))});
      return {error: null};
    });
    if (outcome.error) throw new BadRequestException(outcome.error);
    // Money side-effects stay outside the booking transaction and never fail
    // the action; each lands the payment in an explicit, retryable state.
    if (this.payments) {
      if (dto.action === 'FINISH') await this.payments.ensureAtHomeCollection(id).catch(() => undefined);
      if (dto.action === 'CONFIRM') await this.payments.releaseForRequest(id, userId).catch(() => undefined);
      if (dto.action === 'ISSUE') await this.payments.markDisputed(id, userId).catch(() => undefined);
      if (dto.action === 'CANCEL') await this.payments.cancelUnpaidOrRefund(id, userId).catch(() => undefined);
      // Plus enforcement: arriving past the target + grace on a Plus booking
      // posts the late-arrival penalty into dues. Never fails the arrival.
      if (dto.action === 'ARRIVE' && arrivalTarget
          && Date.now() > arrivalTarget.getTime() + PLUS_ARRIVAL_GRACE_MS
          && await isPlusClient(this.db, snapshot.request.client.userId)) {
        await this.payments.postPenalty(snapshot.request.professionalProfileId, id,
          PENALTY_LATE_ARRIVAL_Paisa, 'LATE_ARRIVAL').catch(() => undefined);
      }
    }
    await this.push.dispatch(id).catch(() => undefined);
    this.realtime.emitUserUpdate(snapshot.request.client.userId, 'service-requests');
    this.realtime.emitUserUpdate(snapshot.request.client.userId, 'notifications');
    this.realtime.emitUserUpdate(snapshot.request.provider.userId, 'service-requests');
    this.realtime.emitUserUpdate(snapshot.request.provider.userId, 'notifications');
    return this.read(userId, id);
  }

  async expire(id?: string, userId?: string) {
    const due = await this.db.serviceJourney.findMany({where: {stage: 'PENDING', expiresAt: {lte: new Date()}, ...(id ? {requestId: id} : {}), ...(userId ? {request: {OR: [{client: {userId}}, {provider: {userId}}]}} : {})}, include: {request: {include: {client: true, provider: {include: {presence: true}}}}}, take: 50});
    for (const j of due) {
      const expired = await this.db.$transaction(async tx => {
        const claimed = await tx.serviceJourney.updateMany({where: {requestId: j.requestId, stage: 'PENDING'}, data: {stage: 'EXPIRED', revision: {increment: 1}}});
        if (!claimed.count) return false;
        await tx.serviceRequest.update({where: {id: j.requestId}, data: {status: 'DECLINED', statusHistory: {create: {toStatus: 'DECLINED', changedByUserId: j.request.client.userId, reason: 'Acceptance window expired'}}}});
        await this.notify(tx, j.request.client.userId, j.requestId, 'Request expired', 'No acceptance was received. You can choose another professional.', 'EXPIRED');
        await this.notify(tx, j.request.provider.userId, j.requestId, 'Request expired', 'The acceptance window ended before this request was accepted.', 'EXPIRED');
        return true;
      });
      if (expired) {
        // Plus enforcement: an online pro who let a Plus request expire pays
        // the slow-acceptance penalty into dues. Offline pros just expire.
        if (j.request.provider.presence?.online && this.payments
            && await isPlusClient(this.db, j.request.client.userId)) {
          await this.payments.postPenalty(j.request.professionalProfileId, j.requestId,
            PENALTY_LATE_ACCEPT_Paisa, 'LATE_ACCEPT').catch(() => undefined);
        }
        await this.push.dispatch(j.requestId).catch(() => undefined);
        this.realtime.emitUserUpdate(j.request.client.userId, 'service-requests');
        this.realtime.emitUserUpdate(j.request.client.userId, 'notifications');
        this.realtime.emitUserUpdate(j.request.provider.userId, 'service-requests');
        this.realtime.emitUserUpdate(j.request.provider.userId, 'notifications');
      }
    }
  }
}
