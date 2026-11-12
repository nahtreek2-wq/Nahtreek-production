import { createHash, createHmac } from "crypto";
import { AuthService, normalizePhone } from "./auth.service";
// Stored OTP hashes are HMACs under a server-side pepper, so fixtures must
// use the same pepper the service reads.
const OTP_PEPPER = "unit-test-only-otp-pepper";
const previousOtpSecret = process.env.OTP_SECRET;
process.env.OTP_SECRET = OTP_PEPPER;
afterAll(() => {
  if (previousOtpSecret === undefined) delete process.env.OTP_SECRET;
  else process.env.OTP_SECRET = previousOtpSecret;
});
const otpHash = (code: string) => createHmac("sha256", OTP_PEPPER).update(code).digest("hex");
import { AuthThrottleGuard } from "./auth-throttle.guard";
import { JwtStrategy } from "../../common/strategies/jwt.strategy";
import { RegisterDto } from "./dto/register.dto";
import { validateSync } from "class-validator";
import {
  ProfessionalAccountType,
  ProfessionalRegisterDto,
} from "./dto/professional-register.dto";
import { VerifyOtpDto } from "./dto/verify-otp.dto";
const registration: RegisterDto = {
  phoneNumber: "9000012345",
  fullName: "Client QA",
  email: "qa@example.com",
  address: "12 Test Street",
  city: "Chennai",
  state: "Tamil Nadu",
  postalCode: "600001",
  code: "345678",
  acceptedTerms: true,
};
function harness() {
  const user = {
    id: "client",
    phoneNumber: "+919000012345",
    email: "qa@example.com",
    status: "ACTIVE",
    deletedAt: null,
    authVersion: 0,
    isPhoneVerified: true,
    roles: [{ role: "CLIENT" }],
    clientProfile: {
      fullName: "Client QA",
      city: "Chennai",
      state: "Tamil Nadu",
      address: "12 Test Street",
      postalCode: "600001",
      avatarUrl: null,
    },
    professionalProfile: null,
  };
  const tx = {
    otpChallenge: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    user: {
      create: jest.fn().mockResolvedValue(user),
      findUnique: jest.fn().mockResolvedValue(user),
      update: jest.fn().mockResolvedValue(user),
    },
    auditLog: { create: jest.fn() },
    session: { create: jest.fn().mockResolvedValue({id: "session"}), updateMany: jest.fn() },
  };
  const prisma = {
    otpChallenge: {
      findUnique: jest.fn().mockResolvedValue({
        codeHash: otpHash("345678"),
        purpose: "OTP_AUTH",
        attempts: 0,
        expiresAt: new Date(Date.now() + 300000),
      }),
      updateMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(user),
      findFirst: jest.fn().mockResolvedValue(user),
    },
    session: { create: jest.fn().mockResolvedValue({ id: "session" }) },
    $transaction: jest.fn((fn) => fn(tx)),
  };
  const emailOtpService = {
    isEnabled: jest.fn().mockReturnValue(false),
    sendOtp: jest.fn(),
  };
  const service = new AuthService(
    { signAsync: jest.fn().mockResolvedValue("jwt") } as any,
    prisma as any,
    { sendOtp: jest.fn() } as any,
    emailOtpService as any
  );
  return { service, prisma, tx, user, emailOtpService };
}
it("validates all required client fields", () => {
  expect(
    validateSync(Object.assign(new RegisterDto(), registration))
  ).toHaveLength(0);
  expect(
    validateSync(
      Object.assign(new RegisterDto(), registration, {
        email: "bad",
        postalCode: "12",
        acceptedTerms: false,
      })
    )
  ).toHaveLength(3);
});
it("registers verified contact and client details with no password stored", async () => {
  const { service, tx } = harness();
  const result = await service.register(registration);
  const created = tx.user.create.mock.calls[0][0].data;
  expect(created).toMatchObject({
    isPhoneVerified: true,
    email: "qa@example.com",
    clientProfile: {
      create: {
        city: "Chennai",
        state: "Tamil Nadu",
        address: "12 Test Street",
        postalCode: "600001",
        termsVersion: "account-data-v1",
      },
    },
  });
  expect(created).not.toHaveProperty("passwordHash");
  expect(JSON.stringify(tx.user.create.mock.calls)).not.toContain("password");
  expect(tx.session.create).toHaveBeenCalledWith({
    data: expect.objectContaining({userId: "client", authVersion: 0}),
  });
  expect(result.user).toMatchObject({
    homeCity: "Chennai",
    postalCode: "600001",
  });
});
it("uses verified email and leaves mobile unverified in Preview", async () => {
  const { service, tx, emailOtpService } = harness();
  emailOtpService.isEnabled.mockReturnValue(true);
  await service.register(registration);
  expect(tx.user.create.mock.calls[0][0].data).toMatchObject({
    email: "qa@example.com",
    isEmailVerified: true,
    isPhoneVerified: false,
  });
  expect(tx.otpChallenge.deleteMany).toHaveBeenCalledWith({
    where: expect.objectContaining({
      identifier: "qa@example.com",
      purpose: "OTP_AUTH",
    }),
  });
});
it("rejects missing mobile proof before account creation", async () => {
  const { service, tx, prisma } = harness();
  prisma.otpChallenge.findUnique.mockResolvedValue(null);
  await expect(service.register(registration)).rejects.toThrow("expired");
  expect(tx.user.create).not.toHaveBeenCalled();
});
it("counts wrong OTP attempts without creating an account", async () => {
  const { service, tx, prisma } = harness();
  await expect(
    service.register({ ...registration, code: "999999" })
  ).rejects.toThrow("Incorrect");
  expect(prisma.otpChallenge.updateMany).toHaveBeenCalled();
  expect(tx.user.create).not.toHaveBeenCalled();
});
it("rejects OTP replay inside the registration transaction", async () => {
  const { service, tx } = harness();
  tx.otpChallenge.deleteMany.mockResolvedValue({ count: 0 });
  await expect(service.register(registration)).rejects.toThrow("already used");
  expect(tx.user.create).not.toHaveBeenCalled();
});
it("refuses to verify codes when no OTP pepper is configured", async () => {
  const { service } = harness();
  const savedOtp = process.env.OTP_SECRET;
  const savedJwt = process.env.JWT_SECRET;
  delete process.env.OTP_SECRET;
  delete process.env.JWT_SECRET;
  try {
    await expect(service.register(registration)).rejects.toThrow("must be configured");
  } finally {
    if (savedOtp !== undefined) process.env.OTP_SECRET = savedOtp;
    if (savedJwt !== undefined) process.env.JWT_SECRET = savedJwt;
  }
});
describe("preview demo-code sign-in", () => {
  const DEMO_CODE = "123456";
  function demoEnv(appEnv: string | undefined, demo: string | undefined) {
    const savedApp = process.env.APP_ENV;
    const savedDemo = process.env.PREVIEW_DEMO_OTP;
    if (appEnv === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = appEnv;
    if (demo === undefined) delete process.env.PREVIEW_DEMO_OTP;
    else process.env.PREVIEW_DEMO_OTP = demo;
    return () => {
      if (savedApp === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = savedApp;
      if (savedDemo === undefined) delete process.env.PREVIEW_DEMO_OTP;
      else process.env.PREVIEW_DEMO_OTP = savedDemo;
    };
  }
  it("accepts the demo code in preview when it is configured", async () => {
    const restore = demoEnv("preview", DEMO_CODE);
    try {
      const { service, tx } = harness();
      const result = await service.verifyOtp({
        phoneNumber: "9000012345",
        code: DEMO_CODE,
      });
      expect(result.accessToken).toBe("jwt");
      expect(tx.otpChallenge.deleteMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          identifier: "+919000012345",
          purpose: "OTP_AUTH",
        }),
      });
      // Demo consumption never matches on a code hash.
      expect(
        tx.otpChallenge.deleteMany.mock.calls[0][0].where
      ).not.toHaveProperty("codeHash");
    } finally {
      restore();
    }
  });
  it("rejects the demo code outside preview", async () => {
    const restore = demoEnv("production", DEMO_CODE);
    try {
      const { service, tx } = harness();
      await expect(
        service.verifyOtp({ phoneNumber: "9000012345", code: DEMO_CODE })
      ).rejects.toThrow("Incorrect verification code");
      expect(tx.user.findUnique).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
  it("rejects the demo code in preview when it is not configured", async () => {
    const restore = demoEnv("preview", undefined);
    try {
      const { service } = harness();
      await expect(
        service.verifyOtp({ phoneNumber: "9000012345", code: DEMO_CODE })
      ).rejects.toThrow("Incorrect verification code");
    } finally {
      restore();
    }
  });
  it("still requires a live challenge row for the demo code", async () => {
    const restore = demoEnv("preview", DEMO_CODE);
    try {
      const { service, prisma } = harness();
      prisma.otpChallenge.findUnique.mockResolvedValue(null);
      await expect(
        service.verifyOtp({ phoneNumber: "9000012345", code: DEMO_CODE })
      ).rejects.toThrow("expired");
    } finally {
      restore();
    }
  });
});

it("registers a professional role without inventing a public profile", async () => {
  const { service, tx } = harness();
  const input: ProfessionalRegisterDto = {
    phoneNumber: "9000012345",
    email: "engineer@example.com",
    code: "345678",
    professionalType: ProfessionalAccountType.CIVIL_ENGINEER,
    acceptedTerms: true,
  };
  tx.user.create.mockResolvedValue({
    id: "professional",
    phoneNumber: "+919000012345",
    email: input.email,
    authVersion: 0,
    status: "ACTIVE",
    isPhoneVerified: true,
    isEmailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    roles: [{ role: "ENGINEER" }],
    clientProfile: null,
    professionalProfile: null,
  });
  const result = await service.registerProfessional(input);
  const createInput = tx.user.create.mock.calls[0][0];
  expect(createInput.data).toMatchObject({
    roles: { create: { role: "ENGINEER" } },
  });
  expect(createInput.data).not.toHaveProperty("clientProfile");
  expect(result.user).toMatchObject({
    roles: ["ENGINEER"],
    needsProfessionalProfile: true,
    verificationStatus: "NOT_SUBMITTED",
  });
});

it("validates professional account type and consent", () => {
  const valid = Object.assign(new ProfessionalRegisterDto(), {
    phoneNumber: "9000012345",
    email: "engineer@example.com",
    code: "345678",
    professionalType: ProfessionalAccountType.SERVICE_PROFESSIONAL,
    acceptedTerms: true,
  });
  expect(validateSync(valid)).toHaveLength(0);
  expect(
    validateSync(
      Object.assign(valid, {
        professionalType: "CLIENT",
        acceptedTerms: false,
      })
    )
  ).toHaveLength(2);
});
it("normalizes Indian numbers and rejects invalid numbers", () => {
  expect(normalizePhone("90000 12345")).toBe("+919000012345");
  expect(() => normalizePhone("123")).toThrow();
});
it("limits repeated authentication attempts", async () => {
  let queryCount = 0;
  const prisma = {
    $queryRaw: jest
      .fn()
      .mockImplementation(() =>
        Promise.resolve([{ count: Math.ceil(++queryCount / 2) }])
      ),
    $executeRaw: jest.fn().mockResolvedValue(0),
  };
  const guard = new AuthThrottleGuard(prisma as any);
  const ctx = {
    switchToHttp: () => ({
      getRequest: () => ({
        method: "POST",
        path: "/auth/otp/verify",
        ip: "test-ip",
        body: { email: "qa@example.com" },
      }),
    }),
  };
  for (let i = 0; i < 5; i++)
    await expect(guard.canActivate(ctx as any)).resolves.toBe(true);
  await expect(guard.canActivate(ctx as any)).rejects.toThrow(
    "Too many attempts"
  );
});
it("rejects a refresh session after the account security version moved on", async () => {
  const { service, prisma, user } = harness();
  (prisma.session as any).findUnique = jest.fn().mockResolvedValue({
    authVersion: 0,
    user: { ...user, authVersion: 1 },
    revokedAt: null,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60000),
    refreshTokenHash: createHash("sha256").update("secret").digest("hex"),
  });
  await expect(
    service.refresh({ refreshToken: "session.secret" })
  ).rejects.toThrow("expired");
  expect(prisma.session.create).not.toHaveBeenCalled();
});
it("forces a fresh sign-in 30 days after the original login", async () => {
  const { service, prisma, user } = harness();
  (prisma.session as any).findUnique = jest.fn().mockResolvedValue({
    authVersion: 0,
    user: { ...user, authVersion: 0 },
    revokedAt: null,
    createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
    expiresAt: new Date(Date.now() + 60000),
    refreshTokenHash: createHash("sha256").update("secret").digest("hex"),
  });
  (prisma.session as any).update = jest.fn();
  await expect(
    service.refresh({ refreshToken: "session.secret" })
  ).rejects.toThrow("expired");
  expect(prisma.session.create).not.toHaveBeenCalled();
});
it("rotates refresh tokens in place, keeping the session id and sign-in date", async () => {
  const { service, prisma, user } = harness();
  const createdAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const currentHash = createHash("sha256").update("secret").digest("hex");
  (prisma.session as any).findUnique = jest.fn().mockResolvedValue({
    id: "session",
    authVersion: 0,
    user: { ...user, authVersion: 0 },
    revokedAt: null,
    createdAt,
    expiresAt: new Date(Date.now() + 60000),
    refreshTokenHash: currentHash,
    previousRefreshTokenHash: null,
    previousRotatedAt: null,
  });
  (prisma.session as any).update = jest.fn();
  const tokens = await service.refresh({ refreshToken: "session.secret" });
  expect(tokens.accessToken).toBe("jwt");
  expect(tokens.refreshToken.startsWith("session.")).toBe(true);
  expect(prisma.session.create).not.toHaveBeenCalled();
  const update = (prisma.session as any).update.mock.calls[0][0];
  expect(update.where).toEqual({ id: "session" });
  expect(update.data.refreshTokenHash).not.toBe(currentHash);
  expect(update.data.previousRefreshTokenHash).toBe(currentHash);
  expect(update.data.previousRotatedAt).toBeInstanceOf(Date);
  expect(update.data.createdAt).toBeUndefined();
});
it("accepts the just-rotated refresh token inside the grace window", async () => {
  const { service, prisma, user } = harness();
  const previousHash = createHash("sha256").update("secret").digest("hex");
  (prisma.session as any).findUnique = jest.fn().mockResolvedValue({
    id: "session",
    authVersion: 0,
    user: { ...user, authVersion: 0 },
    revokedAt: null,
    createdAt: new Date(Date.now() - 60000),
    expiresAt: new Date(Date.now() + 60000),
    refreshTokenHash: createHash("sha256").update("newer").digest("hex"),
    previousRefreshTokenHash: previousHash,
    previousRotatedAt: new Date(),
  });
  (prisma.session as any).update = jest.fn();
  const tokens = await service.refresh({ refreshToken: "session.secret" });
  expect(tokens.accessToken).toBe("jwt");
  const update = (prisma.session as any).update.mock.calls[0][0];
  expect(update.data.previousRefreshTokenHash).toBe(previousHash);
  expect(update.data.previousRotatedAt).toBeInstanceOf(Date);
});
it("rejects the just-rotated refresh token after the grace window", async () => {
  const { service, prisma, user } = harness();
  (prisma.session as any).findUnique = jest.fn().mockResolvedValue({
    id: "session",
    authVersion: 0,
    user: { ...user, authVersion: 0 },
    revokedAt: null,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60000),
    refreshTokenHash: createHash("sha256").update("newer").digest("hex"),
    previousRefreshTokenHash: createHash("sha256").update("secret").digest("hex"),
    previousRotatedAt: new Date(Date.now() - 10 * 60 * 1000),
  });
  (prisma.session as any).update = jest.fn();
  await expect(
    service.refresh({ refreshToken: "session.secret" })
  ).rejects.toThrow("expired");
  expect((prisma.session as any).update).not.toHaveBeenCalled();
});
it("revokes the session on logout with the previous refresh secret", async () => {
  const { service, prisma } = harness();
  (prisma.session as any).findUnique = jest.fn().mockResolvedValue({
    id: "session",
    refreshTokenHash: createHash("sha256").update("newer").digest("hex"),
    previousRefreshTokenHash: createHash("sha256").update("secret").digest("hex"),
  });
  (prisma.session as any).update = jest.fn();
  await expect(
    service.logout({ refreshToken: "session.secret" })
  ).resolves.toEqual({ ok: true });
  expect((prisma.session as any).update).toHaveBeenCalledWith({
    where: { id: "session" },
    data: { revokedAt: expect.any(Date) },
  });
});
it("rejects access sessions from before a revocation, even if not yet marked revoked", async () => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "unit-test-only-secret-at-least-32-characters";
  try {
    const strategy = new JwtStrategy({
      session: {
        findFirst: jest.fn().mockResolvedValue({
          authVersion: 0,
          user: { authVersion: 1, roles: [{ role: "CLIENT" }] },
        }),
      },
    } as any);
    await expect(
      strategy.validate({
        sub: "client",
        sid: "session",
        phoneNumber: registration.phoneNumber,
        roles: ["CLIENT"],
      })
    ).rejects.toThrow("Session revoked");
  } finally {
    if (previous === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous;
  }
});

