// At-home collection economics, dependency-free so journey and request
// flows can enforce dues without importing the payments service.
import {PenaltyStatus} from '@prisma/client';
export const PLATFORM_FEE_BPS = 1000; // 10% standard commission
export const MEMBER_FEE_BPS = 700; // 7% for active Pro members
export const DUES_BLOCK_Paisa = 50000; // ₹500 unsettled commission blocks new accepts
export const MEMBER_DUES_BLOCK_Paisa = 200000; // Members get ₹2,000 of room before new accepts pause
export const MEMBER_FREE_JOBS_PER_MONTH = 1; // First booking row of each calendar month bills at 0%
// Plus client economics: a small engineer-consultation discount funded out of
// the platform commission (the pro keeps their full share), and speed-SLA
// penalties that post to the pro's dues when a Plus booking runs slow.
export const PLUS_DISCOUNT_BPS = 200; // 2% off engineer consultations
export const PLUS_DISCOUNT_CAP_Paisa = 10000; // ...capped at ₹100
export const PLUS_ACCEPT_WINDOW_MS = 900000; // Plus scheduled bookings: 15-min accept (vs 60)
export const PLUS_ARRIVAL_GRACE_MS = 900000; // 15 min past the arrival target before a penalty
export const PENALTY_LATE_ACCEPT_Paisa = 2500; // ₹25 for ignoring a Plus request while online
export const PENALTY_LATE_ARRIVAL_Paisa = 5000; // ₹50 for arriving late to a Plus booking

export function plusDiscountPaisa(amountPaisa: number) {
  return Math.min(Math.floor((amountPaisa * PLUS_DISCOUNT_BPS) / 10000), PLUS_DISCOUNT_CAP_Paisa);
}

type DuesReader = {
   
  payment: {aggregate: (...args: any[]) => Promise<{_sum: {platformFeePaisa?: number | null}}>};
   
  professionalPenalty: {aggregate: (...args: any[]) => Promise<{_sum: {amountPaisa?: number | null}}>};
};

async function safeAggregate<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export async function unsettledDuesPaisa(db: DuesReader, professionalProfileId: string): Promise<number> {
  const [rows, penalties] = await Promise.all([
    safeAggregate<{_sum: {platformFeePaisa?: number | null}}>(() => db.payment.aggregate({
      where: {professionalProfileId, status: 'COLLECTED_UNSETTLED'},
      _sum: {platformFeePaisa: true},
    }), {_sum: {}}),
    safeAggregate<{_sum: {amountPaisa?: number | null}}>(() => db.professionalPenalty.aggregate({
      where: {professionalProfileId, status: PenaltyStatus.PENDING},
      _sum: {amountPaisa: true},
    }), {_sum: {}}),
  ]);
  return (rows._sum.platformFeePaisa ?? 0) + (penalties._sum.amountPaisa ?? 0);
}

type MembershipReader = {
   
  membership: {findUnique: (...args: any[]) => Promise<{status: string; currentPeriodEnd: Date | null} | null>};
};

// Per-profile dues ceiling: members keep accepting until ₹2,000 unsettled.
// Mirrors the membership effectiveness rule (paid period running, including
// a cancelled-but-paid tail) without importing the memberships module, so
// enforcement and the dues view always agree on the limit.
export async function duesLimitPaisa(db: MembershipReader, professionalProfileId: string): Promise<number> {
  try {
    const m = await db.membership.findUnique({where: {professionalProfileId}});
    const effective = Boolean(m?.currentPeriodEnd && m.currentPeriodEnd.getTime() > Date.now()
      && ['ACTIVE', 'PAST_DUE', 'CANCELLED'].includes(m.status));
    return effective ? MEMBER_DUES_BLOCK_Paisa : DUES_BLOCK_Paisa;
  } catch {
    return DUES_BLOCK_Paisa;
  }
}
