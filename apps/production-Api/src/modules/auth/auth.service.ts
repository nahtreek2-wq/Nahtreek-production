import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { AccountStatus, PenaltyStatus, Prisma, Role, User } from "@prisma/client";
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "crypto";
import { PrismaService } from "../../common/prisma/prisma.service";
import { JwtPayload } from "../../common/strategies/jwt.strategy";
import { RefreshDto } from "./dto/refresh.dto";
import { RegisterDto } from "./dto/register.dto";
import { EmailOtpRequestDto, RequestOtpDto } from "./dto/request-otp.dto";
import { VerifyOtpDto } from "./dto/verify-otp.dto";
import { SmsService } from "./sms.service";
import { EmailOtpService } from "./email-otp.service";
import {
  ProfessionalAccountType,
  ProfessionalRegisterDto,
} from "./dto/professional-register.dto";

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// A rotation response lost to a backgrounded app or network handoff must not
// sign the user out: the just-rotated-out secret stays retryable briefly.
const REFRESH_GRACE_MS = 2 * 60 * 1000;
// Rotation renews the 7-day window, so without a family cap a session chain
// lives forever. Force a fresh sign-in 30 days after the original login.
const SESSION_ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 30 * 1000;
const OTP_MAX_ATTEMPTS = 5;
// NAHTREEK is OTP-only: one purpose covers account creation, sign-in and
// step-up verification. There are no passwords anywhere in the system.
type OtpPurpose = "OTP_AUTH";
type OtpChannel = "SMS" | "EMAIL";

type AuthUser = User & {
  roles: { role: Role }[];
  clientProfile: {
    fullName: string;
    avatarUrl: string | null;
    city: string | null;
    state: string | null;
    address?: string | null;
    postalCode?: string | null;
  } | null;
  professionalProfile: {
    fullName: string;
    avatarUrl: string | null;
    baseCity: string;
    baseState: string;
    verificationStatus: string;
  } | null;
};

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const result = digits.length === 10 ? `+91${digits}` : `+${digits}`;
  if (!/^\+91[6-9]\d{9}$/.test(result))
    throw new BadRequestException("Enter a valid Indian mobile number");
  return result;
}

function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function otpPepper(): string {
  const pepper = process.env.OTP_SECRET?.trim() || process.env.JWT_SECRET?.trim();
  if (!pepper) throw new Error("OTP_SECRET or JWT_SECRET must be configured to issue verification codes");
  return pepper;
}

// Six-digit OTPs carry ~20 bits of entropy: a plain fast hash falls to a
// database reader in seconds. HMAC with a server-side pepper keeps stored
// hashes useless without the secret. Refresh tokens keep plain SHA-256 —
// their 384-bit secrets are not brute-forceable.
function hashOtpCode(code: string): string {
  return createHmac("sha256", otpPepper()).update(code).digest("hex");
}

