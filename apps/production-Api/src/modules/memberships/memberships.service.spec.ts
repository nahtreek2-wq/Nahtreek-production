import {MembershipsService} from './memberships.service';

const PLAN_ID = 'plan_test_membership';
const SECRET = 'whsec_test_secret_value_1234567890';
const profile = {id: 'prof', userId: 'pro'};
const row = (over: Record<string, unknown> = {}) => ({id: 'mem', professionalProfileId: 'prof',
  providerSubscriptionId: null, status: 'NONE', currentPeriodStart: null, currentPeriodEnd: null,
  cancelAtPeriodEnd: false, lastChargeAt: null, ...over});
const future = () => new Date(Date.now() + 30 * 24 * 3600 * 1000);
const past = () => new Date(Date.now() - 1000);
const remote = (over: Record<string, unknown> = {}) => ({id: 'sub_1', status: 'active',
  current_start: Math.floor(Date.now() / 1000), current_end: Math.floor(Date.now() / 1000) + 2592000, ...over});

function setup(over: {membership?: any; none?: boolean; provider?: any; event?: any} = {}) {
  let mem: any = over.none ? null : row(over.membership);
  const findMembership = jest.fn(async ({where}: any) => {
    if (!mem) return null;
    if (where.professionalProfileId) return mem.professionalProfileId === where.professionalProfileId ? mem : null;
    if (where.providerSubscriptionId) return mem.providerSubscriptionId === where.providerSubscriptionId ? mem : null;
    if (where.id) return mem.id === where.id ? mem : null;
    return null;
  });
  const findProfile = jest.fn(async () => profile);
  const db: any = {
    professionalProfile: {findUnique: findProfile, findUniqueOrThrow: findProfile,
      update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({count: 0})},
    membership: {
      findUnique: findMembership,
      findUniqueOrThrow: jest.fn(async ({where}: any) => {
        const found = await findMembership({where});
        if (!found) throw new Error('not found');
        return found;
      }),
      create: jest.fn(async ({data}: any) => (mem = Object.assign(row(), data))),
      update: jest.fn(async ({data}: any) => Object.assign(mem, data)),
      updateMany: jest.fn(async ({where, data}: any) => {
        let match = Boolean(mem);
        if (match && where.id && mem.id !== where.id) match = false;
        if (match && where.providerSubscriptionId !== undefined && mem.providerSubscriptionId !== where.providerSubscriptionId) match = false;
        if (match && where.status?.in && !where.status.in.includes(mem.status)) match = false;
        if (match && where.currentPeriodEnd?.lte && !(mem.currentPeriodEnd && mem.currentPeriodEnd <= where.currentPeriodEnd.lte)) match = false;
        if (match) Object.assign(mem, data);
        return {count: match ? 1 : 0};
      }),
    },
    membershipEvent: {findUnique: jest.fn(async () => over.event ?? null), create: jest.fn(async ({data}: any) => ({id: 'evt', ...data}))},
    aiSubscription: {findUnique: jest.fn(async () => null), findUniqueOrThrow: jest.fn(), create: jest.fn(), update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({count: 0}), count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([])},
    aiSubscriptionEvent: {findUnique: jest.fn(async () => null), create: jest.fn(async ({data}: any) => ({id: 'evt', ...data}))},
    aiMessage: {count: jest.fn().mockResolvedValue(0)},
    payment: {findMany: jest.fn().mockResolvedValue([])},
    $transaction: jest.fn((arg: any) => Promise.all(arg)),
    notification: {create: jest.fn()}, auditLog: {create: jest.fn()},
  };
  const provider = {enabled: true, keyId: 'rzp_test',
    fetchPlan: jest.fn().mockResolvedValue({id: PLAN_ID, amount: 39900, currency: 'INR', period: 'monthly'}),
    createSubscription: jest.fn().mockResolvedValue({id: 'sub_1', status: 'created', short_url: 'https://rzp.io/i/x'}),
    fetchSubscription: jest.fn().mockResolvedValue(remote()),
    cancelSubscription: jest.fn().mockResolvedValue({id: 'sub_1', status: 'cancelled'}),
    verifyWebhookSignature: jest.fn().mockReturnValue(true), ...over.provider};
  const push = {dispatch: jest.fn().mockResolvedValue({})};
  const realtime = {emitUserUpdate: jest.fn()};
  db.membership.groupBy = jest.fn().mockResolvedValue([]);
  db.membership.findMany = jest.fn().mockResolvedValue([]);
  db.membership.count = jest.fn().mockResolvedValue(0);
  const service = new MembershipsService(db, provider, push as any, realtime as any);
  return {db, provider, service};
}

