import {Body, Controller, Get, Headers, Post, Query, Req, UnauthorizedException, UseGuards} from '@nestjs/common';
import {timingSafeEqual} from 'crypto';
import {Role} from '@prisma/client';
import {CurrentUser} from '../../common/decorators/current-user.decorator';
import {Roles} from '../../common/decorators/roles.decorator';
import {JwtAuthGuard} from '../../common/guards/jwt-auth.guard';
import {RolesGuard} from '../../common/guards/roles.guard';
import {JwtPayload} from '../../common/strategies/jwt.strategy';
import {CancelMembershipDto} from './memberships.dto';
import {MembershipsService} from './memberships.service';

@Controller('memberships')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SERVICE_PROVIDER, Role.ENGINEER)
export class MembershipsController {
  constructor(private readonly service: MembershipsService) {}

  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.service.me(user.sub);
  }

  @Post('subscribe')
  subscribe(@CurrentUser() user: JwtPayload) {
    return this.service.subscribe(user.sub);
  }

  @Post('confirm')
  confirm(@CurrentUser() user: JwtPayload) {
    return this.service.confirm(user.sub);
  }

  @Post('cancel')
  cancel(@CurrentUser() user: JwtPayload, @Body() dto: CancelMembershipDto) {
    return this.service.cancel(user.sub, dto);
  }

  @Get('admin/summary') @Roles(Role.ADMIN)
  adminSummary() {
    return this.service.adminSummary();
  }

  @Get('admin/list') @Roles(Role.ADMIN)
  adminList(@Query() query: {status?: string; page?: string; limit?: string}) {
    return this.service.listForAdmin(query);
  }
}

@Controller('ai-billing')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CLIENT)
export class AiBillingController {
  constructor(private readonly service: MembershipsService) {}

  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.service.aiMe(user.sub);
  }

  @Get('plan')
  plan() {
    return this.service.aiPlan();
  }

  @Post('subscribe')
  subscribe(@CurrentUser() user: JwtPayload) {
    return this.service.aiSubscribe(user.sub);
  }

  @Post('confirm')
  confirm(@CurrentUser() user: JwtPayload) {
    return this.service.aiConfirm(user.sub);
  }

  @Post('cancel')
  cancel(@CurrentUser() user: JwtPayload, @Body() dto: CancelMembershipDto) {
    return this.service.aiCancel(user.sub, dto);
  }

  @Post('demo-activate')
  demoActivate(@CurrentUser() user: JwtPayload) {
    return this.service.aiDemoActivate(user.sub);
  }

  @Get('admin/summary') @Roles(Role.ADMIN)
  adminSummary() {
    return this.service.aiAdminSummary();
  }

  @Get('admin/list') @Roles(Role.ADMIN)
  adminList(@Query() query: {page?: number; pageSize?: number; status?: 'NONE' | 'PENDING' | 'ACTIVE' | 'PAST_DUE' | 'PAUSED' | 'CANCELLED' | 'EXPIRED'}) {
    return this.service.aiAdminList(query);
  }
}

@Controller('internal/memberships')
export class MembershipsInternalController {
  constructor(private readonly service: MembershipsService) {}

  @Post('webhook')
  webhook(@Req() req: any, @Headers('x-razorpay-signature') signature?: string) {
    const raw = (req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}))) as Buffer;
    return this.service.handleWebhook(raw, signature ?? '');
  }

  @Post('reconcile')
  async reconcile(@Headers('authorization') authorization?: string) {
    const secret = process.env.CRON_SECRET;
    const expected = Buffer.from(`Bearer ${secret ?? ''}`);
    const actual = Buffer.from(authorization ?? '');
    if (!secret || secret.length < 32 || actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new UnauthorizedException();
    return this.service.reconcile();
  }
}
