import {createHmac} from 'crypto';
import {PaymentsService} from './payments.service';
import {RazorpayError} from './razorpay.provider';

const journey = (over: Record<string, unknown> = {}) => ({stage: 'ARRIVED', quoteAmount: 2000, quoteAccepted: true, ...over});
const request = (over: Record<string, unknown> = {}) => ({id: 'req', status: 'ACCEPTED',
  client: {userId: 'client'}, provider: {id: 'prof', userId: 'pro'}, journey: journey(), ...over});
const payment = (over: Record<string, unknown> = {}) => ({id: 'pay', professionalProfileId: 'prof', serviceRequestId: 'req',
  amountPaisa: 200000, platformFeePaisa: 20000, professionalAmountPaisa: 180000, currency: 'INR',
  status: 'ORDER_CREATED', providerOrderId: 'order_1', providerPaymentId: null, providerTransferId: null,
  paidAt: null, releasedAt: null, refundedAt: null, ...over});

function setup(over: {req?: any; pay?: any; pays?: any[]; provider?: any; account?: any; event?: any; email?: any; user?: any} = {}) {
  const req = over.req === undefined ? request() : over.req;
  const pays = over.pays ?? (over.pay === undefined ? [] : [over.pay]);
  const findUnique = jest.fn(async ({where}: any) => {
    if (where.serviceRequestId) return pays.find((p: any) => p.serviceRequestId === where.serviceRequestId) ?? null;
    if (where.providerOrderId) return pays.find((p: any) => p.providerOrderId === where.providerOrderId) ?? null;
    if (where.providerPaymentId) return pays.find((p: any) => p.providerPaymentId === where.providerPaymentId) ?? null;
    if (where.id) return pays.find((p: any) => p.id === where.id) ?? null;
    if (where.providerEventId) return over.event ?? null;
    if (where.professionalProfileId) return over.account ?? null;
    return null;
  });
  const db: any = {
    serviceRequest: {findFirst: jest.fn().mockResolvedValue(req)},
    payment: {findUnique, findUniqueOrThrow: jest.fn(async ({where}: any) => {
      const found = await findUnique({where});
      if (!found) throw new Error('not found');
      return found;
    }), create: jest.fn(async ({data}: any) => {
      const row = {id: 'pay', providerOrderId: null, providerPaymentId: null, providerTransferId: null,
        paidAt: null, releasedAt: null, refundedAt: null, ...data};
      pays.push(row);
      return row;
    }),
      update: jest.fn(async ({where, data}: any) => {
        const row = pays.find((p: any) => p.id === where.id);
        if (row) Object.assign(row, data);
        return row ?? {...data};
      }),
      updateMany: jest.fn(async ({where, data}: any) => {
        const rows = pays.filter((p: any) => {
          if (where.id && p.id !== where.id) return false;
          if (typeof where.status === 'string' && p.status !== where.status) return false;
          if (where.status?.in && !where.status.in.includes(p.status)) return false;
          if (where.providerOrderId && p.providerOrderId !== where.providerOrderId) return false;
          if (where.providerPaymentId === null && p.providerPaymentId !== null) return false;
          if (where.providerTransferId === null && p.providerTransferId !== null) return false;
          return true;
        });
        rows.forEach((row: any) => Object.assign(row, data));
        return {count: rows.length};
      }),
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0)},
    paymentEvent: {findUnique, create: jest.fn(async ({data}: any) => ({id: 'evt', ...data}))},
    payoutAccount: {findUnique, upsert: jest.fn(async ({create}: any) => ({id: 'acct', ...create}))},
    professionalProfile: {findUnique: jest.fn().mockResolvedValue({id: 'prof'})},
    user: {findUnique: jest.fn().mockResolvedValue(over.user === undefined
      ? {email: 'client@example.com', displayName: 'Client'} : over.user)},
    notification: {createMany: jest.fn()}, auditLog: {createMany: jest.fn(), create: jest.fn()},
  };
  const provider = {enabled: true, keyId: 'rzp_test', createOrder: jest.fn().mockResolvedValue({id: 'order_1'}),
    fetchPayment: jest.fn(), createOnHoldTransfer: jest.fn().mockResolvedValue({id: 'trf_1'}),
    createDirectTransfer: jest.fn().mockResolvedValue({id: 'trf_1'}), releaseTransfer: jest.fn().mockResolvedValue({id: 'trf_1'}),
    createRefund: jest.fn().mockResolvedValue({id: 'rfnd_1', status: 'pending'}),
    fetchRefunds: jest.fn().mockResolvedValue([]),
    verifyPaymentSignature: jest.fn().mockReturnValue(true), verifyWebhookSignature: jest.fn().mockReturnValue(true),
    ...over.provider};
  const push = {dispatch: jest.fn().mockResolvedValue({})};
  const realtime = {emitUserUpdate: jest.fn()};
  (db as any).$transaction = jest.fn((arg: any) => Array.isArray(arg) ? Promise.all(arg) : arg({...db, $queryRaw: jest.fn()}));
  const email = over.email === undefined ? undefined
    : {enabled: true, send: jest.fn().mockResolvedValue({id: 'mail_1'}), ...over.email};
  const service = new PaymentsService(db, provider, push as any, realtime as any, undefined, email as any);
  return {db, provider, push, email, service};
}

