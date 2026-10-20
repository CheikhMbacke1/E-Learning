process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-0123456789';
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/cap_test';
process.env.ADMIN_DB_URL ??= 'postgresql://postgres:postgres@localhost:5432/postgres';
process.env.WEB_ORIGIN = 'http://localhost:3000';
process.env.AUTH_THROTTLE_LIMIT = '1000';
