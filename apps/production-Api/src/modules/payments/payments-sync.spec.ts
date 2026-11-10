import {PaymentsService} from './payments.service';
import {RazorpayError} from './razorpay.provider';

const sreq = (over: Record<string, unknown> = {}) => ({id: 'req', status: 'ACCEPTED',
  description: 'Fix wiring', client: {userId: 'client'},
  provider: {id: 'prof', userId: 'pro', fullName: 'Pro'}, journey: {stage: 'ARRIVED'}, ...over});
const ereq = (over: Record<string, unknown> = {}) => ({id: 'eng-req', status: 'IN_PROGRESS', projectTitle: 'Wall crack',
  client: {userId: 'client'},
  engineer: {professionalProfileId: 'prof', profile: {userId: 'eng-user', fullName: 'Eng'}}, ...over});
const payment = (over: Record<string, unknown> = {}) => ({id: 'pay', professionalProfileId: 'prof',
  serviceRequestId: 'req', engineerRequestId: null,
  amountPaisa: 200000, platformFeePaisa: 20000, professionalAmountPaisa: 180000, currency: 'INR',
  status: 'ORDER_CREATED', providerOrderId: 'order_1', providerPaymentId: null, providerTransferId: null,
  paidAt: null, releasedAt: null, refundedAt: null, collectionMode: 'ONLINE', settledAt: null, ...over});

function setup(over: {sreq?: any; ereq?: any; pay?: any; orderPayments?: any[]; providerError?: any; account?: any} = {}) {
  const pays = over.pay === undefined ? [] : [over.pay];
  const findUnique = jest.fn(async ({where}: any) => {
    if (where.serviceRequestId) return pays.find((p: any) => p.serviceRequestId === where.serviceRequestId) ?? null;
    if (where.engineerRequestId) return pays.find((p: any) => p.engineerRequestId === where.engineerRequestId) ?? null;
    if (where.id) return pays.find((p: any) => p.id === where.id) ?? null;
    if (where.professionalProfileId) return over.account ?? null;
    return null;
  });
  const db: any = {
    serviceRequest: {findFirst: jest.fn().mockResolvedValue(over.sreq === undefined ? sreq() : over.sreq)},
    engineerRequest: {findFirst: jest.fn().mockResolvedValue(over.ereq === undefined ? ereq() : over.ereq)},
    payment: {findUnique, findUniqueOrThrow: jest.fn(async ({where}: any) => {
      const found = await findUnique({where});
      if (!found) throw new Error('not found');
      return found;
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
          if (where.providerOrderId && p.providerOrderId !== where.providerOrderId) return false;
          if (where.providerPaymentId === null && p.providerPaymentId !== null) return false;
          return true;
        });
        rows.forEach((row: any) => Object.assign(row, data));
        return {count: rows.length};
      })},
    payoutAccount: {findUnique, upsert: jest.fn(async ({create}: any) => ({id: 'acct', ...create}))},
    professionalProfile: {findUnique: jest.fn().mockResolvedValue({id: 'prof'})},
    user: {findUnique: jest.fn().mockResolvedValue({email: 'client@example.com', displayName: 'Client'})},
    notification: {createMany: jest.fn()},
    auditLog: {create: jest.fn(), createMany: jest.fn()},
  };
  const provider = {enabled: true, keyId: 'rzp_test',
    fetchOrderPayments: over.providerError ? jest.fn().mockRejectedValue(over.providerError)
      : jest.fn().mockResolvedValue(over.orderPayments ?? []),
    createOnHoldTransfer: jest.fn().mockResolvedValue({id: 'trf_1'})};
  (db as any).$transaction = jest.fn((arg: any) => Array.isArray(arg) ? Promise.all(arg) : arg({...db, $queryRaw: jest.fn()}));
  const push = {dispatch: jest.fn().mockResolvedValue({})};
  const realtime = {emitUserUpdate: jest.fn()};
  const service = new PaymentsService(db, provider as any, push as any, realtime as any, undefined, undefined);
  return {db, provider, service};
}