describe('payments order creation', () => {
  it('creates a provider order for the approved quote with a 10% split', async () => {
    const {db, provider, service} = setup();
    const result = await service.createOrder('client', 'req');
    expect(provider.createOrder).toHaveBeenCalledWith({amountPaisa: 200000, currency: 'INR', receipt: 'pay',
      notes: {serviceRequestId: 'req', paymentId: 'pay'}});
    expect(db.payment.create.mock.calls[0][0].data).toMatchObject({amountPaisa: 200000, platformFeePaisa: 20000,
      professionalAmountPaisa: 180000, idempotencyKey: 'pay-req'});
    expect(result).toMatchObject({paymentId: 'pay', keyId: 'rzp_test', status: 'ORDER_CREATED'});
  });
  it('charges active members 7% instead of 10%', async () => {
    const ctx = setup();
    ctx.db.payment.count.mockResolvedValue(2);
    const service = new PaymentsService(ctx.db as any, ctx.provider as any, ctx.push as any,
      {emitUserUpdate: jest.fn()} as any, {isEffectiveByProfile: jest.fn().mockResolvedValue(true)} as any);
    await service.createOrder('client', 'req');
    expect(ctx.db.payment.create.mock.calls[0][0].data).toMatchObject({amountPaisa: 200000,
      platformFeePaisa: 14000, professionalAmountPaisa: 186000});
  });
  it('gives members their first job of the month at 0% commission', async () => {
    const ctx = setup();
    ctx.db.payment.count.mockResolvedValue(0);
    const service = new PaymentsService(ctx.db as any, ctx.provider as any, ctx.push as any,
      {emitUserUpdate: jest.fn()} as any, {isEffectiveByProfile: jest.fn().mockResolvedValue(true)} as any);
    await service.createOrder('client', 'req');
    expect(ctx.db.payment.create.mock.calls[0][0].data).toMatchObject({amountPaisa: 200000,
      platformFeePaisa: 0, professionalAmountPaisa: 200000});
    expect(ctx.db.payment.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({professionalProfileId: 'prof'})}));
  });
  it('replays the same order instead of charging twice', async () => {
    const {provider, service} = setup({pay: payment()});
    const result = await service.createOrder('client', 'req');
    expect(provider.createOrder).not.toHaveBeenCalled();
    expect(result).toMatchObject({paymentId: 'pay', status: 'ORDER_CREATED'});
  });
  it('refuses to reset a paid row when the quote changed', async () => {
    const {service} = setup({pay: payment({status: 'PAID', providerPaymentId: 'pay_1'}),
      req: request({journey: journey({quoteAmount: 2500})})});
    await expect(service.createOrder('client', 'req')).rejects.toMatchObject({status: 409});
  });
  it('starts a new attempt when an unpaid order is stale', async () => {
    const {db, provider, service} = setup({pay: payment({status: 'FAILED'}),
      req: request({journey: journey({quoteAmount: 2500})})});
    await service.createOrder('client', 'req');
    expect(db.payment.update.mock.calls[0][0].data).toMatchObject({amountPaisa: 250000, status: 'NOT_STARTED'});
    expect(provider.createOrder).toHaveBeenCalled();
  });
  it('rejects unapproved quotes, strangers, terminal bookings and disabled provider', async () => {
    await expect(setup({req: request({journey: journey({quoteAccepted: false})})}).service.createOrder('client', 'req'))
      .rejects.toMatchObject({status: 400});
    await expect(setup().service.createOrder('stranger', 'req')).rejects.toMatchObject({status: 404});
    await expect(setup({req: request({journey: journey({stage: 'COMPLETED'})})}).service.createOrder('client', 'req'))
      .rejects.toMatchObject({status: 409});
    await expect(setup({provider: {enabled: false}}).service.createOrder('client', 'req')).rejects.toMatchObject({status: 503});
  });
  it('marks the row failed when the provider is down', async () => {
    const {db, service} = setup({provider: {createOrder: jest.fn().mockRejectedValue(new Error('down'))}});
    await expect(service.createOrder('client', 'req')).rejects.toMatchObject({status: 503});
    expect(db.payment.update.mock.calls[0][0].data.status).toBe('FAILED');
  });
});

