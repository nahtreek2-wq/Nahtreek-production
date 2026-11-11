import {DiscoveryService} from './discovery.service';

function engineer(id: string, rating: number) {
  return {
    id,
    professionalProfileId: `pro-${id}`,
    consultationFeePaisa: 50000,
    qualificationDegree: 'BE',
    institution: 'Anna University',
    graduationYear: 2018,
    licenseNumber: null,
    specializations: [{specialization: {name: 'Plumbing'}}],
    profile: {
      fullName: `Engineer ${id}`,
      avatarUrl: null,
      coverUrl: null,
      title: 'Plumber',
      bio: null,
      yearsOfExperience: 6,
      verificationStatus: 'VERIFIED',
      averageRating: rating,
      totalReviewsCount: 12,
      isAvailable: true,
      baseCity: 'Chennai',
      baseLatitude: 13.0,
      baseLongitude: 80.2,
      memberPriority: false,
      portfolioItems: [],
      serviceAreas: [{name: 'Adyar'}],
      availabilitySlots: [],
      reviewsReceived: [],
    },
  };
}

function setup(pool: object[], total: number) {
  const prisma = {
    $transaction: jest.fn().mockResolvedValue([pool, total]),
    engineerProfile: {findMany: jest.fn(), count: jest.fn()},
  };
  return {prisma, service: new DiscoveryService(prisma as any)};
}

describe('discovery pagination (F-002)', () => {
  it('caps the ranking pool at the query for top sort', async () => {
    const {prisma, service} = setup([engineer('e1', 4.8), engineer('e2', 4.2)], 2);
    const result = await service.getEngineers({sort: 'top', page: '1', limit: '20'});
    // The rank pool is bounded at the database — never a full-table read.
    expect(prisma.engineerProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({take: 500}),
    );
    expect(result.meta).toMatchObject({page: 1, limit: 20, total: 2});
    expect(result.data).toHaveLength(2);
    // Best rank first.
    expect(result.data[0].id).toBe('e1');
  });

  it('uses skip/take at the query for sorted lists', async () => {
    const {prisma, service} = setup([engineer('e3', 4.0)], 25);
    const result = await service.getEngineers({sort: 'fee', page: '3', limit: '10'});
    expect(prisma.engineerProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({skip: 20, take: 10}),
    );
    expect(result.meta).toMatchObject({page: 3, limit: 10, total: 25, totalPages: 3});
  });
});
