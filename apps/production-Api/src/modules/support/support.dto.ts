import {IsNotEmpty, IsOptional, IsString, MaxLength, MinLength} from 'class-validator';

export class CreateSupportTicketDto {
  @IsString()
  @MinLength(4)
  @MaxLength(120)
  @IsNotEmpty()
  subject: string;

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  @IsNotEmpty()
  message: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  bookingRef?: string;
}

export class ReplySupportTicketDto {
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  @IsNotEmpty()
  reply: string;
}

export class FollowUpSupportTicketDto {
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  @IsNotEmpty()
  message: string;
}