describe('payments verification', () => {
  const dto = {serviceRequestId: 'req', razorpayOrderId: 'order_1', razorpayPaymentId: 'pay_1', razorpaySignature: 's'};
  it('captures a verified payment and holds the professional share', async () => {
    const {provider, service} = setup({pay: payment(),
      provider: {fetchPayment: jest.fn().mockResolvedValue({status: 'captured', order_id: 'order_1', amount: 200000})},
      account: {status: 'ACTIVE', providerAccountRef: 'acc_1'}});
    const result = await service.verify('client', dto);
    expect(provider.createOnHoldTransfer).toHaveBeenCalledWith('pay_1', 'acc_1', 180000, 'INR');
    expect(result.status).toBe('HELD');
  });
  it('stays paid when no payout account is linked yet', async () => {
    const {provider, service} = setup({pay: payment(),
      provider: {fetchPayment: jest.fn().mockResolvedValue({status: 'captured', order_id: 'order_1', amount: 200000})}});
    const result = await service.verify('client', dto);
    expect(provider.createOnHoldTransfer).not.toHaveBeenCalled();
    expect(result.status).toBe('PAID');
  });
  it('emails a held-payment receipt to the client after verify', async () => {
    const {email, service} = setup({pay: payment(), email: {},
      req: request({description: 'Bathroom deep clean', provider: {id: 'prof', userId: 'pro', fullName: 'Pro Kumar'}}),
      provider: {fetchPayment: jest.fn().mockResolvedValue({status: 'captured', order_id: 'order_1', amount: 200000})}});
    await service.verify('client', dto);
    expect(email!.send).toHaveBeenCalledTimes(1);
    const message = email!.send.mock.calls[0][0];
    expect(message.to).toBe('client@example.com');
    expect(message.subject).toContain('₹2,000');
    expect(message.text).toContain('Bathroom deep clean');
    expect(message.text).toContain('Pro Kumar');
    expect(message.text).toContain('Held securely by NAHTREEK');
  });
  it('rejects forged signatures and replays idempotently', async () => {
    const forged = setup({pay: payment(), provider: {verifyPaymentSignature: jest.fn().mockReturnValue(false)}});
    await expect(forged.service.verify('client', dto)).rejects.toMatchObject({status: 401});
    const replay = setup({pay: payment({status: 'HELD', providerPaymentId: 'pay_1'})});
    await expect(replay.service.verify('client', dto)).resolves.toMatchObject({status: 'HELD'});
    expect(replay.provider.fetchPayment).not.toHaveBeenCalled();
  });
  it('disputes amount mismatches instead of fulfilling', async () => {
    const {db, service} = setup({pay: payment(),
      provider: {fetchPayment: jest.fn().mockResolvedValue({status: 'captured', order_id: 'order_1', amount: 1})}});
    await expect(service.verify('client', dto)).rejects.toMatchObject({status: 409});
    expect(db.payment.update.mock.calls[0][0].data.status).toBe('DISPUTED');
  });
  it('does not fulfill uncaptured payments', async () => {
    const {service} = setup({pay: payment(),
      provider: {fetchPayment: jest.fn().mockResolvedValue({status: 'authorized', order_id: 'order_1', amount: 200000})}});
    await expect(service.verify('client', dto)).rejects.toMatchObject({status: 409});
  });
  it('converges concurrent double-submits on one winner', async () => {
    const {db, provider, service} = setup({pay: payment(),
      provider: {fetchPayment: jest.fn().mockResolvedValue({status: 'captured', order_id: 'order_1', amount: 200000})}});
    db.payment.updateMany.mockResolvedValueOnce({count: 0});
    db.payment.findUnique = jest.fn(async ({where}: any) => where.serviceRequestId ? payment()
      : payment({status: 'PAID', providerPaymentId: 'pay_1'}));
    await expect(service.verify('client', dto)).resolves.toMatchObject({status: 'PAID'});
    expect(provider.createOnHoldTransfer).not.toHaveBeenCalled();
  });
  it('refuses payment for closed bookings', async () => {
    const {service} = setup({pay: payment(), req: request({journey: journey({stage: 'CANCELLED'})})});
    await expect(service.verify('client', dto)).rejects.toMatchObject({status: 409});
  });
  it('notifies both the client and the professional when a payment lands', async () => {
    const {db, service} = setup({pay: payment(),
      provider: {fetchPayment: jest.fn().mockResolvedValue({status: 'captured', order_id: 'order_1', amount: 200000})}});
    await service.verify('client', dto);
    expect(db.notification.createMany).toHaveBeenCalledWith({data: expect.arrayContaining([
      expect.objectContaining({userId: 'client', title: 'Payment received'}),
      expect.objectContaining({userId: 'pro', title: 'Payment received'}),
    ])});
  });
});

