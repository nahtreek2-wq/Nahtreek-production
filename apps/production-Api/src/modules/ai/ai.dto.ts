import {Type} from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  Matches,
} from 'class-validator';

export const PROJECT_TYPES = [
  'NEW_HOME',
  'RENOVATION',
  'REPAIR',
  'INSPECTION',
  'EXTENSION',
  'UNSURE',
] as const;

export const AI_LANGUAGES = ['en', 'ta'] as const;

export class CreateAiConversationDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsIn(PROJECT_TYPES)
  projectType?: (typeof PROJECT_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;
}

export class CreateAiMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(3000)
  content: string;

  @IsOptional()
  @IsIn(AI_LANGUAGES)
  language?: (typeof AI_LANGUAGES)[number];
}

export class GenerateAiPlanDto {
  @IsOptional()
  @IsIn(PROJECT_TYPES)
  projectType?: (typeof PROJECT_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  propertyType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  budgetRange?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  timeline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1500)
  details?: string;

  @IsOptional()
  @IsIn(AI_LANGUAGES)
  language?: (typeof AI_LANGUAGES)[number];
}

export class AnalyzeAiDocumentDto {
  @IsOptional()
  @IsIn(AI_LANGUAGES)
  language?: (typeof AI_LANGUAGES)[number];
}

export class QuoteRequestFromPlanDto {
  @IsUUID()
  engineerProfileId: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  projectTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  projectDescription?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  propertyType?: string;

  @IsString()
  @MinLength(5)
  @MaxLength(300)
  locationAddress: string;

  @Type(() => Number)
  @IsLatitude()
  latitude: number;

  @Type(() => Number)
  @IsLongitude()
  longitude: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  projectSizeSqFt?: number;

  @IsOptional()
  @IsDateString()
  preferredStartDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  budgetEstimatePaisa?: number;
}

export class UploadAiDocumentDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  conversationId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  fileName: string;

  @IsIn(['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain'])
  mimeType: string;

  @IsString()
  @MaxLength(1500000)
  @Matches(/^[A-Za-z0-9+/]+={0,2}$/)
  contentBase64: string;
}

export class UpdateAiPlanDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @Type(() => Boolean)
  archived?: boolean;
}
