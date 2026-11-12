import { Body, Controller, Delete, Get, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { CurrentUser } from "../../common/decorators/current-user.decorator";
import { JwtPayload } from "../../common/strategies/jwt.strategy";
import { AuthService } from "./auth.service";
import { RefreshDto } from "./dto/refresh.dto";
import { RegisterDto } from "./dto/register.dto";
import { EmailOtpRequestDto, RequestOtpDto } from "./dto/request-otp.dto";
import { VerifyOtpDto } from "./dto/verify-otp.dto";
import { AuthThrottleGuard } from "./auth-throttle.guard";
import { ProfessionalRegisterDto } from "./dto/professional-register.dto";

// OTP-only auth: account creation and sign-in both run through
// otp/request + otp/verify (+ the email variants). There are no password
// endpoints; account deletion takes a fresh OTP code as presence proof.
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
  async deleteMe(@CurrentUser() user: JwtPayload, @Body() body: {code?: string}) {
    return this.authService.deleteAccount(user.sub, body?.code);
  }
}
