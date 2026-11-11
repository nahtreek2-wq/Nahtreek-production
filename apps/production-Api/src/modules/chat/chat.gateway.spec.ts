import {WsException} from '@nestjs/websockets';
import {ChatGateway} from './chat.gateway';

function setup(over: {payload?: any; session?: any; participant?: boolean} = {}) {
  const jwtService = {verifyAsync: jest.fn(async () => {
    if (!over.payload) throw new Error('bad token');
    return over.payload;
  })};
  const prisma = {session: {findFirst: jest.fn(async () => over.session ?? null)}};
  const chatService = {assertConversationParticipant: jest.fn(async () => {
    if (over.participant === false) throw new Error('not a participant');
  })};
  const gateway = new ChatGateway(jwtService as any, prisma as any, chatService as any);
  return {gateway, jwtService, prisma, chatService};
}

function socket(auth?: any, headers: any = {}) {
  return {handshake: {auth, headers}, data: {}, join: jest.fn(), disconnect: jest.fn()} as any;
}

const payload = {sub: 'user-1', sid: 'session-1'};

describe('chat gateway hostile network (F-214)', () => {
  it('disconnects sockets with no token', async () => {
    const {gateway} = setup({payload, session: {id: 'session-1'}});
    const client = socket(undefined);
    await gateway.handleConnection(client);
    expect(client.disconnect).toHaveBeenCalledWith(true);
    expect(client.join).not.toHaveBeenCalled();
  });

  it('accepts the token from the Authorization header', async () => {
    const {gateway, jwtService} = setup({payload, session: {id: 'session-1'}});
    const client = socket(undefined, {authorization: 'Bearer token-abc'});
    await gateway.handleConnection(client);
    expect(jwtService.verifyAsync).toHaveBeenCalledWith('token-abc', expect.objectContaining({
      issuer: 'nahtreek-api', audience: 'nahtreek-mobile'}));
    expect(client.join).toHaveBeenCalledWith('user:user-1');
  });

  it('disconnects invalid tokens and dead sessions', async () => {
    const bad = setup({});
    const badClient = socket({token: 'bogus'});
    await bad.gateway.handleConnection(badClient);
    expect(badClient.disconnect).toHaveBeenCalledWith(true);

    const stale = setup({payload, session: null});
    const staleClient = socket({token: 'token-abc'});
    await stale.gateway.handleConnection(staleClient);
    expect(staleClient.disconnect).toHaveBeenCalledWith(true);
    expect(staleClient.join).not.toHaveBeenCalled();
  });

  it('checks the session is live and the account active', async () => {
    const {gateway, prisma} = setup({payload, session: {id: 'session-1'}});
    await gateway.handleConnection(socket({token: 'token-abc'}));
    expect(prisma.session.findFirst).toHaveBeenCalledWith({where: expect.objectContaining({
      id: 'session-1', userId: 'user-1', revokedAt: null, expiresAt: {gt: expect.any(Date)}})});
  });

  it('rejects room joins without auth, id, or membership', async () => {
    const {gateway} = setup({participant: false});
    await expect(gateway.joinConversation(socket(), {conversationId: 'c1'}))
      .rejects.toBeInstanceOf(WsException);
    const authed = socket();
    authed.data.user = payload;
    await expect(gateway.joinConversation(authed, {}))
      .rejects.toBeInstanceOf(WsException);
    await expect(gateway.joinConversation(authed, {conversationId: 'c1'}))
      .rejects.toThrow('not a participant');
    expect(authed.join).not.toHaveBeenCalled();
  });

  it('joins participants to their conversation room', async () => {
    const {gateway, chatService} = setup({participant: true});
    const client = socket();
    client.data.user = payload;
    await expect(gateway.joinConversation(client, {conversationId: 'c1'}))
      .resolves.toEqual({ok: true});
    expect(chatService.assertConversationParticipant).toHaveBeenCalledWith('c1', 'user-1');
    expect(client.join).toHaveBeenCalledWith('conversation:c1');
  });

  it('emits messages and updates to the exact rooms', () => {
    const {gateway} = setup();
    const emit = jest.fn();
    gateway.server = {to: jest.fn(() => ({emit}))} as any;
    gateway.emitMessage('c1', {id: 'm1'});
    expect(gateway.server.to).toHaveBeenCalledWith('conversation:c1');
    expect(emit).toHaveBeenCalledWith('message:created', {id: 'm1'});
    gateway.emitUserUpdate('user-1', 'requests');
    expect(gateway.server.to).toHaveBeenCalledWith('user:user-1');
    expect(emit).toHaveBeenCalledWith('data:changed', {resource: 'requests'});
  });
});
