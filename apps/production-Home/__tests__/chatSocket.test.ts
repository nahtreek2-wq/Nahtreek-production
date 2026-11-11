jest.mock('socket.io-client', () => ({io: jest.fn(() => ({id: 'socket-1'}))}));

describe('chat socket hostile network (F-214)', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('stays offline when no socket base is configured', () => {
    jest.doMock('../src/services/config', () => ({SOCKET_BASE: ''}));
    const {io} = require('socket.io-client');
    const {openChatSocket} = require('../src/services/chatSocket');
    expect(openChatSocket('token')).toBeNull();
    expect(io).not.toHaveBeenCalled();
  });

  it('bounds retries and the handshake on hostile networks', () => {
    jest.doMock('../src/services/config', () => ({SOCKET_BASE: 'https://api.example.com'}));
    const {io} = require('socket.io-client');
    const {openChatSocket} = require('../src/services/chatSocket');
    expect(openChatSocket('token')).toEqual({id: 'socket-1'});
    expect(io).toHaveBeenCalledWith('https://api.example.com/chat', expect.objectContaining({
      transports: ['websocket'],
      auth: {token: 'token'},
      reconnectionAttempts: 5,
      timeout: 8_000,
    }));
  });
});
