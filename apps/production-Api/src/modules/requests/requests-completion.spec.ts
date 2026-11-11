import {RequestsService} from './requests.service';

const realtime = () => ({emitUserUpdate: jest.fn()});
const push = () => ({dispatch: jest.fn().mockResolvedValue(undefined)});

function txRunner(tx: Record<string, unknown>) {
  return jest.fn(async (fn: (client: unknown) => Promise<unknown>) => fn(tx));
}

const baseRequest = {
  id: 'req-1',
  clientProfileId: 'client-1',
  engineerProfileId: 'eng-1',
  projectTitle: 'Villa wiring',
  projectDescription: 'Full villa rewiring',
  propertyType: 'Villa',
  projectSizeSqFt: null,
  locationAddress: 'Chennai',
  latitude: 13,
  longitude: 80,
  createdAt: new Date('2026-01-01'),
};

function transitionSetup(found: Record<string, unknown>, updated: Record<string, unknown>,
  over: {dues?: number; membership?: any} = {}) {
  const notify = jest.fn().mockResolvedValue({id: 'n-t'});
  const historyCreate = jest.fn().mockResolvedValue({id: 'h-t'});
  const updateMany = jest.fn().mockResolvedValue({count: 1});
  const tx = {
    engineerRequest: {updateMany, update: jest.fn().mockResolvedValue(updated)},
    requestStatusHistory: {create: historyCreate},
    notification: {create: notify},
    auditLog: {createMany: jest.fn()},
  };
  const prisma: any = {
    engineerRequest: {
      findFirst: jest.fn().mockResolvedValue(found),
      update: jest.fn().mockResolvedValue(found),
      updateMany: jest.fn().mockResolvedValue({count: 1}),
    },
    payment: {aggregate: jest.fn().mockResolvedValue({_sum: {platformFeePaisa: over.dues ?? 0}})},
    membership: {findUnique: jest.fn().mockResolvedValue(over.membership ?? null)},
    notification: {create: jest.fn().mockResolvedValue({id: 'n-direct'})},
    $transaction: txRunner(tx),
  };
  const rt = realtime();
  const pushMock = push();
  const service = new RequestsService(prisma, rt as any, pushMock as any);
  return {notify, historyCreate, updateMany, prisma, rt, pushMock, service};
}

const acceptedParties = {
  client: {userId: 'client-user', fullName: 'Asha'},
  engineer: {profile: {userId: 'eng-user', fullName: 'Eng Narayanan'}, consultationFeePaisa: 350000, professionalProfileId: 'pro-1'},
};

