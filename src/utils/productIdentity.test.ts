import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalProductId,
  productLookupFilter,
  withCanonicalProductId,
} from '../../server/services/productIdentity';

test('canonicalProductId prefers the MongoDB _id over a legacy id alias', () => {
  assert.equal(canonicalProductId({ _id: '507f1f77bcf86cd799439011', id: 'legacy-id' }), '507f1f77bcf86cd799439011');
  assert.equal(canonicalProductId({ id: 'catalog-id' }), 'catalog-id');
  assert.equal(canonicalProductId({ id: '' }), null);
});

test('product lookup uses MongoDB _id only for valid ObjectIds and also supports slug/SKU', () => {
  assert.deepEqual(productLookupFilter('507f1f77bcf86cd799439011'), {
    $or: [
      { _id: '507f1f77bcf86cd799439011' },
      { slug: '507f1f77bcf86cd799439011' },
      { sku: '507f1f77bcf86cd799439011' },
    ],
  });
  assert.deepEqual(productLookupFilter('wireless-headphones'), {
    $or: [{ slug: 'wireless-headphones' }, { sku: 'wireless-headphones' }],
  });
});

test('Mongo product records sent to the client expose canonical id', () => {
  assert.equal(withCanonicalProductId({ _id: '507f1f77bcf86cd799439011' }).id, '507f1f77bcf86cd799439011');
});
