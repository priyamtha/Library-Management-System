import test from 'node:test';
import assert from 'node:assert/strict';

import handler from './netlify/functions/api.mjs';

test('register works without Netlify Blobs env configured', async () => {
  const email = `alex-${Date.now()}@example.com`;
  const event = {
    rawUrl: 'http://localhost:8888/api/auth/register',
    path: '/api/auth/register',
    httpMethod: 'POST',
    headers: {},
    body: {
      name: 'Alex Morgan',
      email,
      password: 'securepass123'
    }
  };

  const response = await handler(event);
  assert.equal(response.status, 201);

  const payload = await response.json();
  assert.equal(payload.user.email, email);
  assert.ok(payload.token);
});
