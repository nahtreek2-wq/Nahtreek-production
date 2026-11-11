import {BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException, ServiceUnavailableException} from '@nestjs/common';
import {AiConversationStatus, AiDocumentStatus, AiMessageType, Prisma} from '@prisma/client';
import {randomUUID} from 'crypto';
import {downloadAsset, uploadAsset, signedAssetUrl} from '../../common/storage';
import {PrismaService} from '../../common/prisma/prisma.service';
import {AnalyzeAiDocumentDto, CreateAiConversationDto, CreateAiMessageDto, GenerateAiPlanDto, QuoteRequestFromPlanDto, UpdateAiPlanDto, UploadAiDocumentDto} from './ai.dto';
import {AiLanguage, AiProvider, ChatMessage, GuidedPlannerProvider, ImageAnalysis, OpenAiCompatibleProvider, PlannerInput, VisionUnsupportedError} from './ai.provider';
import {MembershipsService} from '../memberships/memberships.service';
import {RequestsService} from '../requests/requests.service';

const MAX_ACTIONS_PER_WINDOW = 12;
const HEALTH_CACHE_MS = 5 * 60 * 1000;

function paisaLabel(paisa: number) { return `₹${Math.round(paisa / 100).toLocaleString('en-IN')}`; }

function formatAnalysis(analysis: ImageAnalysis, language: AiLanguage) {
  const ta = language === 'ta';
  const head = ta ? 'புகைப்பட ஆய்வு' : 'Photo analysis';
  const seen = ta ? 'கண்டவை' : 'What I see';
  const urgent = ta ? 'அவசர நிலை' : 'Urgency';
  const pro = ta ? 'தேவையான நிபுணர்' : 'Who to call';
  const ask = ta ? 'நிபுணரிடம் கேட்க வேண்டியவை' : 'Ask the professional';
  const next = ta ? 'அடுத்த படிகள்' : 'Next steps';
  return [`${head} — ${analysis.summary}`, '', `${seen}:`, ...analysis.findings.map(f => `• ${f}`),
    '', `${urgent}: ${analysis.urgency}`, `${pro}: ${analysis.suggestedProfessional}`,
    '', `${ask}:`, ...analysis.questionsToAsk.map(q => `• ${q}`),
    '', `${next}:`, ...analysis.nextSteps.map(s => `• ${s}`)].join('\n');
}

@Injectable()
export class AiService {
  private readonly provider: AiProvider = process.env.AI_PROVIDER_URL && process.env.AI_PROVIDER_API_KEY
    ? new OpenAiCompatibleProvider(process.env.AI_PROVIDER_URL, process.env.AI_PROVIDER_API_KEY, process.env.AI_MODEL ?? 'gpt-4.1-mini', process.env.AI_VISION_MODEL ?? process.env.AI_MODEL ?? 'gpt-4.1-mini', process.env.AI_VISION_URL, process.env.AI_VISION_API_KEY)
    : new GuidedPlannerProvider();
  private readonly fallbackProvider = new GuidedPlannerProvider();
  private vision: 'untested' | 'supported' | 'unsupported' | 'error' = 'untested';
  private healthCache: {at: number; result: Record<string, unknown>} | null = null;
  constructor(private readonly prisma: PrismaService, private readonly billing: MembershipsService, private readonly requests: RequestsService) {}

  async createConversation(userId: string, dto: CreateAiConversationDto) {
    await this.limit(userId);
    const conversation = await this.prisma.aiConversation.create({
      data: {
        userId,
        title: dto.title?.trim() || this.titleFor(dto.projectType),
        projectType: dto.projectType,
        city: dto.city?.trim(),
        messages: {create: {type: AiMessageType.SYSTEM, content: 'NAHTREEK AI is ready to help you organise your project.'}},
      },
      include: {messages: true, documents: true, plans: true},
    });
    await this.audit(userId, 'AI_CONVERSATION_CREATED', 'AiConversation', conversation.id);
    return conversation;
  }

