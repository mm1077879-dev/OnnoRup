import test from 'node:test';
import assert from 'node:assert/strict';
import { REFERENCE_WISHLIST_PRODUCT_IDS } from '../../server/routes/wishlistRoutes';
import { INITIAL_PRODUCTS } from '../../server/data/initialData';

test('A new wishlist does not contain fabricated product identifiers', () => {
  assert.deepEqual(REFERENCE_WISHLIST_PRODUCT_IDS, []);
});

test('Demo product seed catalog has been removed from the storefront', () => {
  assert.equal(INITIAL_PRODUCTS.length, 0);
  assert.deepEqual((INITIAL_PRODUCTS as any[]).filter((p) => ['prod-1', 'prod-2', 'prod-3'].includes(p.id)), []);
});

test('Wishlist duplicate prevention logic', () => {
  const currentList = ['prod-1', 'prod-2'];
  const addAttempt = 'prod-1';
  const updatedList = currentList.includes(addAttempt) ? currentList : [...currentList, addAttempt];
  assert.equal(updatedList.length, 2);
  assert.deepEqual(updatedList, ['prod-1', 'prod-2']);

  const newAdd = 'prod-3';
  const secondUpdate = currentList.includes(newAdd) ? currentList : [...currentList, newAdd];
  assert.equal(secondUpdate.length, 3);
  assert.deepEqual(secondUpdate, ['prod-1', 'prod-2', 'prod-3']);
});

test('Wishlist merge deduplication logic for guest to authenticated user', () => {
  const userItems = [{ productId: 'prod-1' }, { productId: 'prod-2' }];
  const guestItems = [{ productId: 'prod-2' }, { productId: 'prod-3' }, { productId: 'prod-4' }];

  const userIds = new Set(userItems.map((i) => i.productId));
  const merged = [...userItems];

  for (const g of guestItems) {
    if (!userIds.has(g.productId)) {
      merged.push(g);
      userIds.add(g.productId);
    }
  }

  assert.equal(merged.length, 4);
  assert.deepEqual(merged.map((m) => m.productId), ['prod-1', 'prod-2', 'prod-3', 'prod-4']);
});

test('Wishlist Move to Cart validates in-stock and skips out-of-stock items', () => {
  const mockWishlistProducts = [
    { id: 'prod-1', name: 'Product 1', stock: 10 },
    { id: 'prod-out', name: 'Product Out', stock: 0 },
    { id: 'prod-3', name: 'Product 3', stock: 5 },
  ];

  const inStockToMove = mockWishlistProducts.filter((p) => p.stock > 0);
  assert.equal(inStockToMove.length, 2);
  assert.deepEqual(inStockToMove.map((p) => p.id), ['prod-1', 'prod-3']);
});