describe('payments sync (lost checkout callback)', () => {
  it('settles a captured payment the app never confirmed', async () => {
    const {service, db} = setup({pay: payment(), orderPayments: [{id: 'pay_rzp', status: 'captured', amount: 200000, order_id: 'order_1'}]});
    const view = await service.sync('client', {serviceRequestId: 'req'});
    expect(view.status).toBe('PAID');
    expect(db.notification.createMany).toHaveBeenCalled();
  });

  it('returns the pending view when nothing was captured', async () => {
    const {service, provider, db} = setup({pay: payment(), orderPayments: []});
    const view = await service.sync('client', {serviceRequestId: 'req'});
    expect(view.status).toBe('ORDER_CREATED');
    expect(provider.fetchOrderPayments).toHaveBeenCalledWith('order_1');
    expect(db.notification.createMany).not.toHaveBeenCalled();
  });

  it('disputes a captured payment with the wrong amount', async () => {
    const {service} = setup({pay: payment(), orderPayments: [{id: 'pay_rzp', status: 'captured', amount: 999, order_id: 'order_1'}]});
    await expect(service.sync('client', {serviceRequestId: 'req'})).rejects.toThrow('mismatch');
  });

  it('refuses other clients', async () => {
    const {service} = setup({pay: payment(), orderPayments: [{id: 'pay_rzp', status: 'captured', amount: 200000}]});
    await expect(service.sync('stranger', {serviceRequestId: 'req'})).rejects.toThrow('Booking not found');
  });

  it('leaves settled rows untouched without calling Razorpay', async () => {
    const {service, provider} = setup({pay: payment({status: 'PAID', providerPaymentId: 'pay_old'})});
    const view = await service.sync('client', {serviceRequestId: 'req'});
    expect(view.status).toBe('PAID');
    expect(provider.fetchOrderPayments).not.toHaveBeenCalled();
  });

  it('settles engineer consultations too', async () => {
    const engPay = payment({serviceRequestId: null, engineerRequestId: 'eng-req', amountPaisa: 343000});
    const {service} = setup({pay: engPay,
      orderPayments: [{id: 'pay_rzp2', status: 'captured', amount: 343000, order_id: 'order_1'}]});
    const view = await service.sync('client', {engineerRequestId: 'eng-req'});
    expect(view.status).toBe('PAID');
  });

  it('refuses closed engineer bookings', async () => {
    const engPay = payment({serviceRequestId: null, engineerRequestId: 'eng-req'});
    const {service} = setup({pay: engPay, ereq: ereq({status: 'CANCELLED'}),
      orderPayments: [{id: 'pay_rzp2', status: 'captured', amount: 200000}]});
    await expect(service.sync('client', {engineerRequestId: 'eng-req'})).rejects.toThrow('closed');
  });

  it('surfaces provider outages as retryable', async () => {
    const {service} = setup({pay: payment(), providerError: new RazorpayError('boom', 502, true)});
    await expect(service.sync('client', {serviceRequestId: 'req'})).rejects.toThrow('Payment provider unavailable');
  });
});

describe('payout account self-service', () => {
  it('submits bank details and reads back only masked values', async () => {
    const {service, db} = setup({account: null});
    db.payoutAccount.upsert.mockResolvedValueOnce({id: 'acct', status: 'PENDING', accountHolderName: 'Veda',
      bankName: 'HDFC', accountLast4: '6789', ifsc: 'HDFC0001234', upiId: 'veda@upi',
      rejectionReason: null, updatedAt: new Date()});
    const view = await service.submitPayoutAccount('pro', {accountHolderName: 'Veda',
      accountNumber: '123456789012', ifsc: 'hdfc0001234', bankName: 'HDFC', upiId: 'veda@upi'});
    expect(db.payoutAccount.upsert).toHaveBeenCalled();
    const create = db.payoutAccount.upsert.mock.calls[0][0].create;
    expect(create.ifsc).toBe('HDFC0001234');
    expect(create.accountLast4).toBe('9012');
    expect(view.maskedAccountNumber).toBe('••••6789');
    expect(view).not.toHaveProperty('accountNumber');
    expect(view.status).toBe('PENDING');
  });

  it('reports NOT_SUBMITTED before the first submission', async () => {
    const {service} = setup({account: null});
    const view = await service.myPayoutAccount('pro');
    expect(view.status).toBe('NOT_SUBMITTED');
  });

  it('keeps an admin-linked account ACTIVE on bank edits', async () => {
    const {service, db} = setup({account: {providerAccountRef: 'acc_route', status: 'ACTIVE'}});
    db.payoutAccount.upsert.mockResolvedValueOnce({id: 'acct', status: 'ACTIVE', accountHolderName: 'Veda',
      bankName: null, accountLast4: '9012', ifsc: 'HDFC0001234', upiId: null, rejectionReason: null, updatedAt: new Date()});
    const view = await service.submitPayoutAccount('pro', {accountHolderName: 'Veda',
      accountNumber: '123456789012', ifsc: 'HDFC0001234'});
    expect(db.payoutAccount.upsert.mock.calls[0][0].update.status).toBe('ACTIVE');
    expect(view.status).toBe('ACTIVE');
  });
});