describe("preview demo OTP fallback", () => {
  function otpHarness(channelConfigured: boolean) {
    const prisma = {
      otpChallenge: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    const service = new AuthService(
      {} as any,
      prisma as any,
      { sendOtp: jest.fn().mockResolvedValue(false), isConfigured: jest.fn().mockReturnValue(channelConfigured) } as any,
      { isEnabled: jest.fn().mockReturnValue(false), sendOtp: jest.fn().mockResolvedValue(false) } as any
    );
    return { service, prisma };
  }

  it("stores the challenge in preview when no SMS provider is configured", async () => {
    const previous = process.env.APP_ENV;
    process.env.APP_ENV = "preview";
    try {
      const { service, prisma } = otpHarness(false);
      const result = await service.requestOtp({ phoneNumber: "9000012345" });
      expect(result.message).toBe("SMS OTP sent");
      expect(prisma.otpChallenge.upsert).toHaveBeenCalledTimes(1);
    } finally {
      if (previous === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = previous;
    }
  });

  it("refuses the fallback outside preview", async () => {
    const previous = process.env.APP_ENV;
    process.env.APP_ENV = "production";
    try {
      const { service, prisma } = otpHarness(false);
      await expect(service.requestOtp({ phoneNumber: "9000012345" })).rejects.toThrow(
        "Could not send SMS right now"
      );
      expect(prisma.otpChallenge.upsert).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = previous;
    }
  });

  it("refuses the fallback in preview when the channel is configured but failing", async () => {
    const previous = process.env.APP_ENV;
    process.env.APP_ENV = "preview";
    try {
      const { service, prisma } = otpHarness(true);
      await expect(service.requestOtp({ phoneNumber: "9000012345" })).rejects.toThrow(
        "Could not send SMS right now"
      );
      expect(prisma.otpChallenge.upsert).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = previous;
    }
  });
});

describe("verifyOtp passwordless login", () => {
  it("signs in by mobile and marks it verified in phone mode", async () => {
    const { service, tx } = harness();
    const result = await service.verifyOtp({
      phoneNumber: "9000012345",
      code: "345678",
    });
    expect(tx.user.findUnique).toHaveBeenCalledWith({
      where: { phoneNumber: "+919000012345" },
    });
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isPhoneVerified: true } })
    );
    expect(result.accessToken).toBe("jwt");
    expect(result.isNewUser).toBe(false);
  });

  it("signs in by email and marks it verified in Preview email-OTP mode", async () => {
    const { service, tx, emailOtpService } = harness();
    emailOtpService.isEnabled.mockReturnValue(true);
    const result = await service.verifyOtp({
      email: "QA@Example.com",
      code: "345678",
    });
    expect(tx.user.findUnique).toHaveBeenCalledWith({
      where: { email: "qa@example.com" },
    });
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isEmailVerified: true } })
    );
    expect(result.accessToken).toBe("jwt");
  });

  it("rejects unknown users with the create-account message", async () => {
    const { service, tx } = harness();
    tx.user.findUnique.mockResolvedValueOnce(null);
    await expect(
      service.verifyOtp({ phoneNumber: "9000012345", code: "345678" })
    ).rejects.toThrow("Create an account with your client details first");
  });

  it("requires the identifier matching the active OTP channel", async () => {
    const { service, emailOtpService } = harness();
    await expect(service.verifyOtp({ code: "345678" } as any)).rejects.toThrow(
      "Provide a mobile number"
    );
    emailOtpService.isEnabled.mockReturnValue(true);
    await expect(service.verifyOtp({ code: "345678" } as any)).rejects.toThrow(
      "Provide an email address"
    );
  });

  it("validates OTP identifier formats", () => {
    expect(
      validateSync(
        Object.assign(new VerifyOtpDto(), { phoneNumber: "12", code: "345678" })
      )
    ).toHaveLength(1);
    expect(
      validateSync(
        Object.assign(new VerifyOtpDto(), { email: "bad", code: "345678" })
      )
    ).toHaveLength(1);
    expect(
      validateSync(
        Object.assign(new VerifyOtpDto(), {
          email: "qa@example.com",
          code: "345678",
        })
      )
    ).toHaveLength(0);
  });
});
