import {
  AccountStatus,
  PrismaClient,
  Role,
  VerificationStatus,
} from '@prisma/client';
import {readFile, writeFile} from 'fs/promises';
import {isAbsolute} from 'path';
import {uploadAsset} from '../src/common/storage';

// These people and credentials are fictional. They must never be promoted to
// production or represented as identity-verified professionals.
const CLIENT_NAMES = [
  'Aadhya Raman', 'Kavin Rajan', 'Meera Subramanian', 'Nila Krishnan',
  'Harish Narayanan', 'Divya Balaji', 'Pranav Iyer', 'Sanjana Murali',
  'Arjun Selvam', 'Pavithra Natarajan', 'Rithvik Anand', 'Janani Sekar',
  'Mithun Prakash', 'Keerthana Ravi', 'Vishal Kannan',
];
const ENGINEER_NAMES = [
  'Ananya Suresh', 'Adithya Menon', 'Revathi Shankar', 'Karthik Venkatesh',
  'Ishwarya Nair', 'Rohit Kumar', 'Priya Gopinath', 'Naveen Chandran',
  'Mahalakshmi Raj', 'Sathish Varadan', 'Deepa Srinivasan', 'Vikram Mohan',
  'Shalini Baskar', 'Rahul Narasimhan', 'Lakshmi Ganesh',
];
const PROVIDER_NAMES = [
  'Senthil Kumar', 'Fathima Begum', 'Manoj Perumal', 'Sangeetha Ravi',
  'Dinesh Palani', 'Kavitha Murugan', 'Aravind Gopal', 'Renuka Devi',
  'Muthu Saravanan', 'Sofia Rahman', 'Jeeva Kannan', 'Malathi Kumar',
  'Bharath Selvam', 'Nandhini Prabhu', 'Prakash Durai',
];

const LOCATIONS = [
  {city: 'Coimbatore', state: 'Tamil Nadu', latitude: 11.0168, longitude: 76.9558},
  {city: 'Krishnagiri', state: 'Tamil Nadu', latitude: 12.5266, longitude: 78.2147},
  {city: 'Chennai', state: 'Tamil Nadu', latitude: 13.0827, longitude: 80.2707},
  {city: 'Salem', state: 'Tamil Nadu', latitude: 11.6643, longitude: 78.1460},
  {city: 'Tiruchirappalli', state: 'Tamil Nadu', latitude: 10.7905, longitude: 78.7047},
  {city: 'Madurai', state: 'Tamil Nadu', latitude: 9.9252, longitude: 78.1198},
];
const SPECIALIZATIONS = [
  'Structural Design', 'Architectural 3D', 'Site Plan Approval',
  'Geotechnical', 'Renovation Audit',
];
const SERVICES = [
  ['service-plumbing', 'Plumbing'],
  ['service-electrical', 'Electrical'],
  ['service-painting', 'Painting'],
  ['service-carpentry', 'Carpentry'],
  ['service-supervision', 'Site supervision'],
  ['service-renovation', 'Renovation'],
  ['service-masonry', 'Masonry'],
  ['service-waterproofing', 'Waterproofing'],
  ['service-inspection', 'Property inspection'],
  ['service-maintenance', 'Maintenance'],
  ['service-structural', 'Structural consultation'],
  ['service-design', 'Residential design'],
] as const;

