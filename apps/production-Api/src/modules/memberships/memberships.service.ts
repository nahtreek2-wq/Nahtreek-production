import {BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException} from '@nestjs/common';
import {MembershipStatus, NotificationKind, PaymentStatus} from '@prisma/client';
import {PrismaService} from '../../common/prisma/prisma.service';
import {pagination} from '../platform/platform.service';
import {PushService} from '../notifications/push.service';
import {ChatGateway} from '../chat/chat.gateway';
import {RazorpayError, RazorpayProvider, RazorpaySubscription} from '../payments/razorpay.provider';
import {CancelMembershipDto} from './memberships.dto';
import {DUES_BLOCK_Paisa, MEMBER_DUES_BLOCK_Paisa, MEMBER_FEE_BPS, MEMBER_FREE_JOBS_PER_MONTH, PENALTY_LATE_ACCEPT_Paisa, PENALTY_LATE_ARRIVAL_Paisa, PLATFORM_FEE_BPS, PLUS_ACCEPT_WINDOW_MS, PLUS_ARRIVAL_GRACE_MS, PLUS_DISCOUNT_BPS, PLUS_DISCOUNT_CAP_Paisa} from '../payments/commission';

// Pro membership: a Razorpay recurring subscription that buys a lower
// commission (7% vs 10%), discovery priority and the member badge. Access is
// effective while the paid period runs, including a cancelled-but-paid tail.
// Webhooks plus explicit confirm/reconcile keep the row truthful; every
// transition is idempotent and stale-subscription events are ignored.
export const MEMBERSHIP_FEE_PAISE = 39900;
export const AI_SUBSCRIPTION_FEE_PAISE = 12900;
export const AI_FREE_MESSAGES = 5;
// Standard commission in basis points, mirrored from the payments module:
// every job billed below this rate is membership savings the app can prove.
const STANDARD_FEE_BPS = 1000;
const AI_SUBSCRIPTION_CYCLES = 120;
const SUBSCRIPTION_CYCLES = 120;

const REMOTE_STATUS: Record<string, MembershipStatus> = {
  created: MembershipStatus.PENDING, authenticated: MembershipStatus.PENDING, pending: MembershipStatus.PENDING,
  active: MembershipStatus.ACTIVE, halted: MembershipStatus.PAST_DUE, paused: MembershipStatus.PAUSED,
  cancelled: MembershipStatus.CANCELLED, completed: MembershipStatus.EXPIRED, expired: MembershipStatus.EXPIRED,
};

// Razorpay charges the first subscription cycle asynchronously: right after
// the customer pays in GPay/UPI the subscription still reads created/pending
// for a few seconds. Confirm retries across that window instead of failing
// a payment that is already on its way.
const SETTLED_POLL_ATTEMPTS = 3;
const SETTLED_POLL_GAP_MS = 3000;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

type Row = {id: string; professionalProfileId: string; providerSubscriptionId: string | null; status: MembershipStatus;
  currentPeriodStart: Date | null; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean; lastChargeAt: Date | null};

@Injectable()
export class MembershipsService {
  constructor(private readonly db: PrismaService, private readonly provider: RazorpayProvider,
    private readonly push: PushService, private readonly realtime: ChatGateway) {}

  get enabled() {
    return this.provider.enabled && Boolean(process.env.RAZORPAY_MEMBERSHIP_PLAN_ID);
  }

  private planId() {
    const id = process.env.RAZORPAY_MEMBERSHIP_PLAN_ID;
    if (!this.provider.enabled || !id) throw new ServiceUnavailableException(process.env.APP_ENV === 'preview'
      ? 'Demo mode: membership billing activates once Razorpay test keys and the plan ID are added'
      : 'Membership billing is not configured');
    return id;
  }

  isEffective(m: {status: MembershipStatus; currentPeriodEnd: Date | null}, now = Date.now()) {
    const billable: MembershipStatus[] = [MembershipStatus.ACTIVE, MembershipStatus.PAST_DUE, MembershipStatus.CANCELLED];
    return Boolean(m.currentPeriodEnd && m.currentPeriodEnd.getTime() > now && billable.includes(m.status));
  }

  // A cancelled plan keeps its paid tail (cancel_at_cycle_end): the user
  // stays effective until currentPeriodEnd with no renewal coming. That tail
  // is the resubscribe window — a fresh mandate scheduled to start at the
  // tail end continues the plan with no double-billed overlap.
  private tailEnd(m: {status: MembershipStatus; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean}, now = Date.now()) {
    if (!this.isEffective(m)) return null;
    if (!m.cancelAtPeriodEnd && m.status !== MembershipStatus.CANCELLED) return null;
    if (!m.currentPeriodEnd || m.currentPeriodEnd.getTime() <= now + 60_000) return null;
    return m.currentPeriodEnd;
  }

  private isResubscribeTail(m: {currentPeriodEnd: Date | null}, remote: {current_start?: number}, now = Date.now()) {
    return Boolean(m.currentPeriodEnd && m.currentPeriodEnd.getTime() > now
      && typeof remote.current_start === 'number'
      && remote.current_start * 1000 >= m.currentPeriodEnd.getTime() - 60_000);
  }

  async isEffectiveByProfile(professionalProfileId: string) {
    const m = await this.db.membership.findUnique({where: {professionalProfileId}});
    return m ? this.isEffective(m) : false;
  }

  private toProviderError(error: unknown): never {
    if (error instanceof RazorpayError && !error.retryable && error.status < 500)
      throw new BadRequestException(error.message);
    throw new ServiceUnavailableException('Billing provider unavailable. Try again.');
  }

  // Published plan terms, straight from the enforcement constants: the apps
  // render price, rates and dues room from here and never hardcode figures.
  private terms() {
    return {memberFeeBps: MEMBER_FEE_BPS, standardFeeBps: PLATFORM_FEE_BPS,
      memberDuesBlockPaisa: MEMBER_DUES_BLOCK_Paisa, standardDuesBlockPaisa: DUES_BLOCK_Paisa,
      freeJobsPerMonth: MEMBER_FREE_JOBS_PER_MONTH};
  }

