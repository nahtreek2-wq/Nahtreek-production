import {PaymentsService} from './payments.service';
import {DUES_BLOCK_Paisa, MEMBER_DUES_BLOCK_Paisa, duesLimitPaisa, unsettledDuesPaisa} from './commission';

const journey = (over: Record<string, unknown> = {}) => ({stage: 'AWAITING_CONFIRMATION',
  quoteAmountPaisa: 200000, quoteAccepted: true, collectionMode: 'AT_HOME',
  collectedAmountPaisa: 200000, collectedMethod: 'UPI', ...over});
const request = (over: Record<string, unknown> = {}) => ({id: 'req', status: 'IN_PROGRESS',
  client: {userId: 'client'}, provider: {id: 'prof', userId: 'pro'}, journey: journey(), ...over});

function setup(over: {req?: any; pays?: any[]; penalties?: any[]; settlements?: any[]; links?: any[]; provider?: any; member?: boolean; email?: any; user?: any; membership?: any} = {}) {
  const req = over.req === undefined ? request() : over.req;
  const pays: any[] = over.pays ?? [];
  const settlements: any[] = over.settlements ?? [];
  const findUnique = jest.fn(async ({where}: any) => {
    if (where.serviceRequestId) return pays.find(p => p.serviceRequestId === where.serviceRequestId) ?? null;
    if (where.providerOrderId) return pays.find(p => p.providerOrderId === where.providerOrderId)
      ?? settlements.find(s => s.providerOrderId === where.providerOrderId) ?? null;
    if (where.providerPaymentId) return settlements.find(s => s.providerPaymentId === where.providerPaymentId) ?? null;
    if (where.id) return pays.find(p => p.id === where.id) ?? settlements.find(s => s.id === where.id) ?? null;
    if (where.userId) return {id: 'prof', userId: 'pro'};
    return null;
  });
  const db: any = {
    serviceRequest: {findFirst: jest.fn().mockResolvedValue(req)},
    payment: {findUnique, findUniqueOrThrow: jest.fn(async ({where}: any) => {
      const found = await findUnique({where});
      if (!found) throw new Error('not found');
      return found;
    }),
      create: jest.fn(async ({data}: any) => {
        const row = {id: `pay-${pays.length}`, providerOrderId: null, providerPaymentId: null,
          providerTransferId: null, paidAt: null, releasedAt: null, refundedAt: null, settledAt: null,
          collectionMode: 'ONLINE', ...data};
        pays.push(row);
        return row;
      }),
      findMany: jest.fn(async ({where}: any) => pays.filter(p =>
        (!where.professionalProfileId || p.professionalProfileId === where.professionalProfileId) &&
        (!where.status || p.status === where.status))),
      updateMany: jest.fn(async ({where, data}: any) => {
        const rows = pays.filter(p => (!where.id?.in || where.id.in.includes(p.id)) &&
          (!where.status || p.status === where.status));
        rows.forEach(row => Object.assign(row, data));
        return {count: rows.length};
      }),
      aggregate: jest.fn(async ({where}: any) => ({_sum: {platformFeePaisa:
        pays.filter(p => p.professionalProfileId === where.professionalProfileId && p.status === where.status)
          .reduce((sum, p) => sum + p.platformFeePaisa, 0)}})),
      count: jest.fn().mockResolvedValue(0)},
    commissionSettlement: {
      findFirst: jest.fn(async ({where}: any) => settlements.find(s =>
        s.professionalProfileId === where.professionalProfileId && s.status === where.status) ?? null),
      findUnique, findUniqueOrThrow: jest.fn(async ({where}: any) => {
        const found = await findUnique({where});
        if (!found) throw new Error('not found');
        return found;
      }),
      create: jest.fn(async ({data}: any) => {
        const row = {id: `stl-${settlements.length}`, status: 'ORDER_CREATED', providerOrderId: null,
          providerPaymentId: null, currency: 'INR', settledAt: null, ...data};
        settlements.push(row);
        return row;
      }),
      update: jest.fn(async ({where, data}: any) => {
        const row = settlements.find(s => s.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      }),
      updateMany: jest.fn(async ({where, data}: any) => {
        const rows = settlements.filter(s => s.id === where.id && s.status === where.status &&
          (where.providerPaymentId !== null || s.providerPaymentId === null));
        rows.forEach(row => Object.assign(row, data));
        return {count: rows.length};
      })},
    professionalProfile: {findUnique: jest.fn(async ({where}: any) =>
      (where.userId ? {id: 'prof', userId: 'pro'} : {id: where.id, userId: 'pro'})),
      findUniqueOrThrow: jest.fn().mockResolvedValue({id: 'prof', userId: 'pro'})},
    user: {findUnique: jest.fn().mockResolvedValue(over.user === undefined
      ? {email: 'client@example.com', displayName: 'Client'} : over.user)},
    professionalPenalty: {
      findMany: jest.fn().mockResolvedValue(over.penalties ?? []),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({data}: any) => ({id: 'pen-1', status: 'PENDING', createdAt: new Date(), ...data})),
      updateMany: jest.fn().mockResolvedValue({count: 0}),
      aggregate: jest.fn().mockResolvedValue({_sum: {amountPaisa: 0}}),
    },
    membership: {findUnique: jest.fn().mockResolvedValue(over.membership ?? null),
      findMany: jest.fn().mockResolvedValue([])},
    notification: {createMany: jest.fn(), create: jest.fn()},
    auditLog: {createMany: jest.fn(), create: jest.fn()},
    // Empty by default: existing tests exercise the legacy snapshot fallback.
    settlementPayment: {findMany: jest.fn(async () => over.links ?? [])},
  };
  const provider = {enabled: true, keyId: 'rzp_test', createOrder: jest.fn().mockResolvedValue({id: 'order_stl'}),
    fetchPayment: jest.fn(), verifyPaymentSignature: jest.fn().mockReturnValue(true), ...over.provider};
  const email = over.email === undefined ? undefined
    : {enabled: true, send: jest.fn().mockResolvedValue({id: 'mail_1'}), ...over.email};
  const service = new PaymentsService(db, provider as any, {dispatch: jest.fn().mockResolvedValue({})} as any,
    {emitUserUpdate: jest.fn()} as any,
    {isEffectiveByProfile: jest.fn().mockResolvedValue(over.member ?? false)} as any, email as any);
  return {db, provider, email, service, pays, settlements};
}