  listConversations(userId: string) {
    return this.prisma.aiConversation.findMany({
      where: {userId, status: AiConversationStatus.ACTIVE},
      include: {plans: {orderBy: {updatedAt: 'desc'}, take: 1}},
      orderBy: {updatedAt: 'desc'},
      take: 30,
    });
  }

  async detail(userId: string, id: string) {
    const conversation = await this.prisma.aiConversation.findFirst({
      where: {id, userId},
      include: {
        messages: {orderBy: {createdAt: 'asc'}},
        documents: {orderBy: {createdAt: 'desc'}},
        plans: {where: {archivedAt: null}, orderBy: {updatedAt: 'desc'}},
      },
    });
    if (!conversation) throw new NotFoundException('AI conversation not found');
    return {...conversation, documents: await Promise.all(conversation.documents.map(async document => ({...document, storageUrl: await signedAssetUrl(document.storageUrl)})))};
  }

  async message(userId: string, id: string, dto: CreateAiMessageDto) {
    await this.billing.assertAiAccess(userId, 'message');
    await this.limit(userId);
    const conversation = await this.ownedConversation(userId, id);
    const content = dto.content.trim();
    if (!content) throw new BadRequestException('Enter a message first.');
    const history = await this.history(id);
    const reply = await this.replyWithFallback({projectType: conversation.projectType, message: content, history, language: dto.language ?? 'en', costRanges: await this.rateCardText(conversation.city)});
    // A failed provider call must not leave an unanswered message that duplicates on retry.
    return this.prisma.$transaction(async tx => {
      await tx.aiMessage.create({data: {conversationId: id, type: AiMessageType.USER_TEXT, content}});
      const assistant = await tx.aiMessage.create({data: {conversationId: id, type: AiMessageType.AI_TEXT, content: reply}});
      await tx.aiConversation.update({where: {id}, data: {updatedAt: new Date()}});
      return assistant;
    });
  }

  async generatePlan(userId: string, id: string, dto: GenerateAiPlanDto) {
    await this.billing.assertAiAccess(userId, 'plan');
    await this.limit(userId);
    const conversation = await this.ownedConversation(userId, id);
    const documents = await this.prisma.aiDocument.findMany({
      where: {conversationId: id, status: AiDocumentStatus.READY},
      select: {fileName: true},
    });
    const input: PlannerInput = {
      projectType: dto.projectType ?? conversation.projectType ?? 'UNSURE',
      city: conversation.city,
      propertyType: dto.propertyType,
      budgetRange: dto.budgetRange,
      timeline: dto.timeline,
      details: dto.details,
      documentNames: documents.map(document => document.fileName),
      conversation: await this.history(id),
      language: dto.language ?? 'en',
      costRanges: await this.rateCardText(conversation.city),
    };
    // A hosted model can be unavailable or return a response outside the mobile
    // schema. A safe, tailored local plan is better than leaving the customer at
    // an error state after they have entered their project details.
    const output = await this.planWithFallback(input);
    const prior = await this.prisma.aiProjectPlan.findFirst({where: {conversationId: id}, orderBy: {version: 'desc'}});
    const plan = await this.prisma.aiProjectPlan.create({
      data: {
        userId,
        conversationId: id,
        projectType: input.projectType,
        title: output.title,
        summary: output.summary,
        stages: output.stages as unknown as Prisma.InputJsonValue,
        recommendations: output.recommendations as unknown as Prisma.InputJsonValue,
        checklist: output.checklist as unknown as Prisma.InputJsonValue,
        missingInformation: output.missingInformation as unknown as Prisma.InputJsonValue,
        safetyNote: output.safetyNote,
        version: (prior?.version ?? 0) + 1,
      },
    });
    await this.prisma.aiMessage.create({
      data: {conversationId: id, type: AiMessageType.PROJECT_PLAN, content: `Created ${plan.title}`, metadata: {planId: plan.id, version: plan.version}},
    });
    await this.audit(userId, 'AI_PLAN_GENERATED', 'AiProjectPlan', plan.id, {conversationId: id, version: plan.version});
    return plan;
  }

