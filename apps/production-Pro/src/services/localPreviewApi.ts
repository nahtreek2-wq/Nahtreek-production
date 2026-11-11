import {useSessionStore} from '../stores/session';
import {readLocalProfessionalProfile, writeLocalProfessionalProfile, type LocalProfessionalProfile} from './localAccounts';

const SERVICES = [
  {id: 'plumbing', slug: 'plumbing', title: 'Plumbing', group: 'Home Services', description: 'Water supply, fittings and drainage work.'},
  {id: 'electrical', slug: 'electrical', title: 'Electrical', group: 'Home Services', description: 'Wiring, fixtures and electrical maintenance.'},
  {id: 'painting', slug: 'painting', title: 'Painting', group: 'Home Services', description: 'Interior and exterior painting work.'},
  {id: 'carpentry', slug: 'carpentry', title: 'Carpentry', group: 'Home Services', description: 'Furniture, doors and woodwork.'},
];
const SPECIALIZATIONS = [
  {id: '11111111-1111-4111-8111-111111111111', name: 'Structural Engineering'},
  {id: '22222222-2222-4222-8222-222222222222', name: 'Residential Design'},
  {id: '33333333-3333-4333-8333-333333333333', name: 'Site Supervision'},
];

function user() {
  const value = useSessionStore.getState().user;
  if (!value) {throw new Error('Please log in again.');}
  return value;
}
function blankProfile(): LocalProfessionalProfile {
  return {fullName: '', title: '', yearsOfExperience: 0, onboardingStep: 'IDENTITY', verificationStatus: 'NOT_SUBMITTED', isAvailable: false, serviceCategories: [], baseCity: '', baseState: '', availabilitySlots: []};
}
async function profile() {return (await readLocalProfessionalProfile(user().id)) ?? blankProfile();}
function body(init: RequestInit) {return init.body ? JSON.parse(String(init.body)) as Record<string, any> : {};}
const page = <T>(data: T[]) => ({data, meta: {page: 1, limit: 50, total: data.length, totalPages: data.length ? 1 : 0}});

export async function localPreviewRequest<T>(path: string, init: RequestInit): Promise<T> {
  const method = init.method ?? 'GET';
  if (path === '/auth/logout') {return {ok: true} as T;}
  if (path === '/discovery/services') {return SERVICES as T;}
  if (path === '/discovery/specializations') {return SPECIALIZATIONS as T;}
  if (path === '/professionals/me' && method === 'GET') {
    const value = await profile();
    return {professionalType: user().roles.includes('ENGINEER') ? 'CIVIL_ENGINEER' : 'SERVICE_PROFESSIONAL', profile: value.fullName ? value : null, onboarding: {currentStep: value.onboardingStep, identityCompleted: Boolean(value.fullName && value.baseCity && value.baseState), canSubmitVerification: Boolean(value.title && value.baseLatitude != null)}} as T;
  }
  if (path === '/professionals/me/identity' && method === 'PATCH') {
    const input = body(init); const value = {...await profile(), fullName: input.fullName, baseCity: input.baseCity, baseState: input.baseState, onboardingStep: 'CAPABILITIES'};
    await writeLocalProfessionalProfile(user().id, value); return value as T;
  }
  if (path === '/professionals/me' && method === 'PUT') {
    const input = body(init); const current = await profile();
    const value = {...current, fullName: input.fullName, title: input.title, bio: input.bio, yearsOfExperience: input.yearsOfExperience, baseCity: input.baseCity, baseState: input.baseState, baseLatitude: input.baseLatitude, baseLongitude: input.baseLongitude, serviceCategories: input.serviceCategories ?? [], startingPricePaisa: input.startingPricePaisa, isAvailable: false, onboardingStep: 'PREVIEW_COMPLETE', verificationStatus: 'NOT_SUBMITTED', ...(input.kind === 'engineer' ? {engineerProfile: {qualificationDegree: input.qualificationDegree, institution: input.institution, graduationYear: input.graduationYear, licenseNumber: input.licenseNumber, consultationFeePaisa: input.consultationFeePaisa, specializations: (input.specializationIds ?? []).map((specializationId: string) => ({specializationId}))}} : {})};
    await writeLocalProfessionalProfile(user().id, value); return value as T;
  }
  if (path === '/professionals/me/availability' && method === 'GET') {const value = await profile(); return {isAvailable: value.isAvailable, slots: value.availabilitySlots ?? []} as T;}
  if (path === '/professionals/me/availability' && method === 'POST') {const input = body(init); const value = await profile(); const slot = {id: `local-slot-${Date.now()}`, startsAt: input.startsAt, endsAt: input.endsAt, isAvailable: true}; value.availabilitySlots = [...(value.availabilitySlots ?? []), slot]; await writeLocalProfessionalProfile(user().id, value); return slot as T;}
  if (path.startsWith('/professionals/me/availability/') && method === 'DELETE') {const value = await profile(); const id = decodeURIComponent(path.split('/').pop() ?? ''); value.availabilitySlots = (value.availabilitySlots ?? []).filter(slot => slot.id !== id); await writeLocalProfessionalProfile(user().id, value); return {ok: true} as T;}
  if (path === '/professionals/me/work-status' && method === 'PATCH') {const value = await profile(); const isAvailable = Boolean(body(init).isAvailable); if (isAvailable && value.verificationStatus !== 'VERIFIED') {throw new Error('Your profile must be approved before you can become available for work.');} value.isAvailable = isAvailable; await writeLocalProfessionalProfile(user().id, value); return {isAvailable: value.isAvailable} as T;}
  const collectionRoots = ['/engineer-requests', '/service-requests', '/conversations', '/notifications', '/history/me'];
  const collectionPath = path.split('?')[0];
  if (collectionRoots.some(root => path === root || path.startsWith(`${root}?`) || path.startsWith(`${root}/`))) {
    const isCollection = collectionRoots.includes(collectionPath) || /^\/conversations\/[^/]+\/messages$/.test(collectionPath);
    if (method === 'GET' && isCollection) {return page([]) as T;}
    if (method === 'GET') {throw new Error('This screen needs the connected NAHTREEK service. Preview mode has no saved job or conversation details.');}
    throw new Error('This action needs the connected NAHTREEK service. Preview mode does not save job, chat or notification changes.');
  }
  throw new Error('This feature needs the connected NAHTREEK service.');
}
