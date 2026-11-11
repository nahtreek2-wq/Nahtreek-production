import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsLatitude, IsLongitude, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateRequestDto {
  @IsString()
  @IsNotEmpty()
  projectTitle: string;

  @IsString()
  @IsNotEmpty()
  projectDescription: string;

  @IsString()
  @IsNotEmpty()
  propertyType: string;

  @IsUUID()
  engineerProfileId: string;

  @IsString()
  @IsNotEmpty()
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
