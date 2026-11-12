import { AccountStatus, PrismaClient, Role } from "@prisma/client";

const prisma = new PrismaClient();

// OTP-only: the preview admin signs in with an email code (or the preview
// demo code). No password is created or stored.
async function main() {
  if (process.env.ALLOW_ADMIN_SEED !== "true") {
    throw new Error(
      "Set ALLOW_ADMIN_SEED=true to create the preview administrator"
    );
  }
  if (process.env.APP_ENV === "production") {
    throw new Error("Preview administrator seeding is forbidden in production");
  }
  const user = await prisma.user.upsert({
    where: { email: "admin.demo@nahtreek.example" },
    create: {
      email: "admin.demo@nahtreek.example",
      phoneNumber: "+919999990100",
      status: AccountStatus.ACTIVE,
      isPhoneVerified: true,
      isEmailVerified: true,
    },
    update: {
      status: AccountStatus.ACTIVE,
      isPhoneVerified: true,
      isEmailVerified: true,
      deletedAt: null,
      authVersion: { increment: 1 },
    },
  });
  await prisma.userRole.upsert({
    where: { userId_role: { userId: user.id, role: Role.ADMIN } },
    create: { userId: user.id, role: Role.ADMIN },
    update: {},
  });
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "SYNTHETIC_PREVIEW_ADMIN_SEEDED",
      entity: "User",
      entityId: user.id,
      metadata: { synthetic: true },
    },
  });
  console.log(JSON.stringify({ userId: user.id, email: user.email }));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