  private viewOf(m: Row) {
    return {status: m.status, effective: this.isEffective(m), currentPeriodStart: m.currentPeriodStart,
      currentPeriodEnd: m.currentPeriodEnd, cancelAtPeriodEnd: m.cancelAtPeriodEnd,
      feePaisa: MEMBERSHIP_FEE_PAISE, currency: 'INR', terms: this.terms()};
  }

  private async profileOf(userId: string) {
    const profile = await this.db.professionalProfile.findUnique({where: {userId}});
    if (!profile) throw new NotFoundException('Professional account required');
    return profile;
  }

  private async tell(userId: string, title: string, body: string, action: string, membershipId: string) {
    await this.db.notification.create({data: {userId, kind: NotificationKind.membership, title, body, data: {membershipId}}});
    await this.db.auditLog.create({data: {userId, entity: 'Membership', entityId: membershipId, action, metadata: {title}}});
    await this.push.dispatch().catch(() => undefined);
    this.realtime.emitUserUpdate(userId, 'notifications');
  }

  private async syncPriority(professionalProfileId: string) {
    const m = await this.db.membership.findUnique({where: {professionalProfileId}});
    await this.db.professionalProfile.update({where: {id: professionalProfileId},
      data: {memberPriority: m ? this.isEffective(m) : false}});
  }

  // Re-reads the provider's subscription before minting a new one: an
  // already-active mandate replays as-is, a live checkout resumes on its
  // short URL, and only dead (cancelled/completed/expired) mandates fall
  // through to a fresh subscription. A failed re-read also falls through so
  // the create path below reports the outage with its proper error.
  private async resumeCheckout(m: Row): Promise<(ReturnType<MembershipsService['viewOf']> & {keyId: string; subscriptionId: string | null; shortUrl: string | null}) | null> {
    if (!m.providerSubscriptionId) return null;
    const remote = await this.provider.fetchSubscription(m.providerSubscriptionId).catch(() => null);
    if (!remote || remote.id !== m.providerSubscriptionId) return null;
    if (remote.status === 'active') {
      // A cancelled tail still reads active at Razorpay until the cycle
      // ends — fall through so subscribe mints the replacement mandate
      // instead of stranding the user with no checkout link.
      if (this.tailEnd(m)) return null;
      const updated = await this.applyRemote(m, remote);
      return {...this.viewOf(updated), keyId: this.provider.keyId, subscriptionId: m.providerSubscriptionId, shortUrl: null};
    }
    if (['created', 'authenticated', 'pending'].includes(remote.status)
      && await this.remotePlanMatches(remote, MEMBERSHIP_FEE_PAISE)) {
      // A resubscribe swaps in a pending mandate while the paid tail still
      // runs — keep the row (and its benefits) untouched until the new
      // mandate actually confirms; only cold rows take the remote status.
      const updated = this.isEffective(m) ? m : await this.applyRemote(m, remote);
      return {...this.viewOf(updated), keyId: this.provider.keyId, subscriptionId: m.providerSubscriptionId, shortUrl: remote.short_url ?? null};
    }
    return null;
  }

  // Resumed checkouts must bill the CURRENT plan: a stale mandate minted
  // under a retired test plan would otherwise open Razorpay for the wrong
  // amount (live incident: ₹5 checkout on a ₹399 plan). Unreadable plans
  // fail closed to a fresh guarded checkout below.
  private async remotePlanMatches(remote: {plan_id?: string}, feePaisa: number): Promise<boolean> {
    if (!remote.plan_id) return false;
    const plan = await this.provider.fetchPlan(remote.plan_id).catch(() => null);
    return !!plan && plan.amount === feePaisa && plan.currency === 'INR' && plan.period === 'monthly';
  }

  async subscribe(userId: string) {
    const planId = this.planId();
    const profile = await this.profileOf(userId);
    let m = await this.db.membership.findUnique({where: {professionalProfileId: profile.id}});
    if (!m) m = await this.db.membership.create({data: {professionalProfileId: profile.id}});
    const resumed = await this.resumeCheckout(m);
    if (resumed) return resumed;
    // Active rows keep their mandate; voluntarily-cancelled rows keep
    // their paid tail but may resubscribe (fresh mandate scheduled at the
    // tail end). Dead past-due/paused rows fall through and get replaced by
    // a fresh checkout. The halted predecessor never charges again, so
    // superseding is safe.
    if (this.isEffective(m) && (m.status === MembershipStatus.ACTIVE || m.status === MembershipStatus.CANCELLED) && !this.tailEnd(m))
      return {...this.viewOf(m), keyId: this.provider.keyId, subscriptionId: m.providerSubscriptionId, shortUrl: null as string | null};
    const tail = this.tailEnd(m);
    try {
      const plan = await this.provider.fetchPlan(planId);
      if (plan.amount !== MEMBERSHIP_FEE_PAISE || plan.currency !== 'INR' || plan.period !== 'monthly')
        throw new ServiceUnavailableException('Membership billing is misconfigured');
      const sub = await this.provider.createSubscription({planId, totalCount: SUBSCRIPTION_CYCLES,
        notes: {membershipId: m.id, professionalProfileId: profile.id},
        ...(tail ? {startAt: Math.floor(tail.getTime() / 1000)} : {})});
      // Optimistic claim: a racing subscribe wins one row update; the loser
      // re-reads and returns the winner's live checkout link. Orphaned
      // Razorpay subscriptions never charge without customer authorization.
      // A resubscribe keeps the paid tail (status + period) — only the mandate
      // id swaps, so benefits never blink while the new checkout pends.
      const claimed = await this.db.membership.updateMany({where: {id: m.id, providerSubscriptionId: m.providerSubscriptionId},
        data: tail ? {providerSubscriptionId: sub.id, cancelAtPeriodEnd: false}
          : {providerSubscriptionId: sub.id, status: MembershipStatus.PENDING, cancelAtPeriodEnd: false}});
      if (!claimed.count) {
        const current = await this.db.membership.findUniqueOrThrow({where: {id: m.id}});
        if (current.providerSubscriptionId && current.providerSubscriptionId !== sub.id) {
          const winner = await this.provider.fetchSubscription(current.providerSubscriptionId);
          return {...this.viewOf(current), keyId: this.provider.keyId, subscriptionId: current.providerSubscriptionId, shortUrl: winner.short_url ?? null};
        }
      }
      const updated = await this.db.membership.findUniqueOrThrow({where: {id: m.id}});
      return {...this.viewOf(updated), keyId: this.provider.keyId, subscriptionId: sub.id, shortUrl: sub.short_url ?? null};
    } catch (error) {
      if (error instanceof ServiceUnavailableException || error instanceof BadRequestException) throw error;
      this.toProviderError(error);
    }
  }