type DemoAccount = {
  role: Role;
  name: string;
  email: string;
  phoneNumber: string;
  index: number;
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function retry<T>(label: string, operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === 3) {
        throw new Error(`${label} failed after three attempts: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
      await new Promise(resolve => setTimeout(resolve, attempt * 1500));
    }
  }
  throw new Error(`${label} failed`);
}

function assertPreviewTarget() {
  if (process.env.ALLOW_PREVIEW_ACCOUNT_SEED !== 'true' || process.env.APP_ENV !== 'staging') {
    throw new Error('Preview seeding requires ALLOW_PREVIEW_ACCOUNT_SEED=true and APP_ENV=staging');
  }
  const ref = required('EXPECTED_SUPABASE_PROJECT_REF');
  const database = new URL(required('DATABASE_URL'));
  const storage = new URL(required('SUPABASE_URL'));
  if (database.username !== `postgres.${ref}` || storage.hostname !== `${ref}.supabase.co`) {
    throw new Error('Database and storage do not match the explicitly expected preview project');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Never run this seeder in a production process');
  }
}

function roster(): DemoAccount[] {
  const groups = [
    {role: Role.CLIENT, names: CLIENT_NAMES, key: 'client'},
    {role: Role.ENGINEER, names: ENGINEER_NAMES, key: 'engineer'},
    {role: Role.SERVICE_PROVIDER, names: PROVIDER_NAMES, key: 'provider'},
  ];
  return groups.flatMap(({role, names, key}, groupIndex) => names.map((name, index) => {
    const serial = groupIndex * 15 + index + 1;
    return {
      role,
      name,
      email: `${key}-${String(index + 1).padStart(2, '0')}.preview@nahtreek.example`,
      phoneNumber: `+91${String(serial).padStart(10, '0')}`,
      index,
    };
  }));
}

// OTP-only: there are no demo passwords. The output file is the account
// roster (email -> phone number); sign-in uses the preview demo OTP code.
async function credentials(): Promise<DemoAccount[]> {
  const path = required('DEMO_CREDENTIALS_OUTPUT');
  if (!isAbsolute(path)) throw new Error('DEMO_CREDENTIALS_OUTPUT must be an absolute path');
  const people = roster();
  const rosterFile: Record<string, string> = Object.fromEntries(
    people.map(person => [person.email, person.phoneNumber]));
  try {
    const existing = JSON.parse(await readFile(path, 'utf8')) as Record<string, string>;
    if (Object.keys(existing).length !== people.length ||
        people.some(person => existing[person.email] !== person.phoneNumber)) {
      throw new Error('Credential file does not match the preview roster');
    }
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
    await writeFile(path, JSON.stringify(rosterFile, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  }
  return people;
}

async function avatar(account: DemoAccount): Promise<string> {
  const storage = required('SUPABASE_URL').replace(/\/$/, '');
  const filename = `preview-${account.role.toLowerCase()}-${String(account.index + 1).padStart(2, '0')}.png`;
  const publicUrl = `${storage}/storage/v1/object/public/nahtreek-avatars/avatars/${filename}`;
  return retry(`Avatar ${account.email}`, async () => {
    const existing = await fetch(publicUrl, {signal: AbortSignal.timeout(20000)});
    if (existing.ok) return publicUrl;
    const missing = await existing.json().catch(() => ({})) as {code?: string};
    if (missing.code !== 'NoSuchKey') {
      throw new Error(`Avatar storage check failed: HTTP ${existing.status}`);
    }
    const source = `https://api.dicebear.com/10.x/notionists/png?seed=${encodeURIComponent(account.email)}&size=256`;
    const response = await fetch(source, {signal: AbortSignal.timeout(20000)});
    if (!response.ok || !response.headers.get('content-type')?.includes('image/png')) {
      throw new Error(`Avatar generation failed: HTTP ${response.status}`);
    }
    const content = Buffer.from(await response.arrayBuffer());
    if (content.length < 100 || content.length > 300_000 ||
        !content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new Error('Avatar response is not a small valid PNG');
    }
    // If storage accepted the upload but its response was lost, retrying
    // begins with the public object check instead of overwriting it.
    return uploadAsset('avatars', filename, content, 'image/png');
  });
}

