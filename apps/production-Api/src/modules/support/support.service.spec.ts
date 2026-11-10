import {SupportService} from './support.service';

function setup(tickets: any[] = []) {
  const db: any = {
    supportTicket: {
      create: jest.fn(async ({data}: any) => ({id: 't1', status: 'OPEN', adminReply: null, repliedAt: null,
        createdAt: new Date(), updatedAt: new Date(), ...data})),
      findMany: jest.fn(async () => tickets),
      findUnique: jest.fn(async ({where}: any) => tickets.find(t => t.id === where.id) ?? null),
      update: jest.fn(async ({where, data}: any) => {
        const row = tickets.find(t => t.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      }),
      count: jest.fn(async () => tickets.length),
    },
    notification: {create: jest.fn()},
    auditLog: {create: jest.fn()},
  };
  (db as any).$transaction = jest.fn((arg: any) => Promise.all(arg));
  return {db, service: new SupportService(db)};
}

describe('support tickets', () => {
  it('files a ticket with cleaned text and an optional booking ref', async () => {
    const {db, service} = setup();
    const created = await service.create('u1', {subject: '  Refund stuck  ',
      message: 'My refund\n\n\n\nnever arrived.', bookingRef: '  req-abc  '});
    expect(db.supportTicket.create).toHaveBeenCalledWith({data: {userId: 'u1', subject: 'Refund stuck',
      message: 'My refund\n\nnever arrived.', bookingRef: 'req-abc'}});
    expect(created).toMatchObject({status: 'OPEN'});
  });

  it('rejects one-word tickets that support cannot act on', async () => {
    const {service} = setup();
    await expect(service.create('u1', {subject: 'Help', message: 'stuck'})).rejects.toThrow();
  });

  it('lists only the caller’s own tickets, newest first', async () => {
    const rows = [{id: 't1', userId: 'u1', subject: 'A', message: 'message one here', status: 'OPEN'}];
    const {db, service} = setup(rows);
    const result = await service.mine('u1', {});
    expect(db.supportTicket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({where: {userId: 'u1'}, orderBy: {createdAt: 'desc'}}));
    expect(result.data).toHaveLength(1);
  });

  it('an admin reply marks the ticket answered and notifies the user', async () => {
    const rows = [{id: 't1', userId: 'u1', subject: 'A', message: 'message one here', status: 'OPEN'}];
    const {db, service} = setup(rows);
    const updated = await service.reply('t1', 'admin', {reply: '  Refund re-issued.  '});
    expect(updated).toMatchObject({status: 'ANSWERED', adminReply: 'Refund re-issued.'});
    expect(db.notification.create).toHaveBeenCalledWith(expect.objectContaining(
      {data: expect.objectContaining({userId: 'u1', kind: 'support'})}));
    expect(db.auditLog.create).toHaveBeenCalled();
  });

  it('resolving closes the ticket with an audit trail', async () => {
    const rows = [{id: 't1', userId: 'u1', subject: 'A', message: 'message one here', status: 'ANSWERED'}];
    const {db, service} = setup(rows);
    const updated = await service.resolve('t1', 'admin');
    expect(updated.status).toBe('RESOLVED');
    expect(db.auditLog.create).toHaveBeenCalled();
  });
});
