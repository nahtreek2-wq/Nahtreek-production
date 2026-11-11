import {IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength} from 'class-validator';
import {CollectionMode} from '@prisma/client';

export class PresenceDto {
  @IsBoolean() online: boolean;
  @IsLatitude() latitude: number;
  @IsLongitude() longitude: number;
  @IsNumber() @Min(0) @Max(10000) accuracy: number;
  @IsDateString() observedAt: string;
  @IsOptional() @IsNumber() @Min(1) @Max(50) radiusKm?: number;
}
export class MatchDto {
  @IsString() @MinLength(1) @MaxLength(80) serviceId: string;
  @IsLatitude() latitude: number;
  @IsLongitude() longitude: number;
  @IsIn(['ASAP', 'SCHEDULED']) mode: 'ASAP' | 'SCHEDULED';
  @IsOptional() @IsUUID() professionalProfileId?: string;
}
export class BookDto extends MatchDto {
  @IsUUID() idempotencyKey: string;
  @IsString() @MinLength(10) @MaxLength(2000) description: string;
  @IsString() @MinLength(5) @MaxLength(500) locationAddress: string;
  @IsString() @MinLength(2) @MaxLength(100) recipientName: string;
  @IsString() @Matches(/^\+?[1-9][0-9]{9,14}$/) recipientPhone: string;
  @IsBoolean() recipientConsent: boolean;
  @IsOptional() @IsDateString() scheduledAt?: string;
}
export class JourneyActionDto {
  @IsIn(['ACCEPT', 'DECLINE', 'DEPART', 'ARRIVE', 'QUOTE', 'APPROVE_QUOTE', 'START', 'FINISH', 'CONFIRM', 'ISSUE', 'CANCEL', 'RESCHEDULE']) action: string;
  @IsInt() @Min(1) revision: number;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100000000) amountPaisa?: number;
  @IsOptional() @IsString() @Matches(/^[0-9]{6}$/) code?: string;
  @IsOptional() @IsEnum(CollectionMode) collectionMode?: CollectionMode;
  @IsOptional() @IsInt() @Min(100) @Max(100000000) collectedAmountPaisa?: number;
  @IsOptional() @IsIn(['CASH', 'UPI']) collectedMethod?: 'CASH' | 'UPI';
  @IsOptional() @IsString() @MaxLength(40) scheduledAt?: string;
}
