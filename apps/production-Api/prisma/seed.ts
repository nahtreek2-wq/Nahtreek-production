import { AccountStatus, PrismaClient, Role, VerificationStatus } from '@prisma/client';

const prisma = new PrismaClient();

const engineers = [
  {
    phoneNumber: '+919000000101',
    fullName: 'Er. Rajesh Kumar',
    title: 'Structural Civil Engineer',
    bio: 'Structural design and approval specialist for residential and commercial projects.',
    yearsOfExperience: 12,
    baseCity: 'Coimbatore',
    baseState: 'Tamil Nadu',
    baseLatitude: 11.0168,
    baseLongitude: 76.9558,
    consultationFeePaisa: 250000,
    qualificationDegree: 'M.E. Structural Engineering',
    institution: 'Anna University',
    graduationYear: 2008,
    licenseNumber: 'CE-CBE-2014-892',
    specializations: ['Structural Design', 'Site Plan Approval'],
    serviceAreas: ['RS Puram', 'Saibaba Colony', 'Vadavalli'],
    portfolio: [
      { title: 'G+2 Residential Structure Design', description: 'RS Puram · RCC framed residential structure', imageUrl: 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=800&q=60' },
      { title: 'Commercial Safety Audit', description: 'Gandhipuram · 12,000 sq.ft commercial property', imageUrl: 'https://images.unsplash.com/photo-1541888946425-d81bb19240f5?auto=format&fit=crop&w=800&q=60' },
    ],
  },
  {
    phoneNumber: '+919000000102',
    fullName: 'Er. Ananya Sundaram',
    title: 'Architectural Civil Engineer',
    bio: 'Architectural planning, elevation design, and Vasthu-compliant residential projects.',
    yearsOfExperience: 8,
    baseCity: 'Coimbatore',
    baseState: 'Tamil Nadu',
    baseLatitude: 11.0056,
    baseLongitude: 76.9691,
    consultationFeePaisa: 200000,
    qualificationDegree: 'B.E. Civil, M.Arch',
    institution: 'NIT Trichy',
    graduationYear: 2014,
    licenseNumber: 'CE-CBE-2018-142',
    specializations: ['Architectural 3D', 'Renovation Audit'],
    serviceAreas: ['Saravanampatti', 'Kalapatti', 'Vilankurichi'],
    portfolio: [
      { title: 'Modern Villa Elevation', description: 'Saravanampatti · Exterior 3D elevation', imageUrl: 'https://images.unsplash.com/photo-1511818966892-d7d671e672a2?auto=format&fit=crop&w=800&q=60' },
    ],
  },
  {
    phoneNumber: '+919000000103',
    fullName: 'Er. Suresh Menon',
    title: 'Geotechnical Engineer',
    bio: 'Soil testing, foundation safety assessment, and structural certification.',
    yearsOfExperience: 14,
    baseCity: 'Chennai',
    baseState: 'Tamil Nadu',
    baseLatitude: 13.0827,
    baseLongitude: 80.2707,
    consultationFeePaisa: 300000,
    qualificationDegree: 'M.Tech Geotechnical Engineering',
    institution: 'IIT Madras',
    graduationYear: 2010,
    licenseNumber: 'CE-CHN-2016-471',
    specializations: ['Geotechnical', 'Structural Design'],
    serviceAreas: ['Chennai City', 'Tambaram', 'Avadi'],
    portfolio: [
      { title: '40-acre Layout Soil Study', description: 'Tambaram · Foundation recommendation study', imageUrl: 'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=800&q=60' },
    ],
  },
];

async function seedEngineer(engineer: (typeof engineers)[number]) {
  const user = await prisma.user.upsert({
    where: { phoneNumber: engineer.phoneNumber },
    create: {
      phoneNumber: engineer.phoneNumber,
      status: AccountStatus.ACTIVE,
      isPhoneVerified: true,
      roles: { create: { role: Role.ENGINEER } },
    },
    update: { status: AccountStatus.ACTIVE, isPhoneVerified: true },
  });
  await prisma.userRole.upsert({
    where: { userId_role: { userId: user.id, role: Role.ENGINEER } },
    create: { userId: user.id, role: Role.ENGINEER },
    update: {},
  });
  const profile = await prisma.professionalProfile.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      fullName: engineer.fullName,
      title: engineer.title,
      bio: engineer.bio,
      yearsOfExperience: engineer.yearsOfExperience,
      verificationStatus: VerificationStatus.VERIFIED,
      isAvailable: true,
      baseCity: engineer.baseCity,
      baseState: engineer.baseState,
      baseLatitude: engineer.baseLatitude,
      baseLongitude: engineer.baseLongitude,
    },
    update: {
      fullName: engineer.fullName,
      title: engineer.title,
      bio: engineer.bio,
      yearsOfExperience: engineer.yearsOfExperience,
      verificationStatus: VerificationStatus.VERIFIED,
      isAvailable: true,
      baseCity: engineer.baseCity,
      baseState: engineer.baseState,
      baseLatitude: engineer.baseLatitude,
      baseLongitude: engineer.baseLongitude,
    },
  });
  const engineerProfile = await prisma.engineerProfile.upsert({
    where: { professionalProfileId: profile.id },
    create: {
      professionalProfileId: profile.id,
      consultationFeePaisa: engineer.consultationFeePaisa,
      qualificationDegree: engineer.qualificationDegree,
      institution: engineer.institution,
      graduationYear: engineer.graduationYear,
      licenseNumber: engineer.licenseNumber,
    },
    update: {
      consultationFeePaisa: engineer.consultationFeePaisa,
      qualificationDegree: engineer.qualificationDegree,
      institution: engineer.institution,
      graduationYear: engineer.graduationYear,
      licenseNumber: engineer.licenseNumber,
    },
  });
  await prisma.engineerSpecialization.deleteMany({ where: { engineerProfileId: engineerProfile.id } });
  for (const name of engineer.specializations) {
    const specialization = await prisma.specialization.upsert({
      where: { name },
      create: { name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') },
      update: {},
    });
    await prisma.engineerSpecialization.create({
      data: { engineerProfileId: engineerProfile.id, specializationId: specialization.id },
    });
  }
  await prisma.serviceArea.deleteMany({ where: { professionalProfileId: profile.id } });
  await prisma.serviceArea.createMany({
    data: engineer.serviceAreas.map(name => ({ professionalProfileId: profile.id, name, city: engineer.baseCity })),
  });
  await prisma.portfolioItem.deleteMany({ where: { professionalProfileId: profile.id } });
  await prisma.portfolioItem.createMany({
    data: engineer.portfolio.map(item => ({ professionalProfileId: profile.id, ...item })),
  });
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await prisma.availabilitySlot.deleteMany({ where: { professionalProfileId: profile.id } });
  await prisma.availabilitySlot.createMany({
    data: [0, 1, 2].map(day => {
      const startsAt = new Date(start.getTime() + day * 24 * 60 * 60 * 1000);
      startsAt.setHours(10, 0, 0, 0);
      const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
      return { professionalProfileId: profile.id, startsAt, endsAt, isAvailable: true };
    }),
  });
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The sample engineer seed is disabled in production.');
  }
  for (const engineer of engineers) await seedEngineer(engineer);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async error => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