const AI_PLAN_ID = 'plan_test_ai_home';

function withEnv() {
  const priorPlan = process.env.RAZORPAY_MEMBERSHIP_PLAN_ID;
  const priorSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const priorAiPlan = process.env.RAZORPAY_AI_PLAN_ID;
  process.env.RAZORPAY_MEMBERSHIP_PLAN_ID = PLAN_ID;
  process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
  process.env.RAZORPAY_AI_PLAN_ID = AI_PLAN_ID;
  return () => {
    if (priorPlan === undefined) delete process.env.RAZORPAY_MEMBERSHIP_PLAN_ID; else process.env.RAZORPAY_MEMBERSHIP_PLAN_ID = priorPlan;
    if (priorSecret === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET; else process.env.RAZORPAY_WEBHOOK_SECRET = priorSecret;
    if (priorAiPlan === undefined) delete process.env.RAZORPAY_AI_PLAN_ID; else process.env.RAZORPAY_AI_PLAN_ID = priorAiPlan;
  };
}

describe('membership effectiveness', () => {
  it('counts the paid tail but never pending or paused rows', () => {
    const {service} = setup();
    expect(service.isEffective(row({status: 'ACTIVE', currentPeriodEnd: future()}) as any)).toBe(true);
    expect(service.isEffective(row({status: 'ACTIVE', currentPeriodEnd: past()}) as any)).toBe(false);
    expect(service.isEffective(row({status: 'CANCELLED', currentPeriodEnd: future()}) as any)).toBe(true);
    expect(service.isEffective(row({status: 'PAST_DUE', currentPeriodEnd: future()}) as any)).toBe(true);
    expect(service.isEffective(row({status: 'PENDING', currentPeriodEnd: future()}) as any)).toBe(false);
    expect(service.isEffective(row({status: 'PAUSED', currentPeriodEnd: future()}) as any)).toBe(false);
    expect(service.isEffective(row({status: 'ACTIVE', currentPeriodEnd: null}) as any)).toBe(false);
  });
});

describe('membership subscribe', () => {
  it('creates a verified plan subscription and returns the checkout link', async () => {
    const restore = withEnv();
    try {
      const {provider, service} = setup({none: true});
      const result = await service.subscribe('pro');
      expect(provider.fetchPlan).toHaveBeenCalledWith(PLAN_ID);
      expect(provider.createSubscription).toHaveBeenCalledWith({planId: PLAN_ID, totalCount: 120,
        notes: expect.objectContaining({professionalProfileId: 'prof'})});
      expect(result).toMatchObject({status: 'PENDING', keyId: 'rzp_test', subscriptionId: 'sub_1', shortUrl: 'https://rzp.io/i/x'});
    } finally { restore(); }
  });
  it('replays effective memberships and resumes live pending attempts', async () => {
    const restore = withEnv();
    try {
      const active = setup({membership: {status: 'ACTIVE', providerSubscriptionId: 'sub_1', currentPeriodEnd: future()}});
      await expect(active.service.subscribe('pro')).resolves.toMatchObject({status: 'ACTIVE', shortUrl: null});
      expect(active.provider.createSubscription).not.toHaveBeenCalled();
      const pending = setup({membership: {status: 'PENDING', providerSubscriptionId: 'sub_1'}});
      pending.provider.fetchSubscription.mockResolvedValue({...remote(), status: 'authenticated', short_url: 'https://rzp.io/i/y'});
      await expect(pending.service.subscribe('pro')).resolves.toMatchObject({shortUrl: 'https://rzp.io/i/y'});
      expect(pending.provider.createSubscription).not.toHaveBeenCalled();
    } finally { restore(); }
  });
  it('replaces dead past-due rows with a fresh checkout', async () => {
    const restore = withEnv();
    try {
      const {provider, service} = setup({membership: {status: 'PAST_DUE', providerSubscriptionId: 'sub_old', currentPeriodEnd: future()}});
      const result = await service.subscribe('pro');
      expect(provider.createSubscription).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({status: 'PENDING', subscriptionId: 'sub_1', shortUrl: 'https://rzp.io/i/x'});
    } finally { restore(); }
  });
  it('refuses misconfigured plans and missing billing', async () => {
    const restore = withEnv();
    try {
      const wrong = setup({provider: {fetchPlan: jest.fn().mockResolvedValue({id: PLAN_ID, amount: 99900, currency: 'INR', period: 'monthly'})}});
      await expect(wrong.service.subscribe('pro')).rejects.toMatchObject({status: 503});
      expect(wrong.provider.createSubscription).not.toHaveBeenCalled();
      const off = setup({provider: {enabled: false}});
      await expect(off.service.subscribe('pro')).rejects.toMatchObject({status: 503});
    } finally { restore(); }
  });
});

describe('membership confirm and cancel', () => {
  it('confirms authorization and lifts discovery priority', async () => {
    const restore = withEnv();
    try {
      const {db, service} = setup({membership: {status: 'PENDING', providerSubscriptionId: 'sub_1'}});
      const result = await service.confirm('pro');
      expect(result).toMatchObject({status: 'ACTIVE', effective: true});
      expect(db.professionalProfile.update).toHaveBeenCalledWith({where: {id: 'prof'}, data: {memberPriority: true}});
    } finally { restore(); }
  });
  it('cancels at period end but clears never-authorized attempts', async () => {
    const restore = withEnv();
    try {
      const active = setup({membership: {status: 'ACTIVE', providerSubscriptionId: 'sub_1', currentPeriodEnd: future()}});
      const cancelled = await active.service.cancel('pro', {});
      expect(cancelled).toMatchObject({status: 'CANCELLED', effective: true, cancelAtPeriodEnd: true});
      expect(active.provider.cancelSubscription).toHaveBeenCalledWith('sub_1');
      const pending = setup({membership: {status: 'PENDING', providerSubscriptionId: 'sub_1'}});
      await expect(pending.service.cancel('pro', {})).resolves.toMatchObject({status: 'NONE'});
      const done = setup({membership: {status: 'CANCELLED', providerSubscriptionId: 'sub_1', currentPeriodEnd: future()}});
      await expect(done.service.cancel('pro', {})).resolves.toMatchObject({status: 'CANCELLED'});
      expect(done.provider.cancelSubscription).not.toHaveBeenCalled();
    } finally { restore(); }
  });
});

describe('membership webhooks', () => {
  const raw = (event: any) => Buffer.from(JSON.stringify(event));
  it('rejects unsigned payloads, dedupes and ignores unknown subscriptions', async () => {
    const restore = withEnv();
    try {
      const {provider, service} = setup({membership: {status: 'PENDING', providerSubscriptionId: 'sub_1'}});
      provider.verifyWebhookSignature.mockReturnValue(false);
      await expect(service.handleWebhook(raw({id: 'e1', event: 'subscription.activated'}), 'bad')).rejects.toMatchObject({status: 401});
      provider.verifyWebhookSignature.mockReturnValue(true);
      await expect(service.handleWebhook(raw({id: 'e1', event: 'subscription.activated', payload: {}}), 'sig'))
        .resolves.toMatchObject({ok: true, ignored: true});
      const dup = setup({membership: {status: 'ACTIVE', providerSubscriptionId: 'sub_1'}, event: {id: 'evt'}});
      await expect(dup.service.handleWebhook(raw({id: 'e1', event: 'subscription.charged',
        payload: {subscription: {entity: {id: 'sub_1'}}}}), 'sig')).resolves.toMatchObject({ok: true, duplicate: true});
    } finally { restore(); }
  });
  it('activates, lapses and expires through the event catalog', async () => {
    const restore = withEnv();
    try {
      const fire = (membership: any, event: string, entity: any = {id: 'sub_1'}) => {
        const ctx = setup({membership});
        return ctx.service.handleWebhook(raw({id: `e-${event}-${membership.status}`, event, payload: {subscription: {entity}}}), 'sig')
          .then(result => ({result, ctx}));
      };
      const activated = await fire({status: 'PENDING', providerSubscriptionId: 'sub_1'}, 'subscription.activated');
      expect(activated.result).toMatchObject({ok: true});
      expect(activated.ctx.db.professionalProfile.update).toHaveBeenCalledWith({where: {id: 'prof'}, data: {memberPriority: true}});
      const halted = await fire({status: 'ACTIVE', providerSubscriptionId: 'sub_1', currentPeriodEnd: future()}, 'subscription.halted', {id: 'sub_1', status: 'halted'});
      expect(halted.ctx.db.membership.update.mock.calls[0][0].data.status).toBe('PAST_DUE');
      const expired = await fire({status: 'ACTIVE', providerSubscriptionId: 'sub_1', currentPeriodEnd: future()}, 'subscription.expired', {id: 'sub_1', status: 'expired'});
      expect(expired.ctx.db.membership.update.mock.calls[0][0].data.status).toBe('EXPIRED');
      expect(expired.ctx.db.professionalProfile.update).toHaveBeenCalledWith({where: {id: 'prof'}, data: {memberPriority: false}});
      const stale = await fire({status: 'ACTIVE', providerSubscriptionId: 'sub_2', currentPeriodEnd: future()}, 'subscription.charged');
      expect(stale.result).toMatchObject({ok: true, ignored: true});
    } finally { restore(); }
  });
});

describe('membership reconcile and view', () => {
  it('expires lapsed rows and heals priority flags', async () => {
    const {db, service} = setup();
    await expect(service.reconcile()).resolves.toMatchObject({expired: 0, cleared: 0});
    expect(db.membership.updateMany).toHaveBeenCalledWith(expect.objectContaining({data: {status: 'EXPIRED'}}));
    expect(db.professionalProfile.updateMany).toHaveBeenCalledTimes(2);
  });
  it('reports NONE for professionals who never subscribed', async () => {
    const {service} = setup({none: true});
    await expect(service.me('pro')).resolves.toMatchObject({status: 'NONE', effective: false, feePaisa: 39900,
      terms: {memberFeeBps: 700, standardFeeBps: 1000, memberDuesBlockPaisa: 200000,
        standardDuesBlockPaisa: 50000, freeJobsPerMonth: 1}});
  });
  it('proves membership savings from jobs billed below the standard rate', async () => {
    const {db, service} = setup({membership: {status: 'ACTIVE', currentPeriodEnd: future()}});
    db.payment.findMany.mockResolvedValue([
      {amountPaisa: 350000, platformFeePaisa: 24500},
      {amountPaisa: 200000, platformFeePaisa: 20000},
    ]);
    // 10% of ₹3500 minus the 7% actually charged = ₹105 on one job; the
    // full-rate job adds nothing.
    await expect(service.me('pro')).resolves.toMatchObject({
      effective: true, lifetimeSavingsPaisa: 10500, jobsAtMemberRate: 1});
    expect(db.payment.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({professionalProfileId: 'prof'})}));
  });
});

