import {PaymentsService} from './payments.service';

function setup(db: any) {
  return new PaymentsService(db, {enabled: true} as any, {} as any, {} as any);
}

const account = (over: any = {}) => ({id: 'acct-1', professionalProfileId: 'prof-1',
  provider: 'RAZORPAY_ROUTE', providerAccountRef: null, accountHolderName: 'Kavin Rajan',
  bankName: 'HDFC', ifsc: 'HDFC0001234', upiId: null, accountLast4: '4321',
  status: 'PENDING', rejectionReason: null, createdAt: new Date(), updatedAt: new Date(),
  profile: {fullName: 'Kavin Rajan', user: {phoneNumber: '+919876543210'}}, ...over});

describe('admin payout accounts', () => {
  it('lists masked accounts with professional names', async () => {
    const db: any = {
      $transaction: jest.fn(async (ops: any[]) => [await ops[0], await ops[1]]),
      payoutAccount: {
        findMany: jest.fn(async () => [account({providerAccountRef: 'acc_abcdef1234'})]),
        count: jest.fn(async () => 1),
      },
    };
    const result = await setup(db).listPayoutAccountsForAdmin({status: 'PENDING', page: '1', limit: '20'});
    expect(db.payoutAccount.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {status: 'PENDING'}, skip: 0, take: 20}));
    expect(result.data[0]).toMatchObject({professionalName: 'Kavin Rajan',
      phoneNumber: '+919876543210', maskedAccountNumber: '••••4321',
      providerAccountRef: '••••1234'});
    expect(JSON.stringify(result.data[0])).not.toContain('acc_abcdef1234');
    expect(result.meta).toMatchObject({page: 1, limit: 20, total: 1});
  });

  it('rejects unknown statuses', async () => {
    await expect(setup({} as any).listPayoutAccountsForAdmin({status: 'BOGUS'}))
      .rejects.toThrow('Invalid payout account status');
  });

  it('rejects pending submissions only, with a reason', async () => {
    const db: any = {
      payoutAccount: {
        findUnique: jest.fn(async () => account()),
        update: jest.fn(async () => ({})),
      },
      auditLog: {create: jest.fn()},
    };
    await expect(setup(db).reviewPayoutAccount('admin', 'acct-1', {decision: 'reject'} as any))
      .rejects.toThrow('Add a reason');
    const result = await setup(db).reviewPayoutAccount('admin', 'acct-1', {decision: 'reject', note: 'IFSC mismatch'} as any);
    expect(result).toEqual({id: 'acct-1', decision: 'reject'});
    expect(db.payoutAccount.update).toHaveBeenCalledWith({where: {id: 'acct-1'},
      data: {status: 'REJECTED', rejectionReason: 'IFSC mismatch'}});
    expect(db.auditLog.create).toHaveBeenCalledWith({data: expect.objectContaining({
      action: 'PAYOUT_ACCOUNT_REJECT'})});
  });

  it('suspends active accounts and clears them back for re-review', async () => {
    const db: any = {
      payoutAccount: {
        findUnique: jest.fn(async () => account({status: 'ACTIVE'})),
        update: jest.fn(async () => ({})),
      },
      auditLog: {create: jest.fn()},
    };
    const service = setup(db);
    await service.reviewPayoutAccount('admin', 'acct-1', {decision: 'suspend', note: 'Fraud check'} as any);
    expect(db.payoutAccount.update).toHaveBeenCalledWith({where: {id: 'acct-1'},
      data: {status: 'SUSPENDED', rejectionReason: 'Fraud check'}});
    db.payoutAccount.findUnique.mockResolvedValueOnce(account({status: 'SUSPENDED'}));
    await service.reviewPayoutAccount('admin', 'acct-1', {decision: 'clear'} as any);
    expect(db.payoutAccount.update).toHaveBeenCalledWith({where: {id: 'acct-1'},
      data: {status: 'PENDING', rejectionReason: null}});
  });

  it('refuses invalid transitions and unknown accounts', async () => {
    const db: any = {
      payoutAccount: {findUnique: jest.fn(async () => null), update: jest.fn()},
      auditLog: {create: jest.fn()},
    };
    await expect(setup(db).reviewPayoutAccount('admin', 'missing', {decision: 'clear'} as any))
      .rejects.toThrow('Payout account not found');
    db.payoutAccount.findUnique.mockResolvedValue(account({status: 'ACTIVE'}));
    await expect(setup(db).reviewPayoutAccount('admin', 'acct-1', {decision: 'reject', note: 'x'} as any))
      .rejects.toThrow('Only a pending submission can be rejected');
    await expect(setup(db).reviewPayoutAccount('admin', 'acct-1', {decision: 'clear'} as any))
      .rejects.toThrow('Only a rejected or suspended account can be cleared');
    expect(db.payoutAccount.update).not.toHaveBeenCalled();
  });
});

describe('admin payout queue', () => {
  it('aggregates releasable money per professional, biggest first', async () => {
    const db: any = {
      payment: {groupBy: jest.fn(async () => ([
        {professionalProfileId: 'prof-1', status: 'HELD', _sum: {professionalAmountPaisa: 18000}},
        {professionalProfileId: 'prof-1', status: 'RELEASE_PENDING', _sum: {professionalAmountPaisa: 9000}},
        {professionalProfileId: 'prof-1', status: 'RELEASED', _sum: {professionalAmountPaisa: 50000}},
        {professionalProfileId: 'prof-2', status: 'PAID', _sum: {professionalAmountPaisa: 45000}},
      ]))},
      professionalProfile: {findMany: jest.fn(async () => ([
        {id: 'prof-1', fullName: 'Kavin Rajan', user: {phoneNumber: '+911'}},
        {id: 'prof-2', fullName: 'Aadhya Raman', user: {phoneNumber: '+912'}},
      ]))},
      payoutAccount: {findMany: jest.fn(async () => ([
        {professionalProfileId: 'prof-1', status: 'ACTIVE', accountLast4: '4321', upiId: null},
      ]))},
    };
    const result = await setup(db).payoutQueue();
    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toMatchObject({professionalProfileId: 'prof-2',
      pendingReleasePaisa: 45000, stuckPaisa: 0, releasedLifetimePaisa: 0,
      payoutAccountStatus: 'NOT_SUBMITTED'});
    expect(result.data[1]).toMatchObject({professionalProfileId: 'prof-1',
      pendingReleasePaisa: 18000, stuckPaisa: 9000, releasedLifetimePaisa: 50000,
      payoutAccountStatus: 'ACTIVE', accountLast4: '4321'});
    expect(result.totals).toMatchObject({pendingReleasePaisa: 63000, stuckPaisa: 9000,
      releasedLifetimePaisa: 50000});
  });

  it('returns empty totals when nobody holds money', async () => {
    const db: any = {payment: {groupBy: jest.fn(async () => [])}};
    await expect(setup(db).payoutQueue()).resolves.toEqual({data: [],
      totals: {pendingReleasePaisa: 0, stuckPaisa: 0, releasedLifetimePaisa: 0}});
  });
});
