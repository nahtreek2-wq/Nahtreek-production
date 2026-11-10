import {JourneyService} from './journey.service';

const journey = (stage: string) => ({requestId: 'req-1', stage, mode: 'SCHEDULED',
  revision: 3, expiresAt: new Date(Date.now() + 3600000), scheduledAt: null,
  request: {id: 'req-1', clientProfileId: 'cp', professionalProfileId: 'pp',
    client: {userId: 'client'}, provider: {userId: 'pro'}}});

function setup(stage: string) {
  const tx: any = {
    $queryRaw: jest.fn(),
    serviceJourney: {findUniqueOrThrow: jest.fn().mockResolvedValue(journey(stage)),
      update: jest.fn().mockResolvedValue({})},
    serviceRequest: {update: jest.fn().mockResolvedValue({})},
    notification: {create: jest.fn().mockResolvedValue({})},
    auditLog: {createMany: jest.fn().mockResolvedValue({})},
  };
  const db: any = {
    serviceJourney: {findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue({...journey(stage), client: {userId: 'client'}})},
    $transaction: jest.fn((fn: any) => fn(tx)),
  };
  const payments = {resolveDisputeForRequest: jest.fn().mockResolvedValue(undefined),
    releaseForRequest: jest.fn().mockResolvedValue({released: true}),
    cancelUnpaidOrRefund: jest.fn().mockResolvedValue(undefined)};
  const push = {dispatch: jest.fn().mockResolvedValue({})};
  const realtime = {emitUserUpdate: jest.fn()};
  const service = new JourneyService(db, push as any, realtime as any, payments as any);
  return {service, tx, payments};
}

describe('pro cancel + dispute resolve', () => {
  it('lets the pro cancel before travel starts and refunds the client', async () => {
    const {service, tx, payments} = setup('ACCEPTED');
    await service.action('pro', 'req-1', {action: 'CANCEL', revision: 3} as any);
    expect(tx.serviceRequest.update.mock.calls[0][0].data.status).toBe('CANCELLED');
    expect(tx.notification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({userId: 'client'})}));
    expect(payments.cancelUnpaidOrRefund).toHaveBeenCalledWith('req-1', 'pro');
  });

  it('refuses pro cancel once travelling', async () => {
    const {service} = setup('EN_ROUTE');
    await expect(service.action('pro', 'req-1', {action: 'CANCEL', revision: 3} as any))
      .rejects.toThrow('not available at this stage');
  });

  it('confirming from DISPUTED unfreezes then releases the payment', async () => {
    const {service, payments, tx} = setup('DISPUTED');
    await service.action('client', 'req-1', {action: 'CONFIRM', revision: 3} as any);
    expect(payments.resolveDisputeForRequest).toHaveBeenCalledWith('req-1', 'client');
    expect(payments.releaseForRequest).toHaveBeenCalledWith('req-1', 'client');
    expect(tx.serviceRequest.update.mock.calls[0][0].data.status).toBe('COMPLETED');
  });
});
