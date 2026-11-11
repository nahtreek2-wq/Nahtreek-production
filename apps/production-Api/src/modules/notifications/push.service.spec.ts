import {PushService, pushDestinationFor, tipForWeek} from './push.service';
import {PushDispatchController} from './push.controller';

describe('push delivery boundaries', () => {
  const user = {sub: 'client', sid: 'session', roles: ['CLIENT'], phoneNumber: ''};
  it('does not let a client register the professional app', async () => {
    const upsert = jest.fn();
    await expect(new PushService({pushDevice: {upsert}} as any, {} as any).register(user, 'token', 'professional')).rejects.toMatchObject({status: 403});
    expect(upsert).not.toHaveBeenCalled();
  });
  it('binds registration to the authenticated account and session', async () => {
    const upsert = jest.fn();
    const tx = {$queryRaw: jest.fn(), pushDevice: {upsert, deleteMany: jest.fn()}};
    await new PushService({$transaction: (fn: any) => fn(tx)} as any, {} as any).register(user, 'token', 'client');
    expect(upsert.mock.calls[0][0].create).toEqual({token: 'token', app: 'client', userId: 'client', sessionId: 'session'});
  });
  it('does not touch the queue while Firebase is disabled', async () => {
    await expect(new PushService({} as any, {enabled: false} as any).dispatch()).resolves.toEqual({enabled: false, processed: 0});
  });
  it('requires a configured worker secret', () => {
    const prior = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {expect(() => new PushDispatchController({} as any).get()).toThrow();}
    finally {if (prior) process.env.CRON_SECRET = prior;}
  });
  it('filters inactive sessions, removes unregistered devices and keeps temporary failures for retry', async () => {
    const row = {id: 'notification', userId: 'client', pushAttempts: 0};
    const device = {id: 'd', token: 'token', session: {authVersion: 2}, user: {authVersion: 2}};
    const db = {notificationPreference: {findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null)}, serviceJourney: {findMany: jest.fn().mockResolvedValue([])}, notification: {updateMany: jest.fn().mockResolvedValue({count: 1}), findMany: jest.fn().mockResolvedValue([row]), update: jest.fn()},
      pushDevice: {findMany: jest.fn().mockResolvedValue([device, {...device, token: 'stale', session: {authVersion: 1}}]), deleteMany: jest.fn()}};
    const fcm = {enabled: true, send: jest.fn().mockResolvedValue('unregistered')};
    await new PushService(db as any, fcm as any).dispatch();
    expect(fcm.send).toHaveBeenCalledTimes(1);
    expect(db.pushDevice.findMany.mock.calls[0][0].where.session).toMatchObject({revokedAt: null});
    expect(db.pushDevice.deleteMany).toHaveBeenCalledWith({where: {id: 'd', token: 'token'}});
    expect(db.notification.update.mock.calls[0][0].data).toMatchObject({pushState: 'PENDING', pushAttempts: {decrement: 1}});
    fcm.send.mockResolvedValue('retry');
    await new PushService(db as any, fcm as any).dispatch();
    expect(db.notification.update.mock.calls[1][0].data.pushState).toBe('PENDING');
    db.pushDevice.findMany.mockResolvedValue([]);
    fcm.send.mockClear();
    await new PushService(db as any, fcm as any).dispatch();
    expect(fcm.send).not.toHaveBeenCalled();
    expect(db.notification.update.mock.calls[2][0].data).toMatchObject({pushState: 'PENDING', pushAttempts: {decrement: 1}});
  });
  it('yields when another worker holds the lease (F-006)', async () => {
    const row = {id: 'notification', userId: 'client', kind: 'request', pushAttempts: 0};
    const db = {notificationPreference: {findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null)},
      serviceJourney: {findMany: jest.fn().mockResolvedValue([])},
      notification: {updateMany: jest.fn().mockResolvedValue({count: 0}), findMany: jest.fn().mockResolvedValue([row]), update: jest.fn()},
      pushDevice: {findMany: jest.fn().mockResolvedValue([])}};
    const fcm = {enabled: true, send: jest.fn()};
    await expect(new PushService(db as any, fcm as any).dispatch()).resolves.toMatchObject({enabled: true, processed: 0});
    expect(fcm.send).not.toHaveBeenCalled();
    expect(db.notification.update).not.toHaveBeenCalled();
  });
  it('parks the row FAILED after the retry budget is spent (F-006)', async () => {
    const row = {id: 'notification', userId: 'client', kind: 'request', pushAttempts: 4};
    const device = {id: 'd', token: 'token', session: {authVersion: 2}, user: {authVersion: 2}};
    const db = {notificationPreference: {findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null)},
      serviceJourney: {findMany: jest.fn().mockResolvedValue([])},
      notification: {updateMany: jest.fn().mockResolvedValue({count: 1}), findMany: jest.fn().mockResolvedValue([row]), update: jest.fn()},
      pushDevice: {findMany: jest.fn().mockResolvedValue([device]), deleteMany: jest.fn()}};
    const fcm = {enabled: true, send: jest.fn().mockResolvedValue('retry')};
    await new PushService(db as any, fcm as any).dispatch();
    expect(db.notification.update.mock.calls[0][0].data).toMatchObject({pushState: 'FAILED', pushLeaseUntil: null});
  });
});

