export const CATEGORY_ATTRIBUTE_TYPES = [
  'text',
  'textarea',
  'number',
  'decimal',
  'boolean',
  'select',
  'multiselect',
  'color',
  'date',
  'url',
  'email',
] as const;

export type CategoryAttributeType = (typeof CATEGORY_ATTRIBUTE_TYPES)[number];

export interface CategoryAttributeDefinition {
  key: string;
  label: string;
  type: CategoryAttributeType;
  placeholder?: string;
  helpText?: string;
  required: boolean;
  defaultValue?: unknown;
  options: string[];
  groupId?: string;
  displayOrder: number;
  isActive: boolean;
  showOnDetails: boolean;
  showInSpecifications: boolean;
  filterable: boolean;
  searchable: boolean;
}

export interface CategoryAttributeGroup {
  id: string;
  name: string;
  displayOrder: number;
  isActive: boolean;
}

export interface CategoryDetailConfiguration {
  productDetailAttributes: CategoryAttributeDefinition[];
  productDetailGroups: CategoryAttributeGroup[];
}

const ATTRIBUTE_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const GROUP_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

export function normalizeCategoryDetailConfiguration(
  attributes: unknown,
  groups: unknown
): CategoryDetailConfiguration {
  if (!Array.isArray(attributes) || attributes.length > 100) {
    throw new Error('Category attributes must be an array with no more than 100 fields.');
  }
  if (!Array.isArray(groups) || groups.length > 50) {
    throw new Error('Specification groups must be an array with no more than 50 groups.');
  }

  const normalizedGroups: CategoryAttributeGroup[] = [];
  const groupIds = new Set<string>();
  for (const rawGroup of groups) {
    if (!isRecord(rawGroup)) throw new Error('Each specification group must be an object.');
    const id = typeof rawGroup.id === 'string' ? rawGroup.id.trim() : '';
    const name = typeof rawGroup.name === 'string' ? rawGroup.name.trim() : '';
    const displayOrder = Number(rawGroup.displayOrder ?? 0);
    if (!GROUP_ID_PATTERN.test(id) || !name || name.length > 80 || groupIds.has(id)) {
      throw new Error('Each group needs a unique valid ID and a name of at most 80 characters.');
    }
    if (!Number.isFinite(displayOrder) || displayOrder < 0 || displayOrder > 10000) {
      throw new Error(`Group "${name}" has an invalid display order.`);
    }
    groupIds.add(id);
    normalizedGroups.push({
      id,
      name,
      displayOrder,
      isActive: rawGroup.isActive !== false,
    });
  }

  const normalizedAttributes: CategoryAttributeDefinition[] = [];
  const keys = new Set<string>();
  for (const rawAttribute of attributes) {
    if (!isRecord(rawAttribute)) throw new Error('Each category attribute must be an object.');
    const key = typeof rawAttribute.key === 'string' ? rawAttribute.key.trim() : '';
    const label = typeof rawAttribute.label === 'string' ? rawAttribute.label.trim() : '';
    const type = rawAttribute.type;
    const displayOrder = Number(rawAttribute.displayOrder ?? 0);
    const options = rawAttribute.options === undefined ? [] : rawAttribute.options;
    const groupId = typeof rawAttribute.groupId === 'string' && rawAttribute.groupId.trim()
      ? rawAttribute.groupId.trim()
      : undefined;

    if (!ATTRIBUTE_KEY_PATTERN.test(key) || keys.has(key) || !label || label.length > 100) {
      throw new Error('Each attribute needs a unique lowercase key and a label of at most 100 characters.');
    }
    if (!CATEGORY_ATTRIBUTE_TYPES.includes(type as CategoryAttributeType)) {
      throw new Error(`Attribute "${label}" has an unsupported field type.`);
    }
    if (!Number.isFinite(displayOrder) || displayOrder < 0 || displayOrder > 10000) {
      throw new Error(`Attribute "${label}" has an invalid display order.`);
    }
    if (!Array.isArray(options) || options.length > 100 || options.some(
      (option) => typeof option !== 'string' || !option.trim() || option.length > 100
    )) {
      throw new Error(`Attribute "${label}" has invalid select options.`);
    }
    if (new Set(options.map((option: string) => option.trim())).size !== options.length) {
      throw new Error(`Attribute "${label}" contains duplicate select options.`);
    }
    if ((type === 'select' || type === 'multiselect') && options.length === 0) {
      throw new Error(`Attribute "${label}" needs at least one option.`);
    }
    if (groupId && !groupIds.has(groupId)) {
      throw new Error(`Attribute "${label}" references an unknown specification group.`);
    }
    for (const property of ['placeholder', 'helpText'] as const) {
      const propertyValue = rawAttribute[property];
      if (propertyValue !== undefined && (typeof propertyValue !== 'string' || propertyValue.length > 500)) {
        throw new Error(`Attribute "${label}" has invalid ${property}.`);
      }
    }

    keys.add(key);
    const normalizedAttribute: CategoryAttributeDefinition = {
      key,
      label,
      type: type as CategoryAttributeType,
      ...(typeof rawAttribute.placeholder === 'string' && rawAttribute.placeholder.trim()
        ? { placeholder: rawAttribute.placeholder.trim() }
        : {}),
      ...(typeof rawAttribute.helpText === 'string' && rawAttribute.helpText.trim()
        ? { helpText: rawAttribute.helpText.trim() }
        : {}),
      required: rawAttribute.required === true,
      ...(rawAttribute.defaultValue !== undefined ? { defaultValue: rawAttribute.defaultValue } : {}),
      options: options.map((option: string) => option.trim()),
      ...(groupId ? { groupId } : {}),
      displayOrder,
      isActive: rawAttribute.isActive !== false,
      showOnDetails: rawAttribute.showOnDetails !== false,
      showInSpecifications: rawAttribute.showInSpecifications !== false,
      filterable: rawAttribute.filterable === true,
      searchable: rawAttribute.searchable === true,
    };
    if (rawAttribute.defaultValue !== undefined && !isEmpty(rawAttribute.defaultValue)) {
      normalizedAttribute.defaultValue = normalizeValue(normalizedAttribute, rawAttribute.defaultValue);
    }
    normalizedAttributes.push(normalizedAttribute);
  }

  return {
    productDetailAttributes: normalizedAttributes,
    productDetailGroups: normalizedGroups,
  };
}

