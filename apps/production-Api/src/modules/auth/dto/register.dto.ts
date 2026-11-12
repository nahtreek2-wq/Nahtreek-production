import {
  Equals,
  IsBoolean,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?\d[\d\s-]{8,14}$/, {
    message: "phoneNumber must be a valid Indian mobile number",
  })
  phoneNumber: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName?: string;

  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  city?: string;
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  state?: string;
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  address?: string;
  @IsOptional()
  @IsString()
  @Matches(/^[1-9]\d{5}$/)
  postalCode?: string;
  @IsString()
  @Matches(/^\d{6}$/)
  code: string;
  @IsBoolean()
  @Equals(true)
  acceptedTerms: boolean;
}