  async listPlans(userId: string) {
    return this.prisma.aiProjectPlan.findMany({
      where: {userId, archivedAt: null},
      orderBy: {updatedAt: 'desc'},
      take: 30,
    });
  }

  async updatePlan(userId: string, id: string, dto: UpdateAiPlanDto) {
    const plan = await this.prisma.aiProjectPlan.findFirst({where: {id, userId}});
    if (!plan) throw new NotFoundException('AI plan not found');
    return this.prisma.aiProjectPlan.update({
      where: {id},
      data: {title: dto.title?.trim(), archivedAt: dto.archived === undefined ? undefined : dto.archived ? new Date() : null},
    });
  }

  async planDetail(userId: string, id: string) {
    const plan = await this.prisma.aiProjectPlan.findFirst({where: {id, userId, archivedAt: null}});
    if (!plan) throw new NotFoundException('AI plan not found');
    return plan;
  }

  async rateCards(city?: string) {
    const trimmed = city?.trim();
    const rows = await this.prisma.aiRateCard.findMany({
      where: trimmed
        ? {OR: [{city: {equals: trimmed, mode: 'insensitive'}}, {city: 'ALL'}]}
        : {city: 'ALL'},
      orderBy: [{label: 'asc'}],
    });
    // A city-specific row wins over the ALL fallback for the same service.
    const byService = new Map(rows.map(row => [row.serviceKey, row]));
    for (const row of rows) if (row.city !== 'ALL') byService.set(row.serviceKey, row);
    return [...byService.values()].map(row => ({...row, rangeLabel: `${paisaLabel(row.minPaisa)}–${paisaLabel(row.maxPaisa)} per ${row.unit}`}));
  }

  async quoteRequest(userId: string, planId: string, dto: QuoteRequestFromPlanDto) {
    await this.limit(userId);
    const plan = await this.prisma.aiProjectPlan.findFirst({where: {id: planId, userId, archivedAt: null}});
    if (!plan) throw new NotFoundException('AI plan not found');
    const request = await this.requests.create({
      engineerProfileId: dto.engineerProfileId,
      projectTitle: dto.projectTitle?.trim() || plan.title,
      projectDescription: dto.projectDescription?.trim() || `${plan.summary} Planned with NAHTREEK AI (plan v${plan.version}).`,
      propertyType: dto.propertyType?.trim() || 'Residential',
      locationAddress: dto.locationAddress,
      latitude: dto.latitude,
      longitude: dto.longitude,
      projectSizeSqFt: dto.projectSizeSqFt,
      preferredStartDate: dto.preferredStartDate,
      budgetEstimatePaisa: dto.budgetEstimatePaisa,
    }, userId);
    await this.prisma.aiMessage.create({
      data: {conversationId: plan.conversationId, type: AiMessageType.SERVICE_RECOMMENDATION, content: `Requested quotes from a verified professional for ${plan.title}.`, metadata: {planId, requestId: request.id}},
    });
    await this.audit(userId, 'AI_QUOTE_REQUESTED', 'EngineerRequest', request.id, {planId});
    return request;
  }