describe('engineer completion proof', () => {
  it('issues a 6-digit code at ACCEPT and tells the client to guard it', async () => {
    const {notify, updateMany, service} = transitionSetup(
      {...baseRequest, status: 'PENDING', completionCode: null, completionCodeAttempts: 0, ...acceptedParties},
      {...baseRequest, status: 'ACCEPTED', ...acceptedParties},
    );
    const result = await service.transitionForEngineer('req-1', 'eng-user', 'ACCEPTED' as any);
    const data = updateMany.mock.calls[0][0].data;
    expect(data.completionCode).toMatch(/^\d{6}$/);
    expect(data.completionCodeAttempts).toBe(0);
    const body = notify.mock.calls[0][0].data.body as string;
    expect(body).toContain(data.completionCode);
    expect(body).toMatch(/share it only after the work is done/);
    // The engineer response never carries the code.
    expect(result).not.toHaveProperty('completionCode');
  });

  it('blocks accepts over the dues ceiling but lets members through under ₹2,000', async () => {
    const pending = {...baseRequest, status: 'PENDING', completionCode: null, completionCodeAttempts: 0, ...acceptedParties};
    const accepted = {...baseRequest, status: 'ACCEPTED', ...acceptedParties};
    const active = {status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 86400000)};
    const blocked = transitionSetup(pending, accepted, {dues: 60000});
    await expect(blocked.service.transitionForEngineer('req-1', 'eng-user', 'ACCEPTED' as any))
      .rejects.toThrow('commission dues');
    const member = transitionSetup(pending, accepted, {dues: 60000, membership: active});
    await expect(member.service.transitionForEngineer('req-1', 'eng-user', 'ACCEPTED' as any)).resolves.toBeTruthy();
    const over = transitionSetup(pending, accepted, {dues: 200000, membership: active});
    await expect(over.service.transitionForEngineer('req-1', 'eng-user', 'ACCEPTED' as any))
      .rejects.toThrow('commission dues');
  });

  it('refuses COMPLETED without the code and counts the attempt', async () => {
    const {prisma, service} = transitionSetup(
      {...baseRequest, status: 'IN_PROGRESS', completionCode: '123456', completionCodeAttempts: 0, ...acceptedParties},
      {...baseRequest, status: 'IN_PROGRESS', ...acceptedParties},
    );
    await expect(service.transitionForEngineer('req-1', 'eng-user', 'COMPLETED' as any))
      .rejects.toMatchObject({status: 400});
    await expect(service.transitionForEngineer('req-1', 'eng-user', 'COMPLETED' as any, undefined, {code: '000000'}))
      .rejects.toMatchObject({status: 400});
    expect(prisma.engineerRequest.update).toHaveBeenCalledTimes(2);
    expect(prisma.engineerRequest.update.mock.calls[0][0]).toMatchObject(
      {data: {completionCodeAttempts: {increment: 1}}});
  });

  it('locks out after five wrong attempts', async () => {
    const {prisma, service} = transitionSetup(
      {...baseRequest, status: 'IN_PROGRESS', completionCode: '123456', completionCodeAttempts: 5, ...acceptedParties},
      {...baseRequest, status: 'IN_PROGRESS', ...acceptedParties},
    );
    await expect(service.transitionForEngineer('req-1', 'eng-user', 'COMPLETED' as any, undefined, {code: '123456'}))
      .rejects.toMatchObject({status: 400});
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('completes with the right code, nulls it, and records GPS', async () => {
    const {notify, historyCreate, updateMany, service} = transitionSetup(
      {...baseRequest, status: 'IN_PROGRESS', completionCode: '123456', completionCodeAttempts: 1, ...acceptedParties},
      {...baseRequest, status: 'COMPLETED', ...acceptedParties},
    );
    const result = await service.transitionForEngineer('req-1', 'eng-user', 'COMPLETED' as any, undefined,
      {code: '123456', latitude: 13.01, longitude: 80.21});
    expect(result).toMatchObject({status: 'COMPLETED'});
    expect(updateMany.mock.calls[0][0].data).toMatchObject({completionCode: null});
    expect(historyCreate).toHaveBeenCalledWith(expect.objectContaining({data: expect.objectContaining({
      toStatus: 'COMPLETED', latitude: 13.01, longitude: 80.21})}));
    const body = notify.mock.calls[0][0].data.body as string;
    expect(body).toMatch(/consultation fee can now be paid/);
  });

  it('issues a fresh code for legacy requests that never got one', async () => {
    const {prisma, service} = transitionSetup(
      {...baseRequest, status: 'IN_PROGRESS', completionCode: null, completionCodeAttempts: 0, ...acceptedParties},
      {...baseRequest, status: 'IN_PROGRESS', ...acceptedParties},
    );
    await expect(service.transitionForEngineer('req-1', 'eng-user', 'COMPLETED' as any, undefined, {code: '123456'}))
      .rejects.toThrow(/fresh completion code was just sent/);
    const data = prisma.engineerRequest.update.mock.calls[0][0].data;
    expect(data.completionCode).toMatch(/^\d{6}$/);
    expect(prisma.notification.create).toHaveBeenCalled();
  });
});

describe('completion code visibility', () => {
  function detailSetup(viewerUserId: string, plus = false) {
    const found = {...baseRequest, status: 'IN_PROGRESS', completionCode: '654321',
      client: {userId: 'client-user', fullName: 'Asha'},
      engineer: {profile: {userId: 'eng-user', fullName: 'Eng Narayanan'}, consultationFeePaisa: 350000},
      statusHistory: [], reviews: []};
    const prisma: any = {engineerRequest: {findFirst: jest.fn().mockResolvedValue(found)},
      aiSubscription: {findUnique: jest.fn().mockResolvedValue(plus
        ? {status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 86400000)} : null)}};
    const service = new RequestsService(prisma, realtime() as any, push() as any);
    return service.detail('req-1', viewerUserId);
  }

  it('shows the code to the client only', async () => {
    await expect(detailSetup('client-user')).resolves.toMatchObject({completionCode: '654321'});
    const engineerView = await detailSetup('eng-user');
    expect(engineerView).not.toHaveProperty('completionCode');
  });

  it('flags Plus subscribers on the engineer view only', async () => {
    await expect(detailSetup('eng-user', true)).resolves.toMatchObject({clientPlus: true});
    await expect(detailSetup('eng-user', false)).resolves.toMatchObject({clientPlus: false});
    const clientView = await detailSetup('client-user', true);
    expect(clientView).not.toHaveProperty('clientPlus');
  });
});
