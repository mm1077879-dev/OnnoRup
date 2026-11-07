import mongoose from 'mongoose';

type ProductIdentitySource = {
  _id?: unknown;
  id?: unknown;
};

export function canonicalProductId(product: ProductIdentitySource): string | null {
  const value = product._id ?? product.id;
  if (value === undefined || value === null) return null;
  const id = String(value).trim();
  return id || null;
}

export function productLookupFilter(identifier: string): { $or: Record<string, string>[] } {
  const alternatives: Record<string, string>[] = [
    { slug: identifier },
    { sku: identifier },
  ];

  if (mongoose.isValidObjectId(identifier)) {
    alternatives.unshift({ _id: identifier });
  }

  return { $or: alternatives };
}

export function withCanonicalProductId<T extends ProductIdentitySource>(product: T): T & { id: string } {
  const id = canonicalProductId(product);
  if (!id) throw new Error('Product record is missing its canonical identifier.');
  return { ...product, id };
}
