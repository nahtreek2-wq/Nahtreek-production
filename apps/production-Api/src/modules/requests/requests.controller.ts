import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtPayload } from '../../common/strategies/jwt.strategy';
import { CreateRequestDto } from './dto/create-request.dto';
import { CreateReviewDto } from './dto/create-review.dto';
import { EngineerTransitionDto } from './dto/engineer-transition.dto';
import { RescheduleRequestDto } from './dto/reschedule-request.dto';
import { RequestsService } from './requests.service';

@Controller('engineer-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CLIENT, Role.ENGINEER)
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Post()
  @Roles(Role.CLIENT)
  async createRequest(@Body() dto: CreateRequestDto, @CurrentUser() user: JwtPayload) {
    return this.requestsService.create(dto, user.sub);
  }

  @Get()
  async getRequests(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.requestsService.list(user.sub, { status, page, limit });
  }

  @Get(':id')
  async detail(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.requestsService.detail(id, user.sub);
  }

  @Patch(':id/cancel')
  @Roles(Role.CLIENT, Role.ENGINEER)
  async cancel(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.requestsService.cancel(id, user.sub);
  }

  @Patch(':id/reschedule')
  @Roles(Role.CLIENT)
  async reschedule(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: RescheduleRequestDto) {
    return this.requestsService.reschedule(id, user.sub, dto.scheduledAt);
  }

  @Post(':id/reviews')
  @Roles(Role.CLIENT)
  async addReview(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() review: CreateReviewDto,
  ) {
    return this.requestsService.addReview(id, user.sub, review);
  }

  @Patch(':id/status') @Roles(Role.ENGINEER)
  transition(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: EngineerTransitionDto) {
    return this.requestsService.transitionForEngineer(id, user.sub, dto.status, dto.reason,
      { code: dto.code, latitude: dto.latitude, longitude: dto.longitude });
  }
}
