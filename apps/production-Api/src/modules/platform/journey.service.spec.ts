import {ConflictException, ServiceUnavailableException} from '@nestjs/common';
import {JourneyService} from './journey.service';

describe('nearby journey matching', () => {
  const now = new Date();
  const provider = (id: string, latitude: number) => ({
    id, fullName: id, title: 'Repair professional', startingPrice: 100,
    presence: {online: true, accuracy: 10, observedAt: now, latitude, longitude: 77, radiusKm: 10},
  });
  const dto = {serviceId: 'repair', latitude: 11, longitude: 77, mode: 'ASAP' as const};

  it('returns zero travel time for a professional already at the service address', async () => {
    const service = new JourneyService({} as any, {} as any, {} as any);
    const request = jest.spyOn(global, 'fetch');
    try {
      await expect((service as any).route(
        {latitude: 11.0168, longitude: 76.9558},
        {latitude: 11.0168, longitude: 76.9558},
      )).resolves.toBe(0);
      expect(request).not.toHaveBeenCalled();
    } finally {
      request.mockRestore();
    }
  });

  it('falls back to a straight-line estimate when road routing fails', async () => {
    const service = new JourneyService({} as any, {} as any, {} as any);
    const previous = process.env.GEOAPIFY_API_KEY;
    process.env.GEOAPIFY_API_KEY = 'test-key';
    const request = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('routing down'));
    try {
      await expect((service as any).route({latitude: 11, longitude: 77}, {latitude: 11.1, longitude: 77})).resolves.toBe(23);
      expect(request).toHaveBeenCalled();
    } finally {
      request.mockRestore();
      if (previous === undefined) delete process.env.GEOAPIFY_API_KEY;
      else process.env.GEOAPIFY_API_KEY = previous;
    }
  });

  it('estimates without calling routing when no key is configured', async () => {
    const service = new JourneyService({} as any, {} as any, {} as any);
    const previous = process.env.GEOAPIFY_API_KEY;
    delete process.env.GEOAPIFY_API_KEY;
    const request = jest.spyOn(global, 'fetch');
    try {
      await expect((service as any).route({latitude: 11, longitude: 77}, {latitude: 11.1, longitude: 77})).resolves.toBe(23);
      expect(request).not.toHaveBeenCalled();
    } finally {
      request.mockRestore();
      if (previous !== undefined) process.env.GEOAPIFY_API_KEY = previous;
    }
  });

  it('keeps a valid professional when another road ETA fails', async () => {
    const db = {serviceCategory: {findFirst: jest.fn().mockResolvedValue({id: 'service-repair', slug: 'repair'})}, professionalProfile: {findMany: jest.fn().mockResolvedValue([
      provider('unroutable', 11), provider('available', 11.01),
    ])}};
    const service = new JourneyService(db as any, {} as any, {} as any);
    jest.spyOn(service as any, 'route').mockImplementation((from: {latitude: number}) =>
      from.latitude === 11 ? Promise.reject(new Error('route unavailable')) : Promise.resolve(10));

    const result = await service.matches('client', dto);
    expect(result.data.map(item => item.id)).toEqual(['available']);
    expect(result.data[0].etaMinutes).toBe(15);
  });

  it('reports an ETA outage when no candidate can be evaluated', async () => {
    const db = {serviceCategory: {findFirst: jest.fn().mockResolvedValue({id: 'service-repair', slug: 'repair'})}, professionalProfile: {findMany: jest.fn().mockResolvedValue([provider('unroutable', 11)])}};
    const service = new JourneyService(db as any, {} as any, {} as any);
    jest.spyOn(service as any, 'route').mockRejectedValue(new Error('route unavailable'));

    await expect(service.matches('client', dto)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('service catalogue compatibility', () => {
  it.each(['plumbing', 'service-plumbing'])('matches ID-based and slug-based profiles for %s', async serviceId => {
    const findMany = jest.fn().mockResolvedValue([]);
    const findFirst = jest.fn().mockResolvedValue({id: 'service-plumbing', slug: 'plumbing'});
    const service = new JourneyService({serviceCategory: {findFirst}, professionalProfile: {findMany}} as any, {} as any, {} as any);
    await service.matches('client', {serviceId, latitude: 11, longitude: 77, mode: 'SCHEDULED'});
    expect(findFirst).toHaveBeenCalledWith({where: {isActive: true, OR: [{slug: serviceId}, {id: serviceId}]}});
    expect(findMany.mock.calls[0][0].where.serviceCategories).toEqual({hasSome: ['service-plumbing', 'plumbing']});
  });

  it('does not match an inactive or missing catalogue service', async () => {
    const findMany = jest.fn();
    const service = new JourneyService({serviceCategory: {findFirst: jest.fn().mockResolvedValue(null)}, professionalProfile: {findMany}} as any, {} as any, {} as any);
    await expect(service.matches('client', {serviceId: 'disabled', latitude: 11, longitude: 77, mode: 'SCHEDULED'})).rejects.toThrow('Service unavailable');
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('service booking delivery and location', () => {
  it('does not enable nearby presence until a provider is verified and available', async () => {
    const upsert = jest.fn();
    const findFirst = jest.fn()
      .mockResolvedValueOnce({id: 'profile', verificationStatus: 'UNDER_REVIEW', isAvailable: true})
      .mockResolvedValueOnce({id: 'profile', verificationStatus: 'VERIFIED', isAvailable: false});
    const serviceJourney = {findFirst: jest.fn().mockResolvedValue(null)};
    const service = new JourneyService({professionalProfile: {findFirst}, serviceJourney, providerPresence: {upsert}} as any, {} as any, {} as any);
    const location = {online: true, latitude: 11, longitude: 77, accuracy: 10, observedAt: new Date().toISOString()};
    await expect(service.presence('provider-user', location)).rejects.toThrow('Go available');
    await expect(service.presence('provider-user', location)).rejects.toBeInstanceOf(ConflictException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('keeps live presence available for an active service visit when new work is paused', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const serviceJourney = {findFirst: jest.fn().mockResolvedValue({requestId: 'visit'})};
    const service = new JourneyService({
      professionalProfile: {findFirst: jest.fn().mockResolvedValue({id: 'profile', verificationStatus: 'VERIFIED', isAvailable: false})},
      serviceJourney,
      providerPresence: {upsert},
    } as any, {} as any, {} as any);

    await expect(service.presence('provider-user', {
      online: true, latitude: 11, longitude: 77, accuracy: 10, observedAt: new Date().toISOString(),
    })).resolves.toMatchObject({online: true});
    expect(serviceJourney.findFirst).toHaveBeenCalledWith({
      where: {stage: {in: ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION', 'DISPUTED']}, request: {professionalProfileId: 'profile'}},
      select: {requestId: true},
    });
    expect(upsert).toHaveBeenCalled();
  });

  it('notifies the selected provider immediately after a booking is committed', async () => {
    const emitUserUpdate = jest.fn();
    const dispatch = jest.fn().mockResolvedValue({processed: 1});
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      professionalProfile: {findUniqueOrThrow: jest.fn().mockResolvedValue({id: 'provider-profile', userId: 'provider-user', verificationStatus: 'VERIFIED', isAvailable: true, presence: null})},
      serviceRequest: {count: jest.fn().mockResolvedValue(0), create: jest.fn().mockResolvedValue({id: 'service-request'})},
      clientProfile: {findUniqueOrThrow: jest.fn().mockResolvedValue({id: 'client-profile'})},
      serviceCategory: {findFirst: jest.fn().mockResolvedValue({id: 'category'})},
      notification: {create: jest.fn().mockResolvedValue({})},
    };
    const db = {
      serviceJourney: {findUnique: jest.fn().mockResolvedValue(null)},
      $transaction: jest.fn((callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const service = new JourneyService(db as any, {dispatch} as any, {emitUserUpdate} as any);
    jest.spyOn(service, 'matches').mockResolvedValue({data: [{id: 'provider-profile', etaMinutes: null}]} as any);

    await expect(service.book('client-user', {
      serviceId: 'repair', latitude: 11, longitude: 77, mode: 'SCHEDULED',
      scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      idempotencyKey: '8a84c054-50e0-4534-b892-20a22a12e1c6',
      description: 'Repair the kitchen sink', locationAddress: '12 Main Street',
      recipientName: 'Client User', recipientPhone: '+919876543210', recipientConsent: true,
    })).resolves.toEqual({id: 'service-request'});
    expect(tx.serviceRequest.create).toHaveBeenCalledWith(expect.objectContaining({data: expect.objectContaining({professionalProfileId: 'provider-profile'})}));
    expect(tx.notification.create).toHaveBeenCalledWith(expect.objectContaining({data: expect.objectContaining({userId: 'provider-user'})}));
    expect(emitUserUpdate).toHaveBeenCalledWith('provider-user', 'service-requests');
    expect(emitUserUpdate).toHaveBeenCalledWith('provider-user', 'notifications');
  });

  it('never extends a location lifetime with a future device timestamp', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const db = {professionalProfile: {findFirst: jest.fn().mockResolvedValue({id: 'profile', verificationStatus: 'VERIFIED', isAvailable: true})}, providerPresence: {upsert}};
    const service = new JourneyService(db as any, {} as any, {} as any);
    const before = Date.now();
    await service.presence('provider-user', {online: true, latitude: 11, longitude: 77, accuracy: 10, observedAt: new Date(before + 5000).toISOString()});
    const stored = upsert.mock.calls[0][0].create.observedAt as Date;
    expect(stored.getTime()).toBeGreaterThanOrEqual(before);
    expect(stored.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('limits on-demand expiry to the signed-in account', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new JourneyService({serviceJourney: {findMany}} as any, {} as any, {} as any);
    await service.expire(undefined, 'provider-user');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({where: expect.objectContaining({request: {OR: [{client: {userId: 'provider-user'}}, {provider: {userId: 'provider-user'}}]}})}));
  });

  describe('paid-before-work gate', () => {
    const sprint = (paid: {status: string} | null) => {
      const journeyRow = {requestId: 'req', stage: 'ARRIVED', mode: 'SCHEDULED', revision: 1,
        quoteAccepted: true, codeAttempts: 0, startCode: '123456', expiresAt: new Date(Date.now() + 3600000),
        payloadHash: 'h', idempotencyKey: 'k',
        request: {id: 'req', professionalProfileId: 'prof', latitude: 11, longitude: 77,
          client: {userId: 'client-user'}, provider: {userId: 'pro-user', presence: null}}};
      const tx: any = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        serviceJourney: {findUniqueOrThrow: jest.fn().mockResolvedValue(journeyRow), update: jest.fn().mockResolvedValue({})},
        payment: {findUnique: jest.fn().mockResolvedValue(paid)},
        serviceRequest: {update: jest.fn().mockResolvedValue({})},
        notification: {create: jest.fn().mockResolvedValue({})},
        auditLog: {createMany: jest.fn().mockResolvedValue({})},
      };
      const db: any = {
        serviceJourney: {findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(journeyRow)},
        $transaction: jest.fn((callback: (value: unknown) => Promise<unknown>) => callback(tx)),
      };
      const payments = {enabled: true, requirePaid: jest.fn().mockResolvedValue(undefined),
        releaseForRequest: jest.fn(), markDisputed: jest.fn(), cancelUnpaidOrRefund: jest.fn()};
      const service = new JourneyService(db, {dispatch: jest.fn().mockResolvedValue({})} as any,
        {emitUserUpdate: jest.fn()} as any, payments as any);
      return {service, tx, payments};
    };
    it('blocks START when the quote is unpaid', async () => {
      const {service, tx} = sprint(null);
      await expect(service.action('pro-user', 'req', {action: 'START', revision: 1, code: '123456'}))
        .rejects.toMatchObject({status: 400});
      expect(tx.serviceJourney.update).not.toHaveBeenCalled();
    });
    it('starts work once the payment is held', async () => {
      const {service, tx, payments} = sprint({status: 'HELD'});
      await expect(service.action('pro-user', 'req', {action: 'START', revision: 1, code: '123456'}))
        .resolves.toMatchObject({requestId: 'req'});
      expect(payments.requirePaid).toHaveBeenCalledWith('req');
      expect(tx.serviceJourney.update).toHaveBeenCalledWith(expect.objectContaining({data: expect.objectContaining({stage: 'IN_PROGRESS'})}));
    });
  });

  describe('Plus speed SLA', () => {
    const plusSub = {status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 86400000)};
    const bookingRig = (plus: boolean) => {
      const tx: any = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        professionalProfile: {findUniqueOrThrow: jest.fn().mockResolvedValue({id: 'provider-profile', userId: 'provider-user', verificationStatus: 'VERIFIED', isAvailable: true, presence: null})},
        serviceRequest: {count: jest.fn().mockResolvedValue(0), create: jest.fn().mockResolvedValue({id: 'service-request'})},
        clientProfile: {findUniqueOrThrow: jest.fn().mockResolvedValue({id: 'client-profile'})},
        serviceCategory: {findFirst: jest.fn().mockResolvedValue({id: 'category'})},
        notification: {create: jest.fn().mockResolvedValue({})},
      };
      const db: any = {
        serviceJourney: {findUnique: jest.fn().mockResolvedValue(null)},
        aiSubscription: {findUnique: jest.fn().mockResolvedValue(plus ? plusSub : null)},
        $transaction: jest.fn((callback: (value: unknown) => Promise<unknown>) => callback(tx)),
      };
      const service = new JourneyService(db, {dispatch: jest.fn().mockResolvedValue({})} as any,
        {emitUserUpdate: jest.fn()} as any);
      jest.spyOn(service, 'matches').mockResolvedValue({data: [{id: 'provider-profile', etaMinutes: null}]} as any);
      return {service, tx};
    };
    const bookingDto = {
      serviceId: 'repair', latitude: 11, longitude: 77, mode: 'SCHEDULED' as const,
      scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      idempotencyKey: '8a84c054-50e0-4534-b892-20a22a12e1c6',
      description: 'Repair the kitchen sink', locationAddress: '12 Main Street',
      recipientName: 'Client User', recipientPhone: '+919876543210', recipientConsent: true,
    };

    it('cuts the scheduled accept window to 15 minutes for Plus clients', async () => {
      const {service, tx} = bookingRig(true);
      const before = Date.now();
      await service.book('client-user', bookingDto);
      const expiresAt = tx.serviceRequest.create.mock.calls[0][0].data.journey.create.expiresAt as Date;
      expect(expiresAt.getTime()).toBeGreaterThan(before + 14 * 60000);
      expect(expiresAt.getTime()).toBeLessThan(before + 16 * 60000);
      expect(tx.notification.create).toHaveBeenCalledWith(expect.objectContaining({data: expect.objectContaining({
        title: 'Plus priority request'})}));
    });

    it('attaches Plus terms to the journey for Plus clients only', async () => {
      const readRig = (plus: boolean) => {
        const journeyRow = {requestId: 'req', stage: 'ACCEPTED', mode: 'SCHEDULED', revision: 1,
          quoteAccepted: false, codeAttempts: 0, expiresAt: new Date(Date.now() + 3600000),
          payloadHash: 'h', idempotencyKey: 'k',
          request: {id: 'req', client: {userId: 'client-user'},
            provider: {userId: 'pro-user', presence: null}}};
        const db: any = {
          serviceJourney: {findMany: jest.fn().mockResolvedValue([]),
            findFirst: jest.fn().mockResolvedValue(journeyRow)},
          aiSubscription: {findUnique: jest.fn().mockResolvedValue(plus ? plusSub : null)},
        };
        const service = new JourneyService(db, {dispatch: jest.fn().mockResolvedValue({})} as any,
          {emitUserUpdate: jest.fn()} as any);
        return service;
      };
      const plusView = await readRig(true).read('client-user', 'req') as any;
      expect(plusView.plusTerms).toMatchObject({acceptWindowMs: 900000, arrivalGraceMs: 900000,
        lateAcceptPenaltyPaisa: 2500, lateArrivalPenaltyPaisa: 5000});
      const plainView = await readRig(false).read('client-user', 'req') as any;
      expect(plainView.plusTerms).toBeNull();
    });

    it('keeps the 60-minute window for everyone else', async () => {
      const {service, tx} = bookingRig(false);
      const before = Date.now();
      await service.book('client-user', bookingDto);
      const expiresAt = tx.serviceRequest.create.mock.calls[0][0].data.journey.create.expiresAt as Date;
      expect(expiresAt.getTime()).toBeGreaterThan(before + 59 * 60000);
      expect(tx.notification.create).toHaveBeenCalledWith(expect.objectContaining({data: expect.objectContaining({
        title: 'New service request nearby'})}));
    });

    const expireRig = (online: boolean, plus: boolean) => {
      const due = [{requestId: 'req', request: {client: {userId: 'client-user'},
        provider: {userId: 'pro-user', presence: {online}}, professionalProfileId: 'prof'}}];
      const tx: any = {
        serviceJourney: {updateMany: jest.fn().mockResolvedValue({count: 1})},
        serviceRequest: {update: jest.fn().mockResolvedValue({})},
        notification: {create: jest.fn().mockResolvedValue({})},
      };
      const payments = {postPenalty: jest.fn().mockResolvedValue({id: 'pen'})};
      const db: any = {
        serviceJourney: {findMany: jest.fn().mockResolvedValue(due)},
        aiSubscription: {findUnique: jest.fn().mockResolvedValue(plus ? plusSub : null)},
        $transaction: jest.fn((callback: (value: unknown) => Promise<unknown>) => callback(tx)),
      };
      const service = new JourneyService(db, {dispatch: jest.fn().mockResolvedValue({})} as any,
        {emitUserUpdate: jest.fn()} as any, payments as any);
      return {service, payments};
    };

    it('penalizes online pros who let Plus requests expire, and no one else', async () => {
      const guilty = expireRig(true, true);
      await guilty.service.expire('req');
      expect(guilty.payments.postPenalty).toHaveBeenCalledWith('prof', 'req', 2500, 'LATE_ACCEPT');
      const offline = expireRig(false, true);
      await offline.service.expire('req');
      expect(offline.payments.postPenalty).not.toHaveBeenCalled();
      const regular = expireRig(true, false);
      await regular.service.expire('req');
      expect(regular.payments.postPenalty).not.toHaveBeenCalled();
    });

    const arriveRig = (target: Date | null, plus: boolean) => {
      const journeyRow: any = {requestId: 'req', stage: 'EN_ROUTE', mode: 'ASAP', revision: 1,
        quoteAccepted: false, codeAttempts: 0, startCode: null, expiresAt: new Date(Date.now() + 3600000),
        arrivalTarget: target, payloadHash: 'h', idempotencyKey: 'k',
        request: {id: 'req', professionalProfileId: 'prof', latitude: 11, longitude: 77,
          client: {userId: 'client-user'}, provider: {userId: 'pro-user', presence: null}}};
      const tx: any = {
        $queryRaw: jest.fn().mockResolvedValue([]),
        serviceJourney: {findUniqueOrThrow: jest.fn().mockResolvedValue(journeyRow), update: jest.fn().mockResolvedValue({})},
        providerPresence: {findUnique: jest.fn().mockResolvedValue({online: true, latitude: 11, longitude: 77, accuracy: 5, observedAt: new Date()})},
        serviceRequest: {update: jest.fn().mockResolvedValue({})},
        notification: {create: jest.fn().mockResolvedValue({})},
        auditLog: {createMany: jest.fn().mockResolvedValue({})},
      };
      const db: any = {
        serviceJourney: {findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(journeyRow)},
        aiSubscription: {findUnique: jest.fn().mockResolvedValue(plus ? plusSub : null)},
        $transaction: jest.fn((callback: (value: unknown) => Promise<unknown>) => callback(tx)),
      };
      const payments: any = {postPenalty: jest.fn().mockResolvedValue({id: 'pen'})};
      const service = new JourneyService(db, {dispatch: jest.fn().mockResolvedValue({})} as any,
        {emitUserUpdate: jest.fn()} as any, payments);
      return {service, payments};
    };

    it('penalizes late Plus arrivals past the grace, never on-time ones', async () => {
      const late = arriveRig(new Date(Date.now() - 3600000), true);
      await expect(late.service.action('pro-user', 'req', {action: 'ARRIVE', revision: 1}))
        .resolves.toMatchObject({requestId: 'req'});
      expect(late.payments.postPenalty).toHaveBeenCalledWith('prof', 'req', 5000, 'LATE_ARRIVAL');
      const onTime = arriveRig(new Date(Date.now() + 3600000), true);
      await onTime.service.action('pro-user', 'req', {action: 'ARRIVE', revision: 1});
      expect(onTime.payments.postPenalty).not.toHaveBeenCalled();
      const regular = arriveRig(new Date(Date.now() - 3600000), false);
      await regular.service.action('pro-user', 'req', {action: 'ARRIVE', revision: 1});
      expect(regular.payments.postPenalty).not.toHaveBeenCalled();
    });
  });
});
