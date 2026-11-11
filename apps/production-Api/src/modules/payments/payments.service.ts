import {BadRequestException, ConflictException, Injectable, NotFoundException, Optional, ServiceUnavailableException, UnauthorizedException} from '@nestjs/common';
import {CollectionMode, JourneyStage, NotificationKind, PaymentStatus, PayoutAccountStatus, PenaltyReason, PenaltyStatus, SettlementStatus} from '@prisma/client';
import {PrismaService} from '../../common/prisma/prisma.service';
import {pagination} from '../platform/platform.service';
import {TERMINAL_STAGES} from '../platform/journey.rules';
import {PushService} from '../notifications/push.service';
import {ReceiptEmailService} from '../notifications/receipt-email.service';
import {ChatGateway} from '../chat/chat.gateway';
import {RazorpayError, RazorpayProvider} from './razorpay.provider';
import {MembershipsService} from '../memberships/memberships.service';
import {DUES_BLOCK_Paisa, MEMBER_DUES_BLOCK_Paisa, MEMBER_FEE_BPS, MEMBER_FREE_JOBS_PER_MONTH, PLATFORM_FEE_BPS, duesLimitPaisa, plusDiscountPaisa} from './commission';
import {isPlusClient} from '../memberships/membership-reads';
import {RefundPaymentDto, RegisterPayoutAccountDto, ResolveDisputeDto, VerifyPaymentDto, VerifySettlementDto} from './payments.dto';

// Held-payment flow for service bookings. The client pays the approved quote
// (integer paisa) before work starts; the professional share is held via a
// Razorpay Route transfer and released when the client confirms completion.
// Engineer (consultation) bookings follow the same held-payment lifecycle,
// except the amount is the engineer's consultation fee and it stays payable
// after completion, since consultations are usually paid once the visit or
// advice is delivered. Webhooks are the source of truth for asynchronous
// outcomes; every handler is idempotent and every money mutation is guarded
// by the payment status.
const PAYABLE_STAGES: JourneyStage[] = [JourneyStage.ARRIVED, JourneyStage.IN_PROGRESS, JourneyStage.AWAITING_CONFIRMATION];
// Consultation fees open once the engineer accepts and stay open through
// completion. PENDING has no rendered consultation yet; DECLINED and
// CANCELLED are terminal and can never be paid.
const ENGINEER_PAYABLE_STATUSES = ['ACCEPTED', 'IN_PROGRESS', 'COMPLETED'];
const ENGINEER_CLOSED_STATUSES = ['CANCELLED', 'DECLINED'];

type BookingRef = {serviceRequestId?: string; engineerRequestId?: string};

type PartyRequest = {
  id: string; status: string; description: string;
  client: {userId: string; fullName: string}; provider: {id: string; userId: string; fullName: string};
  journey: {stage: JourneyStage; quoteAmountPaisa: number | null; quoteAccepted: boolean; collectionMode: CollectionMode;
    collectedAmountPaisa: number | null; collectedMethod: string | null} | null;
};

type EngineerPartyRequest = {
  id: string; status: string; projectTitle: string;
  client: {userId: string; fullName: string};
  engineer: {professionalProfileId: string; consultationFeePaisa: number | null; profile: {userId: string; fullName: string}};
};

@Injectable()
export class PaymentsService {
  constructor(private readonly db: PrismaService, private readonly provider: RazorpayProvider,
    private readonly push: PushService, private readonly realtime: ChatGateway,
    @Optional() private readonly memberships?: MembershipsService,
    @Optional() private readonly email?: ReceiptEmailService) {}

  get enabled() {
    return this.provider.enabled;
  }

  private requireEnabled() {
    if (!this.provider.enabled) throw new ServiceUnavailableException(process.env.APP_ENV === 'preview'
      ? 'Demo mode: payments activate once Razorpay test keys are added'
      : 'Payments are not configured');
  }

  private feeSplit(amountPaisa: number, member: boolean) {
    const bps = member ? MEMBER_FEE_BPS : PLATFORM_FEE_BPS;
    const platformFeePaisa = Math.floor((amountPaisa * bps) / 10000);
    return {platformFeePaisa, professionalAmountPaisa: amountPaisa - platformFeePaisa};
  }

  // Member pricing: the first booking row of each calendar month is free
  // (0% commission), the rest bill at 7%. Any row counts — including an
  // abandoned order — so two concurrent first jobs cannot both go free.
  private async feeSplitFor(professionalProfileId: string, amountPaisa: number, member: boolean) {
    if (member && !(await this.usedFreeJob(professionalProfileId))) {
      return {platformFeePaisa: 0, professionalAmountPaisa: amountPaisa};
    }
    return this.feeSplit(amountPaisa, member);
  }

  private async usedFreeJob(professionalProfileId: string) {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const count = await this.db.payment.count({where: {professionalProfileId, createdAt: {gte: start}}});
    return count >= MEMBER_FREE_JOBS_PER_MONTH;
  }

  private checkExactlyOne(ref: BookingRef) {
    if ((ref.serviceRequestId ? 1 : 0) + (ref.engineerRequestId ? 1 : 0) !== 1)
      throw new BadRequestException('Address exactly one booking per payment request');
  }

  private async partyRequest(serviceRequestId: string): Promise<PartyRequest> {
    const request = await this.db.serviceRequest.findFirst({where: {id: serviceRequestId},
      include: {client: true, provider: true, journey: true}});
    if (!request?.journey) throw new NotFoundException('Booking workflow not found');
    return request as PartyRequest;
  }

  private async engineerPartyRequest(engineerRequestId: string): Promise<EngineerPartyRequest> {
    const request = await this.db.engineerRequest.findFirst({where: {id: engineerRequestId},
      include: {client: true, engineer: {include: {profile: true}}}});
    if (!request) throw new NotFoundException('Booking not found');
    return request as EngineerPartyRequest;
  }

  // Parties + closed state behind any stored payment row, for webhook paths
  // that only know the payment. Never throws for a missing booking: callers
  // treat an unknown booking as closed and dispute for support review.
  private async partyOfPayment(payment: {serviceRequestId: string | null; engineerRequestId: string | null}) {
    if (payment.engineerRequestId) {
      const request = await this.engineerPartyRequest(payment.engineerRequestId).catch(() => null);
      return {kind: 'engineer' as const, requestId: payment.engineerRequestId,
        clientUserId: request?.client.userId, providerUserId: request?.engineer.profile.userId,
        closed: !request || ENGINEER_CLOSED_STATUSES.includes(request.status)};
    }
    const request = await this.partyRequest(payment.serviceRequestId!).catch(() => null);
    return {kind: 'service' as const, requestId: payment.serviceRequestId!,
      clientUserId: request?.client.userId, providerUserId: request?.provider.userId,
      closed: !request || TERMINAL_STAGES.includes(request.journey?.stage ?? JourneyStage.PENDING)};
  }

  private async tell(userIds: string[], ref: BookingRef & {requestId: string}, title: string, body: string, action: string) {
    const engineer = !!ref.engineerRequestId;
    await this.db.notification.createMany({data: userIds.map(userId =>
      ({userId, kind: NotificationKind.payment, title, body, data: engineer
        ? {engineerRequestId: ref.engineerRequestId, requestId: ref.requestId, destination: 'engineer-request'}
        : {serviceRequestId: ref.serviceRequestId}}))});
    await this.db.auditLog.createMany({data: userIds.map(userId =>
      ({userId, entity: 'Payment', entityId: ref.requestId, action, metadata: {title}}))});
    await this.push.dispatch(ref.requestId, engineer ? 'engineerRequestId' : 'serviceRequestId').catch(() => undefined);
    for (const userId of userIds) {
      this.realtime.emitUserUpdate(userId, engineer ? 'requests' : 'service-requests');
      this.realtime.emitUserUpdate(userId, 'notifications');
    }
  }

  // Payment receipt email. Best-effort by design: skipped silently when
  // email is unconfigured or the payer has no address, and a send failure
  // never fails the payment it acknowledges.
  private async receipt(toUserId: string, subject: string, lines: string[]) {
    try {
      if (!this.email?.enabled) return;
      const user = await this.db.user.findUnique({where: {id: toUserId}, select: {email: true, displayName: true}});
      if (!user?.email) return;
      await this.email.send({to: user.email, subject,
        text: [`Hi ${user.displayName || 'there'},`, '', ...lines, '', '— Team NAHTREEK'].join('\n')});
    } catch {
      // Receipts acknowledge money; they must never block or break it.
    }
  }

  private bookingReceipt(input: {title: string; ref: string; amountPaisa: number;
    proName: string; online: boolean; method?: string | null; paymentRef?: string | null; held: boolean}) {
    const amount = `₹${(input.amountPaisa / 100).toLocaleString('en-IN')}`;
    const pro = input.proName?.trim() || 'your professional';
    const heading = (input.title || 'NAHTREEK booking').slice(0, 48);
    const subject = `Payment receipt · ${amount} · ${heading}`;
    const lines = [
      `Booking: ${heading} (#${input.ref.slice(0, 8)})`,
      `Paid: ${amount} to ${pro} ${input.online ? 'online' : `directly by ${(input.method || 'cash').toLowerCase()}`}.`,
      ...(input.paymentRef ? [`Payment ref: ${input.paymentRef}`] : []),
      `Date: ${new Date().toLocaleString('en-IN', {timeZone: 'Asia/Kolkata'})}`,
      input.held
        ? 'Held securely by NAHTREEK. It releases to the professional after review.'
        : 'This payment is complete. No further action is needed.',
      'Questions? Message your professional in the app chat or contact NAHTREEK support.',
    ];
    return {subject, lines};
  }

  // Refund receipt email, sent when a refund completes (webhook or sweeper).
  // Best-effort like payment receipts: never throws into money flows.
  private async refundReceipt(paymentId: string) {
    try {
      const row = await this.db.payment.findUnique({where: {id: paymentId}});
      if (!row) return;
      const parties = await this.partyOfPayment(row);
      if (!parties.clientUserId) return;
      const amount = `₹${(row.amountPaisa / 100).toLocaleString('en-IN')}`;
      await this.receipt(parties.clientUserId, `Refund completed · ${amount} · NAHTREEK booking`, [
        `Booking ref: #${parties.requestId.slice(0, 8)}`,
        `Refunded: ${amount} in full to your original payment method.`,
        `Date: ${new Date().toLocaleString('en-IN', {timeZone: 'Asia/Kolkata'})}`,
        'It should reflect in your account within 5-7 working days.',
        'Questions? Message your professional in the app chat or contact NAHTREEK support.',
      ]);
    } catch {
      // Receipts acknowledge money; they must never block or break it.
    }
  }

  private toProviderError(error: unknown): never {
    if (error instanceof RazorpayError && !error.retryable && error.status < 500)
      throw new BadRequestException(error.message);
    throw new ServiceUnavailableException('Payment provider unavailable. Try again.');
  }