  private async fetchSubscriptionSettled(subscriptionId: string): Promise<RazorpaySubscription> {
    let remote: RazorpaySubscription;
    try {
      remote = await this.provider.fetchSubscription(subscriptionId);
    } catch (error) {
      this.toProviderError(error);
    }
    for (let attempt = 1; attempt < SETTLED_POLL_ATTEMPTS && ['created', 'pending'].includes(remote!.status); attempt += 1) {
      await sleep(SETTLED_POLL_GAP_MS);
      try {
        remote = await this.provider.fetchSubscription(subscriptionId);
      } catch (error) {
        this.toProviderError(error);
      }
    }
    return remote!;
  }

  async confirm(userId: string) {
    this.planId();
    const profile = await this.profileOf(userId);
    const m = await this.db.membership.findUnique({where: {professionalProfileId: profile.id}});
    if (!m?.providerSubscriptionId) throw new ConflictException('No membership checkout to confirm');
    const remote = await this.fetchSubscriptionSettled(m.providerSubscriptionId);
    if (remote.status === 'active') return this.viewOf(await this.applyRemote(m, remote));
    // A live tail with no pending mandate has nothing to confirm; a pending
    // mandate (fresh checkout or resubscribe) must poll, never early-return.
    if (this.isEffective(m) && !['created', 'authenticated', 'pending'].includes(remote.status))
      return this.viewOf(m);
    if (['created', 'pending'].includes(remote.status))
      throw new ConflictException('Payment is still confirming at Razorpay. Wait a minute, then refresh the membership screen.');
    if (remote.status === 'authenticated' && this.isResubscribeTail(m, remote)) {
      // Resubscribe authorized: the new mandate starts where the paid tail
      // ends. Flip to it (ACTIVE + new period) instead of the PENDING a fresh
      // checkout would show — benefits continue without a gap.
      const updated: Row = await this.db.membership.update({where: {id: m.id}, data: {status: MembershipStatus.ACTIVE,
        cancelAtPeriodEnd: false,
        currentPeriodStart: typeof remote.current_start === 'number' ? new Date(remote.current_start * 1000) : m.currentPeriodStart,
        currentPeriodEnd: typeof remote.current_end === 'number' ? new Date(remote.current_end * 1000) : m.currentPeriodEnd,
        lastChargeAt: new Date()}});
      await this.syncPriority(m.professionalProfileId);
      await this.db.auditLog.create({data: {userId, entity: 'Membership', entityId: m.id,
        action: 'MEMBERSHIP_RESUBSCRIBED', metadata: {providerSubscriptionId: m.providerSubscriptionId}}});
      await this.tell(profile.userId, 'Membership continues',
        'Your new billing cycle is set — benefits continue without interruption.', 'MEMBERSHIP_RESUBSCRIBED', m.id);
      return this.viewOf(updated);
    }
    return this.viewOf(await this.applyRemote(m, remote));
  }

  async cancel(userId: string, dto: CancelMembershipDto) {
    this.planId();
    const profile = await this.profileOf(userId);
    const m = await this.db.membership.findUnique({where: {professionalProfileId: profile.id}});
    if (!m?.providerSubscriptionId) throw new NotFoundException('No membership to cancel');
    if (m.status === MembershipStatus.CANCELLED || m.status === MembershipStatus.EXPIRED) return this.viewOf(m);
    if (m.status === MembershipStatus.PENDING) {
      // A never-authorized checkout has no billing cycle, so Razorpay itself
      // refuses to cancel it — drop the dead checkout best-effort and always
      // free the row, otherwise the user is stuck on "Complete authorization"
      // with no working cancel.
      await this.provider.cancelSubscription(m.providerSubscriptionId).catch(() => undefined);
      const updated = await this.db.membership.update({where: {id: m.id},
        data: {providerSubscriptionId: null, status: MembershipStatus.NONE, cancelAtPeriodEnd: false}});
      await this.db.auditLog.create({data: {userId, entity: 'Membership', entityId: m.id,
        action: 'MEMBERSHIP_CHECKOUT_CANCELLED', metadata: {reason: dto.reason ?? null}}});
      return this.viewOf(updated);
    }
    try {
      await this.provider.cancelSubscription(m.providerSubscriptionId);
    } catch (error) {
      // A mandate already ended at Razorpay (dashboard cancel, retried tap)
      // fails the cancel call — sync the local row to the provider truth
      // instead of failing the user.
      const remote = await this.provider.fetchSubscription(m.providerSubscriptionId).catch(() => null);
      if (remote && ['cancelled', 'completed', 'expired'].includes(remote.status)) {
        const synced = await this.applyRemote(m, remote);
        await this.db.auditLog.create({data: {userId, entity: 'Membership', entityId: m.id,
          action: 'MEMBERSHIP_CANCELLED', metadata: {reason: dto.reason ?? null, synced: true}}});
        await this.syncPriority(profile.id);
        await this.tell(profile.userId, 'Membership ended',
          this.isEffective(synced) ? 'Your benefits continue until the paid period ends.' : 'Your membership was cancelled.',
          'MEMBERSHIP_ENDED', m.id);
        return this.viewOf(synced);
      }
      this.toProviderError(error);
    }
    const updated: Row = await this.db.membership.update({where: {id: m.id},
      data: {status: MembershipStatus.CANCELLED, cancelAtPeriodEnd: true}});
    await this.db.auditLog.create({data: {userId, entity: 'Membership', entityId: m.id,
      action: 'MEMBERSHIP_CANCELLED', metadata: {reason: dto.reason ?? null}}});
    await this.syncPriority(profile.id);
    await this.tell(profile.userId, 'Membership cancelled',
      updated.status === MembershipStatus.CANCELLED && this.isEffective(updated)
        ? 'Your benefits continue until the paid period ends.' : 'Your membership was cancelled.',
      'MEMBERSHIP_CANCELLED', m.id);
    return this.viewOf(updated);
  }

