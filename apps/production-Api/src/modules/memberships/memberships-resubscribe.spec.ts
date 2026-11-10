import {MembershipsService} from './memberships.service';

const PLAN_ID = 'plan_test_membership';
const AI_PLAN_ID = 'plan_test_ai_home';
const profile = {id: 'prof', userId: 'pro'};
const futureEnd = () => new Date(Date.now() + 27 * 24 * 3600 * 1000);
const memRow = (over: Record<string, unknown> = {}) => ({id: 'mem', professionalProfileId: 'prof',
  providerSubscriptionId: null, status: 'NONE', currentPeriodStart: null, currentPeriodEnd: null,
  cancelAtPeriodEnd: false, lastChargeAt: null, ...over});
const aiRow = (over: Record<string, unknown> = {}) => ({id: 'ai', userId: 'client',
  providerSubscriptionId: null, status: 'NONE', currentPeriodStart: null, currentPeriodEnd: null,
  cancelAtPeriodEnd: false, lastChargeAt: null, ...over});
const remote = (over: Record<string, unknown> = {}) => ({id: 'sub_old', status: 'active',
  current_start: Math.floor(Date.now() / 1000) - 2592000,
  current_end: Math.floor(Date.now() / 1000) + 27 * 86400, ...over});

function setup(over: {membership?: any; ai?: any; subs?: Record<string, any>; plan?: any} = {}) {
  let mem: any = over.membership === null ? null : memRow(over.membership);
  let ai: any = over.ai === null ? null : aiRow(over.ai);
  const subs = over.subs ?? {};
  const store = (get: () => any, set: (v: any) => void, blank: any) => ({
    findUnique: jest.fn(async ({where}: any) => {
      const row = get();
      if (!row) return null;
      if (where.professionalProfileId) return row.professionalProfileId === where.professionalProfileId ? row : null;
      if (where.userId) return row.userId === where.userId ? row : null;
      if (where.providerSubscriptionId) return row.providerSubscriptionId === where.providerSubscriptionId ? row : null;
      if (where.id) return row.id === where.id ? row : null;
      return null;
    }),
    findUniqueOrThrow: jest.fn(async ({where}: any) => {
      const row = get();
      if (!row) throw new Error('not found');
      return row;
    }),
    create: jest.fn(async ({data}: any) => { set(Object.assign(blank(), data)); return get(); }),
    update: jest.fn(async ({data}: any) => Object.assign(get(), data)),
    updateMany: jest.fn(async ({where, data}: any) => {
      const row = get();
      let match = Boolean(row);
      if (match && where.id && row.id !== where.id) match = false;
      if (match && where.providerSubscriptionId !== undefined && row.providerSubscriptionId !== where.providerSubscriptionId) match = false;
      if (match) Object.assign(row, data);
      return {count: match ? 1 : 0};
    }),
  });
  const db: any = {
    professionalProfile: {findUnique: jest.fn(async () => profile), update: jest.fn().mockResolvedValue({})},
    membership: store(() => mem, v => { mem = v; }, () => memRow()),
    aiSubscription: store(() => ai, v => { ai = v; }, () => aiRow()),
    membershipEvent: {findUnique: jest.fn(async () => null), create: jest.fn()},
    aiSubscriptionEvent: {findUnique: jest.fn(async () => null), create: jest.fn()},
    aiMessage: {count: jest.fn().mockResolvedValue(0)},
    payment: {findMany: jest.fn().mockResolvedValue([])},
    notification: {create: jest.fn()},
    auditLog: {create: jest.fn()},
  };
  const provider = {enabled: true, keyId: 'rzp_test',
    fetchPlan: jest.fn(async (id: string) => over.plan ?? (id === AI_PLAN_ID
      ? {id, amount: 12900, currency: 'INR', period: 'monthly'}
      : {id, amount: 39900, currency: 'INR', period: 'monthly'})),
    createSubscription: jest.fn().mockResolvedValue({id: 'sub_new', status: 'created', short_url: 'https://rzp.io/i/new'}),
    fetchSubscription: jest.fn(async (id: string) => {
      if (subs[id]) return subs[id];
      throw new Error('no such subscription');
    }),
    cancelSubscription: jest.fn().mockResolvedValue({id: 'sub_old', status: 'cancelled'}),
    verifyWebhookSignature: jest.fn().mockReturnValue(true)};
  const push = {dispatch: jest.fn().mockResolvedValue({})};
  const realtime = {emitUserUpdate: jest.fn()};
  const service = new MembershipsService(db, provider as any, push as any, realtime as any);
  return {db, provider, service, rows: () => ({mem, ai})};
}