describe('at-home collection', () => {
  it('records provider dues at 10% when cash is collected at the door', async () => {
    const {db, service} = setup();
    const result = await service.ensureAtHomeCollection('req');
    expect(db.payment.create).toHaveBeenCalledWith({data: expect.objectContaining({serviceRequestId: 'req',
      amountPaisa: 200000, platformFeePaisa: 20000, professionalAmountPaisa: 180000,
      collectionMode: 'AT_HOME', status: 'COLLECTED_UNSETTLED', idempotencyKey: 'collect-req'})});
    expect(db.notification.createMany).toHaveBeenCalled();
    expect(result).toMatchObject({status: 'COLLECTED_UNSETTLED', collectionMode: 'AT_HOME'});
  });
  it('charges active members 7% on collected cash', async () => {
    const {db, service} = setup({member: true});
    db.payment.count.mockResolvedValue(4);
    await service.ensureAtHomeCollection('req');
    expect(db.payment.create.mock.calls[0][0].data).toMatchObject({platformFeePaisa: 14000, professionalAmountPaisa: 186000});
  });
  it('records a member first job of the month with zero commission', async () => {
    const {db, service} = setup({member: true});
    db.payment.count.mockResolvedValue(0);
    const result = await service.ensureAtHomeCollection('req');
    expect(result).toMatchObject({status: 'COLLECTED_UNSETTLED', platformFeePaisa: 0});
    expect(db.payment.create.mock.calls[0][0].data).toMatchObject({platformFeePaisa: 0, professionalAmountPaisa: 200000});
  });
  it('emails a direct-payment receipt to the client when cash is recorded', async () => {
    const {email, service} = setup({email: {}});
    await service.ensureAtHomeCollection('req');
    expect(email!.send).toHaveBeenCalledTimes(1);
    const message = email!.send.mock.calls[0][0];
    expect(message.to).toBe('client@example.com');
    expect(message.text).toContain('directly by upi');
    expect(message.text).toContain('₹2,000');
  });
  it('returns the existing row instead of double-recording', async () => {
    const existing = {id: 'pay-0', serviceRequestId: 'req', status: 'COLLECTED_UNSETTLED', amountPaisa: 200000,
      platformFeePaisa: 20000, professionalAmountPaisa: 180000, currency: 'INR', collectionMode: 'AT_HOME',
      providerOrderId: null, paidAt: null, releasedAt: null, refundedAt: null, settledAt: null};
    const {db, service} = setup({pays: [existing]});
    await service.ensureAtHomeCollection('req');
    expect(db.payment.create).not.toHaveBeenCalled();
  });
  it('ignores online bookings and rejects missing collection data', async () => {
    const {service} = setup({req: request({journey: journey({collectionMode: 'ONLINE'})})});
    await expect(service.ensureAtHomeCollection('req')).resolves.toBeNull();
    const missing = setup({req: request({journey: journey({collectedAmountPaisa: null})})});
    await expect(missing.service.ensureAtHomeCollection('req')).rejects.toThrow('Collection not recorded yet');
  });
  it('refuses online orders for pay-at-home bookings', async () => {
    const {service} = setup();
    await expect(service.createOrder('client', 'req')).rejects.toThrow('pay-at-home');
  });
});

