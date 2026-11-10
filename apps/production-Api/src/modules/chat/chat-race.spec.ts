import {Prisma} from '@prisma/client';
import {ChatService} from './chat.service';

const req = {id: 'req-1', status: 'ACCEPTED', client: {userId: 'client-user'},
  engineer: {profile: {userId: 'eng-user', fullName: 'Eng'}}};
const conv = (over: Record<string, unknown> = {}) => ({id: 'conv-1', engineerRequestId: 'req-1',
  serviceRequestId: null,
  participants: [
    {userId: 'client-user', user: {clientProfile: {fullName: 'Asha', avatarUrl: null}, professionalProfile: null}},
    {userId: 'eng-user', user: {clientProfile: null, professionalProfile: {fullName: 'Eng', avatarUrl: null}}},
  ],
  messages: [], engineerRequest: {projectTitle: 'Wall crack', status: 'ACCEPTED', engineer: {profile: {fullName: 'Eng'}}},
  serviceRequest: null, ...over});

function setup() {
  const winner = conv();
  const db: any = {
    engineerRequest: {findUnique: jest.fn().mockResolvedValue(req)},
    conversation: {
      findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValue(winner),
      create: jest.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002', clientVersion: 'test'})),
    },
  };
  return {service: new ChatService(db)};
}

describe('conversation creation race', () => {
  it('returns the winning conversation instead of a duplicate', async () => {
    const {service} = setup();
    const view = await service.create('client-user', {engineerRequestId: 'req-1'} as any);
    expect(view.id).toBe('conv-1');
  });

  it('carries the request status so apps can tell same-title jobs apart', async () => {
    const {service} = setup();
    const view = await service.create('client-user', {engineerRequestId: 'req-1'} as any);
    expect(view.requestStatus).toBe('ACCEPTED');
    expect(view.requestId).toBe('req-1');
  });
});
