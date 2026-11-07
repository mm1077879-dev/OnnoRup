import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCategoryDetailConfiguration,
  validateCategoryAttributeValues,
} from './categoryAttributes';

const groups = [{ id: 'general', name: 'General', displayOrder: 1, isActive: true }];
const attributes = [
  {
    key: 'model',
    label: 'Model',
    type: 'text',
    required: true,
    options: [],
    groupId: 'general',
    displayOrder: 1,
  },
  {
    key: 'memory',
    label: 'Memory',
    type: 'multiselect',
    required: false,
    options: ['8 GB', '16 GB'],
    groupId: 'general',
    displayOrder: 2,
  },
  {
    key: 'wireless',
    label: 'Wireless',
    type: 'boolean',
    required: false,
    options: [],
    groupId: 'general',
    displayOrder: 3,
  },
];

test('category field configurations normalize with stable keys and valid groups', () => {
  const config = normalizeCategoryDetailConfiguration(attributes, groups);
  assert.equal(config.productDetailAttributes.length, 3);
  assert.equal(config.productDetailAttributes[0].key, 'model');
  assert.equal(config.productDetailAttributes[0].groupId, 'general');
});

test('product values validate required, select, and boolean values with type preservation', () => {
  const config = normalizeCategoryDetailConfiguration(attributes, groups);
  const values = validateCategoryAttributeValues(config.productDetailAttributes, {
    model: 'ThinkPad',
    memory: ['8 GB', '16 GB'],
    wireless: false,
  });
  assert.deepEqual(values, {
    model: 'ThinkPad',
    memory: ['8 GB', '16 GB'],
    wireless: false,
  });
});

test('product values reject missing required and unknown keys', () => {
  const config = normalizeCategoryDetailConfiguration(attributes, groups);
  assert.throws(
    () => validateCategoryAttributeValues(config.productDetailAttributes, { memory: ['8 GB'] }),
    /Model.*required/
  );
  assert.throws(
    () => validateCategoryAttributeValues(config.productDetailAttributes, { model: 'T14', injected: 'value' }),
    /Unknown category attribute/
  );
});

test('category configuration rejects duplicate keys, invalid groups, and options without choices', () => {
  assert.throws(
    () => normalizeCategoryDetailConfiguration([attributes[0], attributes[0]], groups),
    /unique lowercase key/
  );
  assert.throws(
    () => normalizeCategoryDetailConfiguration(
      [{ ...attributes[0], groupId: 'missing' }],
      groups
    ),
    /unknown specification group/
  );
  assert.throws(
    () => normalizeCategoryDetailConfiguration(
      [{ key: 'color', label: 'Color', type: 'select', options: [] }],
      []
    ),
    /at least one option/
  );
});

test('typed fields normalize numbers and validate dates, URLs, and email addresses', () => {
  const config = normalizeCategoryDetailConfiguration(
    [
      { key: 'units', label: 'Units', type: 'number', options: [] },
      { key: 'weight', label: 'Weight', type: 'decimal', options: [] },
      { key: 'release-date', label: 'Release Date', type: 'date', options: [] },
      { key: 'manual', label: 'Manual', type: 'url', options: [] },
      { key: 'support-email', label: 'Support Email', type: 'email', options: [] },
    ],
    []
  );
  assert.deepEqual(
    validateCategoryAttributeValues(config.productDetailAttributes, {
      units: '4',
      weight: '1.25',
      'release-date': '2026-02-28',
      manual: 'https://example.com/manual',
      'support-email': 'support@example.com',
    }),
    {
      units: 4,
      weight: 1.25,
      'release-date': '2026-02-28',
      manual: 'https://example.com/manual',
      'support-email': 'support@example.com',
    }
  );
  assert.throws(
    () => validateCategoryAttributeValues(config.productDetailAttributes, { units: '1.5' }),
    /whole number/
  );
  assert.throws(
    () => validateCategoryAttributeValues(config.productDetailAttributes, { 'release-date': '2026-02-31' }),
    /valid date/
  );
  assert.throws(
    () => validateCategoryAttributeValues(config.productDetailAttributes, { manual: 'javascript:alert(1)' }),
    /HTTP or HTTPS/
  );
});
