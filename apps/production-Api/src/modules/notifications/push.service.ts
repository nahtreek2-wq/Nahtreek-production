import {ForbiddenException, Injectable} from '@nestjs/common';
import {NotificationKind, PushState} from '@prisma/client';
import {PrismaService} from '../../common/prisma/prisma.service';
import {JwtPayload} from '../../common/strategies/jwt.strategy';
import {FcmProvider} from './fcm.provider';
import {allowsNotification, DEFAULT_NOTIFICATION_PREFERENCES, inTipHours} from './preferences';

// Deep-link payload for the Android tap-through. Every value must be a string
// (FCM data constraint); the app ignores unknown destinations by opening Home.
export function pushDestinationFor(row: {kind: string; data?: unknown}): Record<string, string> {
  const data = (row.data && typeof row.data === 'object' ? row.data : {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
  const serviceRequestId = text(data.serviceRequestId);
  const conversationId = text(data.conversationId);
  if (row.kind === 'message' && conversationId) {
    const senderName = text(data.senderName);
    return {destination: 'chat', conversationId, ...(senderName ? {senderName} : {})};
  }
  if ((row.kind === 'request' || row.kind === 'reminder' || row.kind === 'tracking') && serviceRequestId) {
    return {destination: 'service-request', serviceRequestId};
  }
  if (row.kind === 'offer') {
    const destination = text(data.destination);
    return {destination: destination === 'profile' || destination === 'discover' ? destination : 'home'};
  }
  const destination = text(data.destination);
  if (destination === 'chat' && conversationId) return {destination, conversationId};
  if (destination === 'service-request' && serviceRequestId) return {destination, serviceRequestId};
  if (destination === 'home' || destination === 'discover' || destination === 'notifications') return {destination};
  return {destination: 'notifications'};
}

const CLIENT_TIPS: [string, string][] = [
  ['Leak today, flood tomorrow', 'A dripping tap wastes 5,000+ litres a year. Verified plumbers near you fix it in one visit.'],
  ['Monsoon-proof your home', 'Terrace waterproofing now beats ceiling repairs later. Compare verified pros before the rains.'],
  ['Paint season is here', 'A fresh coat before the festivals? See trusted painters with real ratings in your area.'],
  ['That buzzing switchboard?', 'Loose wiring is the top cause of home electrical faults. Get it checked this week.'],
  ['Deep clean, zero effort', 'Kitchen, bathrooms, sofas — book a verified cleaning crew and skip the weekend chore.'],
  ['Plan before you build', 'A 30-minute engineer consult can save lakhs on your project. Ask NAHTREEK AI first, it is free.'],
];

const PRO_TIPS: [string, string][] = [
  ['More jobs start with photos', 'Profiles with 5+ work photos get picked first. Add yours in under a minute.'],
  ['Stay available, stay booked', 'Pros online right now win the urgent jobs. Switch yourself available.'],
  ['Quotes win in hours, not days', 'Customers pick the first clear quote most of the time. Reply fast.'],
  ['Reviews are your billboard', 'Ask every happy customer for a rating. It compounds into steady work.'],
];

export function tipForWeek(professional: boolean, userId: string, now = new Date()): [string, string] {
  const list = professional ? PRO_TIPS : CLIENT_TIPS;
  const week = Math.floor(now.getTime() / (7 * 24 * 60 * 60_000));
  const hash = [...userId].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return list[(week + hash) % list.length];
}

@Injectable()
export class PushService {
  constructor(private readonly prisma: PrismaService, private readonly fcm: FcmProvider) {}

  async register(user: JwtPayload, token: string, app: string) {
    const allowed = app === 'client' ? user.roles.includes('CLIENT') : user.roles.some(r => r === 'ENGINEER' || r === 'SERVICE_PROVIDER');
    if (!allowed) throw new ForbiddenException('This app is not available for your account');
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "Session" WHERE "id" = ${user.sid} FOR UPDATE`;
      await tx.pushDevice.deleteMany({where: {sessionId: user.sid, app, token: {not: token}}});
      await tx.pushDevice.upsert({where: {token},
        create: {token, app, userId: user.sub, sessionId: user.sid},
        update: {app, userId: user.sub, sessionId: user.sid}});
    });
    return {ok: true};
  }

  async unregister(userId: string, token: string) {
    await this.prisma.pushDevice.deleteMany({where: {token, userId}});
    return {ok: true};
  }

  async dispatch(requestId?: string, dataKey: 'serviceRequestId' | 'engineerRequestId' = 'serviceRequestId') {
    if (!this.fcm.enabled) return {enabled: false, processed: 0};
    const now = new Date();
    if (!requestId) {
      await this.queueTips(now);
      await this.queueReminders(now);
    }
    const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    await this.prisma.notification.updateMany({where: {pushState: PushState.PENDING, createdAt: {lt: cutoff}}, data: {pushState: PushState.SKIPPED}});
    const rows = await this.prisma.notification.findMany({where: {pushState: PushState.PENDING, pushAfter: {lte: now},
      ...(requestId ? {data: {path: [dataKey], equals: requestId}} : {}),
      OR: [{pushLeaseUntil: null}, {pushLeaseUntil: {lt: now}}]}, orderBy: {createdAt: 'asc'}, take: 10});
    let processed = 0;
    // Bounded batches, durable retries and a lease permit multiple worker instances.
    await Promise.allSettled(rows.map(async row => {
      if (row.kind === 'offer' && !inTipHours(now)) {
        await this.prisma.notification.updateMany({where: {id: row.id, pushState: PushState.PENDING,
          OR: [{pushLeaseUntil: null}, {pushLeaseUntil: {lt: now}}]}, data: {pushAfter: new Date(now.getTime() + 60 * 60_000)}});
        return;
      }
      const lease = await this.prisma.notification.updateMany({where: {id: row.id, pushState: PushState.PENDING,
        OR: [{pushLeaseUntil: null}, {pushLeaseUntil: {lt: now}}]},
        data: {pushLeaseUntil: new Date(now.getTime() + 120_000), pushAttempts: {increment: 1}}});
      if (!lease.count) return;
      const preference = await this.prisma.notificationPreference.findUnique({where: {userId: row.userId}});
      if (!allowsNotification(row.kind, preference ?? DEFAULT_NOTIFICATION_PREFERENCES)) {
        await this.prisma.notification.update({where: {id: row.id}, data: {pushState: PushState.SKIPPED, pushLeaseUntil: null}});
        return;
      }
      const devices = await this.prisma.pushDevice.findMany({where: {userId: row.userId,
        user: {status: 'ACTIVE', deletedAt: null}, session: {revokedAt: null, expiresAt: {gt: now}}}, include: {session: true, user: {select: {authVersion: true}}}});
      const active = devices.filter(d => d.session.authVersion === d.user.authVersion);
      const outcomes = await Promise.all(active.map(async device => {
        const result = await this.fcm.send(device.token, row.id, row.kind, row.title, row.body, pushDestinationFor(row));
        if (result === 'unregistered') await this.prisma.pushDevice.deleteMany({where: {id: device.id, token: device.token}});
        return result;
      }));
      const failed = outcomes.includes('retry');
      const waitingForDevice = !failed && !outcomes.includes('sent');
      await this.prisma.notification.update({where: {id: row.id}, data: {
        pushState: failed ? (row.pushAttempts >= 4 ? PushState.FAILED : PushState.PENDING) : waitingForDevice ? PushState.PENDING : PushState.SENT,
        // A signed-out device may register again. Preserve the notification
        // until the existing 24-hour cutoff without consuming send retries.
        ...(waitingForDevice ? {pushAttempts: {decrement: 1}} : {}),
        pushLeaseUntil: null, pushAfter: new Date(Date.now() + (waitingForDevice ? 60_000 : Math.min(3600, 30 * 2 ** row.pushAttempts) * 1000)),
      }});
      processed++;
    }));
    return {enabled: true, processed};
  }

  private async queueTips(now: Date) {
    if (!inTipHours(now)) return;
    const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
    const due = await this.prisma.notificationPreference.findMany({
      where: {offers: true, OR: [{lastTipAt: null}, {lastTipAt: {lt: cutoff}}],
        user: {status: 'ACTIVE', deletedAt: null, pushDevices: {some: {session: {revokedAt: null, expiresAt: {gt: now}}}}}},
      include: {user: {select: {roles: true}}}, take: 20, orderBy: {userId: 'asc'},
    });
    for (const item of due) await this.prisma.$transaction(async tx => {
      const claimed = await tx.notificationPreference.updateMany({where: {userId: item.userId, offers: true,
        OR: [{lastTipAt: null}, {lastTipAt: {lt: cutoff}}]}, data: {lastTipAt: now}});
      if (!claimed.count) return;
      const professional = item.user.roles.some(role => role.role === 'ENGINEER' || role.role === 'SERVICE_PROVIDER');
      const [title, body] = tipForWeek(professional, item.userId, now);
      await tx.notification.create({data: {userId: item.userId, kind: NotificationKind.offer, title, body,
        data: {destination: professional ? 'profile' : 'home', category: 'weekly-tip'},
      }});
    });
  }

  private async queueReminders(now: Date) {
    const inDay = new Date(now.getTime() + 24 * 60 * 60_000);
    const stale = new Date(now.getTime() - 6 * 60 * 60_000);
    const recent = new Date(now.getTime() - 20 * 60 * 60_000);
    const due = await this.prisma.serviceJourney.findMany({
      where: {stage: {in: ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS']},
        OR: [{scheduledAt: {gt: now, lte: inDay}}, {quoteAmountPaisa: {not: null}, quoteAccepted: false, updatedAt: {lt: stale}}]},
      include: {request: {include: {client: {select: {userId: true}}, provider: {select: {userId: true, fullName: true}},
        category: {select: {title: true}}}}},
      take: 20, orderBy: {updatedAt: 'asc'},
    });
    for (const journey of due) {
      const requestId = journey.requestId;
      const already = await this.prisma.notification.count({where: {kind: NotificationKind.reminder, createdAt: {gte: recent},
        data: {path: ['serviceRequestId'], equals: requestId}}});
      if (already) continue;
      const proName = journey.request.provider.fullName?.split(' ')[0] || 'your professional';
      const service = journey.request.category.title || 'service';
      if (journey.quoteAmountPaisa !== null && journey.quoteAmountPaisa !== undefined && !journey.quoteAccepted && journey.updatedAt < stale) {
        const amount = `₹${Math.round(journey.quoteAmountPaisa / 100).toLocaleString('en-IN')}`;
        await this.prisma.notification.create({data: {userId: journey.request.client.userId, kind: NotificationKind.reminder,
          title: `Your ${amount} quote is waiting`,
          body: `${proName} sent the ${service} quote. Approve it in one tap and work can start.`,
          data: {serviceRequestId: requestId, category: 'quote-nudge'},
        }});
        continue;
      }
      if (journey.scheduledAt && journey.scheduledAt > now && journey.scheduledAt <= inDay) {
        const when = new Intl.DateTimeFormat('en-IN', {weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata'}).format(journey.scheduledAt);
        await this.prisma.notification.create({data: {userId: journey.request.client.userId, kind: NotificationKind.reminder,
          title: `${proName} visits ${when}`,
          body: `Your ${service} visit is coming up. Keep the start code ready in the request.`,
          data: {serviceRequestId: requestId, category: 'visit-reminder'},
        }});
      }
    }
  }
}
