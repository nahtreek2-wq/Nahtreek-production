import {BadRequestException, Injectable, NotFoundException} from '@nestjs/common';
import {SupportReplyAuthor, SupportTicketStatus} from '@prisma/client';
import {PrismaService} from '../../common/prisma/prisma.service';
import {CreateSupportTicketDto, FollowUpSupportTicketDto, ReplySupportTicketDto} from './support.dto';
import {pagination} from '../platform/platform.service';

function clean(value: string): string {
  return value.replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// Human support tickets behind every "contact support" surface in both apps.
// Users file and read their own; admins list open tickets and reply. A reply
// lands as an in-app notification so the user finds it without polling.
@Injectable()
export class SupportService {
  constructor(private readonly db: PrismaService) {}

  async create(userId: string, dto: CreateSupportTicketDto) {
    const subject = clean(dto.subject);
    const message = clean(dto.message);
    if (subject.length < 4 || message.length < 10)
      throw new BadRequestException('Describe the issue in a few words so support can help.');
    return this.db.supportTicket.create({data: {userId, subject, message,
      bookingRef: dto.bookingRef?.trim()?.slice(0, 40) || null}});
  }

  async mine(userId: string, query: {page?: string; limit?: string}) {
    const {page, limit, skip} = pagination(query.page, query.limit);
    const [rows, total] = await this.db.$transaction([
      this.db.supportTicket.findMany({where: {userId}, orderBy: {createdAt: 'desc'}, skip, take: limit,
        include: {replies: {orderBy: {createdAt: 'asc'}}}}),
      this.db.supportTicket.count({where: {userId}}),
    ]);
    return {data: rows, meta: {page, limit, total, totalPages: Math.ceil(total / limit)}};
  }

  // User follow-up: appends to the thread and reopens the ticket so the new
  // message cannot sit invisible behind an ANSWERED/RESOLVED state.
  async followUp(id: string, userId: string, dto: FollowUpSupportTicketDto) {
    const message = clean(dto.message);
    if (message.length < 2) throw new BadRequestException('Write your follow-up first.');
    const ticket = await this.db.supportTicket.findUnique({where: {id}});
    if (!ticket || ticket.userId !== userId) throw new NotFoundException('Support request not found');
    const [reply] = await this.db.$transaction([
      this.db.supportTicketReply.create({data: {ticketId: id, authorRole: SupportReplyAuthor.USER, message}}),
      this.db.supportTicket.update({where: {id}, data: {status: SupportTicketStatus.OPEN}}),
    ]);
    return reply;
  }

  async listForAdmin(query: {status?: string; page?: string; limit?: string}) {
    const {page, limit, skip} = pagination(query.page, query.limit);
    const status = query.status?.trim();
    if (status && !Object.values(SupportTicketStatus).includes(status as SupportTicketStatus))
      throw new BadRequestException('Invalid ticket status');
    const where = status ? {status: status as SupportTicketStatus} : {};
    const [rows, total] = await this.db.$transaction([
      this.db.supportTicket.findMany({where, orderBy: {createdAt: 'desc'}, skip, take: limit,
        include: {user: {select: {displayName: true, phoneNumber: true, email: true}},
          replies: {orderBy: {createdAt: 'asc'}}}}),
      this.db.supportTicket.count({where}),
    ]);
    return {data: rows, meta: {page, limit, total, totalPages: Math.ceil(total / limit)}};
  }

  async reply(id: string, adminUserId: string, dto: ReplySupportTicketDto) {
    const reply = clean(dto.reply);
    if (reply.length < 2) throw new BadRequestException('Write a reply first.');
    const ticket = await this.db.supportTicket.findUnique({where: {id}});
    if (!ticket) throw new NotFoundException('Support request not found');
    const [, updated] = await this.db.$transaction([
      this.db.supportTicketReply.create({data: {ticketId: id, authorRole: SupportReplyAuthor.ADMIN, message: reply}}),
      // adminReply stays as the latest-admin-reply mirror for older readers.
      this.db.supportTicket.update({where: {id},
        data: {adminReply: reply, repliedAt: new Date(), status: SupportTicketStatus.ANSWERED}}),
    ]);
    await this.db.notification.create({data: {userId: ticket.userId, kind: 'support',
      title: 'Support replied', body: reply.slice(0, 140), data: {ticketId: id, destination: 'support'}}});
    await this.db.auditLog.create({data: {userId: adminUserId, entity: 'SupportTicket',
      entityId: id, action: 'SUPPORT_REPLIED', metadata: {}}});
    return updated;
  }

  async resolve(id: string, adminUserId: string) {
    const ticket = await this.db.supportTicket.findUnique({where: {id}});
    if (!ticket) throw new NotFoundException('Support request not found');
    const updated = await this.db.supportTicket.update({where: {id}, data: {status: SupportTicketStatus.RESOLVED}});
    await this.db.auditLog.create({data: {userId: adminUserId, entity: 'SupportTicket',
      entityId: id, action: 'SUPPORT_RESOLVED', metadata: {}}});
    return updated;
  }
}