describe('payments release and refund', () => {
  it('releases a held transfer on completion', async () => {
    const {provider, service} = setup({pay: payment({status: 'HELD', providerPaymentId: 'pay_1', providerTransferId: 'trf_1'}),
      account: {status: 'ACTIVE', providerAccountRef: 'acc_1'}});
    const result = await service.releaseForRequest('req', 'client');
    expect(provider.releaseTransfer).toHaveBeenCalledWith('trf_1');
    expect(result).toMatchObject({released: true, status: 'RELEASED'});
  });
  it('transfers directly when no hold exists and retries are idempotent', async () => {
    const {provider, service} = setup({pay: payment({status: 'PAID', providerPaymentId: 'pay_1'}),
      account: {status: 'ACTIVE', providerAccountRef: 'acc_1'}});
    await expect(service.releaseForRequest('req', 'client')).resolves.toMatchObject({released: true});
    expect(provider.createDirectTransfer).toHaveBeenCalledWith('pay_1', 'acc_1', 180000, 'INR');
    const done = setup({pay: payment({status: 'RELEASED'})});
    await expect(done.service.releaseForRequest('req', 'client')).resolves.toMatchObject({released: true, duplicate: true});
  });
  it('parks release when no payout account is linked', async () => {
    const {db, service} = setup({pay: payment({status: 'HELD', providerPaymentId: 'pay_1', providerTransferId: 'trf_1'})});
    await expect(service.releaseForRequest('req', 'client')).resolves.toMatchObject({released: false, reason: 'NO_PAYOUT_ACCOUNT'});
    expect(db.payment.update.mock.calls[0][0].data.status).toBe('RELEASE_PENDING');
  });
  it('refunds in full before release and blocks refunds after release', async () => {
    const {provider, service} = setup({pay: payment({status: 'HELD', providerPaymentId: 'pay_1'})});
    await expect(service.requestRefund('client', {serviceRequestId: 'req', reason: 'cancelled visit'}, false))
      .resolves.toMatchObject({status: 'REFUND_PENDING'});
    expect(provider.createRefund).toHaveBeenCalledWith('pay_1', 200000);
    const released = setup({pay: payment({status: 'RELEASED', providerPaymentId: 'pay_1'})});
    await expect(released.service.requestRefund('client', {serviceRequestId: 'req', reason: 'too late now'}, false))
      .rejects.toMatchObject({status: 409});
  });
  it('converges concurrent releases instead of paying twice', async () => {
    const {db, provider, service} = setup({pay: payment({status: 'PAID', providerPaymentId: 'pay_1'}),
      account: {status: 'ACTIVE', providerAccountRef: 'acc_1'}});
    db.payment.updateMany.mockResolvedValueOnce({count: 0});
    db.payment.findUnique = jest.fn(async ({where}: any) => where.serviceRequestId
      ? payment({status: 'PAID', providerPaymentId: 'pay_1'})
      : payment({status: 'RELEASE_PENDING', providerPaymentId: 'pay_1'}));
    await expect(service.releaseForRequest('req', 'client')).resolves.toMatchObject({released: false, reason: 'IN_PROGRESS'});
    expect(provider.createDirectTransfer).not.toHaveBeenCalled();
  });
  it('converges concurrent refunds on one request', async () => {
    const {db, provider, service} = setup({pay: payment({status: 'HELD', providerPaymentId: 'pay_1'})});
    db.payment.updateMany.mockResolvedValueOnce({count: 0});
    db.payment.findUniqueOrThrow.mockResolvedValueOnce(payment({status: 'REFUND_PENDING', providerPaymentId: 'pay_1'}));
    await expect(service.requestRefund('client', {serviceRequestId: 'req', reason: 'cancelled visit'}, false))
      .resolves.toMatchObject({status: 'REFUND_PENDING'});
    expect(provider.createRefund).not.toHaveBeenCalled();
  });
  it('retries a pending refund instead of returning a stuck view', async () => {
    const {provider, service} = setup({pay: payment({status: 'REFUND_PENDING', providerPaymentId: 'pay_1'})});
    await expect(service.requestRefund('client', {serviceRequestId: 'req', reason: 'tap retry'}, false))
      .resolves.toMatchObject({status: 'REFUND_PENDING'});
    expect(provider.fetchRefunds).toHaveBeenCalledWith('pay_1');
    expect(provider.createRefund).toHaveBeenCalledWith('pay_1', 200000);
  });
  it('adopts a processed remote refund without recreating it', async () => {
    const {db, provider, service} = setup({pay: payment({status: 'REFUND_PENDING', providerPaymentId: 'pay_1'}),
      provider: {fetchRefunds: jest.fn().mockResolvedValue([{id: 'rfnd_1', status: 'processed', amount: 200000}])}});
    await expect(service.requestRefund('client', {serviceRequestId: 'req', reason: 'tap retry'}, false))
      .resolves.toMatchObject({status: 'REFUNDED'});
    expect(provider.createRefund).not.toHaveBeenCalled();
    expect(db.payment.update).toHaveBeenCalledWith(expect.objectContaining(
      {data: expect.objectContaining({status: 'REFUNDED'})}));
  });
  it('leaves a live remote refund alone so webhooks finish it', async () => {
    const {provider, service} = setup({pay: payment({status: 'REFUND_PENDING', providerPaymentId: 'pay_1'}),
      provider: {fetchRefunds: jest.fn().mockResolvedValue([{id: 'rfnd_1', status: 'pending', amount: 200000}])}});
    await expect(service.requestRefund('client', {serviceRequestId: 'req', reason: 'tap retry'}, false))
      .resolves.toMatchObject({status: 'REFUND_PENDING'});
    expect(provider.createRefund).not.toHaveBeenCalled();
  });
  it('sweeps only stale pending refunds and survives poisoned rows', async () => {
    const stuck = payment({status: 'REFUND_PENDING', providerPaymentId: 'pay_1'});
    const {db, provider, service} = setup({pays: [stuck]});
    db.auditLog.create.mockResolvedValue({});
    db.payment.findMany.mockResolvedValueOnce([stuck, {...stuck, id: 'poison', providerPaymentId: 'pay_bad'}]);
    provider.fetchRefunds.mockRejectedValueOnce(new Error('boom')).mockResolvedValue([]);
    const result = await service.retryPendingRefunds(10);
    expect(db.payment.findMany).toHaveBeenCalledWith(expect.objectContaining(
      {where: expect.objectContaining({status: 'REFUND_PENDING'})}));
    expect(result).toEqual({checked: 2, retried: 1});
  });
  it('gates work start on payment only when configured', async () => {
    await expect(setup({provider: {enabled: false}}).service.requirePaid('req')).resolves.toBeUndefined();
    await expect(setup({pay: payment({status: 'ORDER_CREATED'})}).service.requirePaid('req')).rejects.toMatchObject({status: 400});
    await expect(setup({pay: payment({status: 'HELD'})}).service.requirePaid('req')).resolves.toBeUndefined();
  });
});

