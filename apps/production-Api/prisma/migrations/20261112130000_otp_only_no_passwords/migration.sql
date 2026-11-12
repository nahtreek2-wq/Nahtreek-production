-- OTP-only auth: passwords are removed from the system. The User password
-- hash column goes away entirely; sign-in and registration run through OTP
-- challenges only. Existing sessions (refresh tokens) are unaffected, so
-- signed-in users stay signed in across the deploy.

ALTER TABLE "User" DROP COLUMN IF EXISTS "passwordHash";

-- Retire in-flight pre-migration challenges: the old SIGNUP / PASSWORD_RESET
-- purposes no longer exist, and OTP_AUTH is the single purpose. Outstanding
-- codes are at most 5 minutes old; holders simply request a new code.
DELETE FROM "OtpChallenge" WHERE "purpose" IN ('SIGNUP', 'PASSWORD_RESET');
