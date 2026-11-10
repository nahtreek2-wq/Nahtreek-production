import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RequestStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';

// Pros clarify scope with the customer BEFORE accepting, so PENDING jobs can
// chat. Only never-started (DRAFT) and closed (DECLINED/CANCELLED) jobs stay
// silent — the participant check still limits chat to the assigned parties.
const CHAT_ENABLED_REQUEST_STATUSES = new Set<RequestStatus>([
  RequestStatus.PENDING,
  RequestStatus.ACCEPTED,
  RequestStatus.IN_PROGRESS,
  RequestStatus.COMPLETED,
]);

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, query: { page?: string; limit?: string }) {
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    const where = { participants: { some: { userId } } };
    const [conversations, total] = await this.prisma.$transaction([
      this.prisma.conversation.findMany({
        where,
        include: {
          participants: {
            include: { user: { include: { clientProfile: true, professionalProfile: true } } },
          },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          engineerRequest: { include: { engineer: { include: { profile: true } } } },
          serviceRequest: { include: { category: true, provider: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.conversation.count({ where }),
    ]);
    const unreadCounts = await Promise.all(
      conversations.map(conversation => {
        const viewer = conversation.participants.find(
          participant => participant.userId === userId,
        );
        return this.prisma.message.count({
          where: {
            conversationId: conversation.id,
            senderUserId: {not: userId},
            ...(viewer?.lastReadAt
              ? {createdAt: {gt: viewer.lastReadAt}}
              : {}),
          },
        });
      }),
    );
    return {
      data: conversations.map((conversation, index) =>
        this.serializeConversation(conversation, userId, unreadCounts[index]),
      ),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async create(userId: string, dto: CreateConversationDto) {
    if (Boolean(dto.engineerRequestId) === Boolean(dto.serviceRequestId)) {
      throw new BadRequestException('Choose exactly one request for this conversation');
    }
    if (dto.serviceRequestId) {
      return this.openForServiceRequest(dto.serviceRequestId, userId);
    }
    if (!dto.engineerRequestId) {
      throw new BadRequestException('Choose a request for this conversation');
    }
    const request = await this.getRequest(dto.engineerRequestId);
    this.assertParticipant(userId, request);
    if (!CHAT_ENABLED_REQUEST_STATUSES.has(request.status)) {
      throw new BadRequestException('This request is closed, so messaging is unavailable');
    }
    return this.openForRequest(request.id, userId);
  }

  async openForRequest(engineerRequestId: string, requestingUserId?: string) {
    const request = await this.getRequest(engineerRequestId);
    if (requestingUserId) this.assertParticipant(requestingUserId, request);
    if (!CHAT_ENABLED_REQUEST_STATUSES.has(request.status)) {
      throw new BadRequestException('This request is closed, so messaging is unavailable');
    }
    const existing = await this.prisma.conversation.findFirst({
      where: { engineerRequestId: request.id },
      include: {
        participants: { include: { user: { include: { clientProfile: true, professionalProfile: true } } } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        engineerRequest: { include: { engineer: { include: { profile: true } } } },
        serviceRequest: { include: { category: true, provider: true } },
      },
    });
    if (existing) return this.serializeConversation(existing, requestingUserId ?? request.client.userId);

    const include = {
      participants: { include: { user: { include: { clientProfile: true, professionalProfile: true } } } },
      messages: { orderBy: { createdAt: 'desc' as const }, take: 1 },
      engineerRequest: { include: { engineer: { include: { profile: true } } } },
      serviceRequest: { include: { category: true, provider: true } },
    };
    try {
      const conversation = await this.prisma.conversation.create({
        data: {
          engineerRequestId: request.id,
          participants: {
            create: [
              { userId: request.client.userId },
              { userId: request.engineer.profile.userId },
            ],
          },
        },
        include,
      });
      return this.serializeConversation(conversation, requestingUserId ?? request.client.userId);
    } catch (error) {
      // Double-tap / retry race: the unique request id makes one winner. The
      // loser returns the winner instead of a duplicate chat row.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await this.prisma.conversation.findFirst({where: {engineerRequestId: request.id}, include});
        if (winner) return this.serializeConversation(winner, requestingUserId ?? request.client.userId);
      }
      throw error;
    }
  }

  async openForServiceRequest(serviceRequestId: string, requestingUserId?: string) {
    const request = await this.getServiceRequest(serviceRequestId);
    if (
      requestingUserId &&
      requestingUserId !== request.client.userId &&
      requestingUserId !== request.provider.userId
    ) {
      throw new NotFoundException('Conversation not found');
    }
    if (!CHAT_ENABLED_REQUEST_STATUSES.has(request.status)) {
      throw new BadRequestException('This request is closed, so messaging is unavailable');
    }
    const include = {
      participants: { include: { user: { include: { clientProfile: true, professionalProfile: true } } } },
      messages: { orderBy: { createdAt: 'desc' as const }, take: 1 },
      engineerRequest: { include: { engineer: { include: { profile: true } } } },
      serviceRequest: { include: { category: true, provider: true } },
    };
    const existing = await this.prisma.conversation.findFirst({
      where: { serviceRequestId: request.id },
      include,
    });
    if (existing) {
      return this.serializeConversation(
        existing,
        requestingUserId ?? request.client.userId,
      );
    }
    try {
      const conversation = await this.prisma.conversation.create({
        data: {
          serviceRequestId: request.id,
          participants: {
            create: [
              { userId: request.client.userId },
              { userId: request.provider.userId },
            ],
          },
        },
        include,
      });
      return this.serializeConversation(
        conversation,
        requestingUserId ?? request.client.userId,
      );
    } catch (error) {
      // Double-tap / retry race: the unique request id makes one winner. The
      // loser returns the winner instead of a duplicate chat row.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await this.prisma.conversation.findFirst({where: {serviceRequestId: request.id}, include});
        if (winner) return this.serializeConversation(winner, requestingUserId ?? request.client.userId);
      }
      throw error;
    }
  }

  async getMessages(id: string, userId: string) {
    await this.assertConversationParticipant(id, userId);
    const messages = await this.prisma.message.findMany({
      where: { conversationId: id },
      include: { sender: { include: { clientProfile: true, professionalProfile: true } } },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    return messages.map(message => ({
      id: message.id,
      conversationId: message.conversationId,
      senderUserId: message.senderUserId,
      senderName: this.displayName(message.sender),
      content: message.content,
      attachmentUrl: message.attachmentUrl ?? undefined,
      createdAt: message.createdAt,
    }));
  }

  async sendMessage(id: string, userId: string, body: SendMessageDto) {
    await this.assertConversationParticipant(id, userId);
    const content = body.content.trim();
    if (!content) throw new BadRequestException('Message content is required');
    return this.prisma.$transaction(async tx => {
      const participants = await tx.conversationParticipant.findMany({
        where: {conversationId: id},
        select: {userId: true},
      });
      const message = await tx.message.create({
        data: { conversationId: id, senderUserId: userId, content },
        include: { sender: { include: { clientProfile: true, professionalProfile: true } } },
      });
      await tx.conversation.update({ where: { id }, data: { updatedAt: new Date() } });
      const senderName = this.displayName(message.sender);
      const recipients = participants.filter(participant => participant.userId !== userId);
      if (recipients.length) {
        await tx.notification.createMany({
          data: recipients.map(recipient => ({
            userId: recipient.userId,
            kind: 'message',
            title: `New message from ${senderName}`,
            body: content.length > 120 ? `${content.slice(0, 117)}…` : content,
            data: {conversationId: id, senderName},
          })),
        });
      }
      return {
        id: message.id,
        conversationId: message.conversationId,
        senderUserId: message.senderUserId,
        senderName,
        content: message.content,
        createdAt: message.createdAt,
      };
    });
  }

  async markRead(id: string, userId: string) {
    await this.assertConversationParticipant(id, userId);
    await this.prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId: id, userId } },
      data: { lastReadAt: new Date() },
    });
    return { ok: true };
  }

  async participantUserIds(conversationId: string) {
    const participants = await this.prisma.conversationParticipant.findMany({
      where: {conversationId},
      select: {userId: true},
    });
    return participants.map(participant => participant.userId);
  }

  private async getRequest(id: string) {
    const request = await this.prisma.engineerRequest.findUnique({
      where: { id },
      include: { client: true, engineer: { include: { profile: true } } },
    });
    if (!request) throw new NotFoundException('Engineer request not found');
    return request;
  }

  private async getServiceRequest(id: string) {
    const request = await this.prisma.serviceRequest.findUnique({
      where: { id },
      include: { client: true, provider: true, category: true },
    });
    if (!request) throw new NotFoundException('Service request not found');
    return request;
  }

  private assertParticipant(
    userId: string,
    request: { client: { userId: string }; engineer: { profile: { userId: string } } },
  ) {
    if (userId !== request.client.userId && userId !== request.engineer.profile.userId) {
      throw new NotFoundException('Conversation not found');
    }
  }

  async assertConversationParticipant(conversationId: string, userId: string) {
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!participant) throw new NotFoundException('Conversation not found');
  }

  private serializeConversation(
    conversation: {
      id: string;
      engineerRequestId: string | null;
      serviceRequestId: string | null;
      participants: { userId: string; user: { clientProfile: { fullName: string; avatarUrl: string | null } | null; professionalProfile: { fullName: string; avatarUrl: string | null } | null } }[];
      messages: { content: string; createdAt: Date }[];
      engineerRequest: { projectTitle: string; status: RequestStatus; engineer: { profile: { fullName: string } } } | null;
      serviceRequest: { status: RequestStatus; category: { title: string }; provider: { fullName: string } } | null;
    },
    viewerUserId: string,
    unread = 0,
  ) {
    const other = conversation.participants.find(participant => participant.userId !== viewerUserId);
    const professionalName = other ? this.displayName(other.user) : 'NAHTREEK';
    // Both sides see the other party's photo (client sees the pro, the pro
    // sees the client); apps fall back to initials when nobody uploaded one.
    const otherAvatarUrl = other
      ? (other.user.professionalProfile?.avatarUrl ?? other.user.clientProfile?.avatarUrl ?? undefined)
      : undefined;
    const latest = conversation.messages[0];
    return {
      id: conversation.id,
      // Lets apps group one person's job threads into a single chat row.
      ...(other ? {otherUserId: other.userId} : {}),
      title: professionalName,
      subtitle: conversation.engineerRequest
        ? `Re: ${conversation.engineerRequest.projectTitle}`
        : conversation.serviceRequest
        ? `Re: ${conversation.serviceRequest.category.title}`
        : 'NAHTREEK conversation',
      professionalName,
      ...(otherAvatarUrl ? {otherAvatarUrl} : {}),
      engineerRequestId: conversation.engineerRequestId ?? undefined,
      serviceRequestId: conversation.serviceRequestId ?? undefined,
      requestKind: conversation.serviceRequestId ? 'service' : 'engineering',
      requestId: conversation.serviceRequestId ?? conversation.engineerRequestId ?? undefined,
      requestStatus: conversation.engineerRequest?.status ?? conversation.serviceRequest?.status ?? undefined,
      lastMessage: latest?.content ?? 'Conversation opened',
      lastAt: latest?.createdAt ?? new Date(),
      unread,
    };
  }

  private displayName(user: { clientProfile: { fullName: string } | null; professionalProfile: { fullName: string } | null }) {
    return user.professionalProfile?.fullName ?? user.clientProfile?.fullName ?? 'NAHTREEK User';
  }
}
