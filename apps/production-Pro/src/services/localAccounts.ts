import {NativeModules} from 'react-native';
import {isApiConfigured, runtimeConfig} from '../config/runtime';
import type {ProfessionalType} from '../stores/professional';
import type {ProfessionalUser} from '../stores/session';

type StoredAccount = {
  phoneNumber: string;
  email: string;
  professionalType: ProfessionalType;
  salt: string;
  hash: string;
  createdAt: string;
};
type Accounts = Record<string, StoredAccount>;
type Bridge = {
  getLocalAccounts(): Promise<string | null>;
  setLocalAccounts(payload: string): Promise<void>;
  hashLocalPassword(password: string): Promise<{salt: string; hash: string}>;
  verifyLocalPassword(password: string, salt: string, hash: string): Promise<boolean>;
  confirmLocalPasswordReset(): Promise<boolean>;
};

function bridge(): Bridge {
  const native = NativeModules.NahtreekRuntimeConfig as Bridge | undefined;
  // Device-local password accounts exist only for unconfigured internal
  // builds. Configured builds must always use server authentication (the
  // native side enforces the same rule).
  if (isApiConfigured || runtimeConfig.environment !== 'staging' || !native?.getLocalAccounts || !native.hashLocalPassword) {
    throw new Error('Secure device accounts are unavailable in this build.');
  }
  return native;
}

function phone(raw: string) {
  const digits = raw.replace(/\D/g, '');
  if (!/^([6-9]\d{9}|91[6-9]\d{9})$/.test(digits)) {throw new Error('Enter a valid 10-digit Indian mobile number.');}
  return `+91${digits.slice(-10)}`;
}

async function load(): Promise<Accounts> {
  const raw = await bridge().getLocalAccounts();
  if (!raw) {return {};}
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {throw new Error('Local account data could not be read.');}
  return parsed as Accounts;
}

function session(account: StoredAccount) {
  const role = account.professionalType === 'CIVIL_ENGINEER' ? 'ENGINEER' : 'SERVICE_PROVIDER';
  const user: ProfessionalUser = {
    id: `offline-professional-${account.phoneNumber.replace(/\D/g, '')}-${role.toLowerCase()}`,
    fullName: '',
    phoneNumber: account.phoneNumber,
    email: account.email,
    roles: [role],
    verificationStatus: 'NOT_SUBMITTED',
    needsProfessionalProfile: true,
  };
  const token = `offline.${encodeURIComponent(account.phoneNumber)}.${role}`;
  return {accessToken: token, refreshToken: token, user};
}

let pending: Promise<unknown> = Promise.resolve();
function serial<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation, operation);
  pending = result.catch(() => undefined);
  return result;
}

export function registerLocalProfessional(input: {phoneNumber: string; email: string; password: string; professionalType: ProfessionalType}) {
  return serial(async () => {
    const phoneNumber = phone(input.phoneNumber);
    const email = input.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {throw new Error('Enter a valid email address.');}
    if (input.password.length < 8 || input.password.length > 72) {throw new Error('Use a password with 8 to 72 characters.');}
    const accounts = await load();
    if (accounts[phoneNumber] || Object.values(accounts).some(account => account.email === email)) {throw new Error('An account with this mobile number or email already exists. Please log in.');}
    const credentials = await bridge().hashLocalPassword(input.password);
    const account: StoredAccount = {phoneNumber, email, professionalType: input.professionalType, ...credentials, createdAt: new Date().toISOString()};
    accounts[phoneNumber] = account;
    await bridge().setLocalAccounts(JSON.stringify(accounts));
    return session(account);
  });
}

export function loginLocalProfessional(identifier: string, password: string) {
  return serial(async () => {
    const accounts = await load();
    const normalized = identifier.includes('@') ? identifier.trim().toLowerCase() : phone(identifier);
    const account = identifier.includes('@') ? Object.values(accounts).find(item => item.email === normalized) : accounts[normalized];
    if (!account || !(await bridge().verifyLocalPassword(password, account.salt, account.hash))) {throw new Error('Mobile/email or password is incorrect.');}
    const result = session(account);
    const profile = await readLocalProfessionalProfile(result.user.id);
    return { ...result, user: {...result.user, fullName: profile?.fullName ?? '', city: profile?.baseCity, state: profile?.baseState, avatarUrl: profile?.avatarUrl, verificationStatus: profile?.verificationStatus ?? 'NOT_SUBMITTED', needsProfessionalProfile: !profile?.fullName} };
  });
}

export function resetLocalProfessionalPassword(phoneNumber: string, password: string) {
  return serial(async () => {
    const accounts = await load();
    const normalized = phone(phoneNumber);
    const account = accounts[normalized];
    if (!account) {throw new Error('No device account was found for this mobile number.');}
    if (password.length < 8 || password.length > 72) {throw new Error('Use a password with 8 to 72 characters.');}
    if (!(await bridge().confirmLocalPasswordReset())) {throw new Error('Device confirmation is required.');}
    accounts[normalized] = {...account, ...(await bridge().hashLocalPassword(password))};
    await bridge().setLocalAccounts(JSON.stringify(accounts));
  });
}

