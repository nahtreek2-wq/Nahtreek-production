import {PaymentsService} from './payments.service';

// Real PNG rendering takes seconds and flakes under load; live device runs
// already prove the actual QR image. Mock it and assert the data-URL shape.
jest.mock('qrcode', () => ({toDataURL: jest.fn(async (url: string) => `data:image/png;base64,QR:${url}`)}));
import * as QRCode from 'qrcode';

const REQ = 'a3d4fa0c-5efe-4375-946b-7bdcd1bc1b8d';

function setup(req: any, pay: any = null) {
  const db: any = {
    engineerRequest: {findFirst: jest.fn(async () => req)},
    payment: {findUnique: jest.fn(async () => pay)},
  };
  const service = new PaymentsService(db, {} as any, {} as any, {} as any);
  return {db, service};
}

const booking = (over: Record<string, unknown> = {}) => ({
  id: REQ,
  status: 'IN_PROGRESS',
  projectTitle: 'Wall crack',
  engineer: {profile: {userId: 'eng-user'}, consultationFeePaisa: 120000},
  ...over,
});

describe('booking payment QR', () => {
  it('returns a scannable checkout link with the expected amount', async () => {
    const {service} = setup(booking());
    const result = await service.collectQr('eng-user', REQ);
    expect(result.payUrl).toBe(`nahtreek://pay/${REQ}`);
    expect(result.qrPng).toMatch(/^data:image\/png;base64,/);
    expect(QRCode.toDataURL).toHaveBeenCalledWith(result.payUrl, expect.objectContaining({width: 512}));
    expect(result).toMatchObject({title: 'Wall crack', expectedAmountPaisa: 120000});
  });

  it('prefers the open payment row amount over the consultation fee', async () => {
    const {service} = setup(booking(), {status: 'ORDER_CREATED', amountPaisa: 147000, providerPaymentId: null});
    const result = await service.collectQr('eng-user', REQ);
    expect(result.expectedAmountPaisa).toBe(147000);
  });

  it('404s malformed ids and other pros bookings', async () => {
    const {service} = setup(booking());
    await expect(service.collectQr('eng-user', 'not-a-uuid')).rejects.toThrow('Booking not found');
    await expect(service.collectQr('stranger', REQ)).rejects.toThrow('Booking not found');
  });

  it('409s before work starts, after online pay, and after a recorded collection', async () => {
    const pending = setup(booking({status: 'ACCEPTED'}));
    await expect(pending.service.collectQr('eng-user', REQ)).rejects.toThrow(
      'Payment QR is available once the work starts');
    const paid = setup(booking(), {status: 'PAID', providerPaymentId: 'pay_1'});
    await expect(paid.service.collectQr('eng-user', REQ)).rejects.toThrow(
      'This booking was already paid online');
    const recorded = setup(booking(), {status: 'COLLECTED_UNSETTLED', providerPaymentId: null});
    await expect(recorded.service.collectQr('eng-user', REQ)).rejects.toThrow(
      'Direct collection was already recorded for this booking');
  });
});
