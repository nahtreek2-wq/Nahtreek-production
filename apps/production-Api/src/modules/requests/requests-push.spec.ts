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

describe('engineering request push fan-out', () => {
  it('queues a pro-request notification and dispatches push on create', async () => {
    const notify = jest.fn().mockResolvedValue({id: 'n-1'});
    const tx = {
      engineerRequest: {create: jest.fn().mockResolvedValue({
        ...baseRequest, status: 'PENDING',
        client: {fullName: 'Asha'},
        engineer: {profile: {fullName: 'Eng Narayanan'}},
      })},
      requestStatusHistory: {create: jest.fn()},
      notification: {create: notify},
      auditLog: {createMany: jest.fn()},
    };
    const prisma = {
      clientProfile: {findUnique: jest.fn().mockResolvedValue({id: 'client-1', fullName: 'Asha'})},
      engineerProfile: {findUnique: jest.fn().mockResolvedValue({
        id: 'eng-1',
        profile: {userId: 'eng-user', verificationStatus: 'VERIFIED', isAvailable: true, user: {status: 'ACTIVE', deletedAt: null}},
      })},
      $transaction: txRunner(tx),
    };
    const pushMock = push();

    await new RequestsService(prisma as any, realtime() as any, pushMock as any).create({
      engineerProfileId: 'eng-1', projectTitle: 'Villa wiring', projectDescription: 'Full villa rewiring',
      propertyType: 'Villa', projectSizeSqFt: 1200, locationAddress: 'Chennai', latitude: 13, longitude: 80,
    } as any, 'client-user');

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({data: expect.objectContaining({
      userId: 'eng-user',
      data: expect.objectContaining({destination: 'pro-request', requestId: 'req-1'}),
    })}));
    expect(pushMock.dispatch).toHaveBeenCalled();
  });

  it('queues an engineer-request notification to the client on engineer transition', async () => {
    const notify = jest.fn().mockResolvedValue({id: 'n-2'});
    const tx = {
      engineerRequest: {
        updateMany: jest.fn().mockResolvedValue({count: 1}),
        update: jest.fn().mockResolvedValue({
          ...baseRequest, status: 'ACCEPTED',
          client: {userId: 'client-user', fullName: 'Asha'},
          engineer: {profile: {fullName: 'Eng Narayanan'}},
        }),
      },
      requestStatusHistory: {create: jest.fn()},
      notification: {create: notify},
      auditLog: {createMany: jest.fn()},
    };
    const prisma = {
      engineerRequest: {findFirst: jest.fn().mockResolvedValue({
        ...baseRequest, status: 'PENDING',
        client: {userId: 'client-user', fullName: 'Asha'},
        engineer: {profile: {userId: 'eng-user', fullName: 'Eng Narayanan'}},
      })},
      $transaction: txRunner(tx),
    };
    const pushMock = push();

    await new RequestsService(prisma as any, realtime() as any, pushMock as any)
      .transitionForEngineer('req-1', 'eng-user', 'ACCEPTED' as any);

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({data: expect.objectContaining({
      userId: 'client-user',
      data: expect.objectContaining({destination: 'engineer-request', requestId: 'req-1', status: 'ACCEPTED'}),
    })}));
    expect(pushMock.dispatch).toHaveBeenCalled();
  });

  it('queues a pro-request notification on client cancel', async () => {
    const notify = jest.fn().mockResolvedValue({id: 'n-3'});
    const tx = {
      engineerRequest: {
        updateMany: jest.fn().mockResolvedValue({count: 1}),
        update: jest.fn().mockResolvedValue({
          ...baseRequest, status: 'CANCELLED',
          client: {fullName: 'Asha'},
          engineer: {profile: {fullName: 'Eng Narayanan'}},
        }),
      },
      requestStatusHistory: {create: jest.fn()},
      notification: {create: notify},
      auditLog: {createMany: jest.fn()},
    };
    const prisma = {
      engineerRequest: {findFirst: jest.fn().mockResolvedValue({
        ...baseRequest, id: 'req-1', status: 'PENDING',
        client: {userId: 'client-user', fullName: 'Asha'},
        engineer: {profile: {userId: 'eng-user'}},
        statusHistory: [],
      })},
      $transaction: txRunner(tx),
    };
    const pushMock = push();

    await new RequestsService(prisma as any, realtime() as any, pushMock as any).cancel('req-1', 'client-user');

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({data: expect.objectContaining({
      userId: 'eng-user',
      data: expect.objectContaining({destination: 'pro-request', requestId: 'req-1'}),
    })}));
    expect(pushMock.dispatch).toHaveBeenCalled();
  });

  it('queues a pro-reviews notification on client review', async () => {
    const notify = jest.fn().mockResolvedValue({id: 'n-4'});
    const prisma = {
      engineerRequest: {findFirst: jest.fn().mockResolvedValue({
        id: 'req-1', status: 'COMPLETED', projectTitle: 'Villa wiring',
        clientProfileId: 'client-1',
        engineer: {professionalProfileId: 'pro-1', profile: {userId: 'eng-user'}},
        statusHistory: [],
      })},
      review: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({id: 'review-1'}),
        aggregate: jest.fn().mockResolvedValue({_avg: {rating: 5}, _count: {rating: 1}}),
      },
      professionalProfile: {update: jest.fn().mockResolvedValue({})},
      notification: {create: notify},
    };
    const rt = realtime();
    const pushMock = push();

    await new RequestsService(prisma as any, rt as any, pushMock as any)
      .addReview('req-1', 'client-user', {rating: 5, comment: 'Excellent work throughout.'} as any);

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({data: expect.objectContaining({
      userId: 'eng-user',
      data: expect.objectContaining({destination: 'pro-reviews', requestId: 'req-1', rating: 5}),
    })}));
    expect(rt.emitUserUpdate).toHaveBeenCalledWith('eng-user', 'notifications');
    expect(pushMock.dispatch).toHaveBeenCalled();
  });
});