function normalizeValue(
  attribute: CategoryAttributeDefinition,
  value: unknown
): unknown {
  switch (attribute.type) {
    case 'text':
    case 'textarea':
    case 'color':
    case 'date':
    case 'url':
    case 'email': {
      if (typeof value !== 'string' || value.length > 5000) {
        throw new Error(`"${attribute.label}" must be text with at most 5000 characters.`);
      }
      if (attribute.type === 'color' && !/^#[0-9a-f]{3,8}$/i.test(value)) {
        throw new Error(`"${attribute.label}" must be a valid hex color.`);
      }
      if (attribute.type === 'date') {
        const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        const date = parts
          ? new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])))
          : null;
        if (
          !parts ||
          !date ||
          date.getUTCFullYear() !== Number(parts[1]) ||
          date.getUTCMonth() !== Number(parts[2]) - 1 ||
          date.getUTCDate() !== Number(parts[3])
        ) {
          throw new Error(`"${attribute.label}" must be a valid date.`);
        }
      }
      if (attribute.type === 'url') {
        try {
          const url = new URL(value);
          if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
        } catch {
          throw new Error(`"${attribute.label}" must be a valid HTTP or HTTPS URL.`);
        }
      }
      if (attribute.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        throw new Error(`"${attribute.label}" must be a valid email address.`);
      }
      return value;
    }
    case 'number':
    case 'decimal': {
      const numericValue = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(numericValue)) throw new Error(`"${attribute.label}" must be a valid number.`);
      if (attribute.type === 'number' && !Number.isInteger(numericValue)) {
        throw new Error(`"${attribute.label}" must be a whole number.`);
      }
      return numericValue;
    }
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (value === 'true') return true;
      if (value === 'false') return false;
      throw new Error(`"${attribute.label}" must be yes or no.`);
    case 'select':
      if (typeof value !== 'string' || !attribute.options.includes(value)) {
        throw new Error(`"${attribute.label}" must match one of the configured options.`);
      }
      return value;
    case 'multiselect':
      if (
        !Array.isArray(value) ||
        value.length > attribute.options.length ||
        value.some((option) => typeof option !== 'string' || !attribute.options.includes(option)) ||
        new Set(value).size !== value.length
      ) {
        throw new Error(`"${attribute.label}" contains an invalid selection.`);
      }
      return value;
  }
}

export function validateCategoryAttributeValues(
  attributes: CategoryAttributeDefinition[],
  values: unknown
): Record<string, unknown> {
  if (!isRecord(values) || Object.keys(values).length > 100 || JSON.stringify(values).length > 50000) {
    throw new Error('Product category attributes must be an object smaller than 50 KB.');
  }

  const activeAttributes = attributes.filter((attribute) => attribute.isActive);
  const allowedKeys = new Set(activeAttributes.map((attribute) => attribute.key));
  const unknownKeys = Object.keys(values).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length) throw new Error(`Unknown category attribute: ${unknownKeys[0]}.`);

  const normalized: Record<string, unknown> = {};
  for (const attribute of activeAttributes) {
    const value = values[attribute.key];
    if (isEmpty(value) || (Array.isArray(value) && value.length === 0)) {
      if (attribute.required) throw new Error(`"${attribute.label}" is required.`);
      continue;
    }
    normalized[attribute.key] = normalizeValue(attribute, value);
  }
  return normalized;
}
