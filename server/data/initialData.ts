export interface SeedProduct {
  id: string;
  name: string;
  slug: string;
  sku: string;
  brand: string;
  category: string;
  subcategory?: string;
  description: string;
  shortDescription?: string;
  price: number;
  salePrice?: number;
  badge?: string;
  images: { url: string; alt?: string; isPrimary?: boolean }[];
  stock: number;
  reservedStock: number;
  lowStockThreshold?: number;
  ratingAverage: number;
  reviewCount: number;
  salesCount: number;
  isPopular: boolean;
  isBestSeller: boolean;
  isFeatured: boolean;
  isNewArrival: boolean;
  attributes: Record<string, string>;
  dynamicAttributes?: Record<string, Record<string, unknown>>;
  productHighlights?: string[];
  banglaKeywords: string[];
  status: 'published';
  warranty?: string;
  variants?: {
    id: string;
    sku: string;
    name: string;
    options: Record<string, string>;
    price: number;
    salePrice?: number;
    stock: number;
    isAvailable: boolean;
  }[];
}

export const INITIAL_CATEGORIES = [
  { id: 'cat-1', name: 'Electronics', slug: 'electronics', icon: 'Smartphone', displayOrder: 1, isActive: true },
  { id: 'cat-2', name: 'Fashion', slug: 'fashion', icon: 'Shirt', displayOrder: 2, isActive: true },
  { id: 'cat-3', name: 'Home & Living', slug: 'home-living', icon: 'Home', displayOrder: 3, isActive: true },
  { id: 'cat-4', name: 'Beauty & Personal Care', slug: 'beauty-personal-care', icon: 'Sparkles', displayOrder: 4, isActive: true },
  { id: 'cat-5', name: 'Sports & Outdoors', slug: 'sports-outdoors', icon: 'Dumbbell', displayOrder: 5, isActive: true },
  { id: 'cat-6', name: 'Toys & Games', slug: 'toys-games', icon: 'Gamepad2', displayOrder: 6, isActive: true },
];

// Development fallback catalog used when no admin-created catalog has been persisted yet.
// The demo catalog is intentionally blank to avoid fabricated storefront products.
export const DEMO_PRODUCT_IDS = new Set<string>();
export const SEED_PRODUCT_IDS: string[] = [];
export const INITIAL_COUPONS: Array<{ code: string; discountType: 'percentage' | 'fixed'; discountValue: number; minOrderAmount: number; maxDiscount?: number; validFrom: string; validTo: string; isActive: boolean; }> = [];
export const INITIAL_TESTIMONIALS: Array<{ id: string; customerName: string; rating: number; comment: string; productName?: string; isFeatured?: boolean; createdAt?: string; }> = [];

export const INITIAL_PRODUCTS: SeedProduct[] = [];