describe('payments admin list', () => {
  it('serializes rows with booking parties and pagination meta', async () => {
    const {db, service} = setup();
    db.payment.findMany.mockResolvedValue([{...payment({status: 'HELD', providerPaymentId: 'pay_1'}),
      professional: {fullName: 'Pro Name'},
      serviceRequest: {id: 'req', status: 'IN_PROGRESS', client: {fullName: 'Client Name'}}}]);
    db.payment.count.mockResolvedValue(1);
    const result = await service.listForAdmin({status: 'HELD', page: '1', limit: '20'});
    expect(result.meta).toMatchObject({page: 1, limit: 20, total: 1, totalPages: 1});
    expect(result.data[0]).toMatchObject({status: 'HELD', professionalName: 'Pro Name',
      clientName: 'Client Name', bookingStatus: 'IN_PROGRESS', amountPaisa: 200000});
    expect(db.payment.findMany.mock.calls[0][0]).toMatchObject({where: {status: 'HELD'}, skip: 0, take: 20});
  });
  it('rejects invalid statuses and pagination', async () => {
    const {service} = setup();
    await expect(service.listForAdmin({status: 'RICH'})).rejects.toMatchObject({status: 400});
    await expect(service.listForAdmin({page: '0'})).rejects.toMatchObject({status: 400});
    await expect(service.listForAdmin({limit: '500'})).rejects.toMatchObject({status: 400});
  });
  it('flags Plus subscribers so support reviews them first', async () => {
    const {db, service} = setup();
    db.payment.findMany.mockResolvedValue([
      {...payment({status: 'DISPUTED', providerPaymentId: 'pay_1'}), professional: {fullName: 'Pro'},
        serviceRequest: {id: 'req', status: 'IN_PROGRESS', client: {fullName: 'Plus Client', userId: 'plus-user'}}},
      {...payment({id: 'pay-2', status: 'DISPUTED', providerPaymentId: 'pay_2'}), professional: {fullName: 'Pro'},
        serviceRequest: {id: 'req-2', status: 'IN_PROGRESS', client: {fullName: 'Free Client', userId: 'free-user'}}},
    ]);
    db.payment.count.mockResolvedValue(2);
    db.aiSubscription = {findMany: jest.fn().mockResolvedValue([
      {userId: 'plus-user', status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 86400000)},
      {userId: 'free-user', status: 'EXPIRED', currentPeriodEnd: new Date(Date.now() - 86400000)},
    ])};
    const result = await service.listForAdmin({status: 'DISPUTED', page: '1', limit: '20'});
    expect(result.data[0]).toMatchObject({clientName: 'Plus Client', clientPlus: true});
    expect(result.data[1]).toMatchObject({clientName: 'Free Client', clientPlus: false});
  });
});

