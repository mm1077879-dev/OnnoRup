import test from 'node:test';
import assert from 'node:assert/strict';
import { inMemoryInteractions, mergeAnonymousSessionIntoUser, getPersonalizedRecommendations } from '../../server/models/UserInteraction';
import { inMemoryProducts } from '../../server/routes/productRoutes';

test('Anonymous browsing history merges into the authenticated profile for personalized recommendations', async () => {
  const existing = [...inMemoryProducts];
  if (!existing.length) {
    inMemoryProducts.push({
      id: 'rec-test-product',
      slug: 'rec-test-product',
      sku: 'REC-TEST-001',
      name: 'Recommendation Test Product',
      description: 'Recommendation test product for behavioral scoring.',
      category: 'Electronics',
      subcategory: 'Smartphones',
      brand: 'TestBrand',
      price: 1200,
      salePrice: 1000,
      badge: 'Best Seller',
      images: [],
      stock: 25,
      ratingAverage: 4.9,
      reviewCount: 100,
      salesCount: 500,
      isPopular: true,
      isBestSeller: true,
      isFeatured: true,
      isNewArrival: false,
      status: 'published',
      banglaKeywords: ['ফোন'],
    } as any);
  }

  const product = inMemoryProducts[0];
  const sessionId = 'session-merge-123';

  inMemoryInteractions.length = 0;
  inMemoryInteractions.push({
    id: 'anon-event-1',
    sessionId,
    eventType: 'category_view',
    category: product.category,
    createdAt: new Date(),
  });

  const result = await mergeAnonymousSessionIntoUser({ userId: 'user-123', sessionId });
  assert.equal(result.mergedCount, 1);

  const recommendations = await getPersonalizedRecommendations({ userId: 'user-123', limit: 10 });
  assert.ok(recommendations.some((item) => item.category === product.category));

  inMemoryProducts.length = 0;
  inMemoryProducts.push(...existing);
});
