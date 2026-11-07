import { Router, Request, Response } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { isDbConnected } from '../db';
import { HomepageConfigModel, IHomepageSection } from '../models/HomepageConfig';
import { BannerModel } from '../models/Banner';
import { SliderModel } from '../models/Slider';
import { CategoryModel } from '../models/Category';
import { INITIAL_PRODUCTS } from '../data/initialData';
import {
  getDefaultHomepageSections,
  reindexSections,
  duplicateSection,
  isBannerAvailableForDisplay,
  HomepageSectionConfig,
} from '../../src/utils/homepageBuilderRules';

const router = Router();

// ==========================================
// In-Memory Fallback Store
// ==========================================
let inMemoryDraftSections: HomepageSectionConfig[] = getDefaultHomepageSections();
let inMemoryPublishedSections: HomepageSectionConfig[] = getDefaultHomepageSections();
let inMemoryIsDraftModified = false;
let inMemoryLastPublishedAt: string = new Date().toISOString();

// Sync from DB if available on boot
async function initFromDb() {
  if (!isDbConnected()) return;
  try {
    let doc = await HomepageConfigModel.findOne();
    if (!doc) {
      doc = await HomepageConfigModel.create({
        draftSections: inMemoryDraftSections,
        publishedSections: inMemoryPublishedSections,
        isDraftModified: false,
        lastPublishedAt: new Date(),
        version: 1,
      });
    } else {
      inMemoryDraftSections = (doc.draftSections as any) || getDefaultHomepageSections();
      inMemoryPublishedSections = (doc.publishedSections as any) || getDefaultHomepageSections();
      inMemoryIsDraftModified = doc.isDraftModified || false;
      inMemoryLastPublishedAt = doc.lastPublishedAt ? doc.lastPublishedAt.toISOString() : new Date().toISOString();
    }
  } catch (err) {
    console.error('Error initializing HomepageConfig from DB:', err);
  }
}

// Fire async initialization
initFromDb();

// Persist helper
async function persistState(): Promise<boolean> {
  if (!isDbConnected()) return false;
  try {
    let doc = await HomepageConfigModel.findOne();
    if (!doc) {
      await HomepageConfigModel.create({
        draftSections: inMemoryDraftSections,
        publishedSections: inMemoryPublishedSections,
        isDraftModified: inMemoryIsDraftModified,
        lastPublishedAt: new Date(inMemoryLastPublishedAt),
        version: 1,
      });
    } else {
      doc.draftSections = inMemoryDraftSections as any;
      doc.publishedSections = inMemoryPublishedSections as any;
      doc.isDraftModified = inMemoryIsDraftModified;
      doc.lastPublishedAt = new Date(inMemoryLastPublishedAt);
      doc.version = (doc.version || 1) + 1;
      await doc.save();
    }
    return true;
  } catch (err) {
    console.error('Error persisting HomepageConfig:', err);
    return false;
  }
}

async function persistStateOrRespond(res: Response): Promise<boolean> {
  if (await persistState()) return true;
  res.status(503).json({
    success: false,
    message: 'Homepage changes could not be saved to persistent storage.',
    code: 'DATABASE_UNAVAILABLE',
  });
  return false;
}

// ==========================================
// 1. PUBLIC STOREFRONT HOMEPAGE CONFIG
// ==========================================
// GET /api/homepage/config?preview=draft
router.get('/config', async (req: Request, res: Response) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (!isDbConnected()) {
      res.status(503).json({
        success: false,
        error: 'Homepage content requires persistent MongoDB storage, which is currently unavailable.',
        code: 'DATABASE_UNAVAILABLE',
      });
      return;
    }

    const isPreview = req.query.preview === 'draft' || req.query.preview === 'true';
    const today = new Date().toISOString().slice(0, 10);
    const [config, banners, sliders, categories] = await Promise.all([
      HomepageConfigModel.findOne().lean(),
      BannerModel.find({
        isActive: true,
        $or: [{ status: 'published' }, { status: 'scheduled', startDate: { $lte: today } }],
      })
        .sort({ displayOrder: 1, createdAt: -1 })
        .lean(),
      SliderModel.find({ isActive: true }).sort({ displayOrder: 1, createdAt: -1 }).lean(),
      CategoryModel.find({ isActive: true }).sort({ displayOrder: 1 }).lean(),
    ]);

    const rawSections = isPreview
      ? config?.draftSections || getDefaultHomepageSections()
      : config?.publishedSections || getDefaultHomepageSections();
    const sections = (rawSections || [])
      .filter((section: any) => (isPreview ? true : section.isEnabled))
      .sort((a: any, b: any) => a.displayOrder - b.displayOrder);
    const visibleBanners = banners.filter((banner: any) => isBannerAvailableForDisplay(banner));

    res.json({
      success: true,
      data: {
        sections,
        banners: visibleBanners.map((banner: any) => ({ ...banner, id: banner._id.toString() })),
        sliders: sliders.map((slider: any) => ({ ...slider, id: slider._id.toString() })),
        categories: categories.map((category: any) => ({ ...category, id: category._id.toString() })),
        isPreview,
        lastPublishedAt: config?.lastPublishedAt?.toISOString() || new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('Error fetching published homepage content:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch homepage content.' });
  }
});

