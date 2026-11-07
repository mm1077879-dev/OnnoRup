import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { test } from 'node:test';

test('admin login validates environment credentials and returns top-level auth data', async () => {
  const previousEnvironment = {
    adminEmail: process.env.ADMIN_EMAIL,
    adminPasswordHash: process.env.ADMIN_PASSWORD_HASH,
    adminPassword: process.env.ADMIN_PASSWORD,
    jwtSecret: process.env.JWT_SECRET,
  };
  process.env.ADMIN_EMAIL = 'configured-admin@example.test';
  process.env.ADMIN_PASSWORD_HASH = 'test-only-password';
  delete process.env.ADMIN_PASSWORD;
  process.env.JWT_SECRET = 'test-only-jwt-secret';

  const { default: authRoutes } = await import('../../server/routes/authRoutes');
  const { default: reviewRoutes } = await import('../../server/routes/reviewRoutes');
  const { authMiddleware } = await import('../../server/middleware/auth');
  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api/auth', authRoutes);
  app.use('/api/reviews', reviewRoutes);
  const server = app.listen(0, '127.0.0.1');

  try {
    await once(server, 'listening');
    const address = server.address();
    assert(address && typeof address !== 'string');
    const endpoint = `http://127.0.0.1:${address.port}/api/auth/admin-login`;
    const postLogin = (body: Record<string, string>) =>
      fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

    const validResponse = await postLogin({
      email: ' CONFIGURED-ADMIN@example.test ',
      password: 'test-only-password',
    });
    const validData = await validResponse.json();
    assert.equal(validResponse.status, 200);
    assert.equal(validData.success, true);
    assert.equal(typeof validData.token, 'string');
    assert.equal(validData.user.email, 'configured-admin@example.test');
    assert.equal(validData.user.role, 'super_admin');
    assert.deepEqual(validData.user.addresses, []);
    assert.equal('data' in validData, false);

    const protectedResponse = await fetch(`http://127.0.0.1:${address.port}/api/reviews/admin/list`, {
      headers: { Authorization: `Bearer ${validData.token}` },
    });
    const protectedData = await protectedResponse.json();
    assert.equal(protectedResponse.status, 200);
    assert.equal(protectedData.success, true);

    const wrongEmailResponse = await postLogin({
      email: 'wrong@example.test',
      password: 'test-only-password',
    });
    assert.equal(wrongEmailResponse.status, 401);

    const wrongPasswordResponse = await postLogin({
      email: 'configured-admin@example.test',
      password: 'wrong-password',
    });
    assert.equal(wrongPasswordResponse.status, 401);

    const emptyCredentialsResponse = await postLogin({ email: '', password: '' });
    assert.equal(emptyCredentialsResponse.status, 400);

    delete process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_PASSWORD_HASH;
    const unconfiguredResponse = await postLogin({
      email: 'admin@novara.com',
      password: 'Admin@123',
    });
    assert.equal(unconfiguredResponse.status, 503);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });

    if (previousEnvironment.adminEmail === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = previousEnvironment.adminEmail;
    if (previousEnvironment.adminPasswordHash === undefined) delete process.env.ADMIN_PASSWORD_HASH;
    else process.env.ADMIN_PASSWORD_HASH = previousEnvironment.adminPasswordHash;
    if (previousEnvironment.adminPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousEnvironment.adminPassword;
    if (previousEnvironment.jwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousEnvironment.jwtSecret;
  }
});