describe('membership admin views', () => {
  it('summarizes counts and recurring revenue', async () => {
    const {db, service} = setup();
    db.membership.groupBy.mockResolvedValue([
      {status: 'ACTIVE', _count: {_all: 3}},
      {status: 'EXPIRED', _count: {_all: 1}},
    ]);
    await expect(service.adminSummary()).resolves.toMatchObject({activeSubscriptions: 3,
      monthlyRecurringPaisa: 119700, feePaisa: 39900});
  });
  it('lists memberships with professional contact and effective flags', async () => {
    const {db, service} = setup();
    db.membership.findMany.mockResolvedValue([{...row({status: 'ACTIVE', currentPeriodEnd: future()}),
      profile: {fullName: 'Pro Name', user: {phoneNumber: '+911234567890', email: null}}}]);
    db.membership.count.mockResolvedValue(1);
    const result = await service.listForAdmin({page: '2', limit: '10'});
    expect(result.meta).toMatchObject({page: 2, limit: 10, total: 1, totalPages: 1});
    expect(result.data[0]).toMatchObject({status: 'ACTIVE', effective: true,
      professionalName: 'Pro Name', phoneNumber: '+911234567890'});
    expect(db.membership.findMany.mock.calls[0][0]).toMatchObject({where: {}, skip: 10, take: 10});
  });
  it('rejects invalid statuses and pagination', async () => {
    const {service} = setup();
    await expect(service.listForAdmin({status: 'VIP'})).rejects.toMatchObject({status: 400});
    await expect(service.listForAdmin({page: '-1'})).rejects.toMatchObject({status: 400});
  });
});