function safelyMatches(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(actual, "hex");
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger("AuthService");

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly smsService: SmsService,
    private readonly emailOtpService: EmailOtpService
  ) {}

  // Preview demo fallback: when no delivery provider is configured, the code
  // is written to the server log instead of being sent. Strictly preview-only
  // and strictly unconfigured-channels-only — a transient provider outage with
  // real keys configured never takes this path, in any environment.
  private useDemoOtp(channel: OtpChannel): boolean {
    if (process.env.APP_ENV !== "preview") return false;
    return channel === "EMAIL"
      ? !this.emailOtpService.isEnabled()
      : !this.smsService.isConfigured();
  }

  private normalizeEmail(raw: string): string {
    return raw.trim().toLowerCase();
  }

  private usePreviewEmailOtp(): boolean {
    return this.emailOtpService.isEnabled();
  }

  async register(body: RegisterDto) {
    const phoneNumber = normalizePhone(body.phoneNumber);
    const email = this.normalizeEmail(body.email);
    if (body.acceptedTerms !== true)
      throw new BadRequestException(
        "Complete your client details and accept the data notice"
      );
    const otpIdentifier = this.usePreviewEmailOtp() ? email : phoneNumber;
    const {demo} = await this.checkOtp(otpIdentifier, body.code, "OTP_AUTH");
    try {
      const sessionSecret = randomBytes(48).toString("base64url");
      const registration = await this.prisma.$transaction(async (tx) => {
        await this.consumeOtp(tx, otpIdentifier, body.code, "OTP_AUTH", demo);
        const created = await tx.user.create({
          data: {
            phoneNumber,
            email,
            status: AccountStatus.ACTIVE,
            isPhoneVerified: !this.usePreviewEmailOtp(),
            isEmailVerified: this.usePreviewEmailOtp(),
            roles: { create: { role: Role.CLIENT } },
            clientProfile: {
              create: {
                fullName: body.fullName?.trim() || "New Client",
                city: body.city?.trim() || undefined,
                state: body.state?.trim() || undefined,
                address: body.address?.trim() || undefined,
                postalCode: body.postalCode,
                termsAcceptedAt: new Date(),
                termsVersion: "account-data-v1",
              },
            },
          },
          include: {
            roles: true,
            clientProfile: true,
            professionalProfile: true,
          },
        });
        await tx.auditLog.create({
          data: {
            userId: created.id,
            action: "ACCOUNT_CREATED",
            entity: "User",
            entityId: created.id,
          },
        });
        const session = await tx.session.create({
          data: {
            userId: created.id,
            authVersion: created.authVersion,
            refreshTokenHash: hashSecret(sessionSecret),
            expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
          },
        });
        return {user: created, sessionId: session.id};
      });
      return this.issueTokensForSession(
        registration.user,
        registration.sessionId,
        sessionSecret
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException(
          "An account with this phone number or email already exists"
        );
      }
      throw error;
    }
  }

  async registerProfessional(body: ProfessionalRegisterDto) {
    const phoneNumber = normalizePhone(body.phoneNumber);
    const email = this.normalizeEmail(body.email);
    if (body.acceptedTerms !== true) {
      throw new BadRequestException(
        "Accept the account data notice to continue"
      );
    }
    const otpIdentifier = this.usePreviewEmailOtp() ? email : phoneNumber;
    const {demo} = await this.checkOtp(otpIdentifier, body.code, "OTP_AUTH");
    const role =
      body.professionalType === ProfessionalAccountType.CIVIL_ENGINEER
        ? Role.ENGINEER
        : Role.SERVICE_PROVIDER;
    try {
      const sessionSecret = randomBytes(48).toString("base64url");
      const registration = await this.prisma.$transaction(async (tx) => {
        await this.consumeOtp(tx, otpIdentifier, body.code, "OTP_AUTH", demo);
        const created = await tx.user.create({
          data: {
            phoneNumber,
            email,
            status: AccountStatus.ACTIVE,
            isPhoneVerified: !this.usePreviewEmailOtp(),
            isEmailVerified: this.usePreviewEmailOtp(),
            roles: { create: { role } },
          },
          include: {
            roles: true,
            clientProfile: true,
            professionalProfile: true,
          },
        });
        await tx.auditLog.create({
          data: {
            userId: created.id,
            action: "PROFESSIONAL_ACCOUNT_CREATED",
            entity: "User",
            entityId: created.id,
            metadata: { professionalType: body.professionalType },
          },
        });
        const session = await tx.session.create({
          data: {
            userId: created.id,
            authVersion: created.authVersion,
            refreshTokenHash: hashSecret(sessionSecret),
            expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
          },
        });
        return {user: created, sessionId: session.id};
      });
      return this.issueTokensForSession(
        registration.user,
        registration.sessionId,
        sessionSecret
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException(
          "An account with this phone number or email already exists"
        );
      }
      throw error;
    }
  }

  private async checkOtp(
    identifier: string,
    code: string,
    purpose: OtpPurpose
  ): Promise<{demo: boolean}> {
    const challenge = await this.prisma.otpChallenge.findUnique({
      where: { identifier },
    });
    if (
      !challenge ||
      challenge.expiresAt <= new Date() ||
      challenge.attempts >= OTP_MAX_ATTEMPTS ||
      challenge.purpose !== purpose
    )
      throw new BadRequestException(
        "Code expired or unavailable. Request a new code"
      );
    // Preview-only demo code: lets the owner sign in to test-domain demo
    // accounts that cannot receive real SMS/email. Requires APP_ENV=preview
    // AND an explicitly configured PREVIEW_DEMO_OTP — production and any
    // environment without the variable can never take this path.
    const demoCode = process.env.PREVIEW_DEMO_OTP?.trim();
    if (
      demoCode &&
      process.env.APP_ENV === "preview" &&
      code === demoCode
    ) {
      this.logger.warn(`Preview demo-code sign-in for ${identifier}.`);
      return {demo: true};
    }
    if (!safelyMatches(challenge.codeHash, hashOtpCode(code))) {
      await this.prisma.otpChallenge.updateMany({
        where: { identifier, codeHash: challenge.codeHash, purpose },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException("Incorrect verification code");
    }
    return {demo: false};
  }

  private async consumeOtp(
    tx: Prisma.TransactionClient,
    identifier: string,
    code: string,
    purpose: OtpPurpose,
    demo = false
  ) {
    const consumed = await tx.otpChallenge.deleteMany({
      where: demo
        ? {
            identifier,
            purpose,
            expiresAt: { gt: new Date() },
            attempts: { lt: OTP_MAX_ATTEMPTS },
          }
        : {
            identifier,
            codeHash: hashOtpCode(code),
            purpose,
            expiresAt: { gt: new Date() },
            attempts: { lt: OTP_MAX_ATTEMPTS },
          },
    });
    if (consumed.count !== 1)
      throw new UnauthorizedException(
        "Code already used or expired. Request a new code"
      );
  }

  async refresh(body: RefreshDto) {
    const parsed = this.parseRefreshToken(body.refreshToken);
    if (!parsed)
      throw new UnauthorizedException("Invalid or expired refresh token");
    const session = await this.prisma.session.findUnique({
      where: { id: parsed.sessionId },
      include: {
        user: {
          include: {
            roles: true,
            clientProfile: true,
            professionalProfile: true,
          },
        },
      },
    });
    if (
      !session ||
      session.revokedAt ||
      session.authVersion !== session.user.authVersion ||
      session.expiresAt <= new Date() ||
      session.createdAt.getTime() + SESSION_ABSOLUTE_TTL_MS <= Date.now()
    ) {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }
    const presented = hashSecret(parsed.secret);
    const graceOpen =
      session.previousRefreshTokenHash &&
      session.previousRotatedAt &&
      session.previousRotatedAt.getTime() + REFRESH_GRACE_MS > Date.now();
    const matchesCurrent = safelyMatches(session.refreshTokenHash, presented);
    const matchesPrevious =
      !matchesCurrent &&
      graceOpen &&
      safelyMatches(session.previousRefreshTokenHash as string, presented);
    if (!matchesCurrent && !matchesPrevious) {
      throw new UnauthorizedException("Invalid or expired refresh token");
    }
    this.assertAccountCanAuthenticate(session.user.status);
    const sessionSecret = randomBytes(48).toString("base64url");
    // In-place rotation keeps the session id (and push-device links) stable
    // and preserves the absolute family lifetime via the untouched createdAt.
    // A grace-hit keeps the previous secret valid with a fresh window, so a
    // second lost response still recovers on the next retry.
    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: hashSecret(sessionSecret),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        previousRefreshTokenHash: matchesCurrent
          ? session.refreshTokenHash
          : session.previousRefreshTokenHash,
        previousRotatedAt: new Date(),
      },
    });
    return this.issueTokensForSession(session.user, session.id, sessionSecret);
  }

  async logout(body: RefreshDto) {
    const parsed = this.parseRefreshToken(body.refreshToken);
    if (!parsed) return { ok: true };
    const session = await this.prisma.session.findUnique({
      where: { id: parsed.sessionId },
    });
    if (
      session &&
      (safelyMatches(session.refreshTokenHash, hashSecret(parsed.secret)) ||
        (session.previousRefreshTokenHash &&
          safelyMatches(
            session.previousRefreshTokenHash,
            hashSecret(parsed.secret)
          )))
    ) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
    }
    return { ok: true };
  }

  async requestOtp(body: RequestOtpDto) {
    const phoneNumber = normalizePhone(body.phoneNumber);
    return this.createAndSendOtp(phoneNumber, "SMS", "OTP_AUTH");
  }

  async requestEmailOtp(body: EmailOtpRequestDto) {
    if (!this.emailOtpService.isEnabled() && !this.useDemoOtp("EMAIL"))
      throw new BadRequestException(
        "Preview email verification is not configured yet"
      );
    return this.createAndSendOtp(
      this.normalizeEmail(body.email),
      "EMAIL",
      "OTP_AUTH"
    );
  }

  private async createAndSendOtp(
    identifier: string,
    channel: OtpChannel,
    purpose: OtpPurpose
  ) {
    const now = new Date();
    const existing = await this.prisma.otpChallenge.findUnique({
      where: { identifier },
    });
    if (
      existing &&
      existing.requestedAt.getTime() + OTP_RESEND_COOLDOWN_MS > now.getTime()
    ) {
      const waitMs =
        existing.requestedAt.getTime() + OTP_RESEND_COOLDOWN_MS - now.getTime();
      throw new BadRequestException(
        `Please wait ${Math.ceil(waitMs / 1000)}s before requesting a new OTP`
      );
    }
    const code = String(randomInt(100000, 1_000_000));
    const sent =
      channel === "EMAIL"
        ? await this.emailOtpService.sendOtp(identifier, code)
        : await this.smsService.sendOtp(identifier, code);
    if (!sent && this.useDemoOtp(channel)) {
      this.logger.warn(
        `DEMO-ONLY preview OTP for ${identifier}: ${code}. No ${
          channel === "EMAIL" ? "email" : "SMS"
        } provider is configured.`
      );
    } else if (!sent) {
      throw new BadRequestException(
        `Could not send ${
          channel === "EMAIL" ? "email" : "SMS"
        } right now. Please try again shortly`
      );
    }
    await this.prisma.otpChallenge.upsert({
      where: { identifier },
      create: {
        identifier,
        deliveryChannel: channel,
        purpose,
        codeHash: hashOtpCode(code),
        expiresAt: new Date(now.getTime() + OTP_TTL_MS),
        requestedAt: now,
      },
      update: {
        codeHash: hashOtpCode(code),
        deliveryChannel: channel,
        purpose,
        expiresAt: new Date(now.getTime() + OTP_TTL_MS),
        requestedAt: now,
        attempts: 0,
      },
    });
    return {
      message: `${channel === "EMAIL" ? "Email" : "SMS"} OTP sent`,
      expiresIn: Math.floor(OTP_TTL_MS / 1000),
    };
  }

  async verifyOtp(body: VerifyOtpDto) {
    // Preview email-OTP mode mirrors registration: the code lives under the
    // email identifier. Production (and flag-off) stays phone-based.
    const byEmail = this.usePreviewEmailOtp();
    if (byEmail && !body.email)
      throw new BadRequestException("Provide an email address");
    if (!byEmail && !body.phoneNumber)
      throw new BadRequestException("Provide a mobile number");
    const identifier = byEmail
      ? this.normalizeEmail(body.email!)
      : normalizePhone(body.phoneNumber!);
    const {demo} = await this.checkOtp(identifier, body.code, "OTP_AUTH");
    const user = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({
        where: byEmail ? { email: identifier } : { phoneNumber: identifier },
      });
      if (!existing || existing.deletedAt)
        throw new BadRequestException(
          "Create an account with your client details first"
        );
      this.assertAccountCanAuthenticate(existing.status);
      await this.consumeOtp(tx, identifier, body.code, "OTP_AUTH", demo);
      return tx.user.update({
        where: { id: existing.id },
        data: byEmail ? { isEmailVerified: true } : { isPhoneVerified: true },
        include: {
          roles: true,
          clientProfile: true,
          professionalProfile: true,
        },
      });
    });
    return { ...(await this.issueTokens(user)), isNewUser: false };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        roles: true,
        clientProfile: true,
        professionalProfile: true,
      },
    });
    if (!user) throw new UnauthorizedException("Unknown user");
    return this.serializeUser(user);
  }

  // Account deletion (App Store / Play requirement for any app with
  // accounts). Soft-delete: the row stays for booking/money history, but
  // login, refresh and sessions stop working immediately (deletedAt +
  // authVersion guards already enforce this everywhere). A fresh OTP code
  // proves presence; pros with unsettled commission dues must settle first
  // so deletion cannot dodge money owed.
  async deleteAccount(userId: string, code?: string) {
    const user = await this.prisma.user.findUnique({where: {id: userId},
      include: {professionalProfile: {select: {id: true}}}});
    if (!user || user.deletedAt) throw new UnauthorizedException("Unknown user");
    if (!code || !/^\d{6}$/.test(code))
      throw new BadRequestException("Enter the 6-digit verification code");
    const byEmail = this.usePreviewEmailOtp();
    const identifier = byEmail
      ? this.normalizeEmail(user.email ?? "")
      : user.phoneNumber;
    if (!identifier || (byEmail && !user.email))
      throw new BadRequestException("Request a verification code first");
    const {demo} = await this.checkOtp(identifier, code, "OTP_AUTH");
    await this.prisma.$transaction(async (tx) => {
      await this.consumeOtp(tx, identifier, code, "OTP_AUTH", demo);
    });
    if (user.professionalProfile) {
      const dues = await this.prisma.payment.aggregate({where: {professionalProfileId: user.professionalProfile.id,
          status: 'COLLECTED_UNSETTLED'}, _sum: {platformFeePaisa: true}}).catch(() => null);
      const penalties = await this.prisma.professionalPenalty.aggregate({where: {professionalProfileId: user.professionalProfile.id,
          status: PenaltyStatus.PENDING}, _sum: {amountPaisa: true}}).catch(() => null);
      const owed = (dues?._sum?.platformFeePaisa ?? 0) + (penalties?._sum?.amountPaisa ?? 0);
      if (owed > 0) throw new ConflictException(
        `Settle your \u20B9${(owed / 100).toLocaleString('en-IN')} commission dues before deleting your account`);
    }
    await this.prisma.user.update({where: {id: userId}, data: {deletedAt: new Date(), authVersion: {increment: 1}}});
    await this.prisma.auditLog.create({data: {userId, entity: 'User', entityId: userId,
      action: 'ACCOUNT_DELETED', metadata: {}}}).catch(() => undefined);
    return {deleted: true};
  }

  private async issueTokens(user: AuthUser, preserveCreatedAt?: Date) {
    const sessionSecret = randomBytes(48).toString("base64url");
    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        authVersion: user.authVersion,
        refreshTokenHash: hashSecret(sessionSecret),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        // Rotation must not reset the absolute family lifetime.
        createdAt: preserveCreatedAt,
      },
    });
    return this.issueTokensForSession(user, session.id, sessionSecret);
  }

  private async issueTokensForSession(
    user: AuthUser,
    sessionId: string,
    sessionSecret: string
  ) {
    const payload: JwtPayload = {
      sub: user.id,
      phoneNumber: user.phoneNumber,
      roles: user.roles.map(({ role }) => role),
      sid: sessionId,
    };
    return {
      accessToken: await this.jwtService.signAsync(payload),
      refreshToken: `${sessionId}.${sessionSecret}`,
      user: this.serializeUser(user),
    };
  }

  private serializeUser(user: AuthUser) {
    return {
      id: user.id,
      fullName:
        user.professionalProfile?.fullName ||
        user.clientProfile?.fullName ||
        (user.roles.some(({ role }) => role === Role.ADMIN)
          ? user.displayName || "NAHTREEK Administrator"
          : "NAHTREEK Professional"),
      phoneNumber: user.phoneNumber,
      email: user.email ?? undefined,
      address: user.clientProfile?.address ?? undefined,
      postalCode: user.clientProfile?.postalCode ?? undefined,
      avatarUrl:
        user.professionalProfile?.avatarUrl ??
        user.clientProfile?.avatarUrl ??
        undefined,
      roles: user.roles.map(({ role }) => role),
      city:
        user.professionalProfile?.baseCity ||
        user.clientProfile?.city ||
        undefined,
      homeCity:
        user.professionalProfile?.baseCity ||
        user.clientProfile?.city ||
        undefined,
      state:
        user.professionalProfile?.baseState ||
        user.clientProfile?.state ||
        undefined,
      verificationStatus:
        user.professionalProfile?.verificationStatus ?? "NOT_SUBMITTED",
      needsProfessionalProfile: !user.professionalProfile,
    };
  }

  private parseRefreshToken(
    token: string
  ): { sessionId: string; secret: string } | null {
    const [sessionId, secret, extra] = token.split(".");
    return sessionId && secret && !extra ? { sessionId, secret } : null;
  }

  private assertAccountCanAuthenticate(status: AccountStatus): void {
    if (status !== AccountStatus.ACTIVE) {
      throw new ForbiddenException("This account is not active");
    }
  }
}