  async me(userId: string) {
    const profile = await this.profileOf(userId);
    const m = await this.db.membership.findUnique({where: {professionalProfileId: profile.id}});
    const savings = await this.lifetimeSavings(profile.id);
    if (!m) return {status: MembershipStatus.NONE, effective: false, currentPeriodStart: null,
      currentPeriodEnd: null, cancelAtPeriodEnd: false, feePaisa: MEMBERSHIP_FEE_PAISE, currency: 'INR', terms: this.terms(), ...savings};
    return {...this.viewOf(m), ...savings};
  }

  // Proof that membership pays: every charged job billed below the 10%
  // standard rate counts its difference as savings. Refunded, failed and
  // never-charged rows never saved anything, so they stay out.
  private async lifetimeSavings(professionalProfileId: string) {
    const rows = await this.db.payment.findMany({where: {professionalProfileId,
        status: {notIn: [PaymentStatus.NOT_STARTED, PaymentStatus.ORDER_CREATED, PaymentStatus.FAILED, PaymentStatus.REFUNDED]}},
      select: {amountPaisa: true, platformFeePaisa: true}});
    let lifetimeSavingsPaisa = 0;
    let jobsAtMemberRate = 0;
    for (const row of rows) {
      const saved = Math.floor((row.amountPaisa * STANDARD_FEE_BPS) / 10000) - row.platformFeePaisa;
      if (saved > 0) {
        lifetimeSavingsPaisa += saved;
        jobsAtMemberRate += 1;
      }
    }
    return {lifetimeSavingsPaisa, jobsAtMemberRate};
  }

  private async handleAiWebhookEvent(ai: {id: string; userId: string; providerSubscriptionId: string | null; status: MembershipStatus; currentPeriodStart: Date | null; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean; lastChargeAt: Date | null},
      event: {id?: string; event?: string; payload?: any}, entity: any) {
    if (await this.db.aiSubscriptionEvent.findUnique({where: {providerEventId: event.id!}})) return {ok: true, duplicate: true};
    await this.db.aiSubscriptionEvent.create({data: {aiSubscriptionId: ai.id, providerEventId: event.id!,
      eventType: event.event!, payload: event.payload ?? {}}});
    if (ai.providerSubscriptionId && entity?.id !== ai.providerSubscriptionId) return {ok: true, stale: true};
    const tellAi = (title: string, body: string, action: string) =>
      this.tellAi(ai.userId, title, body, action, ai.id);
    switch (event.event) {
      case 'subscription.activated':
      case 'subscription.charged': {
        let remote: RazorpaySubscription;
        try {
          remote = await this.provider.fetchSubscription(entity.id);
        } catch {
          break; // Razorpay retries; the row stays as-is.
        }
        const updated = await this.aiApplyRemote(ai, remote, event.event === 'subscription.charged');
        if (updated.status === MembershipStatus.ACTIVE)
          await tellAi('NAHTREEK AI unlocked', `Your ₹${AI_SUBSCRIPTION_FEE_PAISE / 100} Plus subscription is active. Chat, plan and upload without limits — plus priority service and engineer discounts.`, 'AI_SUBSCRIPTION_ACTIVATED');
        break;
      }
      case 'subscription.authenticated':
        await this.aiApplyRemote(ai, entity);
        break;
      case 'subscription.halted': {
        await this.aiApplyRemote(ai, entity);
        await tellAi('AI payment failed', 'Your access continues until the paid period ends. Update autopay to stay subscribed.', 'AI_SUBSCRIPTION_PAST_DUE');
        break;
      }
      case 'subscription.paused':
        await this.aiApplyRemote(ai, entity);
        break;
      case 'subscription.resumed': {
        let remote: RazorpaySubscription;
        try {
          remote = await this.provider.fetchSubscription(entity.id);
        } catch {
          break;
        }
        await this.aiApplyRemote(ai, remote);
        break;
      }
      case 'subscription.cancelled': {
        await this.aiApplyRemote(ai, entity);
        await tellAi('AI subscription ended', 'Your access continues until the paid period ends.', 'AI_SUBSCRIPTION_ENDED');
        break;
      }
      case 'subscription.completed':
      case 'subscription.expired': {
        await this.aiApplyRemote(ai, entity);
        await tellAi('AI subscription expired', 'Resubscribe anytime to keep unlimited NAHTREEK AI.', 'AI_SUBSCRIPTION_EXPIRED');
        break;
      }
      default:
        break;
    }
    return {ok: true};
  }

