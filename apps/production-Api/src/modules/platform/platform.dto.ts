import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { RequestStatus } from "@prisma/client";

export class ProfessionalSetupDto {
  @IsIn(["engineer", "service-provider"]) kind: "engineer" | "service-provider";
  @IsString() @MinLength(2) @MaxLength(120) fullName: string;
  @IsString() @MinLength(2) @MaxLength(120) title: string;
  @IsString() @MinLength(2) @MaxLength(80) baseCity: string;
  @IsString() @MinLength(2) @MaxLength(80) baseState: string;
  @IsLatitude() baseLatitude: number;
  @IsLongitude() baseLongitude: number;
  @IsOptional() @IsString() @MaxLength(2000) bio?: string;
  @IsInt() @Min(0) @Max(80) yearsOfExperience: number;
  @IsOptional() @IsInt() @Min(0) @Max(100000000) startingPricePaisa?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100000000) consultationFeePaisa?: number;
  @IsOptional() @IsBoolean() isAvailable?: boolean;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  serviceCategories?: string[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID(undefined, { each: true })
  specializationIds?: string[];
  @IsOptional() @IsString() @MaxLength(160) qualificationDegree?: string;
  @IsOptional() @IsString() @MaxLength(160) institution?: string;
  @IsOptional() @IsInt() @Min(1950) @Max(2100) graduationYear?: number;
  @IsOptional() @IsString() @MaxLength(80) licenseNumber?: string;
}

export class ProfessionalIdentityDraftDto {
  @IsString() @MinLength(2) @MaxLength(120) fullName: string;
  @IsString() @MinLength(2) @MaxLength(80) baseCity: string;
  @IsString() @MinLength(2) @MaxLength(80) baseState: string;
}

export class CreateAvailabilitySlotDto {
  @IsDateString() startsAt: string;
  @IsDateString() endsAt: string;
}

export class WorkStatusDto {
  @IsBoolean() isAvailable: boolean;
}

export class ProfessionalPhotoDto {
  @IsString()
  @Matches(/^(image\/jpeg|image\/png|image\/webp)$/)
  mimeType: string;

  @IsString()
  @MinLength(16)
  @MaxLength(1500000)
  @Matches(/^[A-Za-z0-9+/]+={0,2}$/)
  contentBase64: string;
}

export class PortfolioPhotoDto extends ProfessionalPhotoDto {
  @IsString() @MinLength(2) @MaxLength(120) title: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
}

export class VerificationDocumentUploadDto {
  @IsIn([
    "identity-proof",
    "address-proof",
    "qualification",
    "license",
    "work-sample",
  ])
  documentType:
    | "identity-proof"
    | "address-proof"
    | "qualification"
    | "license"
    | "work-sample";

  @IsString()
  @Matches(/^(application\/pdf|image\/jpeg|image\/png|image\/webp)$/)
  mimeType: string;

  @IsString()
  @MinLength(16)
  @MaxLength(1500000)
  @Matches(/^[A-Za-z0-9+/]+={0,2}$/)
  contentBase64: string;
}

export class ServiceCategoryDto {
  @IsString() @Matches(/^[a-z][a-z0-9-]{1,79}$/) slug: string;
  @IsString() @MinLength(2) @MaxLength(120) title: string;
  @IsIn([
    "Home Services",
    "Construction & Renovation",
    "Inspection & Maintenance",
    "Engineering & Structural",
  ])
  group: string;
  @IsString() @MaxLength(1000) description: string;
  @IsOptional() @IsString() @MaxLength(1000) prepare?: string;
  @IsOptional() @IsString() @Matches(/^[a-z0-9-]{1,80}$/) iconName?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateServiceRequestDto {
  @IsUUID() professionalProfileId: string;
  @IsString() @MaxLength(80) serviceId: string;
  @IsString() @MinLength(10) @MaxLength(4000) description: string;
  @IsString() @MinLength(5) @MaxLength(500) locationAddress: string;
  @IsLatitude() latitude: number;
  @IsLongitude() longitude: number;
}

export class TransitionDto {
  @IsEnum(RequestStatus) status: RequestStatus;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
