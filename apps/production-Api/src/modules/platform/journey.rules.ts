export const TERMINAL_STAGES = ['COMPLETED', 'CANCELLED', 'DECLINED', 'EXPIRED'];
export const ACTIVE_STAGES = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'AWAITING_CONFIRMATION', 'DISPUTED'];
export function distanceKm(a: number, b: number, c: number, d: number) {
  const rad = Math.PI / 180;
  const h = Math.sin((c-a)*rad/2)**2 + Math.cos(a*rad)*Math.cos(c*rad)*Math.sin((d-b)*rad/2)**2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
// Preview demo fallback when no routing key is configured: straight-line
// distance at ~30 km/h city driving. Never used in production.
export function demoEtaMinutes(from: {latitude: number; longitude: number}, to: {latitude: number; longitude: number}) {
  return Math.max(1, Math.ceil(distanceKm(from.latitude, from.longitude, to.latitude, to.longitude) / 30 * 60));
}
export function freshLocation(p: {online: boolean; accuracy: number; observedAt: Date} | null, now = Date.now()) {
  return Boolean(p?.online && p.accuracy <= 100 && now - p.observedAt.getTime() <= 120000 && p.observedAt.getTime() <= now + 10000);
}
export function actionStage(stage: string, action: string, client: boolean) {
  const transitions: Record<string, [string[], string, boolean]> = {
    ACCEPT: [['PENDING'], 'ACCEPTED', false], DECLINE: [['PENDING'], 'DECLINED', false],
    DEPART: [['ACCEPTED'], 'EN_ROUTE', false], ARRIVE: [['EN_ROUTE'], 'ARRIVED', false],
    QUOTE: [['ARRIVED', 'IN_PROGRESS'], stage, false], APPROVE_QUOTE: [['ARRIVED', 'IN_PROGRESS'], stage, true],
    START: [['ARRIVED'], 'IN_PROGRESS', false], FINISH: [['IN_PROGRESS'], 'AWAITING_CONFIRMATION', false],
    CONFIRM: [['AWAITING_CONFIRMATION', 'DISPUTED'], 'COMPLETED', true], ISSUE: [['IN_PROGRESS', 'AWAITING_CONFIRMATION'], 'DISPUTED', true],
    CANCEL: [['PENDING', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED'], 'CANCELLED', true],
    RESCHEDULE: [['PENDING', 'ACCEPTED'], stage, true],
  };
  const rule = transitions[action];
  return rule && rule[0].includes(stage) && rule[2] === client ? rule[1] : null;
}
