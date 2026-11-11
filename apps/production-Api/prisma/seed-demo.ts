import {
  AccountStatus,
  PrismaClient,
  Role,
  VerificationStatus,
} from "@prisma/client";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient();

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function upsertUser(input: {
  email: string;
  phoneNumber: string;
  password: string;
  role: Role;
}) {
  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await prisma.user.upsert({
    where: { email: input.email },
    create: {
      email: input.email,
      phoneNumber: input.phoneNumber,
      passwordHash,
      status: AccountStatus.ACTIVE,
      isPhoneVerified: true,
      isEmailVerified: true,
    },
    update: {
      phoneNumber: input.phoneNumber,
      passwordHash,
      status: AccountStatus.ACTIVE,
      isPhoneVerified: true,
      isEmailVerified: true,
      deletedAt: null,
      authVersion: { increment: 1 },
    },
  });
  await prisma.userRole.deleteMany({ where: { userId: user.id } });
  await prisma.userRole.create({ data: { userId: user.id, role: input.role } });
  return user;
}

async function seedClient(password: string) {
  const user = await upsertUser({
    email: "client.demo@nahtreek.example",
    phoneNumber: "+919999990101",
    password,
    role: Role.CLIENT,
  });
  const profile = await prisma.clientProfile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      fullName: "NAHTREEK Demo Client",
      city: "Coimbatore",
      state: "Tamil Nadu",
      address: "Demo address, RS Puram",
      postalCode: "641002",
      latitude: 11.0081,
      longitude: 76.9504,
      termsAcceptedAt: new Date(),
      termsVersion: "account-data-v1",
    },
    update: {
      fullName: "NAHTREEK Demo Client",
      city: "Coimbatore",
      state: "Tamil Nadu",
      address: "Demo address, RS Puram",
      postalCode: "641002",
      latitude: 11.0081,
      longitude: 76.9504,
    },
  });
  return { user, profile };
}

async function seedEngineer(password: string) {
  const user = await upsertUser({
    email: "engineer.demo@nahtreek.example",
    phoneNumber: "+919999990102",
    password,
    role: Role.ENGINEER,
  });
  const profile = await prisma.professionalProfile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      fullName: "NAHTREEK Demo Engineer",
      title: "Civil & Structural Engineer",
      bio: "Synthetic account used to demonstrate NAHTREEK request routing.",
      yearsOfExperience: 8,
      onboardingStep: "COMPLETED",
      verificationStatus: VerificationStatus.VERIFIED,
      isAvailable: true,
      startingPricePaisa: 150000,
      baseCity: "Coimbatore",
      baseState: "Tamil Nadu",
      baseCityNorm: "coimbatore",
      baseStateNorm: "tamilnadu",
      baseLatitude: 11.0168,
      baseLongitude: 76.9558,
    },
    update: {
      fullName: "NAHTREEK Demo Engineer",
      title: "Civil & Structural Engineer",
      bio: "Synthetic account used to demonstrate NAHTREEK request routing.",
      yearsOfExperience: 8,
      onboardingStep: "COMPLETED",
      verificationStatus: VerificationStatus.VERIFIED,
      isAvailable: true,
      startingPricePaisa: 150000,
      baseCity: "Coimbatore",
      baseState: "Tamil Nadu",
      baseCityNorm: "coimbatore",
      baseStateNorm: "tamilnadu",
      baseLatitude: 11.0168,
      baseLongitude: 76.9558,
    },
  });
  const engineer = await prisma.engineerProfile.upsert({
    where: { professionalProfileId: profile.id },
    create: {
      professionalProfileId: profile.id,
      consultationFeePaisa: 150000,
      qualificationDegree: "B.E. Civil Engineering (Demo)",
      institution: "NAHTREEK Demo Institute",
      graduationYear: 2018,
      licenseNumber: "DEMO-CBE-ENG-001",
    },
    update: {
      consultationFeePaisa: 150000,
      qualificationDegree: "B.E. Civil Engineering (Demo)",
      institution: "NAHTREEK Demo Institute",
      graduationYear: 2018,
      licenseNumber: "DEMO-CBE-ENG-001",
    },
  });
  const specialization = await prisma.specialization.upsert({
    where: { slug: "structural-design" },
    create: {
      slug: "structural-design",
      name: "Structural Design",
      description: "Structural planning and consultation",
    },
    update: {},
  });
  await prisma.engineerSpecialization.upsert({
    where: {
      engineerProfileId_specializationId: {
        engineerProfileId: engineer.id,
        specializationId: specialization.id,
      },
    },
    create: {
      engineerProfileId: engineer.id,
      specializationId: specialization.id,
    },
    update: {},
  });
  await prisma.serviceArea.deleteMany({
    where: { professionalProfileId: profile.id },
  });
  await prisma.serviceArea.createMany({
    data: ["RS Puram", "Gandhipuram", "Saibaba Colony"].map((name) => ({
      professionalProfileId: profile.id,
      name,
      city: "Coimbatore",
    })),
  });
  return { user, profile, engineer };
}

