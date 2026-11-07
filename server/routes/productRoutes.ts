import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { CategoryModel } from '../models/Category';
import { IProductImage, ProductModel } from '../models/Product';
import { AuditLogModel } from '../models/Coupon';
import { INITIAL_PRODUCTS, SeedProduct, DEMO_PRODUCT_IDS } from '../data/initialData';
import {
  expandSearchQuery,
  escapeRegex,
  scoreSearchMatch,
  normalizeMultilingualQuery,
  parseConversationalSearchQuery,
} from '../../src/utils/ecommerceRules';
import {
  CategoryAttributeDefinition,
  normalizeCategoryDetailConfiguration,
  validateCategoryAttributeValues,
} from '../../src/utils/categoryAttributes';
import { isDbConnected, requireProductionDb } from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
import { productLookupFilter, withCanonicalProductId } from '../services/productIdentity';

const router = Router();

// Admin-managed products are the only catalog source; the legacy demo seed list is intentionally excluded.
let inMemoryProducts: SeedProduct[] = JSON.parse(
  JSON.stringify(INITIAL_PRODUCTS.filter((product) => !DEMO_PRODUCT_IDS.has(product.id)))
);

// Standard lean projection for catalog listings to prevent fetching large blobs for millions of rows
const CATALOG_PROJECTION = 'name slug sku brand category subcategory price salePrice badge images stock ratingAverage reviewCount salesCount isPopular isBestSeller isFeatured isNewArrival status banglaKeywords createdAt';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function findCategoryDefinition(categoryName: string) {
  return CategoryModel.findOne({
    $or: [{ name: categoryName }, { slug: categoryName }, { aliases: categoryName }],
  });
}

function getCategoryAttributes(category: { productDetailAttributes?: unknown; productDetailGroups?: unknown }) {
  return normalizeCategoryDetailConfiguration(
    category.productDetailAttributes ?? [],
    category.productDetailGroups ?? []
  ).productDetailAttributes as CategoryAttributeDefinition[];
}

function normalizeProductImages(value: unknown): IProductImage[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('Product images must be an array.');

  const seen = new Set<string>();
  const images: IProductImage[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('Each product image must include a valid image reference.');
    }

    const image = entry as Record<string, unknown>;
    const url = typeof image.url === 'string' ? image.url.trim() : '';
    if (!url || /^(data|blob):/i.test(url)) {
      throw new Error('Product images must use permanent uploaded image references.');
    }
    if (seen.has(url)) continue;
    seen.add(url);

    images.push({
      url,
      ...(typeof image.publicId === 'string' ? { publicId: image.publicId } : {}),
      ...(typeof image.alt === 'string' ? { alt: image.alt } : {}),
      isPrimary: image.isPrimary === true,
    });
  }

  return images;
}

function normalizeCategoryText(value: string | undefined) {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[-_]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCategoryCandidate(value: string) {
  const normalized = normalizeCategoryText(value);
  if (!normalized) return [];

  const variants = new Set<string>([
    normalized,
    normalized.replace(/\s+and\s+/g, ' '),
    normalized.replace(/\s+/g, '-'),
  ]);

  return [...variants].filter(Boolean);
}

function normalizeProductHighlights(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return [];
  if (!Array.isArray(value)) {
    throw new Error('Product highlights must be an array of strings.');
  }

  const normalized = value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : String(entry ?? '').trim()))
    .filter((entry) => entry.length > 0)
    .filter((entry, index, collection) => collection.indexOf(entry) === index);

  return normalized;
}

function matchesCategoryValue(value: string | undefined, categoryValue: string) {
  const candidateNames = normalizeCategoryCandidate(categoryValue);
  if (!candidateNames.length) return false;

  const baseline = normalizeCategoryText(value);
  return candidateNames.some((candidate) => {
    const asSlug = candidate.replace(/\s+/g, '-');
    return baseline === candidate || baseline === asSlug || baseline === candidate.replace(/\s+and\s+/g, ' ');
  });
}

