import {Prisma} from '@prisma/client';
import {PaymentsService} from './payments.service';

const engRequest = (over: Record<string, unknown> = {}) => ({id: 'eng-req', status: 'COMPLETED',
  client: {userId: 'client'},
  engineer: {professionalProfileId: 'prof', consultationFeePaisa: 350000, profile: {userId: 'eng-user'}}, ...over});
const payment = (over: Record<string, unknown> = {}) => ({id: 'pay', professionalProfileId: 'prof',
  serviceRequestId: null, engineerRequestId: 'eng-req',
  amountPaisa: 350000, platformFeePaisa: 35000, professionalAmountPaisa: 315000, currency: 'INR',
  status: 'ORDER_CREATED', providerOrderId: 'order_1', providerPaymentId: null, providerTransferId: null,
  paidAt: null, releasedAt: null, refundedAt: null, collectionMode: 'ONLINE', settledAt: null, ...over});

function setup(over: {req?: any; sreq?: any; pay?: any; pays?: any[]; provider?: any; account?: any; event?: any; member?: boolean; email?: any; user?: any; plus?: any} = {}) {
  const req = over.req === undefined ? engRequest() : over.req;
  const pays = over.pays ?? (over.pay === undefined ? [] : [over.pay]);
  const findUnique = jest.fn(async ({where}: any) => {
    if (where.serviceRequestId) return pays.find((p: any) => p.serviceRequestId === where.serviceRequestId) ?? null;
    if (where.engineerRequestId) return pays.find((p: any) => p.engineerRequestId === where.engineerRequestId) ?? null;
    if (where.providerOrderId) return pays.find((p: any) => p.providerOrderId === where.providerOrderId) ?? null;
    if (where.providerPaymentId) return pays.find((p: any) => p.providerPaymentId === where.providerPaymentId) ?? null;
    if (where.id) return pays.find((p: any) => p.id === where.id) ?? null;
    if (where.providerEventId) return over.event ?? null;
    if (where.professionalProfileId) return over.account ?? null;
    return null;
  });
  const db: any = {
    engineerRequest: {findFirst: jest.fn().mockResolvedValue(req)},
    serviceRequest: {findFirst: jest.fn().mockResolvedValue(over.sreq ?? null)},
    payment: {findUnique, findUniqueOrThrow: jest.fn(async ({where}: any) => {
      const found = await findUnique({where});
      if (!found) throw new Error('not found');
      return found;
    }), create: jest.fn(async ({data}: any) => {
      const row = {id: 'pay', serviceRequestId: null, engineerRequestId: null, providerOrderId: null,
        providerPaymentId: null, providerTransferId: null, paidAt: null, releasedAt: null, refundedAt: null,
        collectionMode: 'ONLINE', settledAt: null, ...data};
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
    aiSubscription: {findUnique: jest.fn().mockResolvedValue(over.plus === undefined ? null
      : over.plus === true ? {status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 86400000)} : over.plus)},
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
  const memberships = {isEffectiveByProfile: jest.fn().mockResolvedValue(over.member ?? false)};
  const email = over.email === undefined ? undefined
    : {enabled: true, send: jest.fn().mockResolvedValue({id: 'mail_1'}), ...over.email};
  const service = new PaymentsService(db, provider, push as any, realtime as any, memberships as any, email as any);
  return {db, provider, push, realtime, email, service};
}

describe('engineer consultation order creation', () => {
  it('creates a provider order for the consultation fee with a 10% split', async () => {
    const {db, provider, service} = setup();
    const result = await service.createEngineerOrder('client', 'eng-req');
    expect(provider.createOrder).toHaveBeenCalledWith({amountPaisa: 350000, currency: 'INR', receipt: 'pay',
      notes: {engineerRequestId: 'eng-req', paymentId: 'pay'}});
    expect(db.payment.create).toHaveBeenCalledWith(expect.objectContaining({data: expect.objectContaining({
      engineerRequestId: 'eng-req', amountPaisa: 350000, platformFeePaisa: 35000,
      professionalAmountPaisa: 315000, idempotencyKey: 'pay-eng-eng-req'})}));
    expect(result).toMatchObject({paymentId: 'pay', keyId: 'rzp_test', status: 'ORDER_CREATED', amountPaisa: 350000});
  });

  it('charges members the 7% commission rate', async () => {
    const {db, service} = setup({member: true});
    db.payment.count.mockResolvedValue(3);
    await service.createEngineerOrder('client', 'eng-req');
    expect(db.payment.create).toHaveBeenCalledWith(expect.objectContaining({data: expect.objectContaining({
      platformFeePaisa: 24500, professionalAmountPaisa: 325500})}));
  });

  it('gives members their first consultation of the month at 0% commission', async () => {
    const {db, service} = setup({member: true});
    db.payment.count.mockResolvedValue(0);
    await service.createEngineerOrder('client', 'eng-req');
    expect(db.payment.create).toHaveBeenCalledWith(expect.objectContaining({data: expect.objectContaining({
      platformFeePaisa: 0, professionalAmountPaisa: 350000})}));
  });

  it('gives Plus clients 2% off, funded from commission with the pro share whole', async () => {
    const {db, service} = setup({plus: true});
    const result = await service.createEngineerOrder('client', 'eng-req');
    // ₹3,500 → ₹70 off: client pays ₹3,430, commission drops ₹350 → ₹280,
    // engineer still gets ₹3,150.
    expect(result).toMatchObject({amountPaisa: 343000, platformFeePaisa: 28000,
      professionalAmountPaisa: 315000, plusDiscountPaisa: 7000});
    expect(db.payment.create).toHaveBeenCalledWith(expect.objectContaining({data: expect.objectContaining({
      amountPaisa: 343000, platformFeePaisa: 28000, professionalAmountPaisa: 315000})}));
  });

  it('caps the Plus discount at ₹100 and skips it for non-Plus clients', async () => {
    const big = setup({plus: true, req: engRequest({engineer: {professionalProfileId: 'prof',
      consultationFeePaisa: 1000000, profile: {userId: 'eng-user'}}})});
    const capped = await big.service.createEngineerOrder('client', 'eng-req');
    expect(capped).toMatchObject({amountPaisa: 990000, plusDiscountPaisa: 10000});
    const plain = setup({});
    const full = await plain.service.createEngineerOrder('client', 'eng-req');
    expect(full).toMatchObject({amountPaisa: 350000, plusDiscountPaisa: 0});
  });

  it('stays payable through completion but never before acceptance or after terminal states', async () => {
    for (const status of ['ACCEPTED', 'IN_PROGRESS', 'COMPLETED']) {
      const ok = setup({req: engRequest({status})});
      await expect(ok.service.createEngineerOrder('client', 'eng-req')).resolves.toMatchObject({status: 'ORDER_CREATED'});
    }
    const pending = setup({req: engRequest({status: 'PENDING'})});
    await expect(pending.service.createEngineerOrder('client', 'eng-req')).rejects.toMatchObject({status: 400});
    for (const status of ['CANCELLED', 'DECLINED']) {
      const closed = setup({req: engRequest({status})});
      await expect(closed.service.createEngineerOrder('client', 'eng-req')).rejects.toMatchObject({status: 409});
    }
  });

  it('rejects missing fees, sub-minimum fees, and strangers', async () => {
    const noFee = setup({req: engRequest({engineer: {professionalProfileId: 'prof', consultationFeePaisa: null, profile: {userId: 'eng-user'}}})});
    await expect(noFee.service.createEngineerOrder('client', 'eng-req')).rejects.toMatchObject({status: 400});
    const tiny = setup({req: engRequest({engineer: {professionalProfileId: 'prof', consultationFeePaisa: 50, profile: {userId: 'eng-user'}}})});
    await expect(tiny.service.createEngineerOrder('client', 'eng-req')).rejects.toMatchObject({status: 400});
    const {service} = setup();
    await expect(service.createEngineerOrder('stranger', 'eng-req')).rejects.toMatchObject({status: 404});
  });

  it('reuses an open order but never resets money that moved', async () => {
    const open = setup({pay: payment()});
    open.provider.createOrder.mockClear();
    await expect(open.service.createEngineerOrder('client', 'eng-req')).resolves.toMatchObject({status: 'ORDER_CREATED'});
    expect(open.provider.createOrder).not.toHaveBeenCalled();
    const moved = setup({pay: payment({status: 'HELD', providerPaymentId: 'pay_1'}),
      req: engRequest({engineer: {professionalProfileId: 'prof', consultationFeePaisa: 400000, profile: {userId: 'eng-user'}}})});
    await expect(moved.service.createEngineerOrder('client', 'eng-req')).rejects.toMatchObject({status: 409});
  });
});

describe('engineer consultation verification and view', () => {
  const dto = (over: Record<string, unknown> = {}) => ({engineerRequestId: 'eng-req',
    razorpayOrderId: 'order_1', razorpayPaymentId: 'pay_1', razorpaySignature: 'a'.repeat(64), ...over});

  it('confirms a captured consultation fee on a completed booking', async () => {
    const {db, realtime, service} = setup({pay: payment()});
    const provider = (service as any).provider;
    provider.fetchPayment.mockResolvedValue({status: 'captured', order_id: 'order_1', amount: 350000});
    const result = await service.verify('client', dto() as any);
    expect(result).toMatchObject({status: 'PAID', amountPaisa: 350000});
    expect(db.notification.createMany).toHaveBeenCalled();
    expect(realtime.emitUserUpdate).toHaveBeenCalledWith('client', 'requests');
    expect(realtime.emitUserUpdate).toHaveBeenCalledWith('eng-user', 'requests');
  });

  it('rejects closed bookings, bad signatures, and amount mismatches', async () => {
    const closed = setup({pay: payment(), req: engRequest({status: 'CANCELLED'})});
    await expect(closed.service.verify('client', dto() as any)).rejects.toMatchObject({status: 409});
    const badSig = setup({pay: payment()});
    (badSig.service as any).provider.verifyPaymentSignature.mockReturnValue(false);
    await expect(badSig.service.verify('client', dto() as any)).rejects.toMatchObject({status: 401});
    const mismatch = setup({pay: payment()});
    (mismatch.service as any).provider.fetchPayment.mockResolvedValue({status: 'captured', order_id: 'order_1', amount: 100});
    await expect(mismatch.service.verify('client', dto() as any)).rejects.toMatchObject({status: 409});
    expect(mismatch.db.payment.update).toHaveBeenCalledWith(expect.objectContaining({data: {status: 'DISPUTED'}}));
  });

  it('emails a held-payment receipt to the client after verify', async () => {
    const titled = engRequest({projectTitle: 'Structural site visit',
      engineer: {professionalProfileId: 'prof', consultationFeePaisa: 350000, profile: {userId: 'eng-user', fullName: 'Eng Rao'}}});
    const {email, service} = setup({pay: payment(), req: titled, email: {}});
    (service as any).provider.fetchPayment.mockResolvedValue({status: 'captured', order_id: 'order_1', amount: 350000});
    await service.verify('client', dto() as any);
    expect(email!.send).toHaveBeenCalledTimes(1);
    const message = email!.send.mock.calls[0][0];
    expect(message.to).toBe('client@example.com');
    expect(message.subject).toContain('₹3,500');
    expect(message.subject).toContain('Structural site visit');
    expect(message.text).toContain('Held securely by NAHTREEK');
    expect(message.text).toContain('pay_1');
  });

  it('skips the receipt silently when the client has no email, and survives mailer failure', async () => {
    const noMail = setup({pay: payment(), email: {}, user: null});
    (noMail.service as any).provider.fetchPayment.mockResolvedValue({status: 'captured', order_id: 'order_1', amount: 350000});
    await expect(noMail.service.verify('client', dto() as any)).resolves.toMatchObject({status: 'PAID'});
    expect(noMail.email!.send).not.toHaveBeenCalled();
    const failing = setup({pay: payment(), email: {send: jest.fn().mockRejectedValue(new Error('mail down'))}});
    (failing.service as any).provider.fetchPayment.mockResolvedValue({status: 'captured', order_id: 'order_1', amount: 350000});
    await expect(failing.service.verify('client', dto() as any)).resolves.toMatchObject({status: 'PAID'});
  });

  it('rejects verify payloads that address zero or two bookings', async () => {
    const {service} = setup({pay: payment()});
    await expect(service.verify('client', {razorpayOrderId: 'o', razorpayPaymentId: 'p', razorpaySignature: 'a'.repeat(64)} as any))
      .rejects.toMatchObject({status: 400});
    await expect(service.verify('client', {...dto(), serviceRequestId: 'req'} as any)).rejects.toMatchObject({status: 400});
  });

  it('shows payment status to both parties but nobody else', async () => {
    const {service} = setup({pay: payment({status: 'HELD', providerPaymentId: 'pay_1'})});
    await expect(service.viewEngineer('client', 'eng-req', false)).resolves.toMatchObject({status: 'HELD'});
    await expect(service.viewEngineer('eng-user', 'eng-req', false)).resolves.toMatchObject({status: 'HELD'});
    await expect(service.viewEngineer('stranger', 'eng-req', false)).rejects.toMatchObject({status: 404});
    const empty = setup();
    await expect(empty.service.viewEngineer('client', 'eng-req', false)).rejects.toMatchObject({status: 404});
  });
});

describe('engineer consultation release, refund, and cancel hooks', () => {
  it('releases the engineer share and parks release without a payout account', async () => {
    const held = setup({pay: payment({status: 'HELD', providerPaymentId: 'pay_1', providerTransferId: 'trf_1'}),
      account: {status: 'ACTIVE', providerAccountRef: 'acc_1'}});
    await expect(held.service.releaseForEngineerRequest('eng-req', 'admin')).resolves.toMatchObject({released: true, status: 'RELEASED'});
    expect(held.provider.releaseTransfer).toHaveBeenCalledWith('trf_1');
    expect(held.realtime.emitUserUpdate).toHaveBeenCalledWith('eng-user', 'requests');
    const nopay = setup({pay: payment({status: 'HELD', providerPaymentId: 'pay_1', providerTransferId: 'trf_1'})});
    await expect(nopay.service.releaseForEngineerRequest('eng-req', 'admin'))
      .resolves.toMatchObject({released: false, reason: 'NO_PAYOUT_ACCOUNT'});
  });

  it('refunds captured fees and resolves disputes by release or refund', async () => {
    const paid = setup({pay: payment({status: 'PAID', providerPaymentId: 'pay_1'})});
    await expect(paid.service.requestRefund('client', {engineerRequestId: 'eng-req', reason: 'visit never happened'}, false))
      .resolves.toMatchObject({status: 'REFUND_PENDING'});
    const released = setup({pay: payment({status: 'RELEASED', providerPaymentId: 'pay_1'})});
    await expect(released.service.requestRefund('client', {engineerRequestId: 'eng-req', reason: 'too late for this one'}, false))
      .rejects.toMatchObject({status: 409});
    const rel = setup({pay: payment({status: 'DISPUTED', providerPaymentId: 'pay_1', providerTransferId: 'trf_1'}),
      account: {status: 'ACTIVE', providerAccountRef: 'acc_1'}});
    await expect(rel.service.resolveDispute('admin', {engineerRequestId: 'eng-req', decision: 'release', note: 'work was done well'}))
      .resolves.toMatchObject({released: true});
    const ref = setup({pay: payment({status: 'DISPUTED', providerPaymentId: 'pay_1'})});
    await expect(ref.service.resolveDispute('admin', {engineerRequestId: 'eng-req', decision: 'refund', note: 'work never happened'}))
      .resolves.toMatchObject({status: 'REFUND_PENDING'});
  });

  it('fails cancellation safe: voids unpaid orders, refunds captured fees, never throws', async () => {
    const broken: any = {payment: {findUnique: jest.fn().mockRejectedValue(new Error('db down'))}};
    const service = new PaymentsService(broken, {enabled: true} as any, {} as any, {} as any);
    await expect(service.cancelUnpaidOrRefundEngineer('eng-req', 'u')).resolves.toBeUndefined();
    const {db, service: ok} = setup({pay: payment({status: 'ORDER_CREATED'})});
    await ok.cancelUnpaidOrRefundEngineer('eng-req', 'u');
    expect(db.payment.update.mock.calls[0][0].data.status).toBe('FAILED');
    const captured = setup({pay: payment({status: 'PAID', providerPaymentId: 'pay_1'})});
    await captured.service.cancelUnpaidOrRefundEngineer('eng-req', 'client');
    expect(captured.db.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({data: {status: 'REFUND_PENDING'}}));
  });
});

describe('engineer direct collection', () => {
  it('posts commission dues on declared cash and notifies both parties', async () => {
    const {db, realtime, service} = setup();
    const result = await service.declareEngineerCollection('eng-user',
      {engineerRequestId: 'eng-req', amount: 3500, method: 'CASH'});
    expect(db.payment.create).toHaveBeenCalledWith(expect.objectContaining({data: expect.objectContaining({
      engineerRequestId: 'eng-req', amountPaisa: 350000, platformFeePaisa: 35000,
      professionalAmountPaisa: 315000, collectionMode: 'AT_HOME',
      status: 'COLLECTED_UNSETTLED'})}));
    // Regression guard: every written key must exist on the real Payment model.
    // Mocks accept phantom fields; Postgres 500s on them (live declare outage).
    const written = db.payment.create.mock.calls[0][0].data;
    const scalars = new Set(Object.values(Prisma.PaymentScalarFieldEnum));
    for (const key of Object.keys(written)) expect(scalars.has(key as never)).toBe(true);
    expect(result).toMatchObject({status: 'COLLECTED_UNSETTLED', amountPaisa: 350000});
    expect(realtime.emitUserUpdate).toHaveBeenCalledWith('client', 'requests');
    expect(realtime.emitUserUpdate).toHaveBeenCalledWith('eng-user', 'requests');
  });

  it('bills members at 7% on declared cash', async () => {
    const {db, service} = setup({member: true});
    db.payment.count.mockResolvedValue(1);
    await service.declareEngineerCollection('eng-user', {engineerRequestId: 'eng-req', amount: 3500, method: 'UPI'});
    expect(db.payment.create).toHaveBeenCalledWith(expect.objectContaining({data: expect.objectContaining({
      platformFeePaisa: 24500, professionalAmountPaisa: 325500})}));
  });

  it('declares a member first job of the month at 0% commission', async () => {
    const {db, service} = setup({member: true});
    db.payment.count.mockResolvedValue(0);
    const result = await service.declareEngineerCollection('eng-user', {engineerRequestId: 'eng-req', amount: 3500, method: 'CASH'});
    expect(result).toMatchObject({status: 'COLLECTED_UNSETTLED', platformFeePaisa: 0});
    expect(db.payment.create).toHaveBeenCalledWith(expect.objectContaining({data: expect.objectContaining({
      platformFeePaisa: 0, professionalAmountPaisa: 350000})}));
  });

  it('emails a direct-payment receipt to the client after a declare', async () => {
    const {email, service} = setup({email: {}});
    await service.declareEngineerCollection('eng-user', {engineerRequestId: 'eng-req', amount: 3500, method: 'CASH'});
    expect(email!.send).toHaveBeenCalledTimes(1);
    const message = email!.send.mock.calls[0][0];
    expect(message).toMatchObject({to: 'client@example.com'});
    expect(message.text).toContain('directly by cash');
    expect(message.text).toContain('₹3,500');
  });

  it('rejects strangers, early declares, tiny amounts, and double declares', async () => {
    const {service} = setup();
    await expect(service.declareEngineerCollection('stranger', {engineerRequestId: 'eng-req', amount: 3500, method: 'CASH'}))
      .rejects.toMatchObject({status: 404});
    const pending = setup({req: engRequest({status: 'PENDING'})});
    await expect(pending.service.declareEngineerCollection('eng-user', {engineerRequestId: 'eng-req', amount: 3500, method: 'CASH'}))
      .rejects.toMatchObject({status: 400});
    await expect(service.declareEngineerCollection('eng-user', {engineerRequestId: 'eng-req', amount: 0, method: 'CASH'}))
      .rejects.toMatchObject({status: 400});
    const online = setup({pay: payment({status: 'PAID', providerPaymentId: 'pay_1'})});
    await expect(online.service.declareEngineerCollection('eng-user', {engineerRequestId: 'eng-req', amount: 3500, method: 'CASH'}))
      .rejects.toMatchObject({status: 409});
    const declared = setup({pay: payment({status: 'COLLECTED_UNSETTLED'})});
    await expect(declared.service.declareEngineerCollection('eng-user', {engineerRequestId: 'eng-req', amount: 3500, method: 'CASH'}))
      .rejects.toMatchObject({status: 409});
  });

  it('blocks online payment once cash is recorded', async () => {
    const {service} = setup({pay: payment({status: 'COLLECTED_UNSETTLED'})});
    await expect(service.createEngineerOrder('client', 'eng-req')).rejects.toMatchObject({status: 409});
  });

  it('reconciles an in-flight checkout before declaring, and proceeds when nothing was captured', async () => {
    const fetchOrderPayments = jest.fn().mockResolvedValue([]);
    const {db, provider, service} = setup({pay: payment(), provider: {fetchOrderPayments}});
    const result = await service.declareEngineerCollection('eng-user',
      {engineerRequestId: 'eng-req', amount: 3500, method: 'CASH'});
    expect(provider.fetchOrderPayments).toHaveBeenCalledWith('order_1');
    expect(result).toMatchObject({status: 'COLLECTED_UNSETTLED', amountPaisa: 350000});
    expect(db.payment.update).toHaveBeenCalledWith(expect.objectContaining({data: expect.objectContaining({
      collectionMode: 'AT_HOME', status: 'COLLECTED_UNSETTLED'})}));
  });

  it('claims a lagging capture instead of letting a declare wipe the order', async () => {
    const fetchOrderPayments = jest.fn().mockResolvedValue([{id: 'pay_1', status: 'captured', amount: 350000}]);
    const {db, service} = setup({pay: payment(), provider: {fetchOrderPayments}});
    await expect(service.declareEngineerCollection('eng-user',
      {engineerRequestId: 'eng-req', amount: 3500, method: 'CASH'}))
      .rejects.toMatchObject({status: 409, message: 'This booking was already paid online'});
    // The capture was claimed (PAID), never overwritten with AT_HOME data.
    expect(db.payment.updateMany).toHaveBeenCalledWith(expect.objectContaining({data: expect.objectContaining({
      providerPaymentId: 'pay_1', status: 'PAID'})}));
    expect(db.payment.update).not.toHaveBeenCalledWith(expect.objectContaining({data: expect.objectContaining({
      collectionMode: 'AT_HOME'})}));
  });

  it('lets the engineer sync an in-flight checkout like the client can', async () => {
    const fetchOrderPayments = jest.fn().mockResolvedValue([]);
    const {service} = setup({pay: payment(), provider: {fetchOrderPayments}});
    const result = await service.sync('eng-user', {engineerRequestId: 'eng-req'});
    expect(result).toMatchObject({status: 'ORDER_CREATED'});
    await expect(service.sync('stranger', {engineerRequestId: 'eng-req'}))
      .rejects.toMatchObject({status: 404});
  });

  it('exposes the consultation fee as the declare reference in the engineer view', async () => {
    const {service} = setup({pay: payment({status: 'PAID', providerPaymentId: 'pay_1'})});
    const result = await service.viewEngineer('eng-user', 'eng-req', false);
    expect(result).toMatchObject({status: 'PAID', expectedAmountPaisa: 350000});
  });
});

describe('client payment disputes', () => {
  const svcReq = {id: 'req', status: 'IN_PROGRESS', client: {userId: 'client'}, provider: {id: 'prof', userId: 'pro-user'},
    journey: {stage: 'IN_PROGRESS', quoteAmountPaisa: 200000, quoteAccepted: true, collectionMode: 'ONLINE',
      collectedAmountPaisa: null, collectedMethod: null}};

  it('freezes a held consultation payment for support review', async () => {
    const {db, realtime, service} = setup({pay: payment({status: 'HELD', providerPaymentId: 'pay_1'})});
    const result = await service.reportDispute('client',
      {engineerRequestId: 'eng-req', reason: 'The engineer never visited the site'});
    expect(result).toMatchObject({status: 'DISPUTED'});
    expect(db.notification.createMany).toHaveBeenCalled();
    expect(realtime.emitUserUpdate).toHaveBeenCalledWith('client', 'requests');
    expect(realtime.emitUserUpdate).toHaveBeenCalledWith('eng-user', 'requests');
  });

  it('freezes a held service payment the same way', async () => {
    const svcPay = {...payment({status: 'HELD', providerPaymentId: 'pay_1'}), serviceRequestId: 'req', engineerRequestId: null};
    const {service} = setup({sreq: svcReq, pay: svcPay});
    const result = await service.reportDispute('client', {serviceRequestId: 'req', reason: 'Work left incomplete, water still leaking'});
    expect(result).toMatchObject({status: 'DISPUTED'});
  });

  it('rejects strangers, uncaptured payments, released payments, and bad refs', async () => {
    const {service} = setup({pay: payment({status: 'HELD', providerPaymentId: 'pay_1'})});
    await expect(service.reportDispute('stranger', {engineerRequestId: 'eng-req', reason: 'Not my booking at all here'}))
      .rejects.toMatchObject({status: 404});
    const empty = setup();
    await expect(empty.service.reportDispute('client', {engineerRequestId: 'eng-req', reason: 'Nothing was ever paid here'}))
      .rejects.toMatchObject({status: 404});
    const released = setup({pay: payment({status: 'RELEASED', providerPaymentId: 'pay_1'})});
    await expect(released.service.reportDispute('client', {engineerRequestId: 'eng-req', reason: 'Too late to dispute this one'}))
      .rejects.toMatchObject({status: 409});
    await expect(service.reportDispute('client', {reason: 'Missing booking reference here'} as any))
      .rejects.toMatchObject({status: 400});
    await expect(service.reportDispute('client', {engineerRequestId: 'eng-req', serviceRequestId: 'req', reason: 'Two bookings at once here'} as any))
      .rejects.toMatchObject({status: 400});
  });
});

describe('engineer consultation webhooks', () => {
  const SECRET = 'whsec_test_secret_value_1234567890';
  const raw = (event: any) => Buffer.from(JSON.stringify(event));

  it('fulfills captures on completed consultations with consultation copy', async () => {
    const prior = process.env.RAZORPAY_WEBHOOK_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
    try {
      const {db, provider, realtime, service} = setup({pay: payment()});
      provider.fetchPayment.mockResolvedValue({status: 'captured', order_id: 'order_1', amount: 350000});
      await expect(service.handleWebhook(raw({id: 'e-eng-1', event: 'payment.captured',
        payload: {payment: {entity: {id: 'pay_1', order_id: 'order_1'}}}}), 'sig')).resolves.toMatchObject({ok: true});
      expect(db.payment.updateMany.mock.calls[0][0].data.status).toBe('PAID');
      expect(realtime.emitUserUpdate).toHaveBeenCalledWith('eng-user', 'requests');
      const bodies = (db.notification.createMany.mock.calls[0][0].data as any[]).map(n => n.body).join(' ');
      expect(bodies).toContain('consultation fee is paid');
    } finally {
      if (prior === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET;
      else process.env.RAZORPAY_WEBHOOK_SECRET = prior;
    }
  });

  it('auto-refunds captures that arrive for cancelled consultations', async () => {
    const prior = process.env.RAZORPAY_WEBHOOK_SECRET;
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
    try {
      const {db, provider, service} = setup({pay: payment(), req: engRequest({status: 'CANCELLED'})});
      provider.fetchPayment.mockResolvedValue({status: 'captured', order_id: 'order_1', amount: 350000});
      await expect(service.handleWebhook(raw({id: 'e-eng-2', event: 'payment.captured',
        payload: {payment: {entity: {id: 'pay_1', order_id: 'order_1'}}}}), 'sig')).resolves.toMatchObject({ok: true});
      expect(provider.createRefund).toHaveBeenCalledWith('pay_1', 350000);
      expect(db.notification.createMany).toHaveBeenCalled();
    } finally {
      if (prior === undefined) delete process.env.RAZORPAY_WEBHOOK_SECRET;
      else process.env.RAZORPAY_WEBHOOK_SECRET = prior;
    }
  });
});