// ==========================================
// 2. ADMIN BUILDER ENDPOINTS
// ==========================================
const adminAuth = [requireAuth, requireRole(['admin', 'super_admin'])];

// GET /api/admin/homepage/builder
router.get('/builder', ...adminAuth, async (req: Request, res: Response) => {
  try {
    if (!isDbConnected()) {
      res.status(503).json({
        success: false,
        message: 'Homepage builder requires persistent MongoDB storage.',
        code: 'DATABASE_UNAVAILABLE',
      });
      return;
    }
    const [config, banners, sliders, categories] = await Promise.all([
      HomepageConfigModel.findOne().lean(),
      BannerModel.find().sort({ displayOrder: 1, createdAt: -1 }).lean(),
      SliderModel.find().sort({ displayOrder: 1, createdAt: -1 }).lean(),
      CategoryModel.find().sort({ displayOrder: 1 }).lean(),
    ]);
    const draftSections = config?.draftSections || getDefaultHomepageSections();
    const publishedSections = config?.publishedSections || getDefaultHomepageSections();
    inMemoryDraftSections = draftSections as HomepageSectionConfig[];
    inMemoryPublishedSections = publishedSections as HomepageSectionConfig[];
    inMemoryIsDraftModified = config?.isDraftModified ?? false;
    inMemoryLastPublishedAt = config?.lastPublishedAt?.toISOString() || new Date().toISOString();
    const formattedBanners = banners.map((banner: any) => ({ ...banner, id: banner._id.toString() }));
    const formattedSliders = sliders.map((slider: any) => ({ ...slider, id: slider._id.toString() }));
    res.json({
      success: true,
      data: {
        draftSections,
        publishedSections,
        isDraftModified: config?.isDraftModified ?? false,
        lastPublishedAt: config?.lastPublishedAt?.toISOString() || new Date().toISOString(),
        banners: formattedBanners,
        bannersMap: Object.fromEntries(formattedBanners.map((banner: any) => [banner.id, banner])),
        sliders: formattedSliders,
        categories: categories.map((category: any) => ({ ...category, id: category._id.toString() })),
        productsSummary: INITIAL_PRODUCTS.map((p) => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          price: p.price,
          category: p.category,
          image: p.images?.[0] || '',
          isPopular: p.isPopular,
          isBestSeller: p.isBestSeller,
        })),
      },
    });
  } catch (err) {
    console.error('Error loading homepage builder:', err);
    res.status(500).json({ success: false, message: 'Failed to load homepage builder data.' });
  }
});

// PUT /api/admin/homepage/builder/draft - Update entire draft sections list & order
router.put('/builder/draft', ...adminAuth, async (req: Request, res: Response) => {
  const { sections } = req.body;
  if (!Array.isArray(sections)) {
    return res.status(400).json({ success: false, message: 'Sections array is required' });
  }

  inMemoryDraftSections = reindexSections(sections);
  inMemoryIsDraftModified = true;
  if (!(await persistStateOrRespond(res))) return;

  res.json({
    success: true,
    message: 'Homepage draft updated successfully',
    data: {
      draftSections: inMemoryDraftSections,
      isDraftModified: inMemoryIsDraftModified,
    },
  });
});

// POST /api/admin/homepage/builder/publish - Promote draft to published atomically
router.post('/builder/publish', ...adminAuth, async (req: Request, res: Response) => {
  inMemoryPublishedSections = JSON.parse(JSON.stringify(inMemoryDraftSections));
  inMemoryIsDraftModified = false;
  inMemoryLastPublishedAt = new Date().toISOString();
  if (!(await persistStateOrRespond(res))) return;

  res.json({
    success: true,
    message: 'Homepage published live successfully!',
    data: {
      publishedSections: inMemoryPublishedSections,
      draftSections: inMemoryDraftSections,
      isDraftModified: inMemoryIsDraftModified,
      lastPublishedAt: inMemoryLastPublishedAt,
    },
  });
});