// List products with filtering, sorting, cursor or offset pagination, and lean projection
router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      category,
      brand,
      minPrice,
      maxPrice,
      sort,
      isPopular,
      isBestSeller,
      isFeatured,
      isNewArrival,
      status,
      includeAll,
      includeDetails,
      page = '1',
      limit = '12',
      cursor,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 12));

    if (isDbConnected()) {
      const filter: any = {};
      if (status && status !== 'all') {
        filter.status = status;
      } else if (includeAll !== 'true') {
        filter.status = 'published';
      }

      if (category && category !== 'all') {
        const rawCategory = String(category).trim();
        const categoryCandidates = new Set<string>();
        categoryCandidates.add(rawCategory);
        categoryCandidates.add(rawCategory.replace(/[-_]+/g, ' '));
        categoryCandidates.add(rawCategory.replace(/\s+/g, '-'));

        if (isDbConnected()) {
          const dbCategory = await CategoryModel.findOne({
            $or: [
              { slug: rawCategory },
              { slug: rawCategory.replace(/\s+/g, '-') },
              { name: rawCategory },
              { name: rawCategory.replace(/[-_]+/g, ' ') },
              { aliases: rawCategory },
              { aliases: rawCategory.replace(/[-_]+/g, ' ') },
            ],
          }).select('name slug').lean();

          if (dbCategory) {
            categoryCandidates.add(dbCategory.name);
            categoryCandidates.add(dbCategory.slug);
            categoryCandidates.add(dbCategory.name.replace(/\s+/g, '-'));
            categoryCandidates.add(dbCategory.slug.replace(/\s+/g, '-'));
          }
        }

        const regexes = [...categoryCandidates]
          .filter(Boolean)
          .map((candidate) => new RegExp(`^${escapeRegex(candidate)}$`, 'i'))
          .filter((regex) => regex.source !== '^$');

        if (regexes.length > 0) {
          filter.$or = [
            { category: { $in: regexes } },
            { subcategory: { $in: regexes } },
          ];
        }
      }
      if (brand) {
        const safeBrand = escapeRegex(brand as string);
        filter.brand = new RegExp(`^${safeBrand}$`, 'i');
      }
      if (isPopular === 'true') filter.isPopular = true;
      if (isBestSeller === 'true') filter.isBestSeller = true;
      if (isFeatured === 'true') filter.isFeatured = true;
      if (isNewArrival === 'true') filter.isNewArrival = true;

      if (minPrice || maxPrice) {
        filter.price = {};
        if (minPrice) filter.price.$gte = parseFloat(minPrice as string);
        if (maxPrice) filter.price.$lte = parseFloat(maxPrice as string);
      }

      // Cursor-based pagination for large datasets
      if (cursor && typeof cursor === 'string' && mongoose.isValidObjectId(cursor)) {
        filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
      }

      let sortOptions: any = { createdAt: -1, _id: -1 };
      if (sort === 'price_asc') sortOptions = { price: 1, _id: 1 };
      else if (sort === 'price_desc') sortOptions = { price: -1, _id: -1 };
      else if (sort === 'rating') sortOptions = { ratingAverage: -1, _id: -1 };
      else if (sort === 'popular') sortOptions = { salesCount: -1, _id: -1 };

      const total = await ProductModel.countDocuments(filter);
      const projection = includeDetails === 'true'
        ? `${CATALOG_PROJECTION} attributes dynamicAttributes warranty`
        : CATALOG_PROJECTION;
      const queryBuilder = ProductModel.find(filter)
        .select(projection)
        .sort(sortOptions)
        .limit(limitNum)
        .lean();

      if (!cursor) {
        queryBuilder.skip((pageNum - 1) * limitNum);
      }

      const products = await queryBuilder.exec();
      const nextCursor = products.length === limitNum ? products[products.length - 1]._id : null;

      res.json({
        success: true,
        data: products.map(withCanonicalProductId),
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
          nextCursor,
        },
      });
      return;
    }

    // In-memory filtering with bounded slicing
    let filtered = [...inMemoryProducts];
    if (status && status !== 'all') {
      filtered = filtered.filter((p) => p.status === status);
    } else if (includeAll !== 'true') {
      filtered = filtered.filter((p) => p.status === 'published');
    }

    if (category && category !== 'all') {
      filtered = filtered.filter((p) => matchesCategoryValue(p.category, String(category)) || matchesCategoryValue(p.subcategory, String(category)));
    }
    if (brand) {
      filtered = filtered.filter((p) => p.brand.toLowerCase() === (brand as string).toLowerCase());
    }
    if (isPopular === 'true') filtered = filtered.filter((p) => p.isPopular);
    if (isBestSeller === 'true') filtered = filtered.filter((p) => p.isBestSeller);
    if (isFeatured === 'true') filtered = filtered.filter((p) => p.isFeatured);
    if (isNewArrival === 'true') filtered = filtered.filter((p) => p.isNewArrival);

    if (minPrice) {
      const min = parseFloat(minPrice as string);
      filtered = filtered.filter((p) => (p.salePrice || p.price) >= min);
    }
    if (maxPrice) {
      const max = parseFloat(maxPrice as string);
      filtered = filtered.filter((p) => (p.salePrice || p.price) <= max);
    }

    if (sort === 'price_asc') {
      filtered.sort((a, b) => (a.salePrice || a.price) - (b.salePrice || b.price));
    } else if (sort === 'price_desc') {
      filtered.sort((a, b) => (b.salePrice || b.price) - (a.salePrice || a.price));
    } else if (sort === 'rating') {
      filtered.sort((a, b) => b.ratingAverage - a.ratingAverage);
    } else if (sort === 'popular') {
      filtered.sort((a, b) => b.salesCount - a.salesCount);
    }

    const total = filtered.length;
    const paginated = filtered.slice((pageNum - 1) * limitNum, pageNum * limitNum);

    res.json({
      success: true,
      data: paginated.map(withCanonicalProductId),
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Autocomplete suggestions (bounded, keyboard-accessible dropdown with cross-lingual support)
router.get('/suggestions', async (req: Request, res: Response) => {
  try {
    const rawQ = ((req.query.q as string) || '').slice(0, 100).trim();
    if (!rawQ) {
      res.json({ success: true, suggestions: [] });
      return;
    }

    const expandedTokens = expandSearchQuery(rawQ);

    if (isDbConnected()) {
      try {
        const regexList = expandedTokens.map((t) => new RegExp(escapeRegex(t), 'i'));
        const dbMatches = await ProductModel.find({
          status: 'published',
          $or: [
            { name: { $in: regexList } },
            { brand: { $in: regexList } },
            { category: { $in: regexList } },
            { banglaKeywords: { $in: expandedTokens } },
          ],
        })
          .select('name slug brand category price salePrice images badge')
          .limit(8)
          .lean();

        if (dbMatches && dbMatches.length > 0) {
          const suggestions = dbMatches.map((p: any) => ({
            id: String(p._id),
            name: p.name,
            slug: p.slug,
            brand: p.brand,
            category: p.category,
            price: p.price,
            salePrice: p.salePrice,
            image: p.images?.[0]?.url || '',
            badge: p.badge,
          }));
          res.json({ success: true, suggestions });
          return;
        }
      } catch (err) {
        console.warn('DB suggestions lookup fallback:', err);
      }
    }

    // In-memory cross-lingual matching with relevance score
    const scored = inMemoryProducts
      .map((p) => {
        const pText = `${p.name} ${p.brand} ${p.category} ${p.description} ${p.banglaKeywords.join(' ')}`.toLowerCase();
        const hasMatch = expandedTokens.some((token) => pText.includes(token));
        if (!hasMatch) return null;
        let score = 0;
        const normQ = rawQ.toLowerCase();
        if (p.name.toLowerCase().includes(normQ)) score += 50;
        if (p.banglaKeywords.some((k) => k.toLowerCase().includes(normQ))) score += 40;
        return { product: p, score };
      })
      .filter((item): item is { product: SeedProduct; score: number } => item !== null)
      .sort((a, b) => b.score - a.score);

    const suggestions = scored.slice(0, 8).map(({ product: p }) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      brand: p.brand,
      category: p.category,
      price: p.price,
      salePrice: p.salePrice,
      image: p.images[0]?.url || '',
      badge: p.badge,
    }));

    res.json({ success: true, suggestions });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Search endpoint with Bangla-English cross-lingual discovery, conversational intent extraction, and relevance ranking
router.get('/search', async (req: Request, res: Response) => {
  try {
    const rawQuery = ((req.query.q as string) || '').slice(0, 150).trim();
    if (!rawQuery) {
      res.json({ success: true, data: [], query: '', total: 0 });
      return;
    }

    const conversational = parseConversationalSearchQuery(rawQuery);
    const tokens = conversational.tokens.length > 0 ? conversational.tokens : expandSearchQuery(rawQuery);
    const sortBy = (typeof req.query.sort === 'string' ? req.query.sort : conversational.sortBy) || 'popular';
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 20));

    if (isDbConnected()) {
      try {
        const regexList = tokens.map((t) => new RegExp(escapeRegex(t), 'i'));
        const orConditions: any[] = [
          { name: { $in: regexList } },
          { brand: { $in: regexList } },
          { category: { $in: regexList } },
          { subcategory: { $in: regexList } },
          { sku: { $in: regexList } },
          { banglaKeywords: { $in: tokens } },
        ];

        const filter: any = {
          status: 'published',
          $or: orConditions,
        };

        if (req.query.category && req.query.category !== 'all') {
          const categoryFilter = String(req.query.category).trim();
          const categoryMatches = [
            { category: new RegExp(`^${escapeRegex(categoryFilter)}$`, 'i') },
            { subcategory: new RegExp(`^${escapeRegex(categoryFilter)}$`, 'i') },
            { category: new RegExp(`^${escapeRegex(categoryFilter.replace(/[-_]+/g, ' '))}$`, 'i') },
            { subcategory: new RegExp(`^${escapeRegex(categoryFilter.replace(/[-_]+/g, ' '))}$`, 'i') },
          ];
          filter.$and = [{ $or: categoryMatches }];
        }

        if (conversational.targetCategory && (!conversational.cleanedQuery || tokens.length === 0)) {
          const safeCat = escapeRegex(conversational.targetCategory);
          filter.$or = [
            { category: new RegExp(safeCat, 'i') },
            { subcategory: new RegExp(safeCat, 'i') },
          ];
        }

        if (conversational.maxPrice || conversational.minPrice) {
          filter.price = {};
          if (conversational.maxPrice) filter.price.$lte = conversational.maxPrice;
          if (conversational.minPrice) filter.price.$gte = conversational.minPrice;
        }

        const dbMatches = await ProductModel.find(filter)
          .select(CATALOG_PROJECTION)
          .limit(limit * 2)
          .lean();

        if (dbMatches && dbMatches.length > 0) {
          // Sort results by relevance score and intent
          dbMatches.sort((a: any, b: any) => {
            if (sortBy === 'price_asc') {
              return (a.salePrice || a.price) - (b.salePrice || b.price);
            }
            if (sortBy === 'price_desc') {
              return (b.salePrice || b.price) - (a.salePrice || a.price);
            }
            if (sortBy === 'rating') {
              return (b.ratingAverage || 0) - (a.ratingAverage || 0);
            }
            if (sortBy === 'popular') {
              return (b.salesCount || 0) - (a.salesCount || 0);
            }

            const scoreA = tokens.reduce((acc, t) => {
              if (a.name.toLowerCase().includes(t)) return acc + 50;
              if (a.banglaKeywords?.includes(t)) return acc + 40;
              if (a.category.toLowerCase().includes(t)) return acc + 30;
              return acc + 10;
            }, 0);
            const scoreB = tokens.reduce((acc, t) => {
              if (b.name.toLowerCase().includes(t)) return acc + 50;
              if (b.banglaKeywords?.includes(t)) return acc + 40;
              if (b.category.toLowerCase().includes(t)) return acc + 30;
              return acc + 10;
            }, 0);
            return scoreB - scoreA;
          });

          const paginated = dbMatches.slice((page - 1) * limit, page * limit);
          res.json({
            success: true,
            data: paginated.map(withCanonicalProductId),
            query: rawQuery,
            conversational,
            expandedTokens: tokens,
            total: dbMatches.length,
            pagination: {
              total: dbMatches.length,
              page,
              limit,
              totalPages: Math.ceil(dbMatches.length / limit),
            },
          });
          return;
        }
      } catch (err) {
        console.warn('MongoDB search fallback to memory:', err);
      }
    }

    // In-memory cross-lingual and conversational scoring and ranking
    const matched = inMemoryProducts
      .filter((p) => {
        if (p.status !== 'published') return false;
        const effectivePrice = p.salePrice || p.price;

        if (conversational.maxPrice && effectivePrice > conversational.maxPrice) {
          return false;
        }
        if (conversational.minPrice && effectivePrice < conversational.minPrice) {
          return false;
        }
        if (conversational.targetCategory && (!conversational.cleanedQuery || tokens.length === 0)) {
          const targetCat = conversational.targetCategory.toLowerCase();
          const pCat = p.category.toLowerCase();
          const pSub = (p.subcategory || '').toLowerCase();
          if (!pCat.includes(targetCat) && !pSub.includes(targetCat)) {
            return false;
          }
        }
        return true;
      })
      .map((p) => {
        const text = `${p.name} ${p.brand} ${p.category} ${p.subcategory || ''} ${p.description} ${p.banglaKeywords.join(' ')}`.toLowerCase();
        const matches = tokens.length === 0 || tokens.some((token) => text.includes(token));

        // If no explicit tokens (e.g. pure intent like "Show me affordable products" with no specific word left)
        if (!matches && tokens.length > 0) return null;

        // Calculate relevance weight
        let score = 0;
        const normQ = (conversational.cleanedQuery || rawQuery).toLowerCase();
        if (p.name.toLowerCase() === normQ) score += 100;
        else if (normQ && p.name.toLowerCase().includes(normQ)) score += 60;
        if (normQ && p.sku.toLowerCase() === normQ) score += 80;
        if (normQ && p.category.toLowerCase() === normQ) score += 40;
        if (normQ && p.brand.toLowerCase() === normQ) score += 40;

        for (const token of tokens) {
          if (p.banglaKeywords.some((bk) => bk.toLowerCase().includes(token))) score += 45;
          if (p.name.toLowerCase().includes(token)) score += 30;
          if (p.description?.toLowerCase().includes(token)) score += 15;
        }

        // Conversational Intent Boosts
        if (conversational.intent === 'affordable') {
          const effPrice = p.salePrice || p.price;
          if (effPrice <= 5000) score += 40;
          if (p.salePrice) score += 20;
        } else if (conversational.intent === 'premium') {
          if (p.badge?.toUpperCase() === 'PREMIUM' || (p.price >= 8000)) score += 40;
          if (p.ratingAverage >= 4.8) score += 25;
        } else if (conversational.intent === 'daily_use') {
          if (['Lifestyle', 'Fashion', 'Footwear'].includes(p.category)) score += 35;
          if (text.includes('daily') || text.includes('everyday') || text.includes('commute')) score += 30;
        } else if (conversational.intent === 'discount') {
          if (p.salePrice) score += 50;
        } else if (conversational.intent === 'popular') {
          if (p.isPopular || p.isBestSeller) score += 50;
        } else if (conversational.intent === 'new_arrival') {
          if (p.isNewArrival) score += 50;
        }

        return { product: p, score };
      })
      .filter((item): item is { product: SeedProduct; score: number } => item !== null);

    // Sorting according to explicit request, conversational intent or relevance
    if (sortBy === 'price_asc') {
      matched.sort((a, b) => ((a.product.salePrice || a.product.price) - (b.product.salePrice || b.product.price)));
    } else if (sortBy === 'price_desc') {
      matched.sort((a, b) => ((b.product.salePrice || b.product.price) - (a.product.salePrice || a.product.price)));
    } else if (sortBy === 'rating') {
      matched.sort((a, b) => (b.product.ratingAverage || 0) - (a.product.ratingAverage || 0));
    } else if (sortBy === 'popular') {
      matched.sort((a, b) => (b.product.salesCount || 0) - (a.product.salesCount || 0));
    } else {
      matched.sort((a, b) => b.score - a.score);
    }

    const total = matched.length;
    const paginated = matched
      .slice((page - 1) * limit, page * limit)
      .map((item) => item.product);

    res.json({
      success: true,
      data: paginated,
      query: rawQuery,
      conversational,
      expandedTokens: tokens,
      total,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Explain query execution plan for MongoDB database architect inspection
router.get('/explain-query', async (req: Request, res: Response) => {
  try {
    if (!isDbConnected()) {
      res.json({
        success: true,
        database: 'offline (memory fallback)',
        message: 'MongoDB is currently disconnected; explain plans require active database.',
        simulatedPlan: {
          indexUsed: ['status_1_category_1_price_1', 'ProductTextSearchIndex'],
          scanType: 'IXSCAN',
          projectedFields: CATALOG_PROJECTION.split(' '),
        },
      });
      return;
    }

    const { category, brand, q } = req.query;
    const filter: any = { status: 'published' };
    if (category) filter.category = new RegExp(`^${escapeRegex(category as string)}$`, 'i');
    if (brand) filter.brand = new RegExp(`^${escapeRegex(brand as string)}$`, 'i');
    if (q) filter.$text = { $search: q as string };

    const explainResult = await (ProductModel.find(filter)
      .select(CATALOG_PROJECTION)
      .limit(12) as any)
      .explain('executionStats');

    res.json({
      success: true,
      query: filter,
      explain: explainResult,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Related products endpoint with real server-side pagination (Phase 6 Specification)
router.get('/:slug/related', async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 15));

    let current: any;
    if (isDbConnected()) {
      current = await ProductModel.findOne({
        $or: [
          { slug },
          { sku: slug },
          ...(mongoose.isValidObjectId(slug) ? [{ _id: slug }] : []),
        ],
      }).lean();
      if (current) current = withCanonicalProductId(current);
    } else {
      current = inMemoryProducts.find((p) => p.slug === slug || p.id === slug || p.sku === slug);
    }

    if (!current) {
      res.status(404).json({ success: false, error: 'Product not found' });
      return;
    }

    const category = current.category || 'Electronics';
    const currentId = current.id || String(current._id);

    if (isDbConnected()) {
      try {
        const query: any = {
          category: new RegExp(`^${escapeRegex(category)}$`, 'i'),
          status: 'published',
          stock: { $gt: 0 },
          slug: { $ne: current.slug },
        };
        if (current._id) {
          query._id = { $ne: current._id };
        }

        const total = await ProductModel.countDocuments(query);
        const products = await ProductModel.find(query)
          .sort({ isPopular: -1, ratingAverage: -1, salesCount: -1, _id: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .select(CATALOG_PROJECTION)
          .lean();

        const totalPages = Math.ceil(total / limit);
        const hasMore = page < totalPages;

        res.json({
          success: true,
          data: products.map(withCanonicalProductId),
          pagination: {
            page,
            limit,
            total,
            totalPages,
            hasMore,
          },
          hasMore,
          total,
          page,
          limit,
        });
        return;
      } catch (e) {
        console.error('Failed to load related products from MongoDB Atlas:', e);
        res.status(503).json({ success: false, error: 'Related products are temporarily unavailable.' });
        return;
      }
    }

    // In-memory catalog matching (strictly same category, excluding current product, published only, in-stock)
    const categoryLower = category.toLowerCase();
    const allMatching = inMemoryProducts.filter((p) => {
      if (p.id === currentId || p.slug === current.slug || p.sku === current.sku) return false;
      if (p.status !== 'published') return false;
      if (p.stock <= 0) return false;
      return p.category.toLowerCase() === categoryLower;
    });

    // Subcategory priority + rating ranking
    allMatching.sort((a, b) => {
      const aSameSub = a.subcategory && current.subcategory && a.subcategory === current.subcategory ? 1 : 0;
      const bSameSub = b.subcategory && current.subcategory && b.subcategory === current.subcategory ? 1 : 0;
      if (bSameSub !== aSameSub) return bSameSub - aSameSub;
      return (b.ratingAverage || 4.5) - (a.ratingAverage || 4.5);
    });

    const total = allMatching.length;
    const totalPages = Math.ceil(total / limit);
    const paginated = allMatching.slice((page - 1) * limit, page * limit);
    const hasMore = page < totalPages;

    res.json({
      success: true,
      data: paginated,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasMore,
      },
      hasMore,
      total,
      page,
      limit,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Single product by slug or id
router.get('/:slug', async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;

    if (isDbConnected()) {
      const orConditions: any[] = [{ slug }, { sku: slug }];
      if (mongoose.isValidObjectId(slug)) {
        orConditions.push({ _id: slug });
      }
      const product = await ProductModel.findOne({ $or: orConditions });
      if (product) {
        res.json({
          success: true,
          data: withCanonicalProductId(product.toJSON()),
        });
        return;
      }

      res.status(404).json({ success: false, error: 'Product not found' });
      return;
    }

    const item = inMemoryProducts.find((p) => p.slug === slug || p.id === slug || p.sku === slug);
    if (!item) {
      res.status(404).json({ success: false, error: 'Product not found' });
      return;
    }

    res.json({ success: true, data: item });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create product (Admin)
router.post(
  '/',
  requireAuth,
  requireRole(['admin', 'super_admin', 'catalog_manager']),
  requireProductionDb('Product creation'),
  async (req: Request, res: Response) => {
  try {
    const {
      name, brand, category, price, salePrice, description, stock, sku, images, badge, banglaKeywords,
      dynamicAttributes, productHighlights,
    } = req.body;

    if (!name || !price || !sku || !category) {
      res.status(400).json({ success: false, error: 'Name, price, SKU, and category are required' });
      return;
    }

    let productImages: IProductImage[];
    try {
      productImages = normalizeProductImages(images);
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Invalid product images.',
      });
      return;
    }

    let normalizedHighlights: string[] = [];
    try {
      normalizedHighlights = normalizeProductHighlights(productHighlights);
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Invalid product highlights.',
      });
      return;
    }

    let categoryId: string | undefined;
    let dynamicValues: Record<string, unknown> = {};
    const categoryDefinition = await findCategoryDefinition(category.trim());
    if (categoryDefinition) {
      categoryId = categoryDefinition._id.toString();
      try {
        dynamicValues = validateCategoryAttributeValues(
          getCategoryAttributes(categoryDefinition),
          dynamicAttributes ?? {}
        );
      } catch (error) {
        res.status(400).json({
          success: false,
          error: error instanceof Error ? error.message : 'Invalid category attribute values.',
        });
        return;
      }
    } else if (dynamicAttributes !== undefined && isRecord(dynamicAttributes) && Object.keys(dynamicAttributes).length) {
      res.status(400).json({ success: false, error: 'The selected category has no configured attributes.' });
      return;
    }

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    // Check SKU duplicate
    if (inMemoryProducts.some((p) => p.sku.toUpperCase() === sku.toUpperCase())) {
      res.status(400).json({ success: false, error: `SKU ${sku} already exists` });
      return;
    }

    const newProduct: SeedProduct = {
      id: `prod-${Date.now()}`,
      name: name.trim(),
      slug: `${slug}-${Date.now().toString().slice(-4)}`,
      sku: sku.trim().toUpperCase(),
      brand: (brand || 'Novara').trim(),
      category: category.trim(),
      description: description || 'Premium product designed for modern living.',
      price: parseFloat(price),
      salePrice: salePrice ? parseFloat(salePrice) : undefined,
      badge: badge || undefined,
      images: productImages,
      stock: parseInt(stock, 10) || 10,
      reservedStock: 0,
      ratingAverage: 5.0,
      reviewCount: 0,
      salesCount: 0,
      isPopular: false,
      isBestSeller: false,
      isFeatured: false,
      isNewArrival: true,
      attributes: {},
      ...(categoryId ? { dynamicAttributes: { [categoryId]: dynamicValues } } : {}),
      productHighlights: normalizedHighlights,
      banglaKeywords: Array.isArray(banglaKeywords) ? banglaKeywords : [],
      status: 'published',
    };

    if (isDbConnected()) {
      const savedProduct = await ProductModel.create(newProduct);
      const persistedProduct = withCanonicalProductId(savedProduct.toJSON());
      inMemoryProducts.unshift({ ...newProduct, id: persistedProduct.id });
      res.status(201).json({ success: true, data: persistedProduct });
      return;
    }

    inMemoryProducts.unshift(newProduct);
    res.status(201).json({ success: true, data: newProduct });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
  }
);

// Update product (Admin)
router.put(
  '/:id',
  requireAuth,
  requireRole(['admin', 'super_admin', 'catalog_manager']),
  requireProductionDb('Product update'),
  async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    let productImages: IProductImage[] | undefined;
    if (req.body.images !== undefined) {
      try {
        productImages = normalizeProductImages(req.body.images);
      } catch (error) {
        res.status(400).json({
          success: false,
          error: error instanceof Error ? error.message : 'Invalid product images.',
        });
        return;
      }
    }

    let normalizedHighlights: string[] | undefined;
    if (Object.prototype.hasOwnProperty.call(req.body, 'productHighlights')) {
      try {
        normalizedHighlights = normalizeProductHighlights(req.body.productHighlights);
      } catch (error) {
        res.status(400).json({
          success: false,
          error: error instanceof Error ? error.message : 'Invalid product highlights.',
        });
        return;
      }
    }

    if (isDbConnected()) {
      const update = { ...req.body };
      delete update.id;
      delete update._id;
      if (productImages) update.images = productImages;
      if (normalizedHighlights !== undefined) update.productHighlights = normalizedHighlights;

      const currentProduct = await ProductModel.findOne(productLookupFilter(id));
      if (!currentProduct) {
        res.status(404).json({ success: false, error: 'Product not found' });
        return;
      }

      if (Object.prototype.hasOwnProperty.call(req.body, 'dynamicAttributes')) {
        const categoryName = typeof update.category === 'string' ? update.category.trim() : currentProduct.category;
        const categoryDefinition = await findCategoryDefinition(categoryName);
        if (!categoryDefinition) {
          res.status(400).json({ success: false, error: 'The selected category could not be found.' });
          return;
        }

        try {
          const definitions = getCategoryAttributes(categoryDefinition);
          const sanitizedValues = validateCategoryAttributeValues(definitions, req.body.dynamicAttributes);
          const storedByCategory = isRecord(currentProduct.dynamicAttributes) ? currentProduct.dynamicAttributes : {};
          const storedForCategory = isRecord(storedByCategory[categoryDefinition._id.toString()])
            ? { ...storedByCategory[categoryDefinition._id.toString()] as Record<string, unknown> }
            : {};
          for (const definition of definitions) {
            if (definition.isActive) delete storedForCategory[definition.key];
          }
          update.dynamicAttributes = {
            ...storedByCategory,
            [categoryDefinition._id.toString()]: {
              ...storedForCategory,
              ...sanitizedValues,
            },
          };
        } catch (error) {
          res.status(400).json({
            success: false,
            error: error instanceof Error ? error.message : 'Invalid category attribute values.',
          });
          return;
        }
      }

      const savedProduct = await ProductModel.findOneAndUpdate(
        productLookupFilter(id),
        { $set: update },
        { new: true, runValidators: true }
      );
      if (!savedProduct) {
        res.status(404).json({ success: false, error: 'Product not found' });
        return;
      }

      const persistedProduct = withCanonicalProductId(savedProduct.toJSON());
      const memoryIndex = inMemoryProducts.findIndex(
        (product) => product.id === id || product.slug === id || product.sku === id
      );
      if (memoryIndex !== -1) {
        inMemoryProducts[memoryIndex] = {
          ...inMemoryProducts[memoryIndex],
          ...update,
          id: persistedProduct.id,
          ...(productImages ? { images: productImages } : {}),
        };
      }
      res.json({ success: true, data: persistedProduct });
      return;
    }

    const index = inMemoryProducts.findIndex(
      (product) => product.id === id || product.slug === id || product.sku === id
    );
    if (index === -1) {
      res.status(404).json({ success: false, error: 'Product not found' });
      return;
    }

    const existing = inMemoryProducts[index];
    const updated: SeedProduct = {
      ...existing,
      ...req.body,
      id: existing.id,
      sku: req.body.sku ? req.body.sku.toUpperCase() : existing.sku,
      ...(productImages ? { images: productImages } : {}),
      ...(normalizedHighlights !== undefined ? { productHighlights: normalizedHighlights } : {}),
    };

    inMemoryProducts[index] = updated;

    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
  }
);

// Delete/Archive product (Admin)
router.delete('/:id', requireAuth, requireRole(['admin', 'super_admin']), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    inMemoryProducts = inMemoryProducts.filter((p) => p.id !== id && p.slug !== id && p.sku !== id);

    if (isDbConnected()) {
      try {
        const isOid = mongoose.isValidObjectId(id);
        const query = isOid ? { $or: [{ _id: id }, { slug: id }, { sku: id }] } : { $or: [{ slug: id }, { sku: id }] };
        await ProductModel.findOneAndDelete(query);
      } catch (dbErr) {
        console.warn('Product DB deletion failed:', dbErr);
      }
    }

    res.json({ success: true, message: 'Product removed successfully' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Adjust stock (Admin)
router.post('/:id/stock', requireAuth, requireRole(['admin', 'super_admin', 'inventory_manager']), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { adjustment, reason } = req.body;

    const prod = inMemoryProducts.find((p) => p.id === id || p.sku === id || p.slug === id);
    if (!prod) {
      res.status(404).json({ success: false, error: 'Product not found' });
      return;
    }

    const newStock = Math.max(0, prod.stock + (parseInt(adjustment, 10) || 0));
    prod.stock = newStock;

    if (isDbConnected()) {
      try {
        const isOid = mongoose.isValidObjectId(id);
        const query = isOid ? { $or: [{ _id: id }, { slug: id }, { sku: id }] } : { $or: [{ slug: id }, { sku: id }] };
        await ProductModel.findOneAndUpdate(query, { stock: newStock });
      } catch (dbErr) {
        console.warn('Stock DB update failed:', dbErr);
      }
    }

    console.log(`[Inventory] Adjusted stock for ${prod.name} (${prod.sku}) to ${newStock}. Reason: ${reason || 'Manual Adjustment'}`);

    res.json({ success: true, stock: newStock, message: `Stock updated to ${newStock}` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export { inMemoryProducts };
export default router;
