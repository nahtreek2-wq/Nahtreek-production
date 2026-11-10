import {RequestsService} from './requests.service';

const req = (over: Record<string, unknown> = {}) => ({id: 'req-1', status: 'ACCEPTED',
  projectTitle: 'Wall crack', projectDescription: 'Fix', propertyType: 'Flat',
  locationAddress: 'Addr', latitude: 13, longitude: 80, createdAt: new Date(),
  client: {userId: 'client', fullName: 'Client'},
  engineer: {consultationFee: 3500, profile: {userId: 'eng', fullName: 'Eng'}}, ...over});

function setup(row: any) {
  const tx: any = {
    engineerRequest: {
      updateMany: jest.fn().mockResolvedValue({count: 1}),
      update: jest.fn().mockImplementation(async ({data}: any) => ({...row, ...data,
        client: row.client, engineer: row.engineer})),
    },
    requestStatusHistory: {create: jest.fn().mockResolvedValue({})},
    notification: {create: jest.fn().mockResolvedValue({})},
    auditLog: {createMany: jest.fn().mockResolvedValue({})},
  };
  const prisma: any = {
    engineerRequest: {findFirst: jest.fn().mockResolvedValue(row)},
    $transaction: jest.fn((fn: any) => fn(tx)),
  };
  const payments = {cancelUnpaidOrRefundEngineer: jest.fn().mockResolvedValue(undefined)};
  const service = new RequestsService(prisma, {emitUserUpdate: jest.fn()} as any,
    {dispatch: jest.fn().mockResolvedValue(undefined)} as any, payments as any);
  return {service, tx, payments};
}

describe('engineer cancel + reschedule', () => {
  it('lets the engineer cancel an upcoming request and notifies the client', async () => {
    const {service, tx, payments} = setup(req());
    const out = await service.cancel('req-1', 'eng');
    expect(out.status).toBe('CANCELLED');
    expect(tx.notification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({userId: 'client'})}));
    expect(payments.cancelUnpaidOrRefundEngineer).toHaveBeenCalledWith('req-1', 'eng');
  });

  it('refuses engineer cancel once work started', async () => {
    const {service} = setup(req({status: 'IN_PROGRESS'}));
    await expect(service.cancel('req-1', 'eng')).rejects.toThrow('Cannot cancel');
  });

  it('lets the client reschedule an upcoming consultation', async () => {
    const {service, tx} = setup(req({status: 'PENDING'}));
    const when = new Date(Date.now() + 86400000).toISOString();
    const out = await service.reschedule('req-1', 'client', when);
    expect(tx.engineerRequest.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({preferredStartDate: new Date(when)})}));
    expect(tx.notification.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({userId: 'eng'})}));
    expect(out.id).toBe('req-1');
  });

  it('rejects reschedule windows outside 30 minutes to 30 days', async () => {
    const {service} = setup(req({status: 'PENDING'}));
    await expect(service.reschedule('req-1', 'client', new Date(Date.now() + 60000).toISOString()))
      .rejects.toThrow('30 minutes and 30 days');
  });
});