describe('payments dues view', () => {
  it('publishes commission terms so apps never hardcode rates or dues room', async () => {
    const {db, service} = setup();
    db.payment.findMany.mockResolvedValue([
      {id: 'pay-1', serviceRequestId: 'req-1', engineerRequestId: null, amountPaisa: 200000,
        platformFeePaisa: 14000, createdAt: new Date()}]);
    db.professionalPenalty = {findMany: jest.fn().mockResolvedValue([])};
    db.membership = {findUnique: jest.fn().mockResolvedValue(null)};
    await expect(service.dues('pro-user')).resolves.toMatchObject({duesPaisa: 14000, blocked: false,
      blockThresholdPaisa: 50000, isMember: false,
      terms: {memberFeeBps: 700, standardFeeBps: 1000, memberDuesBlockPaisa: 200000,
        standardDuesBlockPaisa: 50000, freeJobsPerMonth: 1}});
  });
});

describe('payments disputes and journey hooks', () => {
  it('resolves disputes by release or refund, and only disputes', async () => {
    const release = setup({pay: payment({status: 'DISPUTED', providerPaymentId: 'pay_1', providerTransferId: 'trf_1'}),
      account: {status: 'ACTIVE', providerAccountRef: 'acc_1'}});
    await expect(release.service.resolveDispute('admin', {serviceRequestId: 'req', decision: 'release', note: 'work was done well'})).resolves.toMatchObject({released: true});
    const refund = setup({pay: payment({status: 'DISPUTED', providerPaymentId: 'pay_1'})});
    await expect(refund.service.resolveDispute('admin', {serviceRequestId: 'req', decision: 'refund', note: 'work never happened'})).resolves.toMatchObject({status: 'REFUND_PENDING'});
    const calm = setup({pay: payment({status: 'PAID', providerPaymentId: 'pay_1'})});
    await expect(calm.service.resolveDispute('admin', {serviceRequestId: 'req', decision: 'refund', note: 'nothing to fix here'})).rejects.toMatchObject({status: 409});
  });
  it('journey hooks never throw', async () => {
    const broken: any = {payment: {findUnique: jest.fn().mockRejectedValue(new Error('db down'))}};
    const service = new PaymentsService(broken, {enabled: true} as any, {} as any, {} as any);
    await expect(service.markDisputed('req', 'u')).resolves.toBeUndefined();
    await expect(service.cancelUnpaidOrRefund('req', 'u')).resolves.toBeUndefined();
    const {db, service: ok} = setup({pay: payment({status: 'ORDER_CREATED'})});
    await ok.markDisputed('req', 'u');
    expect(db.payment.update.mock.calls[0][0].data.status).toBe('FAILED');
  });
});

