import {RequestsService} from './requests.service';

describe('engineer request list', () => {
  it('loads the latest review so clients can hide the Rate action', async () => {
    const item = {
      id: 'req-1',
      clientProfileId: 'client-profile',
      engineerProfileId: 'eng-profile',
      projectTitle: 'Home repair plan',
      projectDescription: 'Fix things',
      propertyType: 'Residential',
      projectSizeSqFt: null,
      locationAddress: '14 Test Street, Chennai',
      latitude: 13.0,
      longitude: 80.2,
      status: 'COMPLETED',
      createdAt: new Date('2026-11-05T17:00:00.000Z'),
      engineer: {profile: {fullName: 'Ananya Suresh (Demo)'}},
      client: {fullName: 'AI Tester'},
      reviews: [{rating: 5, comment: 'excellent plumbing fix', createdAt: new Date('2026-11-06T02:00:00.000Z')}],
    };
    const transaction = jest.fn().mockResolvedValue([[item], 1]);
    const prisma = {
      $transaction: transaction,
      engineerRequest: {findMany: jest.fn(), count: jest.fn()},
    };

    const result = await new RequestsService(prisma as any, {emitUserUpdate: jest.fn()} as any, {dispatch: jest.fn()} as any).list(
      'client-user',
      {},
    );

    expect(prisma.engineerRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          reviews: expect.objectContaining({take: 1}),
        }),
      }),
    );
    expect(result.data[0]).toMatchObject({
      id: 'req-1',
      review: {rating: 5, comment: 'excellent plumbing fix'},
    });
  });

  it('flags Plus clients on the engineer inbox only', async () => {
    const item = (clientUserId: string) => ({id: `req-${clientUserId}`, clientProfileId: 'cp',
      engineerProfileId: 'ep', projectTitle: 'Plan', projectDescription: 'Fix', propertyType: 'Flat',
      projectSizeSqFt: null, locationAddress: 'Addr', latitude: 13, longitude: 80, status: 'PENDING',
      createdAt: new Date(), engineer: {profile: {userId: 'eng-user', fullName: 'Eng'}},
      client: {userId: clientUserId, fullName: 'Client'}, reviews: []});
    const prisma: any = {
      $transaction: jest.fn().mockResolvedValue([[item('plus-user'), item('free-user')], 2]),
      engineerRequest: {findMany: jest.fn(), count: jest.fn()},
      aiSubscription: {findMany: jest.fn().mockResolvedValue([
        {userId: 'plus-user', status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 86400000)}])},
    };
    const service = new RequestsService(prisma, {emitUserUpdate: jest.fn()} as any, {dispatch: jest.fn()} as any);
    const pro = await service.list('eng-user', {});
    expect(pro.data[0]).toMatchObject({clientPlus: true});
    expect(pro.data[1]).toMatchObject({clientPlus: false});
    expect(prisma.aiSubscription.findMany).toHaveBeenCalledTimes(1);
    const client = await service.list('plus-user', {});
    expect(client.data[0]).not.toHaveProperty('clientPlus');
  });

  it('pages at the database with skip/take (F-002)', async () => {
    const prisma: any = {
      $transaction: jest.fn().mockResolvedValue([[], 95]),
      engineerRequest: {findMany: jest.fn(), count: jest.fn()},
    };
    const service = new RequestsService(prisma, {emitUserUpdate: jest.fn()} as any, {dispatch: jest.fn()} as any);
    const result = await service.list('client-user', {page: '3', limit: '10'});
    expect(prisma.engineerRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({skip: 20, take: 10}),
    );
    expect(result.meta).toMatchObject({page: 3, limit: 10, total: 95, totalPages: 10});
  });
});
