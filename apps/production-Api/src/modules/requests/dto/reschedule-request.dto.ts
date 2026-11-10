import { IsDateString } from 'class-validator';

export class RescheduleRequestDto {
  @IsDateString()
  scheduledAt: string;
}
