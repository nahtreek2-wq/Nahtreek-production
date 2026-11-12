// Explicit preview-only acceptance check. Never uses real customer accounts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const base = 'https://nahtreek-api.vercel.app/api/v1';
const runId = `QA-${new Date().toISOString()}`;
const results = [];
const created = [];
const sessions = {};
function record(name, status, details) {
  const row = {name, status, ...(details ? {details} : {})};
  results.push(row);
  console.log(JSON.stringify(row));
}
async function call(role, method, route, data, expected) {
  const response = await fetch(base + route, {
    method, signal: AbortSignal.timeout(45000),
    headers: {'Content-Type': 'application/json', ...(sessions[role] ? {Authorization: `Bearer ${sessions[role].accessToken}`} : {})},
    ...(data === undefined ? {} : {body: JSON.stringify(data)}),
  });
  const body = await response.json().catch(() => ({}));
  if (expected !== undefined) assert.equal(response.status, expected, `${method} ${route}: ${response.status} ${body.message ?? ''}`);
  else assert.ok(response.ok, `${method} ${route}: ${response.status} ${body.message ?? ''}`);
  return body;
}
async function check(name, fn) {
  try {await fn(); record(name, 'PASS');} catch (error) {record(name, 'FAIL', error.message);}
}
async function messages(role, kind, id) {
  const conversation = await call('client', 'POST', '/conversations', {[kind === 'engineer' ? 'engineerRequestId' : 'serviceRequestId']: id});
  for (const [from, to] of [['client', role], [role, 'client']]) {
    const sent = await call(from, 'POST', `/conversations/${conversation.id}/messages`, {content: `${runId} ${from} delivery test`});
    const received = await call(to, 'GET', `/conversations/${conversation.id}/messages`);
    assert.ok(received.some(row => row.id === sent.id && row.content === sent.content));
  }
  await call(role, 'PATCH', `/conversations/${conversation.id}/read`, {});
  record(`${kind}: messages persisted in both directions`, 'PASS');
  await check(`${kind}: live socket message delivery`, async () => {
    const {io} = require(path.join(root, 'node_modules/socket.io-client'));
    const socket = io(base.replace('/api/v1', '') + '/chat', {transports: ['websocket'], reconnection: false, timeout: 10000, auth: {token: sessions[role].accessToken}});
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Socket join timed out')), 15000);
        socket.once('connect_error', () => {clearTimeout(timer); reject(Error('Socket connection failed'));});
        socket.once('exception', error => {clearTimeout(timer); reject(Error(error.message || 'Socket authorization failed'));});
        socket.once('connect', () => socket.timeout(10000).emit('conversation:join', {conversationId: conversation.id}, (error, ack) => {
          clearTimeout(timer);
          if (error || !ack?.ok) reject(Error('Conversation room join failed')); else resolve();
        }));
      });
      const content = `${runId} socket delivery`;
      let timer;
      const arrival = new Promise(resolve => {
        timer = setTimeout(() => resolve(false), 12000);
        socket.on('message:created', message => {if (message.content === content) {clearTimeout(timer); resolve(true);}});
      });
      try {
        await call('client', 'POST', `/conversations/${conversation.id}/messages`, {content});
        assert.equal(await arrival, true, 'Message saved but live socket event did not arrive');
      } finally {clearTimeout(timer);}
    } finally {socket.disconnect();}
  });
}
async function main() {
  assert.equal(process.env.NAHTREEK_PREVIEW_VERIFY, 'yes', 'Set NAHTREEK_PREVIEW_VERIFY=yes explicitly');
  const demoCode = (process.env.PREVIEW_DEMO_OTP || '').trim();
  assert.match(demoCode, /^\d{6}$/, 'Set PREVIEW_DEMO_OTP to the preview demo code');
  const roster = JSON.parse(fs.readFileSync(path.join(root, 'NAHTREEK-preview-demo-credentials.json'), 'utf8'));
  for (const role of ['client', 'engineer', 'provider']) {
    const email = `${role}-01.preview@nahtreek.example`;
    assert.ok(roster[email], 'Missing fictional test account');
    await call(null, 'POST', '/auth/email-otp/request', {email});
    sessions[role] = await call(null, 'POST', '/auth/otp/verify', {email, code: demoCode});
    assert.ok(sessions[role].accessToken);
    record(`${role}: deployed OTP login`, 'PASS');
  }
  const profiles = {};
  for (const role of ['engineer', 'provider']) {
    profiles[role] = (await call(role, 'GET', '/professionals/me')).profile;
    assert.match(profiles[role].fullName, /\(Demo\)/);
    for (const route of ['/professionals/me', '/professionals/me/availability', '/professionals/me/verification-documents', '/conversations', '/notifications', '/notifications/preferences', '/history/me', '/engineer-requests', '/service-requests']) {
      await check(`${role}: GET ${route}`, () => call(role, 'GET', route, undefined, role === 'provider' && route === '/engineer-requests' ? 403 : 200));
    }
    await check(`${role}: availability save/read/delete`, async () => {
      const startsAt = new Date(Date.now() + 20 * 86400000).toISOString();
      const endsAt = new Date(Date.now() + 20 * 86400000 + 3600000).toISOString();
      const slot = await call(role, 'POST', '/professionals/me/availability', {startsAt, endsAt});
      try {
        const list = await call(role, 'GET', '/professionals/me/availability');
        assert.ok(list.slots.some(row => row.id === slot.id));
        await call(role, 'POST', '/professionals/me/availability', {startsAt, endsAt}, 409);
      } finally {await call(role, 'DELETE', `/professionals/me/availability/${slot.id}`);}
    });
  }
  await check('engineer: live exact booking → accept → chat → complete', async () => {
    const p = profiles.engineer;
    const booking = await call('client', 'POST', '/engineer-requests', {
      engineerProfileId: p.engineerProfile.id, projectTitle: `${runId} inspection`,
      projectDescription: 'Synthetic preview acceptance test. No real visit required.', propertyType: 'Residential',
      locationAddress: 'Synthetic QA address, Coimbatore', latitude: p.baseLatitude, longitude: p.baseLongitude,
    });
    created.push({kind: 'engineer', id: booking.id});
    const inbox = await call('engineer', 'GET', '/engineer-requests');
    assert.ok(inbox.data.some(row => row.id === booking.id));
    await call('provider', 'GET', `/engineer-requests/${booking.id}`, undefined, 403);
    await call('engineer', 'PATCH', `/engineer-requests/${booking.id}/status`, {status: 'ACCEPTED'});
    assert.equal((await call('client', 'GET', `/engineer-requests/${booking.id}`)).status, 'ACCEPTED');
    await messages('engineer', 'engineer', booking.id);
    await call('engineer', 'PATCH', `/engineer-requests/${booking.id}/status`, {status: 'IN_PROGRESS'});
    await call('engineer', 'PATCH', `/engineer-requests/${booking.id}/status`, {status: 'COMPLETED'});
    assert.equal((await call('client', 'GET', `/engineer-requests/${booking.id}`)).status, 'COMPLETED');
    record('engineer booking ID', 'INFO', booking.id);
  });
  await check('service: live scheduled workflow including quote/start-code/client completion', async () => {
    const p = profiles.provider;
    assert.equal(p.isAvailable, true, 'Demo provider is paused; no unrelated settings changed');
    const presence = () => call('provider', 'POST', '/service-workflow/presence', {online: true, latitude: p.baseLatitude, longitude: p.baseLongitude, accuracy: 10, observedAt: new Date().toISOString()});
    const payload = {professionalProfileId: p.id, serviceId: p.serviceCategories[0], mode: 'SCHEDULED',
      latitude: p.baseLatitude, longitude: p.baseLongitude, description: `${runId} synthetic plumbing acceptance test; no visit required`,
      locationAddress: 'Synthetic QA address, Coimbatore', recipientName: 'Preview QA client', recipientPhone: sessions.client.user.phoneNumber,
      recipientConsent: true, scheduledAt: new Date(Date.now() + 45 * 60000).toISOString(), idempotencyKey: randomUUID()};
    const booking = await call('client', 'POST', '/service-workflow/book', payload);
    created.push({kind: 'service', id: booking.id});
    assert.equal((await call('client', 'POST', '/service-workflow/book', payload)).id, booking.id);
    assert.ok((await call('provider', 'GET', '/service-requests')).data.some(row => row.id === booking.id));
    await call('engineer', 'GET', `/service-workflow/${booking.id}`, undefined, 404);
    let journey = await call('provider', 'GET', `/service-workflow/${booking.id}`);
    const act = async (role, action, extra = {}) => {
      journey = await call(role, 'POST', `/service-workflow/${booking.id}/actions`, {action, revision: journey.revision, ...extra});
      record(`service action ${action}`, 'PASS');
    };
    try {
      await presence(); await act('provider', 'ACCEPT');
      await messages('provider', 'service', booking.id);
      await presence(); await act('provider', 'DEPART');
      assert.equal((await call('client', 'GET', `/service-workflow/${booking.id}`)).tracking.stale, false);
      await presence(); await act('provider', 'ARRIVE');
      const customer = await call('client', 'GET', `/service-workflow/${booking.id}`);
      assert.match(customer.startCode, /^\d{6}$/);
      await act('provider', 'QUOTE', {amount: 250, note: 'Synthetic test scope; no money is charged or collected.'});
      await act('client', 'APPROVE_QUOTE');
      await act('provider', 'START', {code: customer.startCode});
      await act('provider', 'FINISH', {note: 'Synthetic QA test completed; no physical work performed.'});
      await act('client', 'CONFIRM');
      assert.equal(journey.stage, 'COMPLETED');
      assert.equal((await call('client', 'GET', `/service-requests/${booking.id}`)).status, 'COMPLETED');
      record('service booking ID', 'INFO', booking.id);
    } finally {
      await call('provider', 'POST', '/service-workflow/presence', {online: false, latitude: p.baseLatitude, longitude: p.baseLongitude, accuracy: 10, observedAt: new Date().toISOString()});
    }
  });
  for (const role of ['client', 'engineer', 'provider']) {
    await check(`${role}: generated request notifications exist`, async () => {
      const inbox = await call(role, 'GET', '/notifications?limit=100');
      assert.ok(inbox.data.some(n => created.some(r => JSON.stringify(n.data).includes(r.id))));
    });
  }
  await check('deployed WebSocket connection', async () => {
    const {io} = require(path.join(root, 'node_modules/socket.io-client'));
    await new Promise((resolve, reject) => {
      const socket = io(base.replace('/api/v1', '') + '/chat', {transports: ['websocket'], reconnection: false, timeout: 10000, auth: {token: sessions.engineer.accessToken}});
      const timer = setTimeout(() => {socket.disconnect(); reject(Error('WebSocket handshake timed out; HTTP polling remains active'));}, 12000);
      socket.once('connect', () => {clearTimeout(timer); socket.disconnect(); resolve();});
      socket.once('connect_error', () => {clearTimeout(timer); socket.disconnect(); reject(Error('WebSocket handshake rejected; HTTP polling remains active'));});
    });
  });
}
main().catch(error => record('runner', 'FAIL', error.message)).finally(() => {
  const report = {runId, base, results, created};
  fs.writeFileSync('/private/tmp/nahtreek-preview-verification.json', JSON.stringify(report, null, 2), {mode: 0o600});
  if (results.some(row => row.status === 'FAIL')) process.exitCode = 1;
});
