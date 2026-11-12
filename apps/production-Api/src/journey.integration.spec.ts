import {Test} from '@nestjs/testing';
import {INestApplication, ValidationPipe} from '@nestjs/common';
import {AppModule} from './app.module';
import {PrismaService} from './common/prisma/prisma.service';
import {AuthThrottleGuard} from './modules/auth/auth-throttle.guard';
import {EmailOtpService} from './modules/auth/email-otp.service';
import {JourneyService} from './modules/platform/journey.service';

// External delivery/storage have separate checks. Account, authorization, validation,
// requests, approval, messaging and history use the actual HTTP routes and PostgreSQL.
jest.mock('./common/storage', () => ({
  uploadAsset: jest.fn(async (folder, name) => `https://storage.test/${folder}/${name}`),
  signedAssetUrl: jest.fn(async value => value),
}));

const enabled = /^nahtreek_e2e_[a-f0-9]{16}$/.test(process.env.NAHTREEK_E2E_SCHEMA ?? '') &&
  new URL(process.env.DATABASE_URL ?? 'postgresql://unused').searchParams.get('schema') === process.env.NAHTREEK_E2E_SCHEMA;
(enabled ? describe : describe.skip)('full API journey with isolated PostgreSQL', () => {
  let app: INestApplication;
  let db: PrismaService;
  let base: string;
  const codes = new Map<string, string>();
  let client: any, admin: any, engineer: any, provider: any;
  let specializationId: string;
  let count = 0;
  async function request(method: string, path: string, data?: unknown, session?: any, status?: number) {
    const started = Date.now();
    const response = await fetch(base + path, {method,
      signal: AbortSignal.timeout(35_000),
      headers: {'Content-Type': 'application/json', ...(session ? {Authorization: `Bearer ${session.accessToken}`} : {})},
      ...(data ? {body: JSON.stringify(data)} : {})});
    const body = await response.json();
    if (process.env.JOURNEY_TIMINGS === 'yes') console.log(`${method} ${path}: ${response.status} in ${Date.now() - started}ms`);
    if (status !== undefined) expect({status: response.status, ...(response.status !== status ? {body} : {})}).toEqual({status});
    else if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(body)}`);
    return body;
  }
  async function register(type?: string) {
    const email = `journey${++count}@example.test`;
    const phoneNumber = '+91999999000' + count;
    await request('POST', '/auth/email-otp/request', {email});
    return request('POST', type ? '/auth/professionals/register' : '/auth/register',
      {email, phoneNumber, code: codes.get(email), acceptedTerms: true, ...(type ? {professionalType: type} : {})});
  }
  beforeAll(async () => {
    const module = await Test.createTestingModule({imports: [AppModule]})
      .overrideGuard(AuthThrottleGuard).useValue({canActivate: () => true})
      .overrideProvider(EmailOtpService).useValue({isEnabled: () => true, sendOtp: async (email: string, code: string) => {codes.set(email, code); return true;}}).compile();
    app = module.createNestApplication({logger: ['error']});
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({whitelist: true, transform: true, forbidNonWhitelisted: true}));
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()) + '/api/v1';
    db = app.get(PrismaService);
    await db.user.create({data: {email: 'admin@example.test', phoneNumber: '+919999990099', status: 'ACTIVE', isEmailVerified: true, roles: {create: {role: 'ADMIN'}}}});
    await request('POST', '/auth/email-otp/request', {email: 'admin@example.test'});
    admin = await request('POST', '/auth/otp/verify', {email: 'admin@example.test', code: codes.get('admin@example.test')});
    await db.serviceCategory.create({data: {slug: 'plumbing', title: 'Plumbing', group: 'Home Services', description: 'Test category'}});
    specializationId = (await db.specialization.create({data: {name: 'Structural Design', slug: 'structural-design'}})).id;
    client = await register();
    provider = await register('SERVICE_PROFESSIONAL');
    engineer = await register('CIVIL_ENGINEER');
  }, 180_000);
  afterAll(async () => {await app?.close();});

  it('saves notification preferences per account and validates changes', async () => {
    expect(await request('GET', '/notifications/preferences', undefined, client)).toEqual({requestUpdates: true, messages: true, offers: false});
    expect(await request('PATCH', '/notifications/preferences', {offers: true, messages: false}, client)).toEqual({requestUpdates: true, messages: false, offers: true});
    expect(await request('GET', '/notifications/preferences', undefined, provider)).toEqual({requestUpdates: true, messages: true, offers: false});
    await request('PATCH', '/notifications/preferences', {offers: 'yes'}, client, 400);
    await request('PATCH', '/notifications/preferences', {userId: provider.user.id, offers: true}, client, 400);
    await request('GET', '/notifications/preferences', undefined, undefined, 401);
  }, 30_000);

  it('persists client identity and photo, denies non-admin access and rejects unverified discovery', async () => {
    await request('PATCH', '/clients/me', {fullName: 'Journey Client', city: 'Coimbatore', state: 'Tamil Nadu', address: 'Test address, Coimbatore', postalCode: '641001'}, client);
    expect(await request('GET', '/auth/me', undefined, client)).toMatchObject({fullName: 'Journey Client'});
    const png = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0,0,0,0,0]).toString('base64');
    const photo = await request('POST', '/clients/me/photo', {mimeType: 'image/png', contentBase64: png}, client);
    expect((await request('GET', '/clients/me', undefined, client)).avatarUrl).toBe(photo.avatarUrl);
    await request('GET', '/admin/verifications', undefined, client, 403);
    expect((await request('GET', '/discovery/providers?city=Coimbatore')).data).toHaveLength(0);
  }, 30_000);

  it.each(['service-provider', 'engineer'])('completes %s verification → exact booking → chat → completion and history', async kind => {
    const professional = kind === 'engineer' ? engineer : provider;
    const other = kind === 'engineer' ? provider : engineer;
    const setup = await request('PUT', '/professionals/me', {kind, fullName: `Journey ${kind}`, title: 'Home specialist',
      baseCity: 'Coimbatore', baseState: 'Tamil Nadu', baseLatitude: 11.01, baseLongitude: 76.95, yearsOfExperience: 5,
      ...(kind === 'engineer' ? {specializationIds: [specializationId], qualificationDegree: 'BE', institution: 'Test college', graduationYear: 2015} : {serviceCategories: ['plumbing']})}, professional);
    const profile = await db.professionalProfile.findUniqueOrThrow({where: {userId: professional.user.id}, include: {engineerProfile: true}});
    expect(setup.isAvailable).toBe(false);
    await request('PATCH', '/professionals/me/work-status', {isAvailable: true}, professional, 400);
    if (kind === 'service-provider') {
      await request('POST', '/service-workflow/presence', {
        online: true, latitude: 11.01, longitude: 76.95, accuracy: 15, observedAt: new Date().toISOString(),
      }, professional, 400);
    }
    const required = ['identity-proof', 'address-proof', kind === 'engineer' ? 'qualification' : 'work-sample'];
    const workPhoto = await request('POST', '/professionals/me/portfolio', {
      title: 'Completed kitchen work', mimeType: 'image/png',
      contentBase64: Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0,0,0,0,0]).toString('base64'),
    }, professional);
    expect((await request('GET', '/professionals/me', undefined, professional)).profile.portfolioItems[0].imageUrl).toBe(workPhoto.imageUrl);
    await request('DELETE', `/professionals/me/portfolio/${workPhoto.id}`, undefined, other, 404);
    await request('POST', '/professionals/me/portfolio', {title: 'Invalid photo', mimeType: 'image/png', contentBase64: Buffer.from('this is not an image').toString('base64')}, professional, 400);
    await request('DELETE', `/professionals/me/portfolio/${workPhoto.id}`, undefined, professional);
    const documents = [];
    for (const documentType of required) documents.push(await request('POST', '/professionals/me/verification-documents', {
      documentType, mimeType: 'application/pdf', contentBase64: Buffer.from('%PDF-1.4\nSynthetic integration fixture only.').toString('base64')}, professional));
    await request('POST', '/professionals/me/verification/submit', {}, professional);
    const queue = await request('GET', '/admin/verifications?status=UNDER_REVIEW', undefined, admin);
    expect(queue.data.some((row: any) => row.id === profile.id)).toBe(true);
    await request('PATCH', `/admin/verifications/${profile.id}`, {status: 'VERIFIED'}, admin, 400);
    for (const document of documents) await request('PATCH', `/admin/verifications/${profile.id}/documents/${document.id}`, {status: 'APPROVED'}, admin);
    await request('PATCH', `/admin/verifications/${profile.id}`, {status: 'VERIFIED'}, admin);
    await request('PATCH', '/professionals/me/work-status', {isAvailable: true}, professional);
    const discovery = await request('GET', `/discovery/${kind === 'engineer' ? 'engineers' : 'providers'}?city=Coimbatore`);
    expect(discovery.data).toHaveLength(1);
    const route = kind === 'engineer' ? '/engineer-requests' : '/service-requests';
    const booking = await request('POST', route, {locationAddress: 'Test street, Coimbatore', latitude: 11.013, longitude: 76.951,
      ...(kind === 'engineer' ? {engineerProfileId: profile.engineerProfile!.id, projectTitle: 'Inspection', projectDescription: 'Inspect the residential building', propertyType: 'Residential'} :
        {professionalProfileId: profile.id, serviceId: 'plumbing', description: 'Repair a leaking kitchen tap'})}, client);
    expect((await request('GET', route, undefined, professional)).data.some((row: any) => row.id === booking.id)).toBe(true);
    await request('GET', `${route}/${booking.id}`, undefined, other, kind === 'engineer' ? 403 : 404);
    if (kind !== 'engineer') await request('PATCH', `${route}/${booking.id}/status`, {status: 'ACCEPTED'}, client, 400);
    await request('PATCH', `${route}/${booking.id}/status`, {status: 'ACCEPTED'}, professional);
    const conversation = await request('POST', '/conversations', {[kind === 'engineer' ? 'engineerRequestId' : 'serviceRequestId']: booking.id}, client);
    await request('POST', `/conversations/${conversation.id}/messages`, {content: 'Please arrive tomorrow morning.'}, client);
    expect((await request('GET', `/conversations/${conversation.id}/messages`, undefined, professional))[0].content).toBe('Please arrive tomorrow morning.');
    await request('GET', `/conversations/${conversation.id}/messages`, undefined, other, 404);
    await request('PATCH', `${route}/${booking.id}/status`, {status: 'IN_PROGRESS'}, professional);
    await request('PATCH', `${route}/${booking.id}/status`, {status: 'COMPLETED'}, professional);
    expect((await request('GET', `${route}/${booking.id}`, undefined, client)).status).toBe('COMPLETED');
    expect((await request('GET', '/history/me', undefined, professional)).data.length).toBeGreaterThan(0);
    expect((await request('GET', '/notifications', undefined, professional)).data.length).toBeGreaterThan(0);
    await request('PATCH', `/admin/verifications/${profile.id}/documents/${documents[0].id}`, {status: 'REJECTED', reason: 'Test revocation'}, admin);
    expect((await request('GET', `/discovery/${kind === 'engineer' ? 'engineers' : 'providers'}?city=Coimbatore`)).data).toHaveLength(0);
  }, 180_000);

  it('persists an AI plan and prevents another account reading it', async () => {
    const conversation = await request('POST', '/ai/conversations', {projectType: 'REPAIR', city: 'Coimbatore'}, client);
    await request('POST', `/ai/conversations/${conversation.id}/messages`, {content: 'The kitchen tap is leaking.'}, client);
    const plan = await request('POST', `/ai/conversations/${conversation.id}/plans`, {details: 'Repair the tap'}, client);
    expect(plan.stages.length).toBeGreaterThan(0);
    await request('GET', `/ai/conversations/${conversation.id}`, undefined, provider, 403);
  }, 30_000);

  it('enforces the live service workflow, retry safety, recipient details and client completion', async () => {
    const profile = await db.professionalProfile.update({where:{userId:provider.user.id},data:{verificationStatus:'VERIFIED',isAvailable:true,baseLatitude:11.01,baseLongitude:76.95}});
    const route = jest.spyOn(app.get(JourneyService) as any,'route').mockResolvedValue(5);
    try {
      await request('POST','/service-workflow/presence',{online:true,latitude:11.01,longitude:76.95,accuracy:15,observedAt:new Date().toISOString()},provider);
      const payload={professionalProfileId:profile.id,serviceId:'plumbing',mode:'ASAP',latitude:11.01,longitude:76.95,description:'Repair the leaking kitchen tap',locationAddress:'12, Family house, Coimbatore',recipientName:'Family member',recipientPhone:'+919999990055',recipientConsent:true,idempotencyKey:'b7798d52-02ef-41ee-8b89-45e0a38fbcb1'};
      const booked=await request('POST','/service-workflow/book',payload,client);
      expect((await request('POST','/service-workflow/book',payload,client)).id).toBe(booked.id);
      await request('POST','/service-workflow/book',{...payload,description:'Changed request body'},client,409);
      await request('GET',`/service-workflow/${booked.id}`,undefined,engineer,404);
      await request('PATCH',`/service-requests/${booked.id}/status`,{status:'ACCEPTED'},provider,400);
      let j=await request('GET',`/service-workflow/${booked.id}`,undefined,client);
      expect(j.recipientName).toBe('Family member');
      await request('POST',`/service-workflow/${booked.id}/actions`,{action:'ACCEPT',revision:j.revision},client,400);
      async function act(action:string, who:any, extra:any={}) {
        j=await request('POST',`/service-workflow/${booked.id}/actions`,{action,revision:j.revision,...extra},who);return j;
      }
      await act('ACCEPT',provider);
      await request('POST',`/service-workflow/${booked.id}/actions`,{action:'DEPART',revision:1},provider,409);
      await act('DEPART',provider);
      expect((await request('GET',`/service-workflow/${booked.id}`,undefined,client)).tracking.stale).toBe(false);
      await act('ARRIVE',provider);
      expect(j.startCode).toBeUndefined();
      const customer=await request('GET',`/service-workflow/${booked.id}`,undefined,client);
      expect(customer.startCode).toMatch(/^[0-9]{6}$/);
      expect(customer.tracking).toBeNull();
      await act('QUOTE',provider,{amount:250,note:'Repair tap, labour and washer included'});
      await act('APPROVE_QUOTE',client);
      await act('START',provider,{code:customer.startCode});
      await act('FINISH',provider,{note:'Replaced washer and checked for leaks'});
      expect((await request('GET',`/service-requests/${booked.id}`,undefined,client)).status).toBe('IN_PROGRESS');
      await act('CONFIRM',client);
      expect(j.stage).toBe('COMPLETED');
      expect((await request('GET',`/service-requests/${booked.id}`,undefined,client)).status).toBe('COMPLETED');
    } finally {route.mockRestore();}
  },180_000);
});
