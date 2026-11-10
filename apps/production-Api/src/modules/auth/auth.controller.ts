import { Body, Controller, Delete, Get, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtPayload } from "../../common/strategies/jwt.strategy";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { RefreshDto } from "./dto/refresh.dto";
import {
  EmailResetPasswordDto,
  RegisterDto,
  ResetPasswordDto,
} from "./dto/register.dto";
import { EmailOtpRequestDto, RequestOtpDto } from "./dto/request-otp.dto";
import { VerifyOtpDto } from "./dto/verify-otp.dto";
import { AuthThrottleGuard } from "./auth-throttle.guard";
import { ProfessionalRegisterDto } from "./dto/professional-register.dto";

@Controller("auth")
@UseGuards(AuthThrottleGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register")
  async register(@Body() body: RegisterDto) {
    return this.authService.register(body);
  }

  @Post("professionals/register")
  async registerProfessional(@Body() body: ProfessionalRegisterDto) {
    return this.authService.registerProfessional(body);
  }

  @Post("login")
  async login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }

  @Post("professionals/login")
  async loginProfessional(@Body() body: LoginDto) {
    return this.authService.loginProfessional(body);
  }

  @Post("password-reset/request")
  requestReset(@Body() body: RequestOtpDto) {
    return this.authService.requestPasswordReset(body);
  }

  @Post("password-reset/email/request")
  requestEmailReset(@Body() body: EmailOtpRequestDto) {
    return this.authService.requestEmailPasswordReset(body);
  }

  @Post("password-reset/email/confirm")
  resetEmailPassword(@Body() body: EmailResetPasswordDto) {
    return this.authService.resetPasswordByEmail(body);
  }
  @Post("password-reset/confirm")
  reset(@Body() body: ResetPasswordDto) {
    return this.authService.resetPassword(body);
  }

  @Post("otp/request")
  async requestOtp(@Body() body: RequestOtpDto) {
    return this.authService.requestOtp(body);
  }

  @Post("email-otp/request")
  async requestEmailOtp(@Body() body: EmailOtpRequestDto) {
    return this.authService.requestEmailOtp(body);
  }

  @Post("otp/verify")
  async verifyOtp(@Body() body: VerifyOtpDto) {
    return this.authService.verifyOtp(body);
  }

  @Post("refresh")
  async refresh(@Body() body: RefreshDto) {
    return this.authService.refresh(body);
  }

  @Post("logout")
  async logout(@Body() body: RefreshDto) {
    return this.authService.logout(body);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: JwtPayload) {
    return this.authService.me(user.sub);
  }

  @Delete("me")
  @UseGuards(JwtAuthGuard)
  async deleteMe(@CurrentUser() user: JwtPayload, @Body() body: {password?: string}) {
    return this.authService.deleteAccount(user.sub, body?.password);
  }
}
