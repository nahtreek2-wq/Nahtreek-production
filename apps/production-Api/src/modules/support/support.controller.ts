import {Body, Controller, Get, Param, Post, Query, UseGuards} from '@nestjs/common';
import {Role} from '@prisma/client';
import {CurrentUser} from '../../common/decorators/current-user.decorator';
import {Roles} from '../../common/decorators/roles.decorator';
import {JwtAuthGuard} from '../../common/guards/jwt-auth.guard';
import {RolesGuard} from '../../common/guards/roles.guard';
import {JwtPayload} from '../../common/strategies/jwt.strategy';
import {CreateSupportTicketDto, FollowUpSupportTicketDto, ReplySupportTicketDto} from './support.dto';
import {SupportService} from './support.service';

@Controller('support')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SupportController {
  constructor(private readonly service: SupportService) {}

  @Post('tickets')
  @Roles(Role.CLIENT, Role.SERVICE_PROVIDER, Role.ENGINEER)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateSupportTicketDto) {
    return this.service.create(user.sub, dto);
  }

  @Get('tickets/me')
  @Roles(Role.CLIENT, Role.SERVICE_PROVIDER, Role.ENGINEER)
  mine(@CurrentUser() user: JwtPayload, @Query() query: {page?: string; limit?: string}) {
    return this.service.mine(user.sub, query);
  }

  @Post('tickets/:id/replies')
  @Roles(Role.CLIENT, Role.SERVICE_PROVIDER, Role.ENGINEER)
  followUp(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: FollowUpSupportTicketDto) {
    return this.service.followUp(id, user.sub, dto);
  }

  @Get('admin/tickets')
  @Roles(Role.ADMIN)
  list(@Query() query: {status?: string; page?: string; limit?: string}) {
    return this.service.listForAdmin(query);
  }

  @Post('admin/tickets/:id/reply')
  @Roles(Role.ADMIN)
  reply(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: ReplySupportTicketDto) {
    return this.service.reply(id, user.sub, dto);
  }

  @Post('admin/tickets/:id/resolve')
  @Roles(Role.ADMIN)
  resolve(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.service.resolve(id, user.sub);
  }
}
