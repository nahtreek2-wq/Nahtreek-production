import {
  Equals,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export enum ProfessionalAccountType {
  CIVIL_ENGINEER = "CIVIL_ENGINEER",
  SERVICE_PROFESSIONAL = "SERVICE_PROFESSIONAL",
}

export class ProfessionalRegisterDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?\d[\d\s-]{8,14}$/, {
    message: "phoneNumber must be a valid Indian mobile number",
  })
  phoneNumber: string;

  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @Matches(/^\d{6}$/)
  code: string;

  @IsEnum(ProfessionalAccountType)
  professionalType: ProfessionalAccountType;

  @IsBoolean()
  @Equals(true)
  acceptedTerms: boolean;
}