export type LocalProfessionalProfile = {
  fullName: string;
  avatarUrl?: string;
  title: string;
  bio?: string;
  yearsOfExperience: number;
  onboardingStep: string;
  verificationStatus: string;
  isAvailable: boolean;
  serviceCategories: string[];
  startingPricePaisa?: number;
  baseCity: string;
  baseState: string;
  baseLatitude?: number;
  baseLongitude?: number;
  engineerProfile?: unknown;
  completedJobs?: number;
  rating?: number;
  reviewCount?: number;
  portfolioItems?: {id: string; title: string; description?: string; imageKey: 'engineer' | 'service'}[];
  availabilitySlots?: {id: string; startsAt: string; endsAt: string; isAvailable: boolean}[];
};

type ProfileBridge = {getLocalProfile(userId: string): Promise<string | null>; setLocalProfile(userId: string, payload: string): Promise<void>};
export async function readLocalProfessionalProfile(userId: string): Promise<LocalProfessionalProfile | null> {
  const native = NativeModules.NahtreekRuntimeConfig as ProfileBridge | undefined;
  const raw = await native?.getLocalProfile?.(userId);
  return raw ? JSON.parse(raw) as LocalProfessionalProfile : null;
}
export async function writeLocalProfessionalProfile(userId: string, profile: LocalProfessionalProfile) {
  const native = NativeModules.NahtreekRuntimeConfig as ProfileBridge | undefined;
  if (!native?.setLocalProfile) {throw new Error('Device profile storage is unavailable.');}
  await native.setLocalProfile(userId, JSON.stringify(profile));
}

const demoProfiles = {
  engineer: {
    user: {id: 'preview-engineer-arun', fullName: 'Arun Kumar', phoneNumber: '+919000000101', email: 'arun.demo@nahtreek.local', roles: ['ENGINEER'], city: 'Coimbatore', state: 'Tamil Nadu', verificationStatus: 'VERIFIED', needsProfessionalProfile: false},
    profile: {fullName: 'Arun Kumar', title: 'Civil & Structural Engineer', bio: 'I help families plan safe homes, review drawings and check construction quality in simple language.', yearsOfExperience: 9, onboardingStep: 'COMPLETE', verificationStatus: 'VERIFIED', isAvailable: true, serviceCategories: [], startingPricePaisa: 120000, baseCity: 'Coimbatore', baseState: 'Tamil Nadu', baseLatitude: 11.0168, baseLongitude: 76.9558, completedJobs: 86, rating: 4.8, reviewCount: 42, engineerProfile: {qualificationDegree: 'B.E. Civil Engineering', institution: 'Government College of Technology', graduationYear: 2016, licenseNumber: 'DEMO-CBE-101', consultationFeePaisa: 120000, specializations: [{specializationId: '11111111-1111-4111-8111-111111111111'}, {specializationId: '33333333-3333-4333-8333-333333333333'}]}, portfolioItems: [{id: 'engineer-site-1', title: 'Residential site supervision', description: 'Quality checks for a family home in Coimbatore.', imageKey: 'engineer'}], availabilitySlots: []},
  },
  service: {
    user: {id: 'preview-service-selvam', fullName: 'Selvam R', phoneNumber: '+919000000202', email: 'selvam.demo@nahtreek.local', roles: ['SERVICE_PROVIDER'], city: 'Coimbatore', state: 'Tamil Nadu', verificationStatus: 'VERIFIED', needsProfessionalProfile: false},
    profile: {fullName: 'Selvam R', title: 'Electrician & Home Service Professional', bio: 'I handle home wiring, switches, fans and electrical maintenance with clear pricing and safe work practices.', yearsOfExperience: 11, onboardingStep: 'COMPLETE', verificationStatus: 'VERIFIED', isAvailable: true, serviceCategories: ['electrical'], startingPricePaisa: 35000, baseCity: 'Coimbatore', baseState: 'Tamil Nadu', baseLatitude: 11.0168, baseLongitude: 76.9558, completedJobs: 214, rating: 4.9, reviewCount: 128, portfolioItems: [{id: 'service-home-1', title: 'Home electrical repair', description: 'Switchboard inspection and safe repair.', imageKey: 'service'}], availabilitySlots: []},
  },
} as const;

export async function openDemoProfessional(kind: keyof typeof demoProfiles) {
  const demo = demoProfiles[kind];
  await writeLocalProfessionalProfile(demo.user.id, JSON.parse(JSON.stringify(demo.profile)) as LocalProfessionalProfile);
  const token = `offline.demo.${kind}`;
  return {accessToken: token, refreshToken: token, user: {...demo.user, roles: [...demo.user.roles]}};
}
