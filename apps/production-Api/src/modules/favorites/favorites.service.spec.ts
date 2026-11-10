import {FavoritesService} from './favorites.service';

function setup(rows: any[] = [], profiles: any[] = []) {
  const db: any = {
    favorite: {
      findMany: jest.fn(async () => rows),
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
  isAvailable: true, baseCity: 'Chennai', startingPrice: 299,
  engineerProfile: null});

describe('favorites list', () => {
  it('returns an empty list without querying profiles', async () => {
    const {db, service} = setup();
    await expect(service.list('u1')).resolves.toEqual([]);
    expect(db.professionalProfile.findMany).not.toHaveBeenCalled();
  });

  it('merges card fields so Saved renders without extra fetches', async () => {
    const {service} = setup(
      [{professionalId: 'p1', createdAt: new Date()}, {professionalId: 'p2', createdAt: new Date()}],
      [profile('p1'), {...profile('p2'), engineerProfile: {consultationFee: 499}}]);
    const rows = await service.list('u1');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({professionalId: 'p1', professional: {fullName: 'Pro p1'}});
    expect(rows[1].professional).toMatchObject({engineerProfile: {consultationFee: 499}});
  });

  it('marks deleted professionals null instead of dropping the row', async () => {
    const {service} = setup([{professionalId: 'gone', createdAt: new Date()}], []);
    const rows = await service.list('u1');
    expect(rows).toEqual([{professionalId: 'gone', createdAt: expect.any(Date), professional: null}]);
  });
});
