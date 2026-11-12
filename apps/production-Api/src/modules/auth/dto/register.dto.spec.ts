import {validate} from 'class-validator';
import {RegisterDto} from './register.dto';

describe('otp-only registration', () => {
  const credentials = {phoneNumber: '+919000001234', email: 'qa@example.com', code: '123456', acceptedTerms: true};
  it('accepts signup without onboarding details', async () => {
    expect(await validate(Object.assign(new RegisterDto(), credentials))).toHaveLength(0);
  });
  it('rejects the old client payload with empty profile fields', async () => {
    const errors = await validate(Object.assign(new RegisterDto(), credentials, {fullName: '', city: '', state: '', address: '', postalCode: ''}));
    expect(errors.map(error => error.property).sort()).toEqual(['address', 'city', 'fullName', 'postalCode', 'state']);
  });
});