  private viewOf(payment: {status: PaymentStatus; amountPaisa: number; platformFeePaisa: number; professionalAmountPaisa: number;
    currency: string; providerOrderId: string | null; paidAt: Date | null; releasedAt: Date | null; refundedAt: Date | null;
    collectionMode?: CollectionMode | null; settledAt?: Date | null}) {
    return {status: payment.status, amountPaisa: payment.amountPaisa, platformFeePaisa: payment.platformFeePaisa,
      professionalAmountPaisa: payment.professionalAmountPaisa, currency: payment.currency,
      collectionMode: payment.collectionMode ?? CollectionMode.ONLINE, settledAt: payment.settledAt ?? null,
      razorpayOrderId: payment.providerOrderId, paidAt: payment.paidAt, releasedAt: payment.releasedAt, refundedAt: payment.refundedAt};
  }

  async createOrder(userId: string, serviceRequestId: string) {
    this.requireEnabled();
    const request = await this.partyRequest(serviceRequestId);
    if (request.client.userId !== userId) throw new NotFoundException('Booking not found');
    if (!request.journey!.quoteAccepted || request.journey!.quoteAmountPaisa === null)
      throw new BadRequestException('A quote must be approved before payment');
    if (!PAYABLE_STAGES.includes(request.journey!.stage)) throw new ConflictException('This booking can no longer be paid');
    if (request.journey!.collectionMode === CollectionMode.AT_HOME)
      throw new ConflictException('This booking is pay-at-home. No online payment is needed.');
    const amountPaisa = request.journey!.quoteAmountPaisa;
    if (!Number.isFinite(amountPaisa) || amountPaisa < 100) throw new BadRequestException('The approved quote is below the minimum charge');
    const existing = await this.db.payment.findUnique({where: {serviceRequestId}});
    if (existing) {
      // Money that moved must never be silently reset by a re-quote.
      if (['PAID', 'HELD', 'RELEASE_PENDING', 'RELEASED', 'REFUND_PENDING', 'REFUNDED', 'DISPUTED'].includes(existing.status)) {
        if (existing.amountPaisa !== amountPaisa)
          throw new ConflictException('The quote changed after payment. Support will review it.');
        return {paymentId: existing.id, keyId: this.provider.keyId, ...this.viewOf(existing)};
      }
      if (existing.status === PaymentStatus.ORDER_CREATED && existing.amountPaisa === amountPaisa)
        return {paymentId: existing.id, keyId: this.provider.keyId, ...this.viewOf(existing)};
      // NOT_STARTED, FAILED, or ORDER_CREATED with a changed quote: new attempt on the same row.
    }
    const member = (await this.memberships?.isEffectiveByProfile(request.provider.id).catch(() => false)) ?? false;
    const {platformFeePaisa, professionalAmountPaisa} = await this.feeSplitFor(request.provider.id, amountPaisa, member);
    const payment = existing
      ? await this.db.payment.update({where: {id: existing.id}, data: {amountPaisa, platformFeePaisa, professionalAmountPaisa,
          providerOrderId: null, providerPaymentId: null, providerTransferId: null, status: PaymentStatus.NOT_STARTED}})
      : await this.db.payment.create({data: {professionalProfileId: request.provider.id, serviceRequestId,
          amountPaisa, platformFeePaisa, professionalAmountPaisa, idempotencyKey: `pay-${serviceRequestId}`}});
    let order: {id: string};
    try {
      order = await this.provider.createOrder({amountPaisa, currency: 'INR', receipt: payment.id,
        notes: {serviceRequestId, paymentId: payment.id}});
    } catch (error) {
      await this.db.payment.update({where: {id: payment.id}, data: {status: PaymentStatus.FAILED}});
      this.toProviderError(error);
    }
    const updated = await this.db.payment.update({where: {id: payment.id},
      data: {providerOrderId: order!.id, status: PaymentStatus.ORDER_CREATED}});
    return {paymentId: payment.id, keyId: this.provider.keyId, ...this.viewOf(updated)};
  }

  async createEngineerOrder(userId: string, engineerRequestId: string) {
    this.requireEnabled();
    const request = await this.engineerPartyRequest(engineerRequestId);
    if (request.client.userId !== userId) throw new NotFoundException('Booking not found');
    if (!ENGINEER_PAYABLE_STATUSES.includes(request.status)) {
      if (ENGINEER_CLOSED_STATUSES.includes(request.status))
        throw new ConflictException('This booking can no longer be paid');
      throw new BadRequestException('Payment opens after the engineer accepts the request');
    }
    if (request.engineer.consultationFeePaisa === null || request.engineer.consultationFeePaisa === undefined)
      throw new BadRequestException('This engineer has no consultation fee set. Agree the fee in chat before paying.');
    const amountPaisa = request.engineer.consultationFeePaisa;
    if (!Number.isFinite(amountPaisa) || amountPaisa < 100) throw new BadRequestException('The consultation fee is below the minimum charge');
    const existing = await this.db.payment.findUnique({where: {engineerRequestId}});
    if (existing) {
      if (([PaymentStatus.COLLECTED_UNSETTLED, PaymentStatus.SETTLED] as PaymentStatus[]).includes(existing.status as PaymentStatus))
        throw new ConflictException('This booking was already recorded as paid directly. No online payment is needed.');
      // Money that moved must never be silently reset by a fee change.
      if (['PAID', 'HELD', 'RELEASE_PENDING', 'RELEASED', 'REFUND_PENDING', 'REFUNDED', 'DISPUTED'].includes(existing.status)) {
        if (existing.amountPaisa !== amountPaisa)
          throw new ConflictException('The fee changed after payment. Support will review it.');
        return {paymentId: existing.id, keyId: this.provider.keyId, ...this.viewOf(existing)};
      }
      if (existing.status === PaymentStatus.ORDER_CREATED && existing.amountPaisa === amountPaisa)
        return {paymentId: existing.id, keyId: this.provider.keyId, ...this.viewOf(existing)};
      // NOT_STARTED, FAILED, or ORDER_CREATED with a changed fee: new attempt on the same row.
    }
    const member = (await this.memberships?.isEffectiveByProfile(request.engineer.professionalProfileId).catch(() => false)) ?? false;
    const split = await this.feeSplitFor(request.engineer.professionalProfileId, amountPaisa, member);
    // Plus consultation discount: 2% (capped) off the amount due, funded out
    // of the platform commission — the engineer's share never shrinks. The
    // discount locks at order creation like the commission rate.
    let chargePaisa = amountPaisa;
    let platformFeePaisa = split.platformFeePaisa;
    let professionalAmountPaisa = split.professionalAmountPaisa;
    let plusDiscount = 0;
    if (await isPlusClient(this.db, userId)) {
      plusDiscount = plusDiscountPaisa(amountPaisa);
      chargePaisa = amountPaisa - plusDiscount;
      platformFeePaisa = Math.max(0, platformFeePaisa - plusDiscount);
      professionalAmountPaisa = chargePaisa - platformFeePaisa;
    }
    const payment = existing
      ? await this.db.payment.update({where: {id: existing.id}, data: {amountPaisa: chargePaisa, platformFeePaisa, professionalAmountPaisa,
          providerOrderId: null, providerPaymentId: null, providerTransferId: null, status: PaymentStatus.NOT_STARTED}})
      : await this.db.payment.create({data: {professionalProfileId: request.engineer.professionalProfileId, engineerRequestId,
          amountPaisa: chargePaisa, platformFeePaisa, professionalAmountPaisa, idempotencyKey: `pay-eng-${engineerRequestId}`}});
    let order: {id: string};
    try {
      order = await this.provider.createOrder({amountPaisa: chargePaisa, currency: 'INR', receipt: payment.id,
        notes: {engineerRequestId, paymentId: payment.id}});
    } catch (error) {
      await this.db.payment.update({where: {id: payment.id}, data: {status: PaymentStatus.FAILED}});
      this.toProviderError(error);
    }
    const updated = await this.db.payment.update({where: {id: payment.id},
      data: {providerOrderId: order!.id, status: PaymentStatus.ORDER_CREATED}});
    return {paymentId: payment.id, keyId: this.provider.keyId, plusDiscountPaisa: plusDiscount, ...this.viewOf(updated)};
  }

  // Engineer twin of the service at-home flow: the engineer declares cash
  // or UPI received directly, and the commission posts to dues. Without this
  // every off-app consultation payment would bypass the platform entirely.
  async declareEngineerCollection(proUserId: string, dto: {engineerRequestId: string; amount: number; method: string}) {
    const request = await this.engineerPartyRequest(dto.engineerRequestId);
    if (request.engineer.profile.userId !== proUserId) throw new NotFoundException('Booking not found');
    if (!['IN_PROGRESS', 'COMPLETED'].includes(request.status))
      throw new BadRequestException('Direct collection can be declared only after the work starts');
    const existing = await this.db.payment.findUnique({where: {engineerRequestId: dto.engineerRequestId}});
    if (existing?.providerPaymentId) throw new ConflictException('This booking was already paid online');
    if (existing && ([PaymentStatus.COLLECTED_UNSETTLED, PaymentStatus.SETTLED] as PaymentStatus[]).includes(existing.status as PaymentStatus))
      throw new ConflictException('Direct collection was already recorded for this booking');
    if (existing && existing.status === PaymentStatus.ORDER_CREATED && existing.providerOrderId) {
      // A client checkout is in flight: capture can lag the row by seconds.
      // Reconcile with the provider before overwriting the order — a capture
      // wiped here would strand the money (no order left to verify against)
      // while the client was actually charged. Provider errors surface as
      // 503 so the engineer retries instead of declaring blind.
      const remote = await this.capturedForOrder(existing.providerOrderId);
      if (remote) {
        await this.claimEngineerCapture(request, existing, remote);
        throw new ConflictException('This booking was already paid online');
      }
    }
    const amountPaisa = Math.round(dto.amount * 100);
    if (!Number.isFinite(amountPaisa) || amountPaisa < 100) throw new BadRequestException('Enter the amount received (minimum ₹1)');
    const member = (await this.memberships?.isEffectiveByProfile(request.engineer.professionalProfileId).catch(() => false)) ?? false;
    const {platformFeePaisa, professionalAmountPaisa} = await this.feeSplitFor(request.engineer.professionalProfileId, amountPaisa, member);
    const data = {amountPaisa, platformFeePaisa, professionalAmountPaisa, collectionMode: CollectionMode.AT_HOME,
      collectedAmountPaisa: amountPaisa, collectedMethod: dto.method, status: PaymentStatus.COLLECTED_UNSETTLED,
      providerOrderId: null, providerPaymentId: null, providerTransferId: null};
    const row = existing
      ? await this.db.payment.update({where: {id: existing.id}, data})
      : await this.db.payment.create({data: {professionalProfileId: request.engineer.professionalProfileId,
          engineerRequestId: dto.engineerRequestId, idempotencyKey: `collect-eng-${dto.engineerRequestId}`, ...data}});
    await this.tell([request.client.userId, request.engineer.profile.userId],
      {engineerRequestId: request.id, requestId: request.id},
      'Direct payment recorded',
      `₹${(amountPaisa / 100).toLocaleString('en-IN')} was received directly. ₹${(platformFeePaisa / 100).toLocaleString('en-IN')} commission was added to the professional's dues.`,
      'PAYMENT_CASH_DECLARED');
    const declaredReceipt = this.bookingReceipt({title: request.projectTitle, ref: request.id, amountPaisa,
      proName: request.engineer.profile.fullName, online: false, method: dto.method, held: false});
    await this.receipt(request.client.userId, declaredReceipt.subject, declaredReceipt.lines);
    return this.viewOf(row);
  }

