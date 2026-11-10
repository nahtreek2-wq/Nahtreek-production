import {createLocalPlan, detectLocalServiceIntent, isLocalCompanyQuestion, isLocalOffTopic, localPlannerReply} from '../src/services/localAiPlanner';

it('answers company questions on-device', () => {
  expect(isLocalCompanyQuestion('What is NAHTREEK?')).toBe(true);
  expect(localPlannerReply('UNSURE', 'Tell me about your company')).toMatch(/NAHTREEK connects homeowners/);
});

it('uses cached plan figures when present, generic copy when absent', () => {
  expect(localPlannerReply('UNSURE', 'Tell me about your company', {freeMessages: 5, feePaisa: 12900}))
    .toMatch(/5 free chats, then ₹129\/month/);
  expect(localPlannerReply('UNSURE', 'Tell me about your company', null)).toMatch(/free to start/);
  expect(localPlannerReply('UNSURE', 'Tell me about your company')).not.toMatch(/₹129/);
});

it.each([
  'Who won the cricket match?',
  'Suggest a good movie tonight',
  'Write python code to sort a list',
])('redirects off-topic messages without answering: %s', message => {
  expect(isLocalOffTopic(message)).toBe(true);
  expect(localPlannerReply('UNSURE', message)).toMatch(/only help with home construction/);
});

it.each([
  'My kitchen tap leaks badly',
  'Vastu tips for my new home entrance',
])('keeps construction-adjacent messages in scope: %s', message => {
  expect(isLocalOffTopic(message)).toBe(false);
});

it('uses the structured four-line format in scope', () => {
  const reply = localPlannerReply('REPAIR', 'My bathroom tap leaks');
  expect(reply).toMatch(/Understood:/);
  expect(reply).toMatch(/Do this first:/);
  expect(reply).toMatch(/Watch out:/);
  expect(reply).toMatch(/One question:/);
});

it.each([
  ['My bathroom tap leaks', 'plumbing', 'plumber'],
  ['AC not cooling in the bedroom', 'ac', 'AC technician'],
  ['Need full home deep cleaning', 'cleaning', 'cleaning team'],
])('routes service jobs to providers on-device: %s', (message, serviceId, pro) => {
  expect(detectLocalServiceIntent(message)).toMatchObject({serviceId});
  expect(localPlannerReply('REPAIR', message)).toMatch(new RegExp(pro, 'i'));
  const plan = createLocalPlan({projectType: 'REPAIR', details: message, documentCount: 0});
  expect(plan.recommendations).toEqual([
    expect.objectContaining({action: 'SERVICES', query: serviceId}),
    expect.objectContaining({action: 'REQUESTS', query: serviceId}),
  ]);
});
