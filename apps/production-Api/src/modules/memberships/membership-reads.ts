// Dependency-free membership reads for services that cannot import
// MembershipsService without a module cycle. Read-only, fail-closed.
type PlusReader = {
   
  aiSubscription: {findUnique: (...args: any[]) => Promise<{status: string; currentPeriodEnd: Date | null} | null>};
};

// True while the Home client's Plus subscription has a paid period running,
// including a cancelled-but-paid tail. Used for the pro-side Plus badge and
// priority support handling.
export async function isPlusClient(db: PlusReader, userId: string): Promise<boolean> {
  try {
    const sub = await db.aiSubscription.findUnique({where: {userId}});
    return effectivePlus(sub);
  } catch {
    return false;
  }
}

type PlusBatchReader = {
   
  aiSubscription: {findMany: (...args: any[]) => Promise<{userId: string; status: string; currentPeriodEnd: Date | null}[]>};
};

// One lookup per request list: which client userIds hold Plus right now.
// Failures degrade to an empty set (no badges) rather than a failed list.
export async function plusClientIds(db: PlusBatchReader, userIds: string[]): Promise<Set<string>> {
  try {
    if (!userIds.length) return new Set();
    const subs = await db.aiSubscription.findMany({where: {userId: {in: [...new Set(userIds)]}},
      select: {userId: true, status: true, currentPeriodEnd: true}});
    return new Set(subs.filter(effectivePlus).map(sub => sub.userId));
  } catch {
    return new Set();
  }
}

function effectivePlus(sub: {status: string; currentPeriodEnd: Date | null} | null | undefined) {
  return Boolean(sub?.currentPeriodEnd && sub.currentPeriodEnd.getTime() > Date.now()
    && ['ACTIVE', 'PAST_DUE', 'CANCELLED'].includes(sub.status));
}