beforeEach(() => {
  process.env.RAZORPAY_MEMBERSHIP_PLAN_ID = PLAN_ID;
  process.env.RAZORPAY_AI_PLAN_ID = AI_PLAN_ID;
  process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test_secret_value_1234567890';
});

describe('resubscribe during the cancelled paid tail', () => {
  it('AI: mints a replacement mandate starting at the tail end', async () => {
    const end = futureEnd();
    const {service, provider, rows} = setup({ai: {providerSubscriptionId: 'sub_old', status: 'ACTIVE',
      currentPeriodEnd: end, cancelAtPeriodEnd: true}, subs: {sub_old: remote()}});
    const view = await service.aiSubscribe('client');
    expect(view.shortUrl).toBe('https://rzp.io/i/new');
    expect(provider.createSubscription).toHaveBeenCalledWith(expect.objectContaining({
      startAt: Math.floor(end.getTime() / 1000)}));
    // Tail untouched while the new checkout pends: still ACTIVE till the old end.
    expect(rows().ai.status).toBe('ACTIVE');
    expect(rows().ai.currentPeriodEnd).toEqual(end);
    expect(rows().ai.cancelAtPeriodEnd).toBe(false);
    expect(rows().ai.providerSubscriptionId).toBe('sub_new');
  });

  it('AI: an uncancelled active plan does not mint a second mandate', async () => {
    const {service, provider} = setup({ai: {providerSubscriptionId: 'sub_old', status: 'ACTIVE',
      currentPeriodEnd: futureEnd(), cancelAtPeriodEnd: false}, subs: {sub_old: remote()}});
    const view = await service.aiSubscribe('client');
    expect(view.shortUrl).toBeNull();
    expect(provider.createSubscription).not.toHaveBeenCalled();
  });

  it('Pro: mints a replacement mandate starting at the tail end', async () => {
    const end = futureEnd();
    const {service, provider, rows} = setup({membership: {providerSubscriptionId: 'sub_old', status: 'CANCELLED',
      currentPeriodEnd: end, cancelAtPeriodEnd: true}, subs: {sub_old: remote()}});
    const view = await service.subscribe('pro');
    expect(view.shortUrl).toBe('https://rzp.io/i/new');
    expect(provider.createSubscription).toHaveBeenCalledWith(expect.objectContaining({
      startAt: Math.floor(end.getTime() / 1000)}));
    expect(rows().mem.status).toBe('CANCELLED');
    expect(rows().mem.currentPeriodEnd).toEqual(end);
  });

  it('Pro confirm flips an authorized resubscribe to ACTIVE without a gap', async () => {
    const end = futureEnd();
    const start = Math.floor(end.getTime() / 1000);
    const {service, rows} = setup({membership: {providerSubscriptionId: 'sub_new', status: 'CANCELLED',
      currentPeriodEnd: end, cancelAtPeriodEnd: false},
      subs: {sub_new: remote({id: 'sub_new', status: 'authenticated', current_start: start, current_end: start + 2592000})}});
    const view = await service.confirm('pro');
    expect(view.status).toBe('ACTIVE');
    expect(view.effective).toBe(true);
    expect(rows().mem.currentPeriodEnd).toEqual(new Date((start + 2592000) * 1000));
  });

  it('Pro confirm keeps fresh authenticated checkouts PENDING', async () => {
    const now = Math.floor(Date.now() / 1000);
    const {service} = setup({membership: {providerSubscriptionId: 'sub_new', status: 'PENDING',
      currentPeriodEnd: null, cancelAtPeriodEnd: false},
      subs: {sub_new: remote({id: 'sub_new', status: 'authenticated', current_start: now, current_end: now + 2592000})}});
    const view = await service.confirm('pro');
    expect(view.status).toBe('PENDING');
  });

  it('Pro confirm still syncs a live mandate', async () => {
    const {service} = setup({membership: {providerSubscriptionId: 'sub_old', status: 'ACTIVE',
      currentPeriodEnd: futureEnd(), cancelAtPeriodEnd: false}, subs: {sub_old: remote()}});
    const view = await service.confirm('pro');
    expect(view.status).toBe('ACTIVE');
    expect(view.effective).toBe(true);
  });
});