async function seedProvider(password: string) {
  const user = await upsertUser({
    email: "provider.demo@nahtreek.example",
    phoneNumber: "+919999990103",
    password,
    role: Role.SERVICE_PROVIDER,
  });
  const profile = await prisma.professionalProfile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      fullName: "NAHTREEK Demo Service Provider",
      title: "Electrical & Plumbing Professional",
      bio: "Synthetic account used to demonstrate NAHTREEK service bookings.",
      yearsOfExperience: 6,
      onboardingStep: "COMPLETED",
      verificationStatus: VerificationStatus.VERIFIED,
      isAvailable: true,
      serviceCategories: ["electrical", "plumbing"],
      startingPricePaisa: 35000,
      baseCity: "Coimbatore",
      baseState: "Tamil Nadu",
      baseCityNorm: "coimbatore",
      baseStateNorm: "tamilnadu",
      baseLatitude: 11.0168,
      baseLongitude: 76.9558,
    },
    update: {
      fullName: "NAHTREEK Demo Service Provider",
      title: "Electrical & Plumbing Professional",
      bio: "Synthetic account used to demonstrate NAHTREEK service bookings.",
      yearsOfExperience: 6,
      onboardingStep: "COMPLETED",
      verificationStatus: VerificationStatus.VERIFIED,
      isAvailable: true,
      serviceCategories: ["electrical", "plumbing"],
      startingPricePaisa: 35000,
      baseCity: "Coimbatore",
      baseState: "Tamil Nadu",
      baseCityNorm: "coimbatore",
      baseStateNorm: "tamilnadu",
      baseLatitude: 11.0168,
      baseLongitude: 76.9558,
    },
  });
  await prisma.serviceArea.deleteMany({
    where: { professionalProfileId: profile.id },
  });
  await prisma.serviceArea.createMany({
    data: ["RS Puram", "Gandhipuram", "Peelamedu"].map((name) => ({
      professionalProfileId: profile.id,
      name,
      city: "Coimbatore",
    })),
  });
  return { user, profile };
}

async function main() {
  if (process.env.ALLOW_DEMO_SEED !== "true") {
    throw new Error(
      "Set ALLOW_DEMO_SEED=true to create synthetic demo accounts"
    );
  }
  if (process.env.APP_ENV === "production") {
    throw new Error(
      "Demo accounts are forbidden in the production environment"
    );
  }
  const client = await seedClient(required("DEMO_CLIENT_PASSWORD"));
  const engineer = await seedEngineer(required("DEMO_ENGINEER_PASSWORD"));
  const provider = await seedProvider(required("DEMO_PROVIDER_PASSWORD"));
  await prisma.auditLog.createMany({
    data: [client.user.id, engineer.user.id, provider.user.id].map(
      (userId) => ({
        userId,
        action: "SYNTHETIC_DEMO_ACCOUNT_SEEDED",
        entity: "User",
        entityId: userId,
        metadata: { synthetic: true },
      })
    ),
  });
  console.log(
    JSON.stringify({
      clientProfileId: client.profile.id,
      engineerProfileId: engineer.engineer.id,
      engineerProfessionalProfileId: engineer.profile.id,
      providerProfessionalProfileId: provider.profile.id,
    })
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