// POST /api/admin/homepage/builder/reset - Reset draft back to factory default
router.post('/builder/reset', ...adminAuth, async (req: Request, res: Response) => {
  inMemoryDraftSections = getDefaultHomepageSections();
  inMemoryIsDraftModified = true;
  if (!(await persistStateOrRespond(res))) return;

  res.json({
    success: true,
    message: 'Draft reset to default homepage layout',
    data: {
      draftSections: inMemoryDraftSections,
      isDraftModified: inMemoryIsDraftModified,
    },
  });
});

// POST /api/admin/homepage/builder/sections - Add new section
router.post('/builder/sections', ...adminAuth, async (req: Request, res: Response) => {
  const { sectionType, title, subtitle, settings, isEnabled = true } = req.body;

  if (!sectionType || !title) {
    return res.status(400).json({ success: false, message: 'sectionType and title are required' });
  }

  const newSection: HomepageSectionConfig = {
    id: `sec-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
    sectionType,
    title,
    subtitle: subtitle || '',
    displayOrder: inMemoryDraftSections.length + 1,
    isEnabled,
    settings: {
      productSource: settings?.productSource || 'featured',
      categorySlug: settings?.categorySlug || '',
      productIds: settings?.productIds || [],
      productLimit: settings?.productLimit !== undefined ? settings?.productLimit : 8,
      desktopColumns: settings?.desktopColumns || 4,
      mobileColumns: settings?.mobileColumns || 2,
      bannerPlacements: settings?.bannerPlacements || [],
      bannerId: settings?.bannerId || '',
      bannerIds: settings?.bannerIds || [],
      backgroundColor: settings?.backgroundColor || '',
      viewAllLink: settings?.viewAllLink || '/shop',
      viewAllText: settings?.viewAllText || 'View All',
    },
  };

  inMemoryDraftSections.push(newSection);
  inMemoryDraftSections = reindexSections(inMemoryDraftSections);
  inMemoryIsDraftModified = true;
  if (!(await persistStateOrRespond(res))) return;

  res.status(201).json({
    success: true,
    message: 'Section created in draft',
    data: newSection,
  });
});

// PUT /api/admin/homepage/builder/sections/:id - Update existing section
router.put('/builder/sections/:id', ...adminAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const index = inMemoryDraftSections.findIndex((s) => s.id === id);

  if (index === -1) {
    return res.status(404).json({ success: false, message: 'Section not found in draft' });
  }

  const current = inMemoryDraftSections[index];
  const { title, subtitle, isEnabled, settings, sectionType } = req.body;

  inMemoryDraftSections[index] = {
    ...current,
    sectionType: sectionType || current.sectionType,
    title: title !== undefined ? title : current.title,
    subtitle: subtitle !== undefined ? subtitle : current.subtitle,
    isEnabled: isEnabled !== undefined ? isEnabled : current.isEnabled,
    settings: {
      ...current.settings,
      ...(settings || {}),
    },
  };

  inMemoryIsDraftModified = true;
  if (!(await persistStateOrRespond(res))) return;

  res.json({
    success: true,
    message: 'Section updated in draft',
    data: inMemoryDraftSections[index],
  });
});

// DELETE /api/admin/homepage/builder/sections/:id - Delete section
router.delete('/builder/sections/:id', ...adminAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const initialLen = inMemoryDraftSections.length;
  inMemoryDraftSections = inMemoryDraftSections.filter((s) => s.id !== id);

  if (inMemoryDraftSections.length === initialLen) {
    return res.status(404).json({ success: false, message: 'Section not found' });
  }

  inMemoryDraftSections = reindexSections(inMemoryDraftSections);
  inMemoryIsDraftModified = true;
  if (!(await persistStateOrRespond(res))) return;

  res.json({
    success: true,
    message: 'Section deleted from draft',
    data: { id },
  });
});

// POST /api/admin/homepage/builder/sections/:id/duplicate - Duplicate section
router.post('/builder/sections/:id/duplicate', ...adminAuth, async (req: Request, res: Response) => {
  const { id } = req.params;
  const duplicated = duplicateSection(inMemoryDraftSections, id);

  if (duplicated.length === inMemoryDraftSections.length) {
    return res.status(404).json({ success: false, message: 'Section not found' });
  }

  inMemoryDraftSections = duplicated;
  inMemoryIsDraftModified = true;
  if (!(await persistStateOrRespond(res))) return;

  res.json({
    success: true,
    message: 'Section duplicated in draft',
    data: { draftSections: inMemoryDraftSections },
  });
});

export default router;
