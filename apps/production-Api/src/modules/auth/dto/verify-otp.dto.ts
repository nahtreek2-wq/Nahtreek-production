import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from "class-validator";

export class VerifyOtpDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?\d[\d\s-]{8,14}$/, {
    message: "phoneNumber must be a valid Indian mobile number",
  })
  phoneNumber?: string;

  @IsOptional()
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(254)
  email?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(6)
  code: string;

  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  state?: string;
}