  // Plus speed-SLA penalty. Posted when a Plus booking runs slow (ignored
  // while online, or arrived past the target + grace). Lands in the same
  // dues the pro settles by UPI. Idempotent per booking+reason: concurrent
  // posts converge on the first row; anything else rethrows for the caller
  // to contain so the booking action itself never fails.
  async postPenalty(professionalProfileId: string, serviceRequestId: string, amountPaisa: number,
      reason: PenaltyReason) {
    try {
      const row = await this.db.professionalPenalty.create({data: {professionalProfileId, serviceRequestId, amountPaisa, reason}});
      const request = await this.partyRequest(serviceRequestId).catch(() => null);
      const label = reason === PenaltyReason.LATE_ACCEPT ? 'slow acceptance' : 'late arrival';
      const amount = `₹${(amountPaisa / 100).toLocaleString('en-IN')}`;
      if (request) {
        await this.db.notification.create({data: {userId: request.provider.userId, kind: NotificationKind.payment,
          title: 'Late penalty added to dues',
          body: `${amount} for ${label} on a Plus priority booking. Settle it with your commission dues.`,
          data: {serviceRequestId: request.id}}});
        await this.db.auditLog.create({data: {userId: request.provider.userId, entity: 'ProfessionalPenalty',
          entityId: row.id, action: 'PENALTY_POSTED', metadata: {serviceRequestId, reason, amountPaisa}}});
        this.realtime.emitUserUpdate(request.provider.userId, 'notifications');
      }
      return row;
    } catch (error) {
      if ((error as {code?: string})?.code === 'P2002') {
        return this.db.professionalPenalty.findUnique({where: {serviceRequestId_reason: {serviceRequestId, reason}}});
      }
      throw error;
    }
  }

  // Client-raised dispute for a held payment (either booking kind). The
  // money stays frozen as DISPUTED until an admin releases or refunds it.
  async reportDispute(userId: string, dto: {serviceRequestId?: string; engineerRequestId?: string; reason: string}) {
    this.checkExactlyOne(dto);
    const engineer = !!dto.engineerRequestId;
    const clientUserId = engineer
      ? (await this.engineerPartyRequest(dto.engineerRequestId!)).client.userId
      : (await this.partyRequest(dto.serviceRequestId!)).client.userId;
    if (clientUserId !== userId) throw new NotFoundException('Booking not found');
    const payment = await this.db.payment.findUnique({where: engineer
      ? {engineerRequestId: dto.engineerRequestId}
      : {serviceRequestId: dto.serviceRequestId}});
    if (!payment?.providerPaymentId) throw new NotFoundException('No captured payment to dispute');
    if (!['PAID', 'HELD'].includes(payment.status))
      throw new ConflictException('Only a held payment can be disputed. Released payments need support review.');
    const updated = await this.db.payment.update({where: {id: payment.id}, data: {status: PaymentStatus.DISPUTED}});
    const parties = await this.partyOfPayment({serviceRequestId: payment.serviceRequestId, engineerRequestId: payment.engineerRequestId});
    const ref: BookingRef & {requestId: string} = engineer
      ? {engineerRequestId: parties.requestId, requestId: parties.requestId}
      : {serviceRequestId: parties.requestId, requestId: parties.requestId};
    await this.tell([parties.clientUserId, parties.providerUserId].filter((id): id is string => !!id), ref,
      'Payment disputed', `The client reported a problem: ${dto.reason} Support will review it and decide.`, 'PAYMENT_DISPUTED');
    return this.viewOf(updated);
  }

  async verify(userId: string, dto: VerifyPaymentDto) {
    this.requireEnabled();
    this.checkExactlyOne(dto);
    if (dto.engineerRequestId) return this.verifyEngineer(userId, dto);
    const request = await this.partyRequest(dto.serviceRequestId!);
    if (request.client.userId !== userId) throw new NotFoundException('Booking not found');
    const payment = await this.db.payment.findUnique({where: {serviceRequestId: dto.serviceRequestId}});
    if (!payment) throw new NotFoundException('No payment for this booking');
    if (payment.providerPaymentId === dto.razorpayPaymentId && payment.status !== PaymentStatus.ORDER_CREATED)
      return this.viewOf(payment);
    if (payment.status !== PaymentStatus.ORDER_CREATED || payment.providerOrderId !== dto.razorpayOrderId)
      throw new ConflictException('This payment cannot be confirmed in its current state');
    if (TERMINAL_STAGES.includes(request.journey!.stage))
      throw new ConflictException('This booking is closed and can no longer be paid');
    if (!this.provider.verifyPaymentSignature(dto.razorpayOrderId, dto.razorpayPaymentId, dto.razorpaySignature))
      throw new UnauthorizedException('Invalid payment signature');
    let remote: {status: string; order_id: string; amount: number};
    try {
      remote = await this.provider.fetchPayment(dto.razorpayPaymentId);
    } catch (error) {
      this.toProviderError(error);
    }
    if (remote!.order_id !== payment.providerOrderId || remote!.amount !== payment.amountPaisa) {
      await this.db.payment.update({where: {id: payment.id}, data: {status: PaymentStatus.DISPUTED}});
      await this.tell([request.client.userId, request.provider.userId], {serviceRequestId: request.id, requestId: request.id},
        'Payment needs review', 'The received payment did not match the approved quote. Support will review it.', 'PAYMENT_DISPUTED');
      throw new ConflictException('Payment amount mismatch. Support will review it.');
    }
    if (remote!.status !== 'captured') throw new ConflictException('Payment is not captured yet');
    // Atomic claim: concurrent double-submits converge on one winner.
    const claimed = await this.db.payment.updateMany({where: {id: payment.id, status: PaymentStatus.ORDER_CREATED,
        providerOrderId: dto.razorpayOrderId, providerPaymentId: null},
      data: {providerPaymentId: dto.razorpayPaymentId, status: PaymentStatus.PAID, paidAt: new Date()}});
    if (!claimed.count) {
      const current = await this.db.payment.findUnique({where: {id: payment.id}});
      if (current?.providerPaymentId === dto.razorpayPaymentId && current.status !== PaymentStatus.ORDER_CREATED)
        return this.viewOf(current);
      throw new ConflictException('This payment was already processed');
    }
    await this.tell([request.client.userId, request.provider.userId], {serviceRequestId: request.id, requestId: request.id},
      'Payment received', 'The approved quote is paid. The professional share releases on completion.', 'PAYMENT_PAID');
    const serviceReceipt = this.bookingReceipt({title: request.description || 'Home service', ref: request.id,
      amountPaisa: payment.amountPaisa, proName: request.provider.fullName, online: true,
      paymentRef: dto.razorpayPaymentId, held: true});
    await this.receipt(request.client.userId, serviceReceipt.subject, serviceReceipt.lines);
    return this.viewOf(await this.hold(payment.id));
  }

  private async verifyEngineer(userId: string, dto: VerifyPaymentDto) {
    const request = await this.engineerPartyRequest(dto.engineerRequestId!);
    if (request.client.userId !== userId) throw new NotFoundException('Booking not found');
    const payment = await this.db.payment.findUnique({where: {engineerRequestId: dto.engineerRequestId}});
    if (!payment) throw new NotFoundException('No payment for this booking');
    if (payment.providerPaymentId === dto.razorpayPaymentId && payment.status !== PaymentStatus.ORDER_CREATED)
      return this.viewOf(payment);
    if (payment.status !== PaymentStatus.ORDER_CREATED || payment.providerOrderId !== dto.razorpayOrderId)
      throw new ConflictException('This payment cannot be confirmed in its current state');
    // Unlike service bookings, a COMPLETED consultation stays payable: the
    // fee is usually settled once the visit or advice is delivered.
    if (ENGINEER_CLOSED_STATUSES.includes(request.status))
      throw new ConflictException('This booking is closed and can no longer be paid');
    if (!this.provider.verifyPaymentSignature(dto.razorpayOrderId, dto.razorpayPaymentId, dto.razorpaySignature))
      throw new UnauthorizedException('Invalid payment signature');
    let remote: {status: string; order_id: string; amount: number};
    try {
      remote = await this.provider.fetchPayment(dto.razorpayPaymentId);
    } catch (error) {
      this.toProviderError(error);
    }
    if (remote!.order_id !== payment.providerOrderId || remote!.amount !== payment.amountPaisa) {
      await this.db.payment.update({where: {id: payment.id}, data: {status: PaymentStatus.DISPUTED}});
      await this.tell([request.client.userId, request.engineer.profile.userId],
        {engineerRequestId: request.id, requestId: request.id},
        'Payment needs review', 'The received payment did not match the consultation fee. Support will review it.', 'PAYMENT_DISPUTED');
      throw new ConflictException('Payment amount mismatch. Support will review it.');
    }
    if (remote!.status !== 'captured') throw new ConflictException('Payment is not captured yet');
    // Atomic claim: concurrent double-submits converge on one winner.
    const claimed = await this.db.payment.updateMany({where: {id: payment.id, status: PaymentStatus.ORDER_CREATED,
        providerOrderId: dto.razorpayOrderId, providerPaymentId: null},
      data: {providerPaymentId: dto.razorpayPaymentId, status: PaymentStatus.PAID, paidAt: new Date()}});
    if (!claimed.count) {
      const current = await this.db.payment.findUnique({where: {id: payment.id}});
      if (current?.providerPaymentId === dto.razorpayPaymentId && current.status !== PaymentStatus.ORDER_CREATED)
        return this.viewOf(current);
      throw new ConflictException('This payment was already processed');
    }
    await this.tell([request.client.userId, request.engineer.profile.userId],
      {engineerRequestId: request.id, requestId: request.id},
      'Payment received', 'The consultation fee is paid. The engineer share releases after review.', 'PAYMENT_PAID');
    const engineerReceipt = this.bookingReceipt({title: request.projectTitle, ref: request.id,
      amountPaisa: payment.amountPaisa, proName: request.engineer.profile.fullName, online: true,
      paymentRef: dto.razorpayPaymentId, held: true});
    await this.receipt(request.client.userId, engineerReceipt.subject, engineerReceipt.lines);
    return this.viewOf(await this.hold(payment.id));
  }