  async analyzeDocument(userId: string, id: string, dto: AnalyzeAiDocumentDto) {
    await this.billing.assertAiAccess(userId, 'message');
    await this.limit(userId);
    const document = await this.prisma.aiDocument.findFirst({where: {id, userId}, include: {conversation: true}});
    if (!document) throw new NotFoundException('Document not found');
    if (!document.mimeType.startsWith('image/')) throw new BadRequestException('Only photos can be analysed.');
    if (document.status !== AiDocumentStatus.READY || !document.storageUrl) throw new BadRequestException('This photo is not ready yet. Please try again shortly.');
    if (!document.conversationId) throw new BadRequestException('Attach this photo to a conversation first.');
    const bytes = await downloadAsset(document.storageUrl);
    if (!bytes) throw new ServiceUnavailableException('Photo temporarily unavailable. Please try again shortly.');
    const language = dto.language ?? 'en';
    const visionInput = {mimeType: document.mimeType, base64: bytes.toString('base64'), fileName: document.fileName, projectType: document.conversation?.projectType, language};
    let analysis: ImageAnalysis;
    let engine: 'hosted-model' | 'guided-fallback';
    try {
      analysis = await this.provider.analyzeImage(visionInput);
      engine = this.provider.describe().engine;
      this.vision = engine === 'hosted-model' ? 'supported' : 'unsupported';
    } catch (cause) {
      if (cause instanceof VisionUnsupportedError) this.vision = 'unsupported';
      else if (this.vision === 'untested') this.vision = 'error';
      analysis = await this.fallbackProvider.analyzeImage(visionInput);
      engine = 'guided-fallback';
    }
    const content = formatAnalysis(analysis, language);
    await this.prisma.aiDocument.update({where: {id}, data: {extractedSummary: analysis.summary}});
    const message = await this.prisma.aiMessage.create({
      data: {conversationId: document.conversationId, type: AiMessageType.AI_TEXT, content, metadata: {kind: 'IMAGE_ANALYSIS', documentId: id, urgency: analysis.urgency, engine}},
    });
    await this.audit(userId, 'AI_PHOTO_ANALYSED', 'AiDocument', id, {urgency: analysis.urgency, engine});
    return {document: {...document, extractedSummary: analysis.summary}, message};
  }

  async engineHealth() {
    const described = this.provider.describe();
    if (described.engine === 'guided-fallback') {
      return {engine: described.engine, model: null, visionModel: null, ok: true, latencyMs: 0, vision: 'unsupported' as const,
        checkedAt: new Date().toISOString(), note: 'No hosted model configured; answering with the built-in guided planner.'};
    }
    const now = Date.now();
    if (this.healthCache && now - this.healthCache.at < HEALTH_CACHE_MS) return this.healthCache.result;
    let result: Record<string, unknown>;
    try {
      const latencyMs = await this.provider.ping();
      result = {engine: described.engine, model: described.model, visionModel: described.visionModel, ok: true, latencyMs, vision: this.vision, checkedAt: new Date().toISOString()};
    } catch {
      result = {engine: described.engine, model: described.model, visionModel: described.visionModel, ok: false, latencyMs: -1, vision: this.vision,
        checkedAt: new Date().toISOString(), note: 'Hosted model unreachable; customers are served by the guided fallback.'};
    }
    this.healthCache = {at: now, result};
    return result;
  }

  async uploadDocument(userId: string, dto: UploadAiDocumentDto) {
    await this.billing.assertAiAccess(userId, 'upload');
    await this.limit(userId);
    if (dto.conversationId) await this.ownedConversation(userId, dto.conversationId);
    const content = Buffer.from(dto.contentBase64, 'base64');
    if (!content.length || content.length > 1_000_000) throw new BadRequestException('Choose a file under 1 MB');
    if (!this.validFile(content, dto.mimeType)) throw new BadRequestException('The selected file type does not match its content');
    const extension = dto.mimeType === 'image/jpeg' ? 'jpg' : dto.mimeType === 'image/png' ? 'png' : dto.mimeType === 'image/webp' ? 'webp' : dto.mimeType === 'application/pdf' ? 'pdf' : 'txt';
    const filename = `${randomUUID()}.${extension}`;
    const storageUrl = await uploadAsset('ai-documents', filename, content, dto.mimeType);
    const document = await this.prisma.aiDocument.create({
      data: {
        userId,
        conversationId: dto.conversationId,
        fileName: dto.fileName.trim(),
        mimeType: dto.mimeType,
        sizeBytes: content.length,
        status: dto.mimeType.startsWith('image/') || dto.mimeType === 'text/plain' ? AiDocumentStatus.READY : AiDocumentStatus.PROCESSING,
        storageUrl,
      },
    });
    if (dto.conversationId) await this.prisma.aiMessage.create({data: {conversationId: dto.conversationId, type: dto.mimeType.startsWith('image/') ? AiMessageType.IMAGE : AiMessageType.DOCUMENT, content: `Added ${document.fileName}`}});
    await this.audit(userId, 'AI_DOCUMENT_UPLOADED', 'AiDocument', document.id, {mimeType: dto.mimeType});
    return {...document, storageUrl: await signedAssetUrl(document.storageUrl)};
  }

