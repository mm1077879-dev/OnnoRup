import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { test } from 'node:test';
import reviewRoutes from '../../server/routes/reviewRoutes';
import { inMemoryProducts } from '../../server/routes/productRoutes';
import { authMiddleware, generateToken } from '../../server/middleware/auth';

test('review submission validates required fields, rating, and product existence', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';

  const reviewProductId = 'admin-review-product';
  const originalProductCount = inMemoryProducts.length;
  inMemoryProducts.unshift({
    id: reviewProductId,
    name: 'Review Product',
    slug: 'review-product',
    sku: 'REVIEW-PROD-001',
    brand: 'Admin',
    category: 'Electronics',
    description: 'A valid product for review validation tests.',
    price: 2500,
    salePrice: 2000,
    images: [{ url: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&q=80', isPrimary: true }],
    stock: 12,
    reservedStock: 0,
    ratingAverage: 4.8,
    reviewCount: 0,
    salesCount: 0,
    isPopular: false,
    isBestSeller: false,
    isFeatured: false,
    isNewArrival: true,
    attributes: {},
    banglaKeywords: ['রিভিউ', 'পণ্য'],
    status: 'published',
  });

  const app = express();
  app.use(express.json());
  app.use(authMiddleware);
  app.use('/api/reviews', reviewRoutes);
  const server = app.listen(0, '127.0.0.1');

  try {
    await once(server, 'listening');
    const address = server.address();
    assert(address && typeof address !== 'string');

    const token = generateToken({
      userId: `review-test-${Date.now()}`,
      email: 'review-test@example.test',
      role: 'customer',
      name: 'Review Test',
    });
    const submit = (body: Record<string, unknown>, authenticated = true) =>
      fetch(`http://127.0.0.1:${address.port}/api/reviews`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authenticated ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });

    const unauthorized = await submit({ productId: reviewProductId, rating: 5, comment: 'Good' }, false);
    assert.equal(unauthorized.status, 401);

    const invalidRequests = [
      { rating: 5, comment: 'Good' },
      { productId: reviewProductId, comment: 'Good' },
      { productId: reviewProductId, rating: 0, comment: 'Good' },
      { productId: reviewProductId, rating: 6, comment: 'Good' },
      { productId: reviewProductId, rating: true, comment: 'Good' },
      { productId: reviewProductId, rating: 5 },
      { productId: 5, rating: 5, comment: 'Good' },
    ];
    for (const body of invalidRequests) {
      const response = await submit(body);
      assert.equal(response.status, 400);
    }

    const nonexistentProduct = await submit({
      productId: 'missing-product',
      rating: 5,
      comment: 'Good',
    });
    assert.equal(nonexistentProduct.status, 404);

    const validReview = await submit({
      productId: reviewProductId,
      rating: 5,
      comment: 'A valid review.',
    });
    const validData = await validReview.json();
    assert.equal(validReview.status, 201);
    assert.equal(validData.success, true);
    assert.equal(validData.data.productId, reviewProductId);
    assert.equal(validData.data.rating, 5);
  } finally {
    const reviewProductIndex = inMemoryProducts.findIndex((product) => product.id === 'admin-review-product');
    if (reviewProductIndex >= 0) {
      inMemoryProducts.splice(reviewProductIndex, 1);
    }
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });

    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});