  private async aiApplyRemote(ai: {id: string; providerSubscriptionId: string | null; status: MembershipStatus; currentPeriodStart: Date | null; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean; lastChargeAt: Date | null}, remote: RazorpaySubscription, charged = false) {
    if (ai.providerSubscriptionId && remote.id !== ai.providerSubscriptionId) return ai;
    const status = REMOTE_STATUS[remote.status];
    if (!status) return ai;
    const start = typeof remote.current_start === 'number' ? new Date(remote.current_start * 1000) : undefined;
    const end = typeof remote.current_end === 'number' ? new Date(remote.current_end * 1000) : undefined;
    return this.db.aiSubscription.update({where: {id: ai.id}, data: {status,
      ...(start ? {currentPeriodStart: start} : {}), ...(end ? {currentPeriodEnd: end} : {}),
      ...(charged ? {lastChargeAt: new Date()} : {}),
      ...(status === MembershipStatus.CANCELLED ? {cancelAtPeriodEnd: true} : {})}});
  }

  private async tellAi(userId: string, title: string, body: string, action: string, aiSubscriptionId: string) {
    await this.db.notification.create({data: {userId, kind: NotificationKind.membership, title, body, data: {aiSubscriptionId}}});
    await this.db.auditLog.create({data: {userId, entity: 'AiSubscription', entityId: aiSubscriptionId, action, metadata: {title}}});
    await this.push.dispatch().catch(() => undefined);
    this.realtime.emitUserUpdate(userId, 'notifications');
  }

  private async applyRemote(m: Row, remote: RazorpaySubscription, charged = false) {
    if (m.providerSubscriptionId && remote.id !== m.providerSubscriptionId) return m; // stale subscription
    const status = REMOTE_STATUS[remote.status];
    if (!status) return m;
    const start = typeof remote.current_start === 'number' ? new Date(remote.current_start * 1000) : undefined;
    const end = typeof remote.current_end === 'number' ? new Date(remote.current_end * 1000) : undefined;
    const updated = await this.db.membership.update({where: {id: m.id}, data: {status,
      ...(start ? {currentPeriodStart: start} : {}), ...(end ? {currentPeriodEnd: end} : {}),
      ...(charged ? {lastChargeAt: new Date()} : {}),
      ...(status === MembershipStatus.CANCELLED ? {cancelAtPeriodEnd: true} : {})}});
    await this.syncPriority(m.professionalProfileId);
    return updated as Row;
  }