async function main() {
  assertPreviewTarget();
  const accounts = await credentials();
  const prisma = new PrismaClient();
  const normPlace = (value: string) =>
    value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  try {
    const specializations = await retry('Specialization catalogue', () => prisma.specialization.findMany({
      where: {name: {in: SPECIALIZATIONS}},
    }));
    const categories = await retry('Service catalogue', () => prisma.serviceCategory.findMany({
      where: {id: {in: SERVICES.map(item => item[0])}},
    }));
    if (specializations.length !== SPECIALIZATIONS.length || categories.length !== SERVICES.length) {
      throw new Error('Preview specialization/service catalogue is incomplete');
    }
    const specializationByName = new Map(specializations.map(item => [item.name, item.id]));
    const counts = {created: 0, existing: 0, avatars: 0};
    for (const account of accounts) {
      const location = LOCATIONS[Math.floor(account.index / 5)];
      const marker = `[PREVIEW DEMO] ${account.name}`;
      const existing = await retry(`Account check ${account.email}`, () =>
        prisma.user.findUnique({where: {email: account.email}, include: {roles: true}}));
      if (existing && (existing.phoneNumber !== account.phoneNumber || existing.displayName !== marker ||
          !existing.roles.some(item => item.role === account.role))) {
        throw new Error(`Refusing to modify a non-demo account at ${account.email}`);
      }
      const avatarUrl = await avatar(account);
      counts.avatars += 1;
      if (existing) {
        if (account.role === Role.CLIENT) {
          await prisma.clientProfile.update({where: {userId: existing.id}, data: {avatarUrl}});
        } else {
          await prisma.professionalProfile.update({where: {userId: existing.id}, data: {avatarUrl}});
        }
        counts.existing += 1;
        continue;
      }
      await prisma.$transaction(async tx => {
        const user = await tx.user.create({data: {
          email: account.email,
          phoneNumber: account.phoneNumber,
          displayName: marker,
          status: AccountStatus.ACTIVE,
          isEmailVerified: true,
          isPhoneVerified: false,
          roles: {create: {role: account.role}},
        }});
        if (account.role === Role.CLIENT) {
          await tx.clientProfile.create({data: {
            userId: user.id,
            fullName: `${account.name} (Demo)`,
            avatarUrl,
            city: location.city,
            state: location.state,
            latitude: location.latitude,
            longitude: location.longitude,
            termsAcceptedAt: new Date(),
            termsVersion: 'preview-demo',
          }});
        } else {
          const engineer = account.role === Role.ENGINEER;
          const specialization = SPECIALIZATIONS[account.index % SPECIALIZATIONS.length];
          const service = SERVICES[account.index % SERVICES.length];
          const profile = await tx.professionalProfile.create({data: {
            userId: user.id,
            fullName: `${account.name} (Demo)`,
            avatarUrl,
            title: engineer ? `${specialization} Engineer` : `${service[1]} Service Provider`,
            bio: 'Fictional preview account for NAHTREEK testing. Not an identity-verified professional.',
            yearsOfExperience: 3 + (account.index % 9),
            onboardingStep: 'IDENTITY',
            // Preview-only: verified so discovery lists them. The (Demo)
            // name marker, bio and audit row keep them visibly synthetic.
            verificationStatus: VerificationStatus.VERIFIED,
            isAvailable: true,
            baseCity: location.city,
            baseState: location.state,
            baseCityNorm: normPlace(location.city),
            baseStateNorm: normPlace(location.state),
            baseLatitude: location.latitude,
            baseLongitude: location.longitude,
            serviceCategories: engineer ? [] : [service[0], SERVICES[(account.index + 5) % SERVICES.length][0]],
            startingPricePaisa: (engineer ? 1200 + (account.index % 5) * 300 : 300 + (account.index % 5) * 100) * 100,
            serviceAreas: {create: {name: location.city, city: location.city}},
          }});
          if (engineer) {
            const engineerProfile = await tx.engineerProfile.create({data: {
              professionalProfileId: profile.id,
              qualificationDegree: 'Preview demo qualification — not verified',
              institution: 'Preview demonstration only',
              graduationYear: 2014 + (account.index % 8),
              consultationFeePaisa: (1200 + (account.index % 5) * 300) * 100,
            }});
            await tx.engineerSpecialization.create({data: {
              engineerProfileId: engineerProfile.id,
              specializationId: specializationByName.get(specialization)!,
            }});
          }
          // Fresh presence so ASAP matching finds seeded providers right
          // after a seed run; real pros overwrite this from the Pro app.
          await tx.providerPresence.upsert({where: {professionalProfileId: profile.id},
            create: {professionalProfileId: profile.id, online: true,
              latitude: location.latitude, longitude: location.longitude,
              accuracy: 25, observedAt: new Date()},
            update: {online: true, latitude: location.latitude, longitude: location.longitude,
              accuracy: 25, observedAt: new Date()}});
        }
        await tx.auditLog.create({data: {
          userId: user.id,
          action: 'SYNTHETIC_PREVIEW_ACCOUNT_SEEDED',
          entity: 'User',
          entityId: user.id,
          metadata: {synthetic: true, role: account.role},
        }});
      }, {maxWait: 20_000, timeout: 30_000});
      counts.created += 1;
      console.log(`Created ${counts.created}/${accounts.length} (${account.role})`);
    }
    console.log(JSON.stringify({total: accounts.length, ...counts, credentialsPath: required('DEMO_CREDENTIALS_OUTPUT')}));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Preview seeding failed');
  process.exitCode = 1;
});