describe('commission dues', () => {
  const unsettled = (id: string, fee: number) => ({id, professionalProfileId: 'prof', serviceRequestId: `req-${id}`,
    status: 'COLLECTED_UNSETTLED', amountPaisa: fee * 10, platformFeePaisa: fee, createdAt: new Date()});
  it('sums dues and flags the accept block at ₹500', async () => {
    const {service} = setup({pays: [unsettled('a', 20000), unsettled('b', 30000)]});
    await expect(service.dues('pro')).resolves.toMatchObject({duesPaisa: 50000, blocked: true,
      blockThresholdPaisa: DUES_BLOCK_Paisa, jobs: expect.arrayContaining([expect.objectContaining({id: 'a'})])});
    expect(DUES_BLOCK_Paisa).toBe(50000);
  });
  it('leaves small dues unblocked', async () => {
    const {service} = setup({pays: [unsettled('a', 20000)]});
    await expect(service.dues('pro')).resolves.toMatchObject({duesPaisa: 20000, blocked: false});
  });
  it('holds members to the ₹2,000 ceiling instead of ₹500', async () => {
    const active = {status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 86400000)};
    const member = setup({member: true, membership: active, pays: [unsettled('a', 60000)]});
    await expect(member.service.dues('pro')).resolves.toMatchObject({duesPaisa: 60000, blocked: false,
      blockThresholdPaisa: MEMBER_DUES_BLOCK_Paisa, isMember: true});
    expect(MEMBER_DUES_BLOCK_Paisa).toBe(200000);
    const over = setup({member: true, membership: active, pays: [unsettled('a', 200000)]});
    await expect(over.service.dues('pro')).resolves.toMatchObject({blocked: true});
    const lapsed = setup({membership: {status: 'EXPIRED', currentPeriodEnd: new Date(Date.now() - 1000)},
      pays: [unsettled('a', 60000)]});
    await expect(lapsed.service.dues('pro')).resolves.toMatchObject({blocked: true,
      blockThresholdPaisa: DUES_BLOCK_Paisa});
  });
  it('fails the dues ceiling closed to ₹500 without a membership row', async () => {
    await expect(duesLimitPaisa({membership: {findUnique: async () => null}}, 'prof')).resolves.toBe(DUES_BLOCK_Paisa);
    await expect(duesLimitPaisa({} as any, 'prof')).resolves.toBe(DUES_BLOCK_Paisa);
  });
  it('adds pending penalties to dues but keeps them out of savings', async () => {
    const {service} = setup({pays: [unsettled('a', 20000)],
      penalties: [{id: 'pen-1', serviceRequestId: 'req-a', amountPaisa: 5000, reason: 'LATE_ARRIVAL', createdAt: new Date()}]});
    await expect(service.dues('pro')).resolves.toMatchObject({duesPaisa: 25000, blocked: false,
      penalties: [expect.objectContaining({id: 'pen-1', reason: 'LATE_ARRIVAL'})],
      memberSavingsPaisa: 0});
  });
  it('posts an idempotent penalty with a pro notification', async () => {
    const {db, service} = setup({});
    const row = await service.postPenalty('prof', 'req', 5000, 'LATE_ARRIVAL');
    expect(row).toMatchObject({serviceRequestId: 'req', amountPaisa: 5000, reason: 'LATE_ARRIVAL'});
    expect(db.notification.create).toHaveBeenCalledWith(expect.objectContaining({data: expect.objectContaining({
      userId: 'pro', title: 'Late penalty added to dues'})}));
    db.professionalPenalty.create.mockRejectedValueOnce(Object.assign(new Error('taken'), {code: 'P2002'}));
    db.professionalPenalty.findUnique.mockResolvedValueOnce(row);
    await expect(service.postPenalty('prof', 'req', 5000, 'LATE_ARRIVAL')).resolves.toBe(row);
    db.professionalPenalty.create.mockRejectedValueOnce(new Error('db down'));
    await expect(service.postPenalty('prof', 'req', 2500, 'LATE_ACCEPT')).rejects.toThrow('db down');
  });
  it('settles penalties with the same dues order', async () => {
    const {db, provider, service} = setup({pays: [unsettled('a', 20000)],
      penalties: [{id: 'pen-1', amountPaisa: 5000}]});
    db.professionalPenalty.updateMany.mockResolvedValue({count: 1});
    const order = await service.createSettlementOrder('pro');
    expect(order).toMatchObject({amountPaisa: 25000});
    provider.fetchPayment.mockResolvedValue({status: 'captured', order_id: order.orderId, amount: 25000});
    const result = await service.verifySettlement('pro', {settlementId: order.settlementId,
      razorpayOrderId: order.orderId, razorpayPaymentId: 'pay_stl', razorpaySignature: 'a'.repeat(64)});
    expect(result).toMatchObject({settled: true, settledJobs: 1, settledPenalties: 1, amountPaisa: 25000});
    expect(db.professionalPenalty.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({data: expect.objectContaining({status: 'SETTLED'})}));
  });
  it('sums dues through the shared helper', async () => {
    const {db} = setup({pays: [unsettled('a', 20000), unsettled('b', 5000),
      {...unsettled('c', 99999), status: 'SETTLED'}]});
    await expect(unsettledDuesPaisa(db, 'prof')).resolves.toBe(25000);
  });
  it('shows members what the 7% rate saved versus the standard 10%', async () => {
    // ₹2000 and ₹1000 collected at home, billed at the 7% member rate.
    const {service} = setup({member: true, pays: [
      {id: 'a', professionalProfileId: 'prof', serviceRequestId: 'req-a', status: 'COLLECTED_UNSETTLED', amountPaisa: 200000, platformFeePaisa: 14000, createdAt: new Date()},
      {id: 'b', professionalProfileId: 'prof', serviceRequestId: 'req-b', status: 'COLLECTED_UNSETTLED', amountPaisa: 100000, platformFeePaisa: 7000, createdAt: new Date()},
    ]});
    await expect(service.dues('pro')).resolves.toMatchObject({duesPaisa: 21000, blocked: false, isMember: true, memberSavingsPaisa: 9000});
  });
  it('reports zero savings for non-members billed at the standard rate', async () => {
    const {service} = setup({pays: [unsettled('a', 20000)]});
    await expect(service.dues('pro')).resolves.toMatchObject({duesPaisa: 20000, isMember: false, memberSavingsPaisa: 0});
  });
});

