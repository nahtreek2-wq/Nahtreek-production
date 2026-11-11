import {Body, Controller, Get, Headers, Param, Post, Query, Req, UnauthorizedException, UseGuards} from '@nestjs/common';
import {timingSafeEqual} from 'crypto';
import {Role} from '@prisma/client';
import {CurrentUser} from '../../common/decorators/current-user.decorator';
import {Roles} from '../../common/decorators/roles.decorator';
import {JwtAuthGuard} from '../../common/guards/jwt-auth.guard';
import {RolesGuard} from '../../common/guards/roles.guard';
import {JwtPayload} from '../../common/strategies/jwt.strategy';
import {CreatePaymentOrderDto, DeclareEngineerCollectionDto, RefundPaymentDto, RegisterPayoutAccountDto, ReleasePaymentDto, ReportDisputeDto, ResolveDisputeDto, ReviewPayoutAccountDto, SubmitPayoutAccountDto, SyncPaymentDto, VerifyPaymentDto, VerifySettlementDto} from './payments.dto';
import {PaymentsService} from './payments.service';

@Controller('payments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  @Post('orders') @Roles(Role.CLIENT)
  createOrder(@CurrentUser() user: JwtPayload, @Body() dto: CreatePaymentOrderDto) {
    if (dto.engineerRequestId) return this.service.createEngineerOrder(user.sub, dto.engineerRequestId);
    return this.service.createOrder(user.sub, dto.serviceRequestId!);
  }

  @Post('verify') @Roles(Role.CLIENT)
  verify(@CurrentUser() user: JwtPayload, @Body() dto: VerifyPaymentDto) {
    return this.service.verify(user.sub, dto);
  }

  @Post('sync') @Roles(Role.CLIENT, Role.ENGINEER, Role.SERVICE_PROVIDER)
  sync(@CurrentUser() user: JwtPayload, @Body() dto: SyncPaymentDto) {
    return this.service.sync(user.sub, dto);
  }

  @Get('requests/:serviceRequestId') @Roles(Role.CLIENT, Role.SERVICE_PROVIDER, Role.ADMIN)
  view(@CurrentUser() user: JwtPayload, @Param('serviceRequestId') serviceRequestId: string) {
    return this.service.view(user.sub, serviceRequestId, user.roles.includes(Role.ADMIN));
  }

  @Get('engineer-requests/:engineerRequestId') @Roles(Role.CLIENT, Role.ENGINEER, Role.ADMIN)
  viewEngineer(@CurrentUser() user: JwtPayload, @Param('engineerRequestId') engineerRequestId: string) {
    return this.service.viewEngineer(user.sub, engineerRequestId, user.roles.includes(Role.ADMIN));
  }

  @Post('refund') @Roles(Role.CLIENT, Role.ADMIN)
  refund(@CurrentUser() user: JwtPayload, @Body() dto: RefundPaymentDto) {
    return this.service.requestRefund(user.sub, dto, user.roles.includes(Role.ADMIN));
  }

  @Post('disputes') @Roles(Role.CLIENT)
  dispute(@CurrentUser() user: JwtPayload, @Body() dto: ReportDisputeDto) {
    return this.service.reportDispute(user.sub, dto);
  }

  @Post('engineer-collections') @Roles(Role.ENGINEER)
  declareCollection(@CurrentUser() user: JwtPayload, @Body() dto: DeclareEngineerCollectionDto) {
    return this.service.declareEngineerCollection(user.sub, dto);
  }

  @Post('release') @Roles(Role.ADMIN)
  release(@CurrentUser() user: JwtPayload, @Body() dto: ReleasePaymentDto) {
    if (dto.engineerRequestId) return this.service.releaseForEngineerRequest(dto.engineerRequestId, user.sub);
    return this.service.releaseForRequest(dto.serviceRequestId!, user.sub);
  }

  @Post('resolve') @Roles(Role.ADMIN)
  resolve(@CurrentUser() user: JwtPayload, @Body() dto: ResolveDisputeDto) {
    return this.service.resolveDispute(user.sub, dto);
  }

  @Post('payout-accounts') @Roles(Role.ADMIN)
  registerPayoutAccount(@CurrentUser() user: JwtPayload, @Body() dto: RegisterPayoutAccountDto) {
    return this.service.registerPayoutAccount(user.sub, dto);
  }

  @Get('admin/payout-accounts') @Roles(Role.ADMIN)
  listPayoutAccounts(@Query() query: {status?: string; page?: string; limit?: string}) {
    return this.service.listPayoutAccountsForAdmin(query);
  }

  @Post('admin/payout-accounts/:id/review') @Roles(Role.ADMIN)
  reviewPayoutAccount(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: ReviewPayoutAccountDto) {
    return this.service.reviewPayoutAccount(user.sub, id, dto);
  }

  @Get('admin/payout-queue') @Roles(Role.ADMIN)
  payoutQueue() {
    return this.service.payoutQueue();
  }

  @Get('payout-accounts/me') @Roles(Role.SERVICE_PROVIDER, Role.ENGINEER)
  myPayoutAccount(@CurrentUser() user: JwtPayload) {
    return this.service.myPayoutAccount(user.sub);
  }

  @Post('payout-accounts/me') @Roles(Role.SERVICE_PROVIDER, Role.ENGINEER)
  submitPayoutAccount(@CurrentUser() user: JwtPayload, @Body() dto: SubmitPayoutAccountDto) {
    return this.service.submitPayoutAccount(user.sub, dto);
  }

  @Get('dues') @Roles(Role.SERVICE_PROVIDER, Role.ENGINEER)
  dues(@CurrentUser() user: JwtPayload) {
    return this.service.dues(user.sub);
  }

  @Post('dues/orders') @Roles(Role.SERVICE_PROVIDER, Role.ENGINEER)
  createSettlementOrder(@CurrentUser() user: JwtPayload) {
    return this.service.createSettlementOrder(user.sub);
  }

  @Post('dues/verify') @Roles(Role.SERVICE_PROVIDER, Role.ENGINEER)
  verifySettlement(@CurrentUser() user: JwtPayload, @Body() dto: VerifySettlementDto) {
    return this.service.verifySettlement(user.sub, dto);
  }

  @Get('admin/dues') @Roles(Role.ADMIN)
  duesSummary() {
    return this.service.duesSummary();
  }

  @Get('admin/summary') @Roles(Role.ADMIN)
  summary() {
    return this.service.summary();
  }

  @Get('admin/list') @Roles(Role.ADMIN)
  list(@Query() query: {status?: string; page?: string; limit?: string}) {
    return this.service.listForAdmin(query);
  }
}

// No JWT guard: authenticity comes from the Razorpay webhook signature over
// the raw body (see main.ts rawBody). Always answers 2xx once the signature
// verifies so Razorpay stops retrying.
@Controller('internal/payments')
export class PaymentsWebhookController {
  constructor(private readonly service: PaymentsService) {}

  @Post('webhook')
  webhook(@Req() req: any, @Headers('x-razorpay-signature') signature?: string) {
    const raw = (req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}))) as Buffer;
    return this.service.handleWebhook(raw, signature ?? '');
  }
}

// Cron-kept: retries refunds stuck in REFUND_PENDING (same CRON_SECRET guard
// as the journey expiry sweep). Schedule every 15 minutes.
@Controller('internal/payments')
export class PaymentsMaintenanceController {
  constructor(private readonly service: PaymentsService) {}

  @Post('retry-refunds')
  async retryRefunds(@Headers('authorization') authorization?: string) {
    const secret = process.env.CRON_SECRET;
    const expected = Buffer.from(`Bearer ${secret ?? ''}`);
    const actual = Buffer.from(authorization ?? '');
    if (!secret || secret.length < 32 || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new UnauthorizedException();
    return this.service.retryPendingRefunds();
  }
}