describe('home AI subscription', () => {
  const aiRow = (over: Record<string, unknown> = {}) => ({id: 'ai', userId: 'u', providerSubscriptionId: null,
    status: 'NONE', currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, lastChargeAt: null, ...over});
  const aiProvider = () => ({fetchPlan: jest.fn().mockResolvedValue({id: AI_PLAN_ID, amount: 12900, currency: 'INR', period: 'monthly'})});

  it('reports NONE with free quota for new users', async () => {
    const {service} = setup();
    await expect(service.aiMe('u')).resolves.toMatchObject({status: 'NONE', effective: false, feePaisa: 12900, freeUsed: 0, freeQuota: 5});
  });

  it('allows 5 free messages then requires subscription', async () => {
    const {db, service} = setup();
    db.aiMessage.count.mockResolvedValue(4);
    await expect(service.assertAiAccess('u', 'message')).resolves.toBeUndefined();
    db.aiMessage.count.mockResolvedValue(5);
    await expect(service.assertAiAccess('u', 'message')).rejects.toMatchObject({status: 402});
  });

  it('gates plans and uploads behind subscription from the first use', async () => {
    const {service} = setup();
    await expect(service.assertAiAccess('u', 'plan')).rejects.toMatchObject({status: 402});
    await expect(service.assertAiAccess('u', 'upload')).rejects.toMatchObject({status: 402});
  });

  it('lets subscribers through without spending quota', async () => {
    const {db, service} = setup();
    db.aiSubscription.findUnique.mockResolvedValue(aiRow({status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 86400000)}));
    await expect(service.assertAiAccess('u', 'plan')).resolves.toBeUndefined();
    expect(db.aiMessage.count).not.toHaveBeenCalled();
  });

  it('subscribes with the ₹129 plan and refuses mismatches', async () => {
    const restore = withEnv();
    try {
      const {db, service} = setup({provider: aiProvider()});
      db.aiSubscription.create.mockResolvedValue(aiRow());
      db.aiSubscription.updateMany.mockResolvedValue({count: 1});
      db.aiSubscription.findUniqueOrThrow.mockResolvedValue(aiRow({providerSubscriptionId: 'sub_1', status: 'PENDING'}));
      const started = await service.aiSubscribe('u');
      expect(started).toMatchObject({keyId: 'rzp_test', subscriptionId: 'sub_1', shortUrl: 'https://rzp.io/i/x'});
      const wrong = setup({provider: {fetchPlan: jest.fn().mockResolvedValue({id: AI_PLAN_ID, amount: 19900, currency: 'INR', period: 'monthly'})}});
      wrong.db.aiSubscription.create.mockResolvedValue(aiRow());
      await expect(wrong.service.aiSubscribe('u')).rejects.toThrow('AI plan mismatch');
    } finally { restore(); }
  });

  it('confirms an authenticated checkout and cancels at period end', async () => {
    const {db, service} = setup();
    db.aiSubscription.findUnique.mockResolvedValue(aiRow({providerSubscriptionId: 'sub_ai'}));
    db.aiSubscription.update.mockImplementation(async ({data}: any) => aiRow({providerSubscriptionId: 'sub_ai', ...data}));
    const confirmed = await service.aiConfirm('u');
    expect(confirmed).toMatchObject({status: 'ACTIVE'});
    db.aiSubscription.findUnique.mockResolvedValue(aiRow({providerSubscriptionId: 'sub_ai', status: 'ACTIVE', currentPeriodEnd: future()}));
    const cancelled = await service.aiCancel('u', {});
    expect(cancelled).toMatchObject({cancelAtPeriodEnd: true});
  });

  it('activates on subscription webhooks and dedupes replays', async () => {
    const restore = withEnv();
    try {
      const {db, provider, service} = setup();
      provider.fetchSubscription.mockResolvedValue(remote({id: 'sub_ai'}));
      db.aiSubscription.findUnique.mockImplementation(async ({where}: any) =>
        where.providerSubscriptionId === 'sub_ai' ? aiRow({providerSubscriptionId: 'sub_ai'}) : null);
      db.aiSubscription.update.mockImplementation(async ({data}: any) => aiRow({providerSubscriptionId: 'sub_ai', ...data, status: 'ACTIVE'}));
      const raw = (id: string, event: string) => Buffer.from(JSON.stringify({id, event,
        payload: {subscription: {entity: {id: 'sub_ai', status: 'active'}}}}));
      const first = await service.handleWebhook(raw('evt-ai-1', 'subscription.activated'), 'sig');
      expect(first).toMatchObject({ok: true});
      expect(db.aiSubscription.update).toHaveBeenCalledWith(expect.objectContaining({data: expect.objectContaining({status: 'ACTIVE'})}));
      db.aiSubscriptionEvent.findUnique.mockResolvedValue({id: 'evt'});
      const replay = await service.handleWebhook(raw('evt-ai-1', 'subscription.activated'), 'sig');
      expect(replay).toMatchObject({ok: true, duplicate: true});
    } finally { restore(); }
  });

  it('demo-activates in preview but refuses outside preview', async () => {
    const prior = process.env.APP_ENV;
    try {
      process.env.APP_ENV = 'preview';
      const {db, service} = setup();
      db.aiSubscription.create.mockResolvedValue(aiRow());
      db.aiSubscription.update.mockImplementation(async ({data}: any) => aiRow({...data}));
      const activated = await service.aiDemoActivate('u');
      expect(activated).toMatchObject({status: 'ACTIVE', effective: true, freeQuota: 5});
      expect(db.aiSubscription.update).toHaveBeenCalledWith(expect.objectContaining({
        where: {userId: 'u'}, data: expect.objectContaining({status: 'ACTIVE'})}));
      expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({action: 'AI_SUBSCRIPTION_DEMO_ACTIVATED'})}));
      db.aiSubscription.findUnique.mockResolvedValue(aiRow({status: 'ACTIVE', currentPeriodEnd: future()}));
      const replayed = await service.aiDemoActivate('u');
      expect(replayed).toMatchObject({status: 'ACTIVE', effective: true});
      process.env.APP_ENV = 'production';
      await expect(service.aiDemoActivate('u')).rejects.toMatchObject({status: 403});
      delete process.env.APP_ENV;
      await expect(service.aiDemoActivate('u')).rejects.toMatchObject({status: 403});
    } finally {
      if (prior === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = prior;
    }
  });

  it('counts AI MRR in admin summary', async () => {
    const {db, service} = setup();
    db.aiSubscription.count.mockResolvedValue(3);
    await expect(service.aiAdminSummary()).resolves.toMatchObject({active: 3, mrrPaisa: 38700, feePaisa: 12900});
  });
});

