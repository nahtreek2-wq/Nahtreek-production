import * as bcrypt from 'bcrypt';
import {AuthService} from './auth.service';

function setup(user: any, dues = 0) {
  const prisma: any = {
    user: {findUnique: jest.fn().mockResolvedValue(user), update: jest.fn().mockResolvedValue({})},
    payment: {aggregate: jest.fn().mockResolvedValue({_sum: {platformFeePaisa: dues}})},
    professionalPenalty: {aggregate: jest.fn().mockResolvedValue({_sum: {amountPaisa: 0}})},
    auditLog: {create: jest.fn().mockResolvedValue({})},
  };
  const service = new AuthService({} as any, prisma, {} as any, {} as any);
  return {service, prisma};
}

const user = (over: Record<string, unknown> = {}) => ({id: 'u1', deletedAt: null,
  passwordHash: bcrypt.hashSync('correct-horse', 4), professionalProfile: null, ...over});

describe('delete account', () => {
  it('rejects a wrong password', async () => {
    const {service} = setup(user());
    await expect(service.deleteAccount('u1', 'nope')).rejects.toThrow('Password did not match');
  });

  it('blocks pros with unsettled dues', async () => {
    const {service} = setup(user({professionalProfile: {id: 'pp'}}), 25000);
    await expect(service.deleteAccount('u1', 'correct-horse')).rejects.toThrow('commission dues');
  });

  it('soft-deletes and revokes sessions', async () => {
    const {service, prisma} = setup(user());
    const out = await service.deleteAccount('u1', 'correct-horse');
    expect(out).toEqual({deleted: true});
    expect(prisma.user.update).toHaveBeenCalledWith({where: {id: 'u1'},
      data: {deletedAt: expect.any(Date), authVersion: {increment: 1}}});
  });
});
