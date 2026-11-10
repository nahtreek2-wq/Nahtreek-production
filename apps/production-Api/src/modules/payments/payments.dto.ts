import {Type} from 'class-transformer';
import {IsIn, IsNumber, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf, IsOptional} from 'class-validator';

// Every money DTO addresses exactly one booking: a service request or an
// engineer (consultation) request. At least one id is required; the service
// rejects a DTO carrying both.
export class CreatePaymentOrderDto {
  @ValidateIf(o => !o.engineerRequestId) @IsUUID() serviceRequestId?: string;
  @ValidateIf(o => !o.serviceRequestId) @IsUUID() engineerRequestId?: string;
}

export class VerifyPaymentDto {
  @ValidateIf(o => !o.engineerRequestId) @IsUUID() serviceRequestId?: string;
  @ValidateIf(o => !o.serviceRequestId) @IsUUID() engineerRequestId?: string;
  @IsString() @MinLength(1) @MaxLength(64) razorpayOrderId: string;
  @IsString() @MinLength(1) @MaxLength(64) razorpayPaymentId: string;
  @IsString() @Matches(/^[0-9a-f]{64}$/i) razorpaySignature: string;
}

export class SyncPaymentDto {
  @ValidateIf(o => !o.engineerRequestId) @IsUUID() serviceRequestId?: string;
  @ValidateIf(o => !o.serviceRequestId) @IsUUID() engineerRequestId?: string;
}

export class RefundPaymentDto {
  @ValidateIf(o => !o.engineerRequestId) @IsUUID() serviceRequestId?: string;
  @ValidateIf(o => !o.serviceRequestId) @IsUUID() engineerRequestId?: string;
  @IsString() @MinLength(10) @MaxLength(500) reason: string;
}

export class ReleasePaymentDto {
  @ValidateIf(o => !o.engineerRequestId) @IsUUID() serviceRequestId?: string;
  @ValidateIf(o => !o.serviceRequestId) @IsUUID() engineerRequestId?: string;
}

export class ResolveDisputeDto {
  @ValidateIf(o => !o.engineerRequestId) @IsUUID() serviceRequestId?: string;
  @ValidateIf(o => !o.serviceRequestId) @IsUUID() engineerRequestId?: string;
  @IsIn(['release', 'refund']) decision: 'release' | 'refund';
  @IsString() @MinLength(10) @MaxLength(500) note: string;
}

export class VerifySettlementDto {
  @IsUUID() settlementId: string;
  @IsString() @MinLength(1) @MaxLength(64) razorpayOrderId: string;
  @IsString() @MinLength(1) @MaxLength(64) razorpayPaymentId: string;
  @IsString() @Matches(/^[0-9a-f]{64}$/i) razorpaySignature: string;
}

export class DeclareEngineerCollectionDto {
  @IsUUID() engineerRequestId: string;
  @Type(() => Number) @IsNumber() @Min(1) @Max(1000000) amount: number;
  @IsIn(['CASH', 'UPI']) method: 'CASH' | 'UPI';
}

export class ReportDisputeDto {
  @ValidateIf(o => !o.engineerRequestId) @IsUUID() serviceRequestId?: string;
  @ValidateIf(o => !o.serviceRequestId) @IsUUID() engineerRequestId?: string;
  @IsString() @MinLength(10) @MaxLength(500) reason: string;
}

export class SubmitPayoutAccountDto {
  @IsString() @MinLength(1) @MaxLength(120) accountHolderName: string;
  @IsString() @Matches(/^[0-9]{9,18}$/) accountNumber: string;
  @IsString() @Matches(/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/) ifsc: string;
  @IsOptional() @IsString() @MaxLength(120) bankName?: string;
  @IsOptional() @IsString() @MaxLength(80) @Matches(/^[\w.\-]{2,64}@[A-Za-z]{2,32}$/) upiId?: string;
}

export class RegisterPayoutAccountDto {
  @IsUUID() professionalProfileId: string;
  @IsString() @MinLength(1) @MaxLength(64) providerAccountRef: string;
  @IsString() @MinLength(2) @MaxLength(120) accountHolderName: string;
  @IsString() @MaxLength(120) bankName?: string;
  @IsString() @Matches(/^[0-9]{4}$/) accountLast4?: string;
}