  async handleWebhook(rawBody: Buffer | string, signature: string) {
    if (!process.env.RAZORPAY_WEBHOOK_SECRET) throw new ServiceUnavailableException('Billing webhooks are not configured');
    if (!this.provider.verifyWebhookSignature(rawBody, signature)) throw new UnauthorizedException('Invalid webhook signature');
    let event: {id?: string; event?: string; payload?: any};
    try {
      event = JSON.parse(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException('Invalid webhook payload');
    }
    if (!event?.id || !event?.event) throw new BadRequestException('Invalid webhook payload');
    const entity = event.payload?.subscription?.entity;
    let m = entity?.id ? await this.db.membership.findUnique({where: {providerSubscriptionId: entity.id}}) : null;
    if (!m && entity?.notes?.membershipId)
      m = await this.db.membership.findUnique({where: {id: entity.notes.membershipId}}).catch(() => null);
    if (!m) {
      let ai = entity?.id ? await this.db.aiSubscription.findUnique({where: {providerSubscriptionId: entity.id}}) : null;
      if (!ai && entity?.notes?.aiSubscriptionId)
        ai = await this.db.aiSubscription.findUnique({where: {id: entity.notes.aiSubscriptionId}}).catch(() => null);
      if (!ai) return {ok: true, ignored: true};
      return this.handleAiWebhookEvent(ai, event, entity);
    }
    if (await this.db.membershipEvent.findUnique({where: {providerEventId: event.id}})) return {ok: true, duplicate: true};
    await this.db.membershipEvent.create({data: {membershipId: m.id, providerEventId: event.id,
      eventType: event.event!, payload: event.payload ?? {}}});
    if (m.providerSubscriptionId && entity?.id !== m.providerSubscriptionId) return {ok: true, stale: true};
    const profile = await this.db.professionalProfile.findUniqueOrThrow({where: {id: m.professionalProfileId}});
    switch (event.event) {
      case 'subscription.activated':
      case 'subscription.charged': {
        let remote: RazorpaySubscription;
        try {
          remote = await this.provider.fetchSubscription(entity.id);
        } catch {
          break; // Razorpay retries; the row stays as-is.
        }
        const updated = await this.applyRemote(m, remote, event.event === 'subscription.charged');
        if (updated.status === MembershipStatus.ACTIVE)
          await this.tell(profile.userId, 'Pro membership active',
            'You now pay 7% commission and rank higher in discovery.', 'MEMBERSHIP_ACTIVATED', m.id);
        break;
      }
      case 'subscription.authenticated':
        await this.applyRemote(m, entity);
        break;
      case 'subscription.halted': {
        await this.applyRemote(m, entity);
        await this.tell(profile.userId, 'Membership payment failed',
          'Your benefits continue until the paid period ends. Update autopay to stay subscribed.', 'MEMBERSHIP_PAST_DUE', m.id);
        break;
      }
      case 'subscription.paused':
        await this.applyRemote(m, entity);
        break;
      case 'subscription.resumed': {
        let remote: RazorpaySubscription;
        try {
          remote = await this.provider.fetchSubscription(entity.id);
        } catch {
          break;
        }
        await this.applyRemote(m, remote);
        break;
      }
      case 'subscription.cancelled': {
        await this.applyRemote(m, entity);
        await this.tell(profile.userId, 'Membership ended',
          'Your benefits continue until the paid period ends.', 'MEMBERSHIP_ENDED', m.id);
        break;
      }
      case 'subscription.completed':
      case 'subscription.expired': {
        await this.applyRemote(m, entity);
        await this.tell(profile.userId, 'Membership expired', 'Resubscribe anytime to restore Pro benefits.', 'MEMBERSHIP_EXPIRED', m.id);
        break;
      }
      default:
        break;
    }
    return {ok: true};
  }

  async adminSummary() {
    const rows = await this.db.membership.groupBy({by: ['status'], _count: {_all: true}});
    const byStatus = rows.map(row => ({status: row.status, count: row._count._all}));
    const active = byStatus.find(row => row.status === MembershipStatus.ACTIVE)?.count ?? 0;
    return {byStatus, activeSubscriptions: active, monthlyRecurringPaisa: active * MEMBERSHIP_FEE_PAISE,
      feePaisa: MEMBERSHIP_FEE_PAISE, currency: 'INR'};
  }

  async listForAdmin(query: {status?: string; page?: string; limit?: string}) {
    const {page, limit, skip} = pagination(query.page, query.limit);
    const status = query.status?.trim();
    if (status && !Object.values(MembershipStatus).includes(status as MembershipStatus))
      throw new BadRequestException('Invalid membership status');
    const where = status ? {status: status as MembershipStatus} : {};
    const [rows, total] = await this.db.$transaction([
      this.db.membership.findMany({where, orderBy: {updatedAt: 'desc'}, skip, take: limit, include: {
        profile: {select: {fullName: true, user: {select: {phoneNumber: true, email: true}}}},
      }}),
      this.db.membership.count({where}),
    ]);
    return {data: rows.map(row => ({id: row.id, status: row.status, effective: this.isEffective(row),
        currentPeriodStart: row.currentPeriodStart, currentPeriodEnd: row.currentPeriodEnd,
        cancelAtPeriodEnd: row.cancelAtPeriodEnd, lastChargeAt: row.lastChargeAt,
        providerSubscriptionId: row.providerSubscriptionId, professionalName: row.profile.fullName,
        phoneNumber: row.profile.user?.phoneNumber ?? null, email: row.profile.user?.email ?? null})),
      meta: {page, limit, total, totalPages: Math.ceil(total / limit)}};
  }

  async reconcile() {
    const now = new Date();
    const expired = await this.db.membership.updateMany({where: {currentPeriodEnd: {lte: now},
        status: {in: [MembershipStatus.ACTIVE, MembershipStatus.PAST_DUE, MembershipStatus.CANCELLED]}},
      data: {status: MembershipStatus.EXPIRED}});
    const effective = {status: {in: [MembershipStatus.ACTIVE, MembershipStatus.PAST_DUE, MembershipStatus.CANCELLED]},
      currentPeriodEnd: {gt: now}};
    await this.db.professionalProfile.updateMany({where: {membership: effective}, data: {memberPriority: true}});
    const cleared = await this.db.professionalProfile.updateMany({where: {memberPriority: true, NOT: {membership: effective}},
      data: {memberPriority: false}});
    const aiExpired = await this.db.aiSubscription.updateMany({where: {currentPeriodEnd: {lte: now},
        status: {in: [MembershipStatus.ACTIVE, MembershipStatus.PAST_DUE, MembershipStatus.CANCELLED]}},
      data: {status: MembershipStatus.EXPIRED}});
    return {expired: expired.count, cleared: cleared.count, aiExpired: aiExpired.count};
  }

  // ---- Home Plus subscription (₹129/month, client-side) ----
  private aiPlanId() {
    const id = process.env.RAZORPAY_AI_PLAN_ID;
    if (!id) throw new ServiceUnavailableException('Demo mode: AI billing activates once Razorpay test keys and the AI plan ID are added');
    return id;
  }

  private aiViewOf(row: {status: MembershipStatus; currentPeriodStart: Date | null; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean; lastChargeAt: Date | null}) {
    return {status: row.status, effective: this.isEffective(row), currentPeriodStart: row.currentPeriodStart,
      currentPeriodEnd: row.currentPeriodEnd, cancelAtPeriodEnd: row.cancelAtPeriodEnd, lastChargeAt: row.lastChargeAt,
      feePaisa: AI_SUBSCRIPTION_FEE_PAISE};
  }

  async aiFreeUsed(userId: string) {
    return this.db.aiMessage.count({where: {type: 'USER_TEXT', conversation: {userId}}});
  }

  isAiEffectiveByUser(userId: string) {
    return this.db.aiSubscription.findUnique({where: {userId}}).then(row => !!row && this.isEffective(row));
  }

  async assertAiAccess(userId: string, kind: 'message' | 'plan' | 'upload') {
    if (await this.isAiEffectiveByUser(userId)) return;
    if (kind === 'message' && (await this.aiFreeUsed(userId)) < AI_FREE_MESSAGES) return;
    const fee = `₹${AI_SUBSCRIPTION_FEE_PAISE / 100}/month`;
    const message = kind === 'message'
      ? `NAHTREEK AI needs a subscription. Your ${AI_FREE_MESSAGES} free chats are used — subscribe for ${fee} to keep going.`
      : `Photo uploads and project plans need NAHTREEK Plus (${fee}) — subscribe to unlock them.`;
    throw new HttpException({statusCode: HttpStatus.PAYMENT_REQUIRED, message, code: 'AI_SUBSCRIPTION_REQUIRED'}, HttpStatus.PAYMENT_REQUIRED);
  }

  async aiMe(userId: string) {
    const row = await this.db.aiSubscription.findUnique({where: {userId}});
    const freeUsed = await this.aiFreeUsed(userId);
    if (!row) return {status: 'NONE' as MembershipStatus, effective: false, currentPeriodStart: null, currentPeriodEnd: null,
      cancelAtPeriodEnd: false, lastChargeAt: null, feePaisa: AI_SUBSCRIPTION_FEE_PAISE, freeUsed, freeQuota: AI_FREE_MESSAGES};
    return {...this.aiViewOf(row), freeUsed, freeQuota: AI_FREE_MESSAGES};
  }

  // Public plan card: every price and perk the apps show for NAHTREEK Plus.
  // Apps must render from here so copy can never drift from the constants
  // the server actually enforces.
  aiPlan() {
    return {
      feePaisa: AI_SUBSCRIPTION_FEE_PAISE,
      freeMessages: AI_FREE_MESSAGES,
      consultDiscountBps: PLUS_DISCOUNT_BPS,
      consultDiscountCapPaisa: PLUS_DISCOUNT_CAP_Paisa,
      acceptWindowMs: PLUS_ACCEPT_WINDOW_MS,
      arrivalGraceMs: PLUS_ARRIVAL_GRACE_MS,
      lateAcceptPenaltyPaisa: PENALTY_LATE_ACCEPT_Paisa,
      lateArrivalPenaltyPaisa: PENALTY_LATE_ARRIVAL_Paisa,
    };
  }

  async aiSubscribe(userId: string) {
    const planId = this.aiPlanId();
    let row = await this.db.aiSubscription.findUnique({where: {userId}});
    if (!row) row = await this.db.aiSubscription.create({data: {userId}});
    if (row.providerSubscriptionId) {
      const remote = await this.provider.fetchSubscription(row.providerSubscriptionId).catch(() => null);
      // A remote id that does not match the row is stale: fall through to a
      // fresh subscription below instead of resuming a stranger's checkout.
      const stale = !remote || remote.id !== row.providerSubscriptionId;
      if (!stale && remote?.status === 'active') {
        // A cancelled tail still reads active until the cycle ends — fall
        // through so subscribe mints the replacement mandate instead of
        // stranding the user with no checkout link.
        if (!this.tailEnd(row)) {
          const updated = await this.aiApplyRemote(row, remote);
          return {...this.aiViewOf(updated), keyId: this.provider.keyId, subscriptionId: row.providerSubscriptionId, shortUrl: null as string | null};
        }
      }
      if (!stale && remote && ['created', 'authenticated', 'pending'].includes(remote.status)
        && await this.remotePlanMatches(remote, AI_SUBSCRIPTION_FEE_PAISE)) {
        // A live checkout resumes on its short URL — but an effective row
        // (demo, or a paid tail with a resubscribe pending) keeps its status
        // until the real mandate actually confirms.
        const updated = this.isEffective(row) ? row : await this.aiApplyRemote(row, remote);
        return {...this.aiViewOf(updated), keyId: this.provider.keyId, subscriptionId: row.providerSubscriptionId, shortUrl: remote.short_url ?? null};
      }
      // Dead (cancelled/completed/expired) or unreadable mandates fall
      // through to a fresh subscription; the create path below reports a real
      // provider outage with its proper error.
    }
    const tail = this.tailEnd(row);
    if (this.isEffective(row) && (row.status === MembershipStatus.ACTIVE || row.status === MembershipStatus.CANCELLED)
      && row.providerSubscriptionId && !tail)
      return {...this.aiViewOf(row), keyId: this.provider.keyId, subscriptionId: row.providerSubscriptionId, shortUrl: null as string | null};
    // A demo-effective row has no provider id: starting a real checkout must
    // not kill the demo — the demo stays until the real mandate confirms.
    // A resubscribe likewise keeps the paid tail while the new checkout pends.
    const keepDemo = this.isEffective(row) && !row.providerSubscriptionId;
    try {
      const plan = await this.provider.fetchPlan(planId);
      if (plan.amount !== AI_SUBSCRIPTION_FEE_PAISE || plan.currency !== 'INR' || plan.period !== 'monthly')
        throw new BadRequestException('AI plan mismatch — refusing to bill the wrong amount');
      const sub = await this.provider.createSubscription({planId, totalCount: AI_SUBSCRIPTION_CYCLES,
        notes: {kind: 'ai-subscription', aiSubscriptionId: row.id, userId},
        ...(tail ? {startAt: Math.floor(tail.getTime() / 1000)} : {})});
      // Optimistic claim: a racing subscribe wins one row update; the loser
      // re-reads and returns the winner's live checkout link. Orphaned
      // Razorpay subscriptions never charge without customer authorization.
      const claimed = await this.db.aiSubscription.updateMany({where: {id: row.id, providerSubscriptionId: row.providerSubscriptionId},
        data: tail ? {providerSubscriptionId: sub.id, cancelAtPeriodEnd: false}
          : keepDemo ? {providerSubscriptionId: sub.id}
          : {providerSubscriptionId: sub.id, status: MembershipStatus.PENDING, cancelAtPeriodEnd: false}});
      if (!claimed.count) {
        const winner = await this.db.aiSubscription.findUniqueOrThrow({where: {id: row.id}});
        const remote = await this.provider.fetchSubscription(winner.providerSubscriptionId!);
        return {...this.aiViewOf(winner), keyId: this.provider.keyId, subscriptionId: winner.providerSubscriptionId, shortUrl: remote.short_url ?? null};
      }
      const updated = await this.db.aiSubscription.findUniqueOrThrow({where: {id: row.id}});
      await this.db.auditLog.create({data: {userId, entity: 'AiSubscription', entityId: row.id,
        action: tail ? 'AI_SUBSCRIPTION_RESUBSCRIBED' : 'AI_SUBSCRIPTION_STARTED',
        metadata: {providerSubscriptionId: sub.id}}});
      return {...this.aiViewOf(updated), keyId: this.provider.keyId, subscriptionId: sub.id, shortUrl: sub.short_url ?? null};
    } catch (error) {
      if (error instanceof ServiceUnavailableException || error instanceof BadRequestException) throw error;
      this.toProviderError(error);
    }
  }

  async aiConfirm(userId: string) {
    const row = await this.db.aiSubscription.findUnique({where: {userId}});
    if (!row?.providerSubscriptionId) throw new BadRequestException('Start the AI subscription checkout first');
    const sub = await this.fetchSubscriptionSettled(row.providerSubscriptionId);
    if (['halted', 'cancelled'].includes(sub.status))
      throw new BadRequestException('The payment failed or was cancelled at Razorpay. No money was taken — start a fresh checkout to try again.');
    if (!['active', 'authenticated'].includes(sub.status))
      throw new BadRequestException('Payment is still confirming at Razorpay. Wait a minute, then tap refresh — do not pay again.');
    const updated = await this.db.aiSubscription.update({where: {userId}, data: {status: 'ACTIVE', cancelAtPeriodEnd: false,
      currentPeriodStart: sub.current_start ? new Date(sub.current_start * 1000) : null,
      currentPeriodEnd: sub.current_end ? new Date(sub.current_end * 1000) : null, lastChargeAt: new Date()}});
    await this.db.auditLog.create({data: {userId, entity: 'AiSubscription', entityId: row.id,
      action: 'AI_SUBSCRIPTION_CONFIRMED', metadata: {providerSubscriptionId: row.providerSubscriptionId}}});
    return {...this.aiViewOf(updated), freeUsed: await this.aiFreeUsed(userId), freeQuota: AI_FREE_MESSAGES};
  }

  // Preview-only demo path so testers can use the full AI subscription
  // without real money. Hard-gated on APP_ENV: production always refuses.
  // Effective rows are returned untouched, and any live checkout id is kept
  // so a real pending checkout or webhook still resolves.
  async aiDemoActivate(userId: string) {
    if (process.env.APP_ENV !== 'preview')
      throw new ForbiddenException('Demo activation is available in preview builds only');
    let row = await this.db.aiSubscription.findUnique({where: {userId}});
    if (!row) row = await this.db.aiSubscription.create({data: {userId}});
    if (this.isEffective(row))
      return {...this.aiViewOf(row), freeUsed: await this.aiFreeUsed(userId), freeQuota: AI_FREE_MESSAGES};
    const now = new Date();
    const updated = await this.db.aiSubscription.update({where: {userId}, data: {status: MembershipStatus.ACTIVE,
      currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      cancelAtPeriodEnd: false}});
    await this.db.auditLog.create({data: {userId, entity: 'AiSubscription', entityId: row.id,
      action: 'AI_SUBSCRIPTION_DEMO_ACTIVATED', metadata: {demo: true}}});
    return {...this.aiViewOf(updated), freeUsed: await this.aiFreeUsed(userId), freeQuota: AI_FREE_MESSAGES};
  }

  async aiCancel(userId: string, dto: CancelMembershipDto) {
    const row = await this.db.aiSubscription.findUnique({where: {userId}});
    if (!row || (!this.isEffective(row) && row.status !== MembershipStatus.PENDING))
      throw new BadRequestException('No active AI subscription to cancel');
    const quota = {freeUsed: await this.aiFreeUsed(userId), freeQuota: AI_FREE_MESSAGES};
    if (!this.isEffective(row)) {
      // A never-authorized checkout has no billing cycle, so Razorpay itself
      // refuses to cancel it — drop the dead checkout best-effort and always
      // free the row instead of stranding the user.
      if (row.providerSubscriptionId)
        await this.provider.cancelSubscription(row.providerSubscriptionId).catch(() => undefined);
      const cleared = await this.db.aiSubscription.update({where: {userId}, data: {providerSubscriptionId: null,
        status: MembershipStatus.NONE, cancelAtPeriodEnd: false, currentPeriodStart: null, currentPeriodEnd: null}});
      await this.db.auditLog.create({data: {userId, entity: 'AiSubscription', entityId: row.id,
        action: 'AI_SUBSCRIPTION_CHECKOUT_CANCELLED', metadata: {reason: dto.reason ?? null}}});
      return {...this.aiViewOf(cleared), ...quota};
    }
    if (row.providerSubscriptionId) {
      try {
        await this.provider.cancelSubscription(row.providerSubscriptionId);
      } catch (error) {
        // A mandate already ended at Razorpay (dashboard cancel, retried tap)
        // fails the cancel call — sync the local row to the provider truth
        // instead of failing the user.
        const remote = await this.provider.fetchSubscription(row.providerSubscriptionId).catch(() => null);
        if (remote && ['cancelled', 'completed', 'expired'].includes(remote.status)) {
          const synced = await this.aiApplyRemote(row, remote);
          await this.db.auditLog.create({data: {userId, entity: 'AiSubscription', entityId: row.id,
            action: 'AI_SUBSCRIPTION_CANCELLED', metadata: {reason: dto.reason ?? null, synced: true}}});
          await this.tellAi(userId, 'AI subscription ended', 'Your access continues until the paid period ends.',
            'AI_SUBSCRIPTION_ENDED', row.id);
          return {...this.aiViewOf(synced), ...quota};
        }
        this.toProviderError(error);
      }
    }
    const updated = await this.db.aiSubscription.update({where: {userId}, data: {cancelAtPeriodEnd: true}});
    await this.db.auditLog.create({data: {userId, entity: 'AiSubscription', entityId: row.id,
      action: 'AI_SUBSCRIPTION_CANCELLED', metadata: {reason: dto.reason ?? null}}});
    await this.tellAi(userId, 'AI subscription will not renew', 'You keep unlimited AI until the paid period ends.',
      'AI_SUBSCRIPTION_CANCELLED', row.id);
    return {...this.aiViewOf(updated), ...quota};
  }

  async aiAdminSummary() {
    const active = await this.db.aiSubscription.count({where: {status: 'ACTIVE'}});
    return {active, mrrPaisa: active * AI_SUBSCRIPTION_FEE_PAISE, feePaisa: AI_SUBSCRIPTION_FEE_PAISE};
  }

  async aiAdminList(query: {page?: number; pageSize?: number; status?: MembershipStatus}) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, query.pageSize ?? 20));
    const where = query.status ? {status: query.status} : {};
    const [total, rows] = await this.db.$transaction([
      this.db.aiSubscription.count({where}),
      this.db.aiSubscription.findMany({where, orderBy: {updatedAt: 'desc'}, skip: (page - 1) * pageSize, take: pageSize,
        include: {user: {select: {phoneNumber: true, email: true, displayName: true}}}}),
    ]);
    return {page, pageSize, total, rows: rows.map(row => ({id: row.id, ...this.aiViewOf(row), userId: row.userId,
      phoneNumber: row.user.phoneNumber, email: row.user.email, displayName: row.user.displayName}))};
  }
}
