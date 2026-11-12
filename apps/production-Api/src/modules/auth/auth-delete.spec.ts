import {createHmac} from 'crypto';
import {AuthService} from './auth.service';

const OTP_PEPPER = 'unit-test-only-otp-pepper';
const previousOtpSecret = process.env.OTP_SECRET;
process.env.OTP_SECRET = OTP_PEPPER;
afterAll(() => {
  if (previousOtpSecret === undefined) delete process.env.OTP_SECRET;
  else process.env.OTP_SECRET = previousOtpSecret;
});
const otpHash = (code: string) => createHmac('sha256', OTP_PEPPER).update(code).digest('hex');

function setup(user: any, dues = 0, byEmail = false) {
  const tx: any = {
    otpChallenge: {deleteMany: jest.fn().mockResolvedValue({count: 1})},
  };
  const prisma: any = {
    user: {findUnique: jest.fn().mockResolvedValue(user), update: jest.fn().mockResolvedValue({})},
    otpChallenge: {
      findUnique: jest.fn().mockResolvedValue({
        codeHash: otpHash('345678'),
        purpose: 'OTP_AUTH',
        attempts: 0,
        expiresAt: new Date(Date.now() + 300000),
      }),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn((fn: any) => fn(tx)),
    payment: {aggregate: jest.fn().mockResolvedValue({_sum: {platformFeePaisa: dues}})},
    professionalPenalty: {aggregate: jest.fn().mockResolvedValue({_sum: {amountPaisa: 0}})},
    auditLog: {create: jest.fn().mockResolvedValue({})},
  };
  const service = new AuthService({} as any, prisma, {} as any,
    {isEnabled: () => byEmail} as any);
  return {service, prisma, tx};
}

const user = (over: Record<string, unknown> = {}) => ({id: 'u1', deletedAt: null,
  phoneNumber: '+919000012345', email: 'qa@example.com', professionalProfile: null, ...over});

describe('delete account', () => {
  it('rejects a missing verification code', async () => {
    const {service} = setup(user());
    await expect(service.deleteAccount('u1', undefined)).rejects.toThrow('verification code');
  });

  it('rejects a wrong verification code', async () => {
    const {service, prisma} = setup(user());
    await expect(service.deleteAccount('u1', '999999')).rejects.toThrow('Incorrect verification code');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('blocks pros with unsettled dues', async () => {
    const {service, prisma} = setup(user({professionalProfile: {id: 'pp'}}), 25000);
    await expect(service.deleteAccount('u1', '345678')).rejects.toThrow('commission dues');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('soft-deletes and revokes sessions after OTP proof', async () => {
    const {service, prisma, tx} = setup(user());
    const out = await service.deleteAccount('u1', '345678');
    expect(out).toEqual({deleted: true});
    expect(tx.otpChallenge.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({identifier: '+919000012345', purpose: 'OTP_AUTH'}),
    });
    expect(prisma.user.update).toHaveBeenCalledWith({where: {id: 'u1'},
      data: {deletedAt: expect.any(Date), authVersion: {increment: 1}}});
  });

  it('proves presence by email in Preview email-OTP mode', async () => {
    const {service, tx} = setup(user(), 0, true);
    await service.deleteAccount('u1', '345678');
    expect(tx.otpChallenge.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({identifier: 'qa@example.com', purpose: 'OTP_AUTH'}),
    });
  });
});