describe('dues settlement', () => {
  const unsettled = (id: string, fee: number) => ({id, professionalProfileId: 'prof', serviceRequestId: `req-${id}`,
    status: 'COLLECTED_UNSETTLED', amountPaisa: fee * 10, platformFeePaisa: fee, createdAt: new Date()});
  it('refuses to settle with no dues', async () => {
    const {service} = setup();
    await expect(service.createSettlementOrder('pro')).rejects.toThrow('No commission dues');
  });
  it('creates one order for all dues and reuses it on retry', async () => {
    const {provider, service, settlements} = setup({pays: [unsettled('a', 20000), unsettled('b', 5000)]});
    const first = await service.createSettlementOrder('pro');
    expect(provider.createOrder).toHaveBeenCalledWith({amountPaisa: 25000, currency: 'INR',
      receipt: `stl-${first.settlementId}`,
      notes: {settlementId: first.settlementId, professionalProfileId: 'prof'}});
    const second = await service.createSettlementOrder('pro');
    expect(second.settlementId).toBe(first.settlementId);
    expect(provider.createOrder).toHaveBeenCalledTimes(1);
    expect(settlements).toHaveLength(1);
  });
  it('expires a stale open order when dues changed', async () => {
    const ctx = setup({pays: [unsettled('a', 20000)]});
    const first = await ctx.service.createSettlementOrder('pro');
    ctx.pays.push(unsettled('b', 5000));
    const second = await ctx.service.createSettlementOrder('pro');
    expect(second.settlementId).not.toBe(first.settlementId);
    expect(second.amountPaisa).toBe(25000);
    expect(ctx.settlements.find(s => s.id === first.settlementId).status).toBe('FAILED');
  });
  it('verifies a settlement and marks every job settled', async () => {
    const {db, provider, service} = setup({pays: [unsettled('a', 20000), unsettled('b', 5000)]});
    const order = await service.createSettlementOrder('pro');
    provider.fetchPayment.mockResolvedValue({status: 'captured', order_id: order.orderId, amount: 25000});
    const result = await service.verifySettlement('pro', {settlementId: order.settlementId,
      razorpayOrderId: order.orderId, razorpayPaymentId: 'pay_stl', razorpaySignature: 'a'.repeat(64)});
    expect(result).toMatchObject({settled: true, settledJobs: 2, amountPaisa: 25000});
    expect(db.payment.updateMany).toHaveBeenCalledWith({where: {id: {in: ['a', 'b']}, status: 'COLLECTED_UNSETTLED'},
      data: {status: 'SETTLED', settledAt: expect.any(Date)}});
    const again = await service.verifySettlement('pro', {settlementId: order.settlementId,
      razorpayOrderId: order.orderId, razorpayPaymentId: 'pay_stl', razorpaySignature: 'a'.repeat(64)});
    expect(again).toMatchObject({settled: true, duplicate: true});
  });
  it('settles the junction membership when present, snapshot otherwise (F-010)', async () => {
    const {db, provider, service} = setup({pays: [unsettled('a', 20000), unsettled('b', 5000)],
      links: [{paymentId: 'a'}]});
    const order = await service.createSettlementOrder('pro');
    // Junction write rides the same atomic create as the snapshot.
    expect(db.commissionSettlement.create).toHaveBeenCalledWith({data: expect.objectContaining({
      paymentIds: ['a', 'b'],
      settledPayments: {create: [{paymentId: 'a'}, {paymentId: 'b'}]},
    })});
    provider.fetchPayment.mockResolvedValue({status: 'captured', order_id: order.orderId, amount: 25000});
    const result = await service.verifySettlement('pro', {settlementId: order.settlementId,
      razorpayOrderId: order.orderId, razorpayPaymentId: 'pay_stl', razorpaySignature: 'a'.repeat(64)});
    expect(db.payment.updateMany).toHaveBeenCalledWith({where: {id: {in: ['a']}, status: 'COLLECTED_UNSETTLED'},
      data: {status: 'SETTLED', settledAt: expect.any(Date)}});
    expect(result).toMatchObject({settled: true, settledJobs: 1});
  });
  it('emails a settlement receipt to the professional after dues clear', async () => {
    const {email, provider, service} = setup({pays: [unsettled('a', 20000)], email: {},
      user: {email: 'pro@example.com', displayName: 'Pro'}});
    const order = await service.createSettlementOrder('pro');
    provider.fetchPayment.mockResolvedValue({status: 'captured', order_id: order.orderId, amount: 20000});
    await service.verifySettlement('pro', {settlementId: order.settlementId,
      razorpayOrderId: order.orderId, razorpayPaymentId: 'pay_stl', razorpaySignature: 'a'.repeat(64)});
    expect(email!.send).toHaveBeenCalledTimes(1);
    const message = email!.send.mock.calls[0][0];
    expect(message.to).toBe('pro@example.com');
    expect(message.subject).toContain('₹200');
    expect(message.text).toContain('New jobs are unlocked');
  });
  it('rejects bad signatures and amount mismatches', async () => {
    const {provider, service} = setup({pays: [unsettled('a', 20000)]});
    const order = await service.createSettlementOrder('pro');
    provider.verifyPaymentSignature.mockReturnValue(false);
    await expect(service.verifySettlement('pro', {settlementId: order.settlementId,
      razorpayOrderId: order.orderId, razorpayPaymentId: 'pay_x', razorpaySignature: 'b'.repeat(64)}))
      .rejects.toThrow('Invalid payment signature');
    provider.verifyPaymentSignature.mockReturnValue(true);
    provider.fetchPayment.mockResolvedValue({status: 'captured', order_id: order.orderId, amount: 1});
    await expect(service.verifySettlement('pro', {settlementId: order.settlementId,
      razorpayOrderId: order.orderId, razorpayPaymentId: 'pay_x', razorpaySignature: 'b'.repeat(64)}))
      .rejects.toThrow('amount mismatch');
  });
  it('refuses to verify a settlement outside ORDER_CREATED (F-006)', async () => {
    const {service} = setup({pays: [unsettled('a', 20000)], settlements: [{id: 'stl-0',
      professionalProfileId: 'prof', status: 'FAILED', providerOrderId: 'order_stl', providerPaymentId: null,
      amountPaisa: 20000, paymentIds: ['a']}]});
    await expect(service.verifySettlement('pro', {settlementId: 'stl-0',
      razorpayOrderId: 'order_stl', razorpayPaymentId: 'pay_x', razorpaySignature: 'c'.repeat(64)}))
      .rejects.toThrow('cannot be confirmed');
  });
});