describe('push deep links', () => {
  it.each([
    [{kind: 'message', data: {conversationId: 'c1', senderName: 'Kannan'}}, {destination: 'chat', conversationId: 'c1', senderName: 'Kannan'}],
    [{kind: 'request', data: {serviceRequestId: 'r1', stage: 'ARRIVED'}}, {destination: 'service-request', serviceRequestId: 'r1'}],
    [{kind: 'reminder', data: {serviceRequestId: 'r2'}}, {destination: 'service-request', serviceRequestId: 'r2'}],
    [{kind: 'offer', data: {destination: 'home'}}, {destination: 'home'}],
    [{kind: 'offer', data: {destination: 'profile'}}, {destination: 'profile'}],
    [{kind: 'offer', data: {}}, {destination: 'home'}],
    [{kind: 'system', data: null}, {destination: 'notifications'}],
    [{kind: 'request', data: {bogus: true}}, {destination: 'notifications'}],
  ])('maps %j', (row, expected) => {
    expect(pushDestinationFor(row)).toEqual(expected);
  });
  it('sends the deep link with every push', async () => {
    const row = {id: 'n', userId: 'u', kind: 'message', title: 't', body: 'b', pushAttempts: 0, data: {conversationId: 'c1'}};
    const device = {id: 'd', token: 'token', session: {authVersion: 1}, user: {authVersion: 1}};
    const db = {notificationPreference: {findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null)}, serviceJourney: {findMany: jest.fn().mockResolvedValue([])},
      notification: {updateMany: jest.fn().mockResolvedValue({count: 1}), findMany: jest.fn().mockResolvedValue([row]), update: jest.fn(), count: jest.fn()},
      pushDevice: {findMany: jest.fn().mockResolvedValue([device]), deleteMany: jest.fn()}};
    const fcm = {enabled: true, send: jest.fn().mockResolvedValue('sent')};
    await new PushService(db as any, fcm as any).dispatch();
    expect(fcm.send).toHaveBeenCalledWith('token', 'n', 'message', 't', 'b', {destination: 'chat', conversationId: 'c1'});
  });
});

describe('engagement queue', () => {
  const journey = (over: any = {}) => ({requestId: 'r1', stage: 'ACCEPTED', scheduledAt: null, quoteAmountPaisa: null,
    quoteAccepted: false, updatedAt: new Date(), request: {client: {userId: 'client'}, provider: {userId: 'pro', fullName: 'Ravi Kumar'},
    category: {title: 'Plumbing'}}, ...over});
  const dbFor = (journeys: any[], reminded: number) => ({notificationPreference: {findMany: jest.fn().mockResolvedValue([])},
    serviceJourney: {findMany: jest.fn().mockResolvedValue(journeys)},
    notification: {updateMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]), update: jest.fn(),
      count: jest.fn().mockResolvedValue(reminded), create: jest.fn()},
    pushDevice: {findMany: jest.fn().mockResolvedValue([])}});
  it('queues a visit reminder for journeys starting within a day', async () => {
    const db = dbFor([journey({scheduledAt: new Date(Date.now() + 12 * 3600_000)})], 0);
    await new PushService(db as any, {enabled: true} as any).dispatch();
    expect(db.notification.create).toHaveBeenCalledTimes(1);
    expect(db.notification.create.mock.calls[0][0].data).toMatchObject({kind: 'reminder', userId: 'client'});
    expect(db.notification.create.mock.calls[0][0].data.title).toMatch('Ravi visits');
  });
  it('queues a quote nudge for stale unapproved quotes', async () => {
    const db = dbFor([journey({quoteAmountPaisa: 150000, updatedAt: new Date(Date.now() - 8 * 3600_000)})], 0);
    await new PushService(db as any, {enabled: true} as any).dispatch();
    expect(db.notification.create.mock.calls[0][0].data).toMatchObject({kind: 'reminder'});
    expect(db.notification.create.mock.calls[0][0].data.title).toMatch('₹1,500');
  });
  it('does not remind twice within 20 hours', async () => {
    const db = dbFor([journey({scheduledAt: new Date(Date.now() + 12 * 3600_000)})], 1);
    await new PushService(db as any, {enabled: true} as any).dispatch();
    expect(db.notification.create).not.toHaveBeenCalled();
  });
  it('rotates weekly tips deterministically', () => {
    const now = new Date('2026-11-05T10:00:00Z');
    expect(tipForWeek(false, 'user-1', now)).toEqual(tipForWeek(false, 'user-1', now));
    expect(tipForWeek(false, 'user-1', now)).not.toEqual(tipForWeek(false, 'user-1', new Date(now.getTime() + 7 * 24 * 3600_000)));
  });
});
