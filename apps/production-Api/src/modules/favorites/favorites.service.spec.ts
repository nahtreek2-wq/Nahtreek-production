import {FavoritesService} from './favorites.service';

function setup(joined: any[] = [], profiles: any[] = []) {
  const db: any = {
    favorite: {
      findMany: jest.fn(async () => joined),
    },
    professionalProfile: {
      findMany: jest.fn(async () => profiles),
      findUnique: jest.fn(async ({where}: any) => profiles.find(p => p.id === where.id) ?? null),
    },
  };
  return {db, service: new FavoritesService(db)};
}

const profile = (id: string) => ({id, fullName: 'Pro ' + id, avatarUrl: null, title: 'Plumber',
  verificationStatus: 'VERIFIED', averageRating: 4.5, totalReviewsCount: 10,
  isAvailable: true, baseCity: 'Chennai', startingPricePaisa: 29900,
  engineerProfile: null});

describe('favorites list', () => {
  it('returns an empty list without querying profiles', async () => {
    const {db, service} = setup();
    await expect(service.list('u1')).resolves.toEqual([]);
    expect(db.professionalProfile.findMany).not.toHaveBeenCalled();
  });

  it('merges card fields so Saved renders without extra fetches', async () => {
    const {db, service} = setup(
      [{professionalId: 'p1', createdAt: new Date(), professional: profile('p1')},
        {professionalId: 'p2', createdAt: new Date(),
          professional: {...profile('p2'), engineerProfile: {consultationFeePaisa: 49900}}}]);
    const rows = await service.list('u1');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({professionalId: 'p1', professional: {fullName: 'Pro p1'}});
    expect(rows[1].professional).toMatchObject({engineerProfile: {consultationFeePaisa: 49900}});
    // One join — the manual second query is gone (F-004).
    expect(db.professionalProfile.findMany).not.toHaveBeenCalled();
    expect(db.favorite.findMany).toHaveBeenCalledWith(
      expect.objectContaining({include: expect.objectContaining({professional: expect.anything()})}));
  });
});