  async documentStatus(userId: string, id: string) {
    const document = await this.prisma.aiDocument.findFirst({where: {id, userId}});
    if (!document) throw new NotFoundException('Document not found');
    return {...document, storageUrl: await signedAssetUrl(document.storageUrl)};
  }

  private async rateCardText(city?: string | null) {
    const cards = await this.rateCards(city ?? undefined);
    if (!cards.length) return undefined;
    return cards.map(card => `- ${card.label}: ${card.rangeLabel}${card.note ? ` (${card.note})` : ''}`).join('\n');
  }

  private async ownedConversation(userId: string, id: string) {
    const conversation = await this.prisma.aiConversation.findFirst({where: {id, userId, status: AiConversationStatus.ACTIVE}});
    if (!conversation) throw new NotFoundException('AI conversation not found');
    return conversation;
  }

  private async history(conversationId: string): Promise<ChatMessage[]> {
    const messages = await this.prisma.aiMessage.findMany({where: {conversationId, type: {in: ['USER_TEXT', 'AI_TEXT']}}, orderBy: {createdAt: 'desc'}, take: 12});
    return messages.reverse().map(m => ({role: m.type === 'USER_TEXT' ? 'user' : 'assistant', content: m.content.slice(0, 3000)}));
  }

  private async replyWithFallback(input: Parameters<AiProvider['generateReply']>[0]) {
    try {
      return await this.provider.generateReply(input);
    } catch {
      return this.fallbackProvider.generateReply(input);
    }
  }

  private async planWithFallback(input: PlannerInput) {
    try {
      return await this.provider.generateStructuredPlan(input);
    } catch {
      return this.fallbackProvider.generateStructuredPlan(input);
    }
  }

  private async limit(userId: string) {
    const rows = await this.prisma.$queryRaw<{count: number}[]>`
      INSERT INTO "RateLimitWindow" ("key", "count", "expiresAt")
      VALUES (${'ai:' + userId}, 1, NOW() + INTERVAL '10 minutes')
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimitWindow"."expiresAt" <= NOW() THEN 1 ELSE "RateLimitWindow"."count" + 1 END,
        "expiresAt" = CASE WHEN "RateLimitWindow"."expiresAt" <= NOW() THEN NOW() + INTERVAL '10 minutes' ELSE "RateLimitWindow"."expiresAt" END
      RETURNING "count"`;
    if (rows[0].count > MAX_ACTIONS_PER_WINDOW) throw new HttpException('Please wait a few minutes before creating more AI plans.', HttpStatus.TOO_MANY_REQUESTS);
  }

  private validFile(content: Buffer, mimeType: string) {
    if (mimeType === 'image/jpeg') return content.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
    if (mimeType === 'image/png') return content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (mimeType === 'image/webp') return content.subarray(0, 4).toString() === 'RIFF' && content.subarray(8, 12).toString() === 'WEBP';
    if (mimeType === 'application/pdf') return content.subarray(0, 5).toString() === '%PDF-';
    return mimeType === 'text/plain';
  }

  private titleFor(type?: string) { return `${({NEW_HOME: 'New home', RENOVATION: 'Renovation', REPAIR: 'Repair', INSPECTION: 'Inspection', EXTENSION: 'Extension'} as Record<string, string>)[type ?? ''] ?? 'Project'} plan`; }
  private audit(userId: string, action: string, entity: string, entityId: string, metadata?: Prisma.InputJsonValue) { return this.prisma.auditLog.create({data: {userId, action, entity, entityId, metadata}}); }
}