  // Reconciliation for lost checkout callbacks: the SDK promise can hang or
  // report failure for a payment Razorpay actually captured (error banner with
  // success behind it, retry-inside-checkout, bridge restart). The app calls
  // this before opening a checkout and after any checkout error, so captured
  // money confirms instead of inviting a second charge for the same order.
  // Settles through the same atomic claim + hold path as verify; a
  // signature is unnecessary because the facts come server-to-server from
  // Razorpay itself. Idempotent: settled rows return their view untouched.
  async sync(userId: string, dto: {serviceRequestId?: string; engineerRequestId?: string}) {
    this.requireEnabled();
    this.checkExactlyOne(dto);
    if (dto.engineerRequestId) return this.syncEngineer(userId, dto.engineerRequestId);
    const request = await this.partyRequest(dto.serviceRequestId!);
    if (request.client.userId !== userId && request.provider.userId !== userId)
      throw new NotFoundException('Booking not found');
    const payment = await this.db.payment.findUnique({where: {serviceRequestId: dto.serviceRequestId}});
    if (!payment) throw new NotFoundException('No payment for this booking');
    if (payment.status !== PaymentStatus.ORDER_CREATED || !payment.providerOrderId) return this.viewOf(payment);
    if (TERMINAL_STAGES.includes(request.journey!.stage))
      throw new ConflictException('This booking is closed and can no longer be paid');
    const remote = await this.capturedForOrder(payment.providerOrderId);
    if (!remote) return this.viewOf(payment);
    if (remote.amount !== payment.amountPaisa) {
      await this.db.payment.update({where: {id: payment.id}, data: {status: PaymentStatus.DISPUTED}});
      await this.tell([request.client.userId, request.provider.userId], {serviceRequestId: request.id, requestId: request.id},
        'Payment needs review', 'The received payment did not match the approved quote. Support will review it.', 'PAYMENT_DISPUTED');
      throw new ConflictException('Payment amount mismatch. Support will review it.');
    }
    const claimed = await this.db.payment.updateMany({where: {id: payment.id, status: PaymentStatus.ORDER_CREATED,
        providerOrderId: payment.providerOrderId, providerPaymentId: null},
      data: {providerPaymentId: remote.id, status: PaymentStatus.PAID, paidAt: new Date()}});
    if (!claimed.count) {
      const current = await this.db.payment.findUnique({where: {id: payment.id}});
      if (current && current.providerPaymentId && current.status !== PaymentStatus.ORDER_CREATED)
        return this.viewOf(current);
      throw new ConflictException('This payment was already processed');
    }
    await this.tell([request.client.userId, request.provider.userId], {serviceRequestId: request.id, requestId: request.id},
      'Payment received', 'The approved quote is paid. The professional share releases on completion.', 'PAYMENT_PAID');
    const serviceReceipt = this.bookingReceipt({title: request.description || 'Home service', ref: request.id,
      amountPaisa: payment.amountPaisa, proName: request.provider.fullName, online: true,
      paymentRef: remote.id, held: true});
    await this.receipt(request.client.userId, serviceReceipt.subject, serviceReceipt.lines);
    return this.viewOf(await this.hold(payment.id));
  }

  private async syncEngineer(userId: string, engineerRequestId: string) {
    const request = await this.engineerPartyRequest(engineerRequestId);
    if (request.client.userId !== userId && request.engineer.profile.userId !== userId)
      throw new NotFoundException('Booking not found');
    const payment = await this.db.payment.findUnique({where: {engineerRequestId}});
    if (!payment) throw new NotFoundException('No payment for this booking');
    if (payment.status !== PaymentStatus.ORDER_CREATED || !payment.providerOrderId) return this.viewOf(payment);
    if (ENGINEER_CLOSED_STATUSES.includes(request.status))
      throw new ConflictException('This booking is closed and can no longer be paid');
    const remote = await this.capturedForOrder(payment.providerOrderId);
    if (!remote) return this.viewOf(payment);
    const claimed = await this.claimEngineerCapture(request, payment, remote);
    return this.viewOf(await this.hold(claimed.id));
  }

  // Claims a captured Razorpay payment for an ORDER_CREATED engineer row:
  // marks PAID, notifies both parties and receipts the client. Shared by
  // sync and by declare-before-overwrite so a capture can never be wiped
  // by an at-home declaration. Throws Conflict when the capture mismatches
  // (row flagged DISPUTED for support) — callers must stop either way.
  private async claimEngineerCapture(request: EngineerPartyRequest,
      payment: {id: string; amountPaisa: number; providerOrderId: string | null},
      remote: {id: string; amount: number}) {
    if (remote.amount !== payment.amountPaisa) {
      await this.db.payment.update({where: {id: payment.id}, data: {status: PaymentStatus.DISPUTED}});
      await this.tell([request.client.userId, request.engineer.profile.userId],
        {engineerRequestId: request.id, requestId: request.id},
        'Payment needs review', 'The received payment did not match the consultation fee. Support will review it.', 'PAYMENT_DISPUTED');
      throw new ConflictException('Payment amount mismatch. Support will review it.');
    }
    const claimed = await this.db.payment.updateMany({where: {id: payment.id, status: PaymentStatus.ORDER_CREATED,
        providerOrderId: payment.providerOrderId, providerPaymentId: null},
      data: {providerPaymentId: remote.id, status: PaymentStatus.PAID, paidAt: new Date()}});
    if (!claimed.count) {
      const current = await this.db.payment.findUnique({where: {id: payment.id}});
      if (current && current.providerPaymentId && current.status !== PaymentStatus.ORDER_CREATED)
        return current;
      throw new ConflictException('This payment was already processed');
    }
    await this.tell([request.client.userId, request.engineer.profile.userId],
      {engineerRequestId: request.id, requestId: request.id},
      'Payment received', 'The consultation fee is paid. The engineer share releases after review.', 'PAYMENT_PAID');
    const engineerReceipt = this.bookingReceipt({title: request.projectTitle, ref: request.id,
      amountPaisa: payment.amountPaisa, proName: request.engineer.profile.fullName, online: true,
      paymentRef: remote.id, held: true});
    await this.receipt(request.client.userId, engineerReceipt.subject, engineerReceipt.lines);
    return this.db.payment.findUniqueOrThrow({where: {id: payment.id}});
  }

  private async capturedForOrder(providerOrderId: string) {
    let items: {id: string; status: string; amount: number}[];
    try {
      items = await this.provider.fetchOrderPayments(providerOrderId);
    } catch (error) {
      this.toProviderError(error);
    }
    return items!.find(item => item.status === 'captured') ?? null;
  }

