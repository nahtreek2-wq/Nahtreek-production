import {actionStage,demoEtaMinutes,distanceKm,freshLocation} from './journey.rules';
describe('service journey rules',()=>{
 it('rejects skipped steps and role violations',()=>{
  expect(actionStage('PENDING','FINISH',false)).toBeNull();
  expect(actionStage('PENDING','ACCEPT',true)).toBeNull();
  expect(actionStage('ARRIVED','START',false)).toBe('IN_PROGRESS');
  expect(actionStage('AWAITING_CONFIRMATION','CONFIRM',false)).toBeNull();
  expect(actionStage('AWAITING_CONFIRMATION','CONFIRM',true)).toBe('COMPLETED');
  expect(actionStage('COMPLETED','CANCEL',true)).toBeNull();
  expect(actionStage('PENDING','CANCEL',false)).toBeNull();
  expect(actionStage('PENDING','CANCEL',true)).toBe('CANCELLED');
 });
 it('lets only the client reschedule before work starts',()=>{
  expect(actionStage('PENDING','RESCHEDULE',true)).toBe('PENDING');
  expect(actionStage('ACCEPTED','RESCHEDULE',true)).toBe('ACCEPTED');
  expect(actionStage('PENDING','RESCHEDULE',false)).toBeNull();
  expect(actionStage('EN_ROUTE','RESCHEDULE',true)).toBeNull();
 });
 it('only exposes precise recent positions as fresh',()=>{
  const p={online:true,accuracy:20,observedAt:new Date()};
  expect(freshLocation(p)).toBe(true);
  expect(freshLocation({...p,accuracy:500})).toBe(false);
  expect(freshLocation({...p,observedAt:new Date(Date.now()-121000)})).toBe(false);
  expect(freshLocation({...p,online:false})).toBe(false);
 });
 it('measures coverage in kilometres',()=>{
  expect(distanceKm(11,77,11,77)).toBe(0);
  expect(distanceKm(11,77,12,77)).toBeCloseTo(111.19,1);
 });
 it('estimates demo ETAs at city speed with a one-minute floor',()=>{
  expect(demoEtaMinutes({latitude:11,longitude:77},{latitude:11,longitude:77})).toBe(1);
  // ~11.1 km straight-line at 30 km/h -> 23 minutes.
  expect(demoEtaMinutes({latitude:12.9,longitude:77.6},{latitude:13,longitude:77.6})).toBe(23);
 });
});