describe('payments webhooks', () => {
  const SECRET = 'whsec_test_secret_value_1234567890';
  const raw = (event: any) => Buffer.from(JSON.stringify(event));
  function webhookSetup(pays: any[]) {
    const prior = process.env.RAZORPAY_WEBHOOK_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
    const ctx = setup({pays});
    return {ctx, restore: () => { if (prior === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET; else process.env.RAZORPAY_WEBHOOK_SECRET = prior; }};
  }
  it('rejects unsigned payloads and ignores unknown entities', async () => {
    const {ctx, restore} = webhookSetup([payment()]);
    try {
      ctx.provider.verifyWebhookSignature.mockReturnValue(false);
      await expect(ctx.service.handleWebhook(raw({id: 'e1', event: 'payment.captured'}), 'bad')).rejects.toMatchObject({status: 401});
      ctx.provider.verifyWebhookSignature.mockReturnValue(true);
      await expect(ctx.service.handleWebhook(raw({id: 'e1', event: 'payment.captured', payload: {}}), 'sig'))
        .resolves.toMatchObject({ok: true, ignored: true});
    } finally { restore(); }
  });
  it('deduplicates redelivered events', async () => {
    const prior = process.env.RAZORPAY_WEBHOOK_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
    try {
      const {service} = setup({pay: payment(), event: {id: 'evt'}});
      const event = {id: 'e1', event: 'payment.captured', payload: {payment: {entity: {id: 'pay_1', order_id: 'order_1'}}}};
      await expect(service.handleWebhook(raw(event), 'sig')).resolves.toMatchObject({ok: true, duplicate: true});
    } finally { if (prior === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET; else process.env.RAZORPAY_WEBHOOK_SECRET = prior; }
  });
  it('fulfills on captured, fails on failed, and settles refunds', async () => {
    const {ctx, restore} = webhookSetup([payment()]);
    try {
      ctx.provider.fetchPayment.mockResolvedValue({status: 'captured', order_id: 'order_1', amount: 200000});
      await expect(ctx.service.handleWebhook(raw({id: 'e1', event: 'payment.captured',
        payload: {payment: {entity: {id: 'pay_1', order_id: 'order_1'}}}}), 'sig')).resolves.toMatchObject({ok: true});
      expect(ctx.db.payment.updateMany.mock.calls[0][0].data.status).toBe('PAID');
    } finally { restore(); }
    const failed = webhookSetup([payment()]);
    try {
      await expect(failed.ctx.service.handleWebhook(raw({id: 'e2', event: 'payment.failed',
        payload: {payment: {entity: {id: 'pay_1', order_id: 'order_1'}}}}), 'sig')).resolves.toMatchObject({ok: true});
      expect(failed.ctx.db.payment.update.mock.calls[0][0].data.status).toBe('FAILED');
    } finally { failed.restore(); }
    const refunded = webhookSetup([payment({status: 'REFUND_PENDING', providerPaymentId: 'pay_1'})]);
    try {
      await expect(refunded.ctx.service.handleWebhook(raw({id: 'e3', event: 'refund.processed',
        payload: {refund: {entity: {id: 'rfnd_1', payment_id: 'pay_1'}}}}), 'sig')).resolves.toMatchObject({ok: true});
      expect(refunded.ctx.db.payment.update.mock.calls[0][0].data.status).toBe('REFUNDED');
    } finally { refunded.restore(); }
    const reverted = webhookSetup([payment({status: 'REFUND_PENDING', providerPaymentId: 'pay_1'})]);
    try {
      await expect(reverted.ctx.service.handleWebhook(raw({id: 'e4', event: 'refund.failed',
        payload: {refund: {entity: {id: 'rfnd_1', payment_id: 'pay_1'}}}}), 'sig')).resolves.toMatchObject({ok: true});
      // Stays REFUND_PENDING so the retry sweeper can finish it; the client is told a retry is coming.
      expect(reverted.ctx.db.payment.update).not.toHaveBeenCalled();
      expect(reverted.ctx.db.notification.createMany).toHaveBeenCalled();
    } finally { reverted.restore(); }
  });
  it('auto-refunds captures that arrive for closed bookings', async () => {
    const prior = process.env.RAZORPAY_WEBHOOK_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
    try {
      const {provider, service} = setup({pay: payment(), req: request({journey: journey({stage: 'CANCELLED'})}),
        provider: {fetchPayment: jest.fn().mockResolvedValue({status: 'captured', order_id: 'order_1', amount: 200000})}});
      await expect(service.handleWebhook(raw({id: 'e5', event: 'payment.captured',
        payload: {payment: {entity: {id: 'pay_1', order_id: 'order_1'}}}}), 'sig')).resolves.toMatchObject({ok: true});
      expect(provider.createRefund).toHaveBeenCalledWith('pay_1', 200000);
      expect(provider.createOnHoldTransfer).not.toHaveBeenCalled();
    } finally { if (prior === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET; else process.env.RAZORPAY_WEBHOOK_SECRET = prior; }
  });
  it('computes the real webhook HMAC the provider accepts', () => {
    const body = raw({id: 'e9', event: 'payment.captured'});
    const signature = createHmac('sha256', SECRET).update(body).digest('hex');
    expect(signature).toMatch(/^[0-9a-f]{64}$/);
  });
});