  // Best-effort Route hold right after capture. The row lock means concurrent
  // verify/webhook attempts create exactly one hold. A provider failure leaves
  // PAID; the release step creates a direct transfer instead. Never throws.
  private async hold(paymentId: string) {
    try {
      return await this.db.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${paymentId} FOR UPDATE`;
        const payment = await tx.payment.findUniqueOrThrow({where: {id: paymentId}});
        if (payment.status !== PaymentStatus.PAID || !payment.providerPaymentId || payment.providerTransferId) return payment;
        const account = await tx.payoutAccount.findUnique({where: {professionalProfileId: payment.professionalProfileId}});
        if (account?.status !== PayoutAccountStatus.ACTIVE || !account.providerAccountRef) return payment;
        const transfer = await this.provider.createOnHoldTransfer(payment.providerPaymentId,
          account.providerAccountRef, payment.professionalAmountPaisa, payment.currency);
        return await tx.payment.update({where: {id: payment.id},
          data: {providerTransferId: transfer.id, status: PaymentStatus.HELD}});
      });
    } catch {
      return this.db.payment.findUniqueOrThrow({where: {id: paymentId}});
    }
  }

  async requirePaid(serviceRequestId: string) {
    if (!this.provider.enabled) return;
    const payment = await this.db.payment.findUnique({where: {serviceRequestId}});
    if (!payment || !['PAID', 'HELD', 'RELEASE_PENDING', 'RELEASED'].includes(payment.status))
      throw new BadRequestException('Complete payment for the approved quote before work starts');
  }

  async releaseForRequest(serviceRequestId: string, actorUserId: string): Promise<{released: boolean; reason?: string} & Record<string, unknown>> {
    const payment = await this.db.payment.findUnique({where: {serviceRequestId}});
    if (!payment) return {released: false, reason: 'NO_PAYMENT'};
    return this.releasePayment(payment, actorUserId, {serviceRequestId, requestId: serviceRequestId});
  }

  async releaseForEngineerRequest(engineerRequestId: string, actorUserId: string): Promise<{released: boolean; reason?: string} & Record<string, unknown>> {
    const payment = await this.db.payment.findUnique({where: {engineerRequestId}});
    if (!payment) return {released: false, reason: 'NO_PAYMENT'};
    return this.releasePayment(payment, actorUserId, {engineerRequestId, requestId: engineerRequestId});
  }

  private async releasePayment(payment: {id: string; status: PaymentStatus; professionalProfileId: string;
    providerPaymentId: string | null; providerTransferId: string | null; professionalAmountPaisa: number; currency: string},
    actorUserId: string, ref: BookingRef & {requestId: string}): Promise<{released: boolean; reason?: string} & Record<string, unknown>> {
    if (payment.status === PaymentStatus.RELEASED) return {released: true, duplicate: true};
    if (!['PAID', 'HELD', 'RELEASE_PENDING'].includes(payment.status)) return {released: false, reason: payment.status};
    const account = await this.db.payoutAccount.findUnique({where: {professionalProfileId: payment.professionalProfileId}});
    if (account?.status !== PayoutAccountStatus.ACTIVE || !account.providerAccountRef) {
      await this.db.payment.update({where: {id: payment.id}, data: {status: PaymentStatus.RELEASE_PENDING, releaseRequestedAt: new Date()}});
      return {released: false, reason: 'NO_PAYOUT_ACCOUNT'};
    }
    // Claim the single-transfer right: concurrent releases converge, the loser
    // sees RELEASED or IN_PROGRESS on re-read instead of paying twice.
    if (!payment.providerTransferId) {
      if (!payment.providerPaymentId) return {released: false, reason: 'NO_CAPTURED_PAYMENT'};
      const claimed = await this.db.payment.updateMany({where: {id: payment.id, providerTransferId: null,
          status: {in: [PaymentStatus.PAID, PaymentStatus.RELEASE_PENDING]}},
        data: {status: PaymentStatus.RELEASE_PENDING, releaseRequestedAt: new Date()}});
      if (!claimed.count) {
        const current = await this.db.payment.findUnique({where: {id: payment.id}});
        if (current?.status === PaymentStatus.RELEASED) return {released: true, duplicate: true};
        return {released: false, reason: 'IN_PROGRESS'};
      }
      try {
        const transfer = await this.provider.createDirectTransfer(payment.providerPaymentId,
          account.providerAccountRef, payment.professionalAmountPaisa, payment.currency);
        await this.db.payment.update({where: {id: payment.id}, data: {providerTransferId: transfer.id}});
      } catch {
        return {released: false, reason: 'PROVIDER_UNAVAILABLE'};
      }
    } else {
      try {
        await this.provider.releaseTransfer(payment.providerTransferId);
      } catch {
        await this.db.payment.update({where: {id: payment.id}, data: {status: PaymentStatus.RELEASE_PENDING, releaseRequestedAt: new Date()}});
        return {released: false, reason: 'PROVIDER_UNAVAILABLE'};
      }
    }
    const released = await this.db.payment.update({where: {id: payment.id},
      data: {status: PaymentStatus.RELEASED, releasedAt: new Date()}});
    const parties = await this.partyOfPayment({serviceRequestId: ref.serviceRequestId ?? null, engineerRequestId: ref.engineerRequestId ?? null});
    await this.tell([parties.clientUserId, parties.providerUserId].filter((id): id is string => !!id), ref,
      'Payment released', ref.engineerRequestId
        ? 'The engineer share of the consultation fee was released.'
        : 'The professional share was released after completion.', 'PAYMENT_RELEASED');
    await this.db.auditLog.create({data: {userId: actorUserId, entity: 'Payment', entityId: payment.id,
      action: 'PAYMENT_RELEASE', metadata: {serviceRequestId: ref.serviceRequestId, engineerRequestId: ref.engineerRequestId}}});
    return {released: true, ...this.viewOf(released)};
  }

  async requestRefund(userId: string, dto: RefundPaymentDto, admin: boolean) {
    this.requireEnabled();
    this.checkExactlyOne(dto);
    const clientUserId = dto.engineerRequestId
      ? (await this.engineerPartyRequest(dto.engineerRequestId)).client.userId
      : (await this.partyRequest(dto.serviceRequestId!)).client.userId;
    if (!admin && clientUserId !== userId) throw new NotFoundException('Booking not found');
    const payment = await this.db.payment.findUnique({where: dto.engineerRequestId
      ? {engineerRequestId: dto.engineerRequestId}
      : {serviceRequestId: dto.serviceRequestId}});
    if (!payment?.providerPaymentId) throw new NotFoundException('No captured payment to refund');
    if (payment.status === PaymentStatus.REFUNDED) return this.viewOf(payment);
    // A repeat call while REFUND_PENDING is a retry, not a no-op: reconcile
    // with Razorpay (adopt processed refunds, recreate missing ones) so a
    // stuck "refund on the way" can actually finish.
    if (payment.status === PaymentStatus.REFUND_PENDING) {
      await this.reconcileRefund(payment).catch(() => undefined);
      return this.viewOf(await this.db.payment.findUniqueOrThrow({where: {id: payment.id}}));
    }
    if (!['PAID', 'HELD', 'RELEASE_PENDING'].includes(payment.status))
      throw new ConflictException(payment.status === PaymentStatus.RELEASED
        ? 'Released payments need support review before a refund' : 'This payment cannot be refunded in its current state');
    const claimed = await this.db.payment.updateMany({where: {id: payment.id,
        status: {in: [PaymentStatus.PAID, PaymentStatus.HELD, PaymentStatus.RELEASE_PENDING]}},
      data: {status: PaymentStatus.REFUND_PENDING}});
    if (!claimed.count)
      return this.viewOf(await this.db.payment.findUniqueOrThrow({where: {id: payment.id}}));
    await this.db.auditLog.create({data: {userId, entity: 'Payment', entityId: payment.id,
      action: 'PAYMENT_REFUND_REQUESTED', metadata: {reason: dto.reason}}});
    try {
      await this.provider.createRefund(payment.providerPaymentId, payment.amountPaisa);
    } catch {
      // Stays REFUND_PENDING for the retry sweeper; the booking flow continues.
    }
    const updated = await this.db.payment.findUniqueOrThrow({where: {id: payment.id}});
    return this.viewOf(updated);
  }

  // Single-payment refund truth check against Razorpay. Processed remote
  // refunds are adopted locally; a missing/failed remote refund is recreated.
  // Never double-creates: any live remote refund (pending or processed) wins.
  private async reconcileRefund(payment: {id: string; providerPaymentId: string | null;
    amountPaisa: number; status: string}) {
    if (!payment.providerPaymentId) return;
    const remote = await this.provider.fetchRefunds(payment.providerPaymentId);
    const live = remote.filter(item => item.status === 'processed' || item.status === 'pending');
    if (live.some(item => item.status === 'processed')) {
      await this.db.payment.update({where: {id: payment.id},
        data: {status: PaymentStatus.REFUNDED, refundedAt: new Date()}});
      await this.refundReceipt(payment.id);
      return;
    }
    if (live.length) return; // Razorpay is still working; its webhook finishes us.
    await this.provider.createRefund(payment.providerPaymentId, payment.amountPaisa);
    await this.db.auditLog.create({data: {userId: 'system', entity: 'Payment', entityId: payment.id,
      action: 'PAYMENT_REFUND_RETRIED', metadata: {}}}).catch(() => undefined);
  }

  // Cron sweeper for refunds stuck in REFUND_PENDING: the create call failed,
  // Razorpay failed the refund, or the completion webhook never arrived. Only
  // touches rows older than the grace window so fresh refunds settle first.
  async retryPendingRefunds(graceMinutes = 10) {
    this.requireEnabled();
    const cutoff = new Date(Date.now() - graceMinutes * 60000);
    const stuck = await this.db.payment.findMany({where: {status: PaymentStatus.REFUND_PENDING,
      updatedAt: {lt: cutoff}, providerPaymentId: {not: null}},
      select: {id: true, providerPaymentId: true, amountPaisa: true, status: true}});
    let retried = 0;
    for (const row of stuck) {
      try {
        await this.reconcileRefund(row as {id: string; providerPaymentId: string | null;
          amountPaisa: number; status: string});
        retried += 1;
      } catch {
        // Next sweep tries again; one poisoned row never blocks the rest.
      }
    }
    return {checked: stuck.length, retried};
  }

  async resolveDispute(adminUserId: string, dto: ResolveDisputeDto) {
    this.requireEnabled();
    this.checkExactlyOne(dto);
    const payment = await this.db.payment.findUnique({where: dto.engineerRequestId
      ? {engineerRequestId: dto.engineerRequestId}
      : {serviceRequestId: dto.serviceRequestId}});
    if (!payment) throw new NotFoundException('No payment for this booking');
    if (payment.status !== PaymentStatus.DISPUTED) throw new ConflictException('Only disputed payments can be resolved');
    await this.db.auditLog.create({data: {userId: adminUserId, entity: 'Payment', entityId: payment.id,
      action: 'PAYMENT_DISPUTE_RESOLVED', metadata: {decision: dto.decision, note: dto.note}}});
    const restored = payment.collectionMode === CollectionMode.AT_HOME && !payment.providerTransferId
      ? PaymentStatus.COLLECTED_UNSETTLED
      : payment.providerTransferId ? PaymentStatus.HELD : PaymentStatus.PAID;
    await this.db.payment.update({where: {id: payment.id}, data: {status: restored}});
    if (dto.engineerRequestId) {
      if (dto.decision === 'release') return this.releaseForEngineerRequest(dto.engineerRequestId, adminUserId);
      return this.requestRefund(adminUserId, {engineerRequestId: dto.engineerRequestId, reason: dto.note}, true);
    }
    if (dto.decision === 'release') return this.releaseForRequest(dto.serviceRequestId!, adminUserId);
    return this.requestRefund(adminUserId, {serviceRequestId: dto.serviceRequestId, reason: dto.note}, true);
  }

  // Journey hooks. These never throw: booking progress must not fail because
  // a money side-effect hiccuped; every outcome lands in an explicit state.
  async markDisputed(serviceRequestId: string, actorUserId: string) {
    const payment = await this.db.payment.findUnique({where: {serviceRequestId}}).catch(() => null);
    if (!payment) return;
    if (payment.status === PaymentStatus.ORDER_CREATED || payment.status === PaymentStatus.NOT_STARTED) {
      await this.db.payment.update({where: {id: payment.id}, data: {status: PaymentStatus.FAILED}}).catch(() => undefined);
      return;
    }
    if (['PAID', 'HELD', 'RELEASE_PENDING', 'COLLECTED_UNSETTLED'].includes(payment.status)) {
      await this.db.payment.update({where: {id: payment.id}, data: {status: PaymentStatus.DISPUTED}}).catch(() => undefined);
      await this.db.auditLog.create({data: {userId: actorUserId, entity: 'Payment', entityId: payment.id,
        action: 'PAYMENT_DISPUTED', metadata: {serviceRequestId}}}).catch(() => undefined);
    }
  }

  // The client confirmed from DISPUTED: the issue was resolved, so the
  // frozen payment goes back to HELD for the normal release path. Only
  // DISPUTED rows move; anything else is already where it belongs.
  async resolveDisputeForRequest(serviceRequestId: string, actorUserId: string) {
    const payment = await this.db.payment.findUnique({where: {serviceRequestId}}).catch(() => null);
    if (!payment || payment.status !== PaymentStatus.DISPUTED) return;
    await this.db.payment.update({where: {id: payment.id}, data: {status: PaymentStatus.HELD}}).catch(() => undefined);
    await this.db.auditLog.create({data: {userId: actorUserId, entity: 'Payment', entityId: payment.id,
      action: 'PAYMENT_DISPUTE_RESOLVED', metadata: {serviceRequestId}}}).catch(() => undefined);
  }

  async cancelUnpaidOrRefund(serviceRequestId: string, actorUserId: string) {
    const payment = await this.db.payment.findUnique({where: {serviceRequestId}}).catch(() => null);
    if (!payment) return;
    if (payment.status === PaymentStatus.ORDER_CREATED || payment.status === PaymentStatus.NOT_STARTED) {
      await this.db.payment.update({where: {id: payment.id}, data: {status: PaymentStatus.FAILED}}).catch(() => undefined);
      return;
    }
    if (['PAID', 'HELD', 'RELEASE_PENDING'].includes(payment.status)) {
      await this.requestRefund(actorUserId, {serviceRequestId, reason: 'Booking cancelled before completion'}, true)
        .catch(() => undefined);
    }
  }

  // Engineer-request twin of cancelUnpaidOrRefund, called from request
  // cancellation. Never throws: cancelling must not fail on a money
  // side-effect; every outcome lands in an explicit payment state.
  async cancelUnpaidOrRefundEngineer(engineerRequestId: string, actorUserId: string) {
    const payment = await this.db.payment.findUnique({where: {engineerRequestId}}).catch(() => null);
    if (!payment) return;
    if (payment.status === PaymentStatus.ORDER_CREATED || payment.status === PaymentStatus.NOT_STARTED) {
      await this.db.payment.update({where: {id: payment.id}, data: {status: PaymentStatus.FAILED}}).catch(() => undefined);
      return;
    }
    if (['PAID', 'HELD', 'RELEASE_PENDING'].includes(payment.status)) {
      await this.requestRefund(actorUserId, {engineerRequestId, reason: 'Consultation cancelled before completion'}, true)
        .catch(() => undefined);
    }
  }

  async registerPayoutAccount(adminUserId: string, dto: RegisterPayoutAccountDto) {
    const profile = await this.db.professionalProfile.findUnique({where: {id: dto.professionalProfileId}});
    if (!profile) throw new NotFoundException('Professional not found');
    const account = await this.db.payoutAccount.upsert({where: {professionalProfileId: dto.professionalProfileId},
      create: {professionalProfileId: dto.professionalProfileId, provider: 'RAZORPAY_ROUTE',
        providerAccountRef: dto.providerAccountRef, accountHolderName: dto.accountHolderName,
        bankName: dto.bankName, accountLast4: dto.accountLast4, status: PayoutAccountStatus.ACTIVE},
      update: {providerAccountRef: dto.providerAccountRef, accountHolderName: dto.accountHolderName,
        bankName: dto.bankName, accountLast4: dto.accountLast4, status: PayoutAccountStatus.ACTIVE, rejectionReason: null}});
    await this.db.auditLog.create({data: {userId: adminUserId, entity: 'PayoutAccount', entityId: account.id,
      action: 'PAYOUT_ACCOUNT_LINKED', metadata: {professionalProfileId: dto.professionalProfileId}}});
    return {id: account.id, status: account.status};
  }

  // ---- Pro payout-account self-service ----
  // Professionals submit where their share should land (bank account + IFSC
  // for NEFT/IMPS, UPI id for instant payouts). The full account number is
  // write-only through this API: owners only ever read back the masked form,
  // and every admin link is audit-logged. Actual money movement still needs
  // the Razorpay Route onboarding (linked account + KYC) — these details are
  // what that onboarding verifies against.
  private payoutAccountViewOf(account: {status: string; accountHolderName: string; bankName: string | null;
    accountLast4: string | null; ifsc: string | null; upiId: string | null; rejectionReason: string | null;
    updatedAt: Date} | null) {
    if (!account) return {status: 'NOT_SUBMITTED', accountHolderName: null, bankName: null,
      accountLast4: null, maskedAccountNumber: null, ifsc: null, upiId: null,
      rejectionReason: null, updatedAt: null};
    return {status: account.status, accountHolderName: account.accountHolderName, bankName: account.bankName,
      accountLast4: account.accountLast4,
      maskedAccountNumber: account.accountLast4 ? `\u2022\u2022\u2022\u2022${account.accountLast4}` : null,
      ifsc: account.ifsc, upiId: account.upiId, rejectionReason: account.rejectionReason, updatedAt: account.updatedAt};
  }

  async myPayoutAccount(userId: string) {
    const profile = await this.ownProfile(userId);
    const account = await this.db.payoutAccount.findUnique({where: {professionalProfileId: profile.id}});
    return this.payoutAccountViewOf(account);
  }

  async submitPayoutAccount(userId: string, dto: {accountHolderName: string; accountNumber: string; ifsc: string;
    bankName?: string; upiId?: string}) {
    const profile = await this.ownProfile(userId);
    const ifsc = dto.ifsc.toUpperCase();
    const accountLast4 = dto.accountNumber.slice(-4);
    const existing = await this.db.payoutAccount.findUnique({where: {professionalProfileId: profile.id}});
    // An admin-linked Route account stays ACTIVE: bank edits supplement it
    // and go through verification without pausing payouts.
    const status = existing?.providerAccountRef && existing.status === PayoutAccountStatus.ACTIVE
      ? PayoutAccountStatus.ACTIVE : PayoutAccountStatus.PENDING;
    // F-001: the full account number is validated (DTO) and reduced to its
    // last4 here, then never persisted — no reader needs it (views show the
    // mask, transfers use providerAccountRef, admin linking supplies its own
    // reference). Keeping it in the DTO preserves the app contract.
    const account = await this.db.payoutAccount.upsert({where: {professionalProfileId: profile.id},
      create: {professionalProfileId: profile.id, provider: 'RAZORPAY_ROUTE',
        accountHolderName: dto.accountHolderName.trim(),
        ifsc, bankName: dto.bankName?.trim() || null, upiId: dto.upiId?.trim() || null,
        accountLast4, status: PayoutAccountStatus.PENDING},
      update: {accountHolderName: dto.accountHolderName.trim(),
        ifsc, bankName: dto.bankName?.trim() || null, upiId: dto.upiId?.trim() || null,
        accountLast4, status, rejectionReason: null}});
    await this.db.auditLog.create({data: {userId, entity: 'PayoutAccount', entityId: account.id,
      action: 'PAYOUT_ACCOUNT_SUBMITTED', metadata: {professionalProfileId: profile.id}}});
    return this.payoutAccountViewOf(account);
  }

  // ---- At-home collection ----
  // The provider collected cash/UPI at the door, so the money is already in
  // their pocket. This records the platform commission as a due instead of
  // moving money. Idempotent on serviceRequestId; safe to call from FINISH
  // and retried from CONFIRM.
  async ensureAtHomeCollection(serviceRequestId: string) {
    const request = await this.partyRequest(serviceRequestId);
    const journey = request.journey!;
    if (journey.collectionMode !== CollectionMode.AT_HOME) return null;
    if (!journey.collectedAmountPaisa || journey.collectedAmountPaisa < 100 || !journey.collectedMethod)
      throw new ConflictException('Collection not recorded yet. The provider must submit it first.');
    const existing = await this.db.payment.findUnique({where: {serviceRequestId}});
    if (existing) return this.viewOf(existing);
    const member = (await this.memberships?.isEffectiveByProfile(request.provider.id).catch(() => false)) ?? false;
    const {platformFeePaisa, professionalAmountPaisa} = await this.feeSplitFor(request.provider.id, journey.collectedAmountPaisa, member);
    try {
      const created = await this.db.payment.create({data: {professionalProfileId: request.provider.id, serviceRequestId,
        amountPaisa: journey.collectedAmountPaisa, platformFeePaisa, professionalAmountPaisa,
        collectionMode: CollectionMode.AT_HOME, status: PaymentStatus.COLLECTED_UNSETTLED,
        idempotencyKey: `collect-${serviceRequestId}`}});
      await this.tell([request.client.userId, request.provider.userId], {serviceRequestId: request.id, requestId: request.id},
        'Payment collected at home',
        `₹${(journey.collectedAmountPaisa / 100).toLocaleString('en-IN')} collected by ${journey.collectedMethod}. The platform commission of ₹${(platformFeePaisa / 100).toLocaleString('en-IN')} is recorded as provider dues.`,
        'PAYMENT_COLLECTED_AT_HOME');
      const atHomeReceipt = this.bookingReceipt({title: request.description || 'Home service', ref: request.id,
        amountPaisa: journey.collectedAmountPaisa, proName: request.provider.fullName, online: false,
        method: journey.collectedMethod, held: false});
      await this.receipt(request.client.userId, atHomeReceipt.subject, atHomeReceipt.lines);
      return this.viewOf(created);
    } catch {
      const current = await this.db.payment.findUnique({where: {serviceRequestId}});
      if (current) return this.viewOf(current);
      throw new ServiceUnavailableException('Collection could not be recorded. Try again.');
    }
  }

  private async ownProfile(userId: string) {
    const profile = await this.db.professionalProfile.findUnique({where: {userId}});
    if (!profile) throw new NotFoundException('Professional profile not found');
    return profile;
  }

  async dues(userId: string) {
    const profile = await this.ownProfile(userId);
    const rows = await this.db.payment.findMany({where: {professionalProfileId: profile.id, status: PaymentStatus.COLLECTED_UNSETTLED},
      orderBy: {createdAt: 'asc'},
      select: {id: true, serviceRequestId: true, engineerRequestId: true, amountPaisa: true, platformFeePaisa: true, createdAt: true}});
    const penalties = await this.db.professionalPenalty.findMany({where: {professionalProfileId: profile.id, status: PenaltyStatus.PENDING},
      orderBy: {createdAt: 'asc'},
      select: {id: true, serviceRequestId: true, amountPaisa: true, reason: true, createdAt: true}});
    const duesPaisa = rows.reduce((sum, row) => sum + row.platformFeePaisa, 0)
      + penalties.reduce((sum, row) => sum + row.amountPaisa, 0);
    // Membership proof: what these same jobs would have cost at the standard
    // 10% rate, minus what is actually owed. Members see real savings;
    // non-members see exactly what membership would have saved them.
    // Penalties are never commission, so they stay out of the savings math.
    const atStandardRate = rows.reduce((sum, row) => sum + Math.floor((row.amountPaisa * PLATFORM_FEE_BPS) / 10000), 0);
    const member = (await this.memberships?.isEffectiveByProfile(profile.id).catch(() => false)) ?? false;
    const blockThresholdPaisa = await duesLimitPaisa(this.db, profile.id);
    const terms = {memberFeeBps: MEMBER_FEE_BPS, standardFeeBps: PLATFORM_FEE_BPS,
      memberDuesBlockPaisa: MEMBER_DUES_BLOCK_Paisa, standardDuesBlockPaisa: DUES_BLOCK_Paisa,
      freeJobsPerMonth: MEMBER_FREE_JOBS_PER_MONTH};
    return {duesPaisa, blocked: duesPaisa >= blockThresholdPaisa, blockThresholdPaisa, jobs: rows, penalties,
      isMember: member, memberSavingsPaisa: Math.max(0, atStandardRate - rows.reduce((sum, row) => sum + row.platformFeePaisa, 0)), terms};
  }

  async createSettlementOrder(userId: string) {
    this.requireEnabled();
    const profile = await this.ownProfile(userId);
    const rows = await this.db.payment.findMany({where: {professionalProfileId: profile.id, status: PaymentStatus.COLLECTED_UNSETTLED},
      select: {id: true, platformFeePaisa: true}});
    const penalties = await this.db.professionalPenalty.findMany({where: {professionalProfileId: profile.id, status: PenaltyStatus.PENDING},
      select: {id: true, amountPaisa: true}});
    const totalPaisa = rows.reduce((sum, row) => sum + row.platformFeePaisa, 0)
      + penalties.reduce((sum, row) => sum + row.amountPaisa, 0);
    if ((!rows.length && !penalties.length) || totalPaisa < 100) throw new BadRequestException('No commission dues to settle');
    const paymentIds = rows.map(row => row.id).sort();
    const open = await this.db.commissionSettlement.findFirst({where: {professionalProfileId: profile.id, status: SettlementStatus.ORDER_CREATED},
      orderBy: {createdAt: 'desc'}});
    if (open && open.providerOrderId && open.amountPaisa === totalPaisa &&
        [...open.paymentIds].sort().join(',') === paymentIds.join(','))
      return {settlementId: open.id, keyId: this.provider.keyId, orderId: open.providerOrderId, amountPaisa: totalPaisa, currency: open.currency};
    if (open) await this.db.commissionSettlement.update({where: {id: open.id}, data: {status: SettlementStatus.FAILED}});
    // F-010: paymentIds stays the immutable snapshot; the junction rows are the
    // queryable membership (nested create keeps both in one atomic write).
    const settlement = await this.db.commissionSettlement.create({data: {professionalProfileId: profile.id, paymentIds,
      amountPaisa: totalPaisa, idempotencyKey: `stl-${profile.id}-${Date.now()}`,
      settledPayments: {create: paymentIds.map(paymentId => ({paymentId}))}}});
    let order: {id: string};
    try {
      order = await this.provider.createOrder({amountPaisa: totalPaisa, currency: 'INR', receipt: `stl-${settlement.id}`,
        notes: {settlementId: settlement.id, professionalProfileId: profile.id}});
    } catch (error) {
      await this.db.commissionSettlement.update({where: {id: settlement.id}, data: {status: SettlementStatus.FAILED}});
      this.toProviderError(error);
    }
    const updated = await this.db.commissionSettlement.update({where: {id: settlement.id}, data: {providerOrderId: order!.id}});
    return {settlementId: settlement.id, keyId: this.provider.keyId, orderId: updated.providerOrderId, amountPaisa: totalPaisa, currency: 'INR'};
  }

  async verifySettlement(userId: string, dto: VerifySettlementDto) {
    this.requireEnabled();
    const profile = await this.ownProfile(userId);
    const settlement = await this.db.commissionSettlement.findUnique({where: {id: dto.settlementId}});
    if (!settlement || settlement.professionalProfileId !== profile.id) throw new NotFoundException('Settlement not found');
    if (settlement.providerPaymentId === dto.razorpayPaymentId && settlement.status === SettlementStatus.SETTLED)
      return {settled: true, duplicate: true};
    if (settlement.status !== SettlementStatus.ORDER_CREATED || settlement.providerOrderId !== dto.razorpayOrderId)
      throw new ConflictException('This settlement cannot be confirmed in its current state');
    if (!this.provider.verifyPaymentSignature(dto.razorpayOrderId, dto.razorpayPaymentId, dto.razorpaySignature))
      throw new UnauthorizedException('Invalid payment signature');
    let remote: {status: string; order_id: string; amount: number};
    try {
      remote = await this.provider.fetchPayment(dto.razorpayPaymentId);
    } catch (error) {
      this.toProviderError(error);
    }
    if (remote!.order_id !== settlement.providerOrderId || remote!.amount !== settlement.amountPaisa)
      throw new ConflictException('Settlement amount mismatch. Support will review it.');
    if (remote!.status !== 'captured') throw new ConflictException('Payment is not captured yet');
    return this.applySettlementCapture(settlement.id, dto.razorpayPaymentId);
  }

  // Atomic claim so app-verify and webhook converge on one winner.
  private async applySettlementCapture(settlementId: string, razorpayPaymentId: string) {
    const claimed = await this.db.commissionSettlement.updateMany({where: {id: settlementId, status: SettlementStatus.ORDER_CREATED, providerPaymentId: null},
      data: {providerPaymentId: razorpayPaymentId, status: SettlementStatus.SETTLED, settledAt: new Date()}});
    if (!claimed.count) {
      const current = await this.db.commissionSettlement.findUnique({where: {id: settlementId}});
      if (current?.status === SettlementStatus.SETTLED) return {settled: true, duplicate: true};
      throw new ConflictException('This settlement was already processed');
    }
    const settlement = await this.db.commissionSettlement.findUniqueOrThrow({where: {id: settlementId}});
    // Junction first, snapshot fallback for rows settled before the backfill.
    const links = await this.db.settlementPayment.findMany({where: {settlementId}, select: {paymentId: true}});
    const memberIds = links.length ? links.map(link => link.paymentId) : settlement.paymentIds;
    await this.db.payment.updateMany({where: {id: {in: memberIds}, status: PaymentStatus.COLLECTED_UNSETTLED},
      data: {status: PaymentStatus.SETTLED, settledAt: new Date()}});
    // Penalties settle with the same order: the total already included every
    // pending one, so anything still pending belonged to this settlement. A
    // penalty posted between order and verify fails the amount match first.
    const cleared = await this.db.professionalPenalty.updateMany({where: {professionalProfileId: settlement.professionalProfileId, status: PenaltyStatus.PENDING},
      data: {status: PenaltyStatus.SETTLED, settledAt: new Date()}});
    const profile = await this.db.professionalProfile.findUniqueOrThrow({where: {id: settlement.professionalProfileId}});
    await this.db.notification.create({data: {userId: profile.userId, kind: NotificationKind.payment, title: 'Commission dues cleared',
      body: `₹${(settlement.amountPaisa / 100).toLocaleString('en-IN')} settled for ${memberIds.length} job(s)${cleared.count ? ` and ${cleared.count} penalt${cleared.count === 1 ? 'y' : 'ies'}` : ''}. New jobs are unlocked.`,
      data: {settlementId: settlement.id}}});
    await this.db.auditLog.create({data: {userId: profile.userId, entity: 'CommissionSettlement', entityId: settlement.id,
      action: 'DUES_SETTLED', metadata: {amountPaisa: settlement.amountPaisa, jobs: memberIds.length, penalties: cleared.count}}});
    this.realtime.emitUserUpdate(profile.userId, 'notifications');
    const settledAmount = `₹${(settlement.amountPaisa / 100).toLocaleString('en-IN')}`;
    await this.receipt(profile.userId, `Commission dues settled · ${settledAmount}`,
      [`Settled: ${settledAmount} for ${memberIds.length} job(s).`,
        `Date: ${new Date().toLocaleString('en-IN', {timeZone: 'Asia/Kolkata'})}`,
        'New jobs are unlocked. Thank you for settling promptly.']);
    return {settled: true, settledJobs: memberIds.length, settledPenalties: cleared.count, amountPaisa: settlement.amountPaisa};
  }

  async duesSummary() {
    const rows = await this.db.payment.groupBy({by: ['professionalProfileId'], where: {status: PaymentStatus.COLLECTED_UNSETTLED},
      _count: {_all: true}, _sum: {platformFeePaisa: true, amountPaisa: true}});
    const penaltyRows: {professionalProfileId: string; _count: {_all: number}; _sum: {amountPaisa: number | null}}[] =
      await this.db.professionalPenalty?.groupBy({by: ['professionalProfileId'], where: {status: PenaltyStatus.PENDING},
        _count: {_all: true}, _sum: {amountPaisa: true}}).catch(() => []) ?? [];
    const byId = new Map(rows.map(row => [row.professionalProfileId, row]));
    for (const pen of penaltyRows) {
      if (!byId.has(pen.professionalProfileId)) {
        byId.set(pen.professionalProfileId, {professionalProfileId: pen.professionalProfileId,
          _count: {_all: 0}, _sum: {platformFeePaisa: 0, amountPaisa: 0}});
      }
    }
    const ids = [...byId.keys()];
    const profiles = await this.db.professionalProfile.findMany({where: {id: {in: ids}},
      select: {id: true, fullName: true, baseCity: true}});
    const names = new Map(profiles.map(profile => [profile.id, profile]));
    const memberships: {professionalProfileId: string; status: string; currentPeriodEnd: Date | null}[] =
      await this.db.membership?.findMany({where: {professionalProfileId: {in: ids}},
        select: {professionalProfileId: true, status: true, currentPeriodEnd: true}}).catch(() => []) ?? [];
    const limitOf = (id: string) => {
      const m = memberships.find(entry => entry.professionalProfileId === id);
      const effective = Boolean(m?.currentPeriodEnd && m.currentPeriodEnd.getTime() > Date.now()
        && ['ACTIVE', 'PAST_DUE', 'CANCELLED'].includes(m.status));
      return effective ? MEMBER_DUES_BLOCK_Paisa : DUES_BLOCK_Paisa;
    };
    const penaltyOf = (id: string) => penaltyRows.find(pen => pen.professionalProfileId === id);
    return [...byId.values()].map(row => {
      const pen = penaltyOf(row.professionalProfileId);
      const duesPaisa = (row._sum.platformFeePaisa ?? 0) + (pen?._sum.amountPaisa ?? 0);
      return {professionalProfileId: row.professionalProfileId,
        fullName: names.get(row.professionalProfileId)?.fullName ?? 'Unknown',
        baseCity: names.get(row.professionalProfileId)?.baseCity ?? '',
        jobs: row._count._all, duesPaisa, penaltyPaisa: pen?._sum.amountPaisa ?? 0, penalties: pen?._count._all ?? 0,
        collectedPaisa: row._sum.amountPaisa ?? 0, blocked: duesPaisa >= limitOf(row.professionalProfileId)};
    });
  }

  async view(userId: string, serviceRequestId: string, admin: boolean) {
    const request = await this.partyRequest(serviceRequestId);
    if (!admin && request.client.userId !== userId && request.provider.userId !== userId)
      throw new NotFoundException('Booking not found');
    const payment = await this.db.payment.findUnique({where: {serviceRequestId}});
    if (!payment) throw new NotFoundException('No payment for this booking');
    return this.viewOf(payment);
  }

  async viewEngineer(userId: string, engineerRequestId: string, admin: boolean) {
    const request = await this.engineerPartyRequest(engineerRequestId);
    if (!admin && request.client.userId !== userId && request.engineer.profile.userId !== userId)
      throw new NotFoundException('Booking not found');
    const payment = await this.db.payment.findUnique({where: {engineerRequestId}});
    if (!payment) throw new NotFoundException('No payment for this booking');
    // The engineer declares at-home cash/UPI against this reference: without
    // it the declare form cannot show what the visit should cost.
    const fee = request.engineer.consultationFeePaisa;
    return {...this.viewOf(payment),
      ...(fee === null || fee === undefined ? {} : {expectedAmountPaisa: fee})};
  }

  async summary() {
    const rows = await this.db.payment.groupBy({by: ['status'],
      _count: {_all: true}, _sum: {amountPaisa: true, platformFeePaisa: true, professionalAmountPaisa: true}});
    return rows.map(row => ({status: row.status, count: row._count._all, amountPaisa: row._sum.amountPaisa ?? 0,
      platformFeePaisa: row._sum.platformFeePaisa ?? 0, professionalAmountPaisa: row._sum.professionalAmountPaisa ?? 0}));
  }

  async listForAdmin(query: {status?: string; page?: string; limit?: string}) {
    const {page, limit, skip} = pagination(query.page, query.limit);
    const status = query.status?.trim();
    if (status && !Object.values(PaymentStatus).includes(status as PaymentStatus))
      throw new BadRequestException('Invalid payment status');
    const where = status ? {status: status as PaymentStatus} : {};
    const [rows, total] = await this.db.$transaction([
      this.db.payment.findMany({where, orderBy: {updatedAt: 'desc'}, skip, take: limit, include: {
        professional: {select: {fullName: true}},
        serviceRequest: {select: {id: true, status: true, client: {select: {fullName: true, userId: true}}}},
        engineerRequest: {select: {id: true, status: true, client: {select: {fullName: true, userId: true}}}},
      }}),
      this.db.payment.count({where}),
    ]);
    // Plus priority: disputes and reviews from subscribed Home clients sort
    // first for support. One lookup per page; failures degrade to no flag.
    const clientIds = [...new Set(rows.map(row =>
      row.serviceRequest?.client?.userId ?? row.engineerRequest?.client?.userId).filter((id): id is string => Boolean(id)))];
    const subs: {userId: string; status: string; currentPeriodEnd: Date | null}[] = clientIds.length && this.db.aiSubscription
      ? await this.db.aiSubscription.findMany({where: {userId: {in: clientIds}},
          select: {userId: true, status: true, currentPeriodEnd: true}}).catch(() => []) : [];
    const plusIds = new Set(subs.filter(sub => sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() > Date.now()
      && ['ACTIVE', 'PAST_DUE', 'CANCELLED'].includes(sub.status)).map(sub => sub.userId));
    return {data: rows.map(row => ({id: row.id, serviceRequestId: row.serviceRequestId,
        engineerRequestId: row.engineerRequestId, status: row.status, amountPaisa: row.amountPaisa,
        platformFeePaisa: row.platformFeePaisa, professionalAmountPaisa: row.professionalAmountPaisa,
        currency: row.currency, providerOrderId: row.providerOrderId, providerPaymentId: row.providerPaymentId,
        providerTransferId: row.providerTransferId, paidAt: row.paidAt, releasedAt: row.releasedAt,
        refundedAt: row.refundedAt, createdAt: row.createdAt, updatedAt: row.updatedAt,
        professionalName: row.professional.fullName,
        clientName: row.serviceRequest?.client?.fullName ?? row.engineerRequest?.client?.fullName ?? null,
        clientPlus: plusIds.has(row.serviceRequest?.client?.userId ?? row.engineerRequest?.client?.userId ?? ''),
        bookingStatus: row.serviceRequest?.status ?? row.engineerRequest?.status ?? null})),
      meta: {page, limit, total, totalPages: Math.ceil(total / limit)}};
  }

  // Commission-settlement webhooks. No event table: the atomic status claim
  // in applySettlementCapture is the dedupe, so replays converge safely.
  private async handleSettlementWebhook(event: {id?: string; event?: string}, paymentEntity: {id?: string} | undefined) {
    if (event.event !== 'payment.captured' || !paymentEntity?.id) return {ok: true, ignored: true};
    const settlement = await this.db.commissionSettlement.findFirst({where: {providerPaymentId: paymentEntity.id}})
      .catch(() => null);
    if (settlement?.status === SettlementStatus.SETTLED) return {ok: true, duplicate: true};
    let remote: {status: string; order_id: string; amount: number};
    try {
      remote = await this.provider.fetchPayment(paymentEntity.id);
    } catch {
      return {ok: true}; // Razorpay retries; the row stays payable.
    }
    if (remote.status !== 'captured') return {ok: true};
    const target = await this.db.commissionSettlement.findUnique({where: {providerOrderId: remote.order_id}}).catch(() => null);
    if (!target || target.status !== SettlementStatus.ORDER_CREATED || remote.amount !== target.amountPaisa) return {ok: true, ignored: true};
    try {
      return await this.applySettlementCapture(target.id, paymentEntity.id);
    } catch {
      return {ok: true, duplicate: true};
    }
  }

  async handleWebhook(rawBody: Buffer | string, signature: string) {
    if (!process.env.RAZORPAY_WEBHOOK_SECRET) throw new ServiceUnavailableException('Payment webhooks are not configured');
    if (!this.provider.verifyWebhookSignature(rawBody, signature)) throw new UnauthorizedException('Invalid webhook signature');
    let event: {id?: string; event?: string; payload?: any};
    try {
      event = JSON.parse(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException('Invalid webhook payload');
    }
    if (!event?.id || !event?.event) throw new BadRequestException('Invalid webhook payload');
    const paymentEntity = event.payload?.payment?.entity;
    const orderEntity = event.payload?.order?.entity;
    const refundEntity = event.payload?.refund?.entity;
    const orderId = paymentEntity?.order_id ?? orderEntity?.id;
    const razorpayPaymentId = paymentEntity?.id ?? refundEntity?.payment_id;
    let payment = orderId ? await this.db.payment.findUnique({where: {providerOrderId: orderId}}) : null;
    if (!payment && razorpayPaymentId)
      payment = await this.db.payment.findUnique({where: {providerPaymentId: razorpayPaymentId}});
    if (!payment && orderEntity?.receipt)
      payment = await this.db.payment.findUnique({where: {id: orderEntity.receipt}}).catch(() => null);
    if (!payment && typeof orderEntity?.receipt === 'string' && orderEntity.receipt.startsWith('stl-'))
      return this.handleSettlementWebhook(event, paymentEntity);
    if (!payment) return {ok: true, ignored: true};
    if (await this.db.paymentEvent.findUnique({where: {providerEventId: event.id}})) return {ok: true, duplicate: true};
    await this.db.paymentEvent.create({data: {paymentId: payment.id, providerEventId: event.id,
      eventType: event.event!, payload: event.payload ?? {}}});
    const currentOrder = payment.providerOrderId === orderId || (!orderId && payment.providerPaymentId === razorpayPaymentId);
    switch (event.event) {
      case 'payment.captured': {
        if (!['NOT_STARTED', 'ORDER_CREATED', 'FAILED'].includes(payment.status)) break;
        let remote: {status: string; order_id: string; amount: number};
        try {
          remote = await this.provider.fetchPayment(paymentEntity.id);
        } catch {
          break; // Razorpay retries the webhook; the row stays payable.
        }
        if (remote.status !== 'captured') break;
        // Parties behind this payment, whichever booking kind it belongs to.
        // A COMPLETED consultation is still payable (the fee settles after
        // the visit), while a COMPLETED service journey is closed to payment.
        const parties = await this.partyOfPayment(payment);
        const ref: BookingRef & {requestId: string} = parties.kind === 'engineer'
          ? {engineerRequestId: parties.requestId, requestId: parties.requestId}
          : {serviceRequestId: parties.requestId, requestId: parties.requestId};
        const both = [parties.clientUserId, parties.providerUserId].filter((id): id is string => !!id);
        if (!currentOrder || remote.order_id !== payment.providerOrderId || remote.amount !== payment.amountPaisa) {
          // Paid on a superseded order: adopt exact-amount captures (same receipt
          // family), dispute anything else so support reconciles it by hand.
          if (currentOrder || remote.amount !== payment.amountPaisa) {
            await this.db.payment.update({where: {id: payment.id}, data: {status: PaymentStatus.DISPUTED}});
            await this.tell(both, ref,
              'Payment needs review', 'A payment arrived that did not match the booking. Support will review it.', 'PAYMENT_DISPUTED');
            break;
          }
        }
        const claimed = await this.db.payment.updateMany({where: {id: payment.id, providerPaymentId: null,
            status: {in: [PaymentStatus.NOT_STARTED, PaymentStatus.ORDER_CREATED, PaymentStatus.FAILED]}},
          data: {providerOrderId: remote.order_id, providerPaymentId: paymentEntity.id,
            status: PaymentStatus.PAID, paidAt: new Date()}});
        if (!claimed.count) break; // Winner already applied it; the event row above is the audit trail.
        if (parties.closed) {
          let refunded = false;
          try {
            const outcome = await this.requestRefund(parties.clientUserId ?? 'unknown',
              {...(parties.kind === 'engineer'
                ? {engineerRequestId: parties.requestId}
                : {serviceRequestId: parties.requestId}),
              reason: 'Payment arrived for a closed booking'}, true);
            refunded = outcome.status === PaymentStatus.REFUND_PENDING || outcome.status === PaymentStatus.REFUNDED;
          } catch {
            refunded = false;
          }
          if (!refunded)
            await this.db.payment.update({where: {id: payment.id}, data: {status: PaymentStatus.DISPUTED}});
          await this.tell(parties.clientUserId ? [parties.clientUserId] : [], ref,
            refunded ? 'Refund started' : 'Payment needs review',
            refunded ? 'The payment arrived after the booking closed, so a refund was started automatically.'
              : 'A payment arrived for a closed booking. Support will review it.',
            refunded ? 'PAYMENT_REFUND_STARTED' : 'PAYMENT_DISPUTED');
          break;
        }
        await this.hold(payment.id);
        await this.tell(both, ref,
          'Payment received', parties.kind === 'engineer'
            ? 'The consultation fee is paid. The engineer share releases after review.'
            : 'The approved quote is paid. The professional share releases on completion.', 'PAYMENT_PAID');
        break;
      }
      case 'payment.failed': {
        if (!currentOrder || payment.status !== PaymentStatus.ORDER_CREATED) break;
        await this.db.payment.update({where: {id: payment.id}, data: {status: PaymentStatus.FAILED}});
        break;
      }
      case 'refund.processed': {
        if (payment.status !== PaymentStatus.REFUND_PENDING) break;
        await this.db.payment.update({where: {id: payment.id}, data: {status: PaymentStatus.REFUNDED, refundedAt: new Date()}});
        await this.refundReceipt(payment.id);
        const parties = await this.partyOfPayment(payment);
        await this.tell(parties.clientUserId ? [parties.clientUserId] : [],
          parties.kind === 'engineer'
            ? {engineerRequestId: parties.requestId, requestId: parties.requestId}
            : {serviceRequestId: parties.requestId, requestId: parties.requestId},
          'Refund completed', parties.kind === 'engineer'
            ? 'The consultation fee was refunded in full.'
            : 'The booking payment was refunded in full.', 'PAYMENT_REFUNDED');
        break;
      }
      case 'refund.failed': {
        // Stays REFUND_PENDING: reverting to PAID would strand the money with
        // no retry path. The retry sweeper picks it up after the grace window,
        // which is what the "will be retried" message below promises.
        if (payment.status !== PaymentStatus.REFUND_PENDING) break;
        const parties = await this.partyOfPayment(payment);
        await this.tell(parties.clientUserId ? [parties.clientUserId] : [],
          parties.kind === 'engineer'
            ? {engineerRequestId: parties.requestId, requestId: parties.requestId}
            : {serviceRequestId: parties.requestId, requestId: parties.requestId},
          'Refund needs another attempt', 'The refund did not go through. It will be retried.', 'PAYMENT_REFUND_FAILED');
        break;
      }
      default:
        break; // Recorded above; no state change for other event types.
    }
    return {ok: true};
  }
}