describe('subscription cancel and confirm hardening', () => {
  const aiRow = (over: Record<string, unknown> = {}) => ({id: 'ai', userId: 'u', providerSubscriptionId: null,
    status: 'NONE', currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, lastChargeAt: null, ...over});
  const aiProvider = () => ({fetchPlan: jest.fn().mockResolvedValue({id: AI_PLAN_ID, amount: 12900, currency: 'INR', period: 'monthly'})});

  it('frees a pending Pro checkout even when Razorpay refuses the cancel', async () => {
    const restore = withEnv();
    try {
      const {db, provider, service} = setup({membership: {status: 'PENDING', providerSubscriptionId: 'sub_1'}});
      provider.cancelSubscription.mockRejectedValue(new Error('Subscription cannot be cancelled since no billing cycle is going on'));
      const result = await service.cancel('pro', {});
      expect(result).toMatchObject({status: 'NONE', effective: false});
      expect(db.membership.update).toHaveBeenCalledWith(expect.objectContaining(
        {data: expect.objectContaining({providerSubscriptionId: null, status: 'NONE'})}));
    } finally { restore(); }
  });

  it('syncs a Pro row when the mandate already ended at Razorpay', async () => {
    const restore = withEnv();
    try {
      const {provider, service} = setup({membership: {status: 'ACTIVE', providerSubscriptionId: 'sub_1', currentPeriodEnd: future()}});
      provider.cancelSubscription.mockRejectedValue(new Error('already cancelled'));
      provider.fetchSubscription.mockResolvedValue({...remote(), id: 'sub_1', status: 'cancelled'});
      const result = await service.cancel('pro', {});
      expect(result).toMatchObject({status: 'CANCELLED', cancelAtPeriodEnd: true});
    } finally { restore(); }
  });

  it('waits out the first-charge lag before confirming a Pro membership', async () => {
    const restore = withEnv();
    try {
      const {provider, service} = setup({membership: {status: 'PENDING', providerSubscriptionId: 'sub_1'}});
      provider.fetchSubscription
        .mockResolvedValueOnce({...remote(), id: 'sub_1', status: 'created', current_start: undefined, current_end: undefined})
        .mockResolvedValueOnce({...remote(), id: 'sub_1', status: 'active'});
      const result = await service.confirm('pro');
      expect(result).toMatchObject({status: 'ACTIVE', effective: true});
      expect(provider.fetchSubscription).toHaveBeenCalledTimes(2);
    } finally { restore(); }
  }, 15000);

  it('tells the pro to wait when the charge still has not landed', async () => {
    const restore = withEnv();
    try {
      const {provider, service} = setup({membership: {status: 'PENDING', providerSubscriptionId: 'sub_1'}});
      provider.fetchSubscription.mockResolvedValue({...remote(), id: 'sub_1', status: 'created', current_start: undefined, current_end: undefined});
      await expect(service.confirm('pro')).rejects.toThrow('still confirming');
    } finally { restore(); }
  }, 15000);

  it('starts a real AI checkout without killing the demo', async () => {
    const restore = withEnv();
    try {
      const {db, provider, service} = setup({provider: aiProvider()});
      db.aiSubscription.findUnique.mockResolvedValue(aiRow({status: 'ACTIVE', currentPeriodEnd: future()}));
      db.aiSubscription.updateMany.mockResolvedValue({count: 1});
      db.aiSubscription.findUniqueOrThrow.mockResolvedValue(aiRow({status: 'ACTIVE', currentPeriodEnd: future(), providerSubscriptionId: 'sub_1'}));
      const started = await service.aiSubscribe('u');
      expect(provider.createSubscription).toHaveBeenCalledTimes(1);
      expect(db.aiSubscription.updateMany).toHaveBeenCalledWith(expect.objectContaining(
        {data: {providerSubscriptionId: 'sub_1'}}));
      expect(started).toMatchObject({status: 'ACTIVE', effective: true, subscriptionId: 'sub_1'});
    } finally { restore(); }
  });

  it('resumes a live AI checkout instead of minting a duplicate', async () => {
    const restore = withEnv();
    try {
      const {db, provider, service} = setup({provider: aiProvider()});
      db.aiSubscription.findUnique.mockResolvedValue(aiRow({status: 'PENDING', providerSubscriptionId: 'sub_1'}));
      provider.fetchSubscription.mockResolvedValue({...remote(), id: 'sub_1', status: 'created', short_url: 'https://rzp.io/i/live'});
      db.aiSubscription.update.mockImplementation(async ({data}: any) => aiRow({providerSubscriptionId: 'sub_1', ...data}));
      const resumed = await service.aiSubscribe('u');
      expect(provider.createSubscription).not.toHaveBeenCalled();
      expect(resumed).toMatchObject({subscriptionId: 'sub_1', shortUrl: 'https://rzp.io/i/live'});
    } finally { restore(); }
  });

  it('frees a pending AI checkout even when Razorpay refuses the cancel', async () => {
    const {db, provider, service} = setup();
    db.aiSubscription.findUnique.mockResolvedValue(aiRow({status: 'PENDING', providerSubscriptionId: 'sub_1'}));
    provider.cancelSubscription.mockRejectedValue(new Error('no billing cycle is going on'));
    db.aiSubscription.update.mockImplementation(async ({data}: any) => aiRow({...data}));
    const result = await service.aiCancel('u', {});
    expect(result).toMatchObject({status: 'NONE', effective: false, freeQuota: 5});
    expect(db.aiSubscription.update).toHaveBeenCalledWith(expect.objectContaining(
      {data: expect.objectContaining({providerSubscriptionId: null, status: 'NONE'})}));
  });

  it('rejects a failed AI mandate with a no-money-taken message', async () => {
    const {db, provider, service} = setup();
    db.aiSubscription.findUnique.mockResolvedValue(aiRow({status: 'PENDING', providerSubscriptionId: 'sub_1'}));
    provider.fetchSubscription.mockResolvedValue({...remote(), id: 'sub_1', status: 'halted'});
    await expect(service.aiConfirm('u')).rejects.toThrow('No money was taken');
  });

  it('syncs an AI row when the mandate already ended at Razorpay', async () => {
    const {db, provider, service} = setup();
    db.aiSubscription.findUnique.mockResolvedValue(aiRow({status: 'ACTIVE', providerSubscriptionId: 'sub_1', currentPeriodEnd: future()}));
    provider.cancelSubscription.mockRejectedValue(new Error('already cancelled'));
    provider.fetchSubscription.mockResolvedValue({...remote(), id: 'sub_1', status: 'cancelled'});
    db.aiSubscription.update.mockImplementation(async ({data}: any) =>
      aiRow({providerSubscriptionId: 'sub_1', currentPeriodEnd: future(), ...data}));
    const result = await service.aiCancel('u', {});
    expect(result).toMatchObject({status: 'CANCELLED', cancelAtPeriodEnd: true, freeQuota: 5});
  });
});
