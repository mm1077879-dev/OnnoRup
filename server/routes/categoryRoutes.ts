import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { CategoryModel } from '../models/Category';
import { ProductModel } from '../models/Product';
import { isDbConnected } from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
import { normalizeCategoryDetailConfiguration } from '../../src/utils/categoryAttributes';

const router = Router();

function requireCategoryDatabase(res: Response): boolean {
  if (isDbConnected()) return true;
  res.status(503).json({
    success: false,
    error: 'Categories require persistent MongoDB storage, which is currently unavailable.',
    code: 'DATABASE_UNAVAILABLE',
  });
  return false;
}

function serializeCategory(category: any) {
  const { _id, __v, ...data } = typeof category?.toObject === 'function' ? category.toObject() : category;
  return { ...data, id: _id ? _id.toString() : category.id };
}

function categoryFilter(id: string) {
  return mongoose.isValidObjectId(id)
    ? { _id: id }
    : { $or: [{ slug: id }, { name: id }, { aliases: id }] };
}

router.get('/', async (req: Request, res: Response) => {
  try {
    if (!requireCategoryDatabase(res)) return;
    const query = req.query.activeOnly === 'true' ? { isActive: true } : {};
    const categoryQuery = CategoryModel.find(query);
    if (req.query.includeProductDetails !== 'true') {
      categoryQuery.select('-productDetailAttributes -productDetailGroups');
    }
    const categories = await categoryQuery.sort({ displayOrder: 1 }).lean();
    res.json({ success: true, data: categories.map(serializeCategory) });
  } catch (err) {
    console.error('Category list failed:', err);
    res.status(500).json({ success: false, error: 'Failed to load categories.' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    if (!requireCategoryDatabase(res)) return;
    const category = await CategoryModel.findOne(categoryFilter(req.params.id)).lean();
    if (!category) {
      res.status(404).json({ success: false, error: 'Category not found.' });
      return;
    }
    res.json({ success: true, data: serializeCategory(category) });
  } catch (err) {
    console.error('Category detail load failed:', err);
    res.status(500).json({ success: false, error: 'Failed to load category details.' });
  }
});

function normalizeOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const nextValue = String(value).trim();
  return nextValue || undefined;
}

router.post(
  '/',
  requireAuth,
  requireRole(['admin', 'super_admin', 'catalog_manager']),
  async (req: Request, res: Response) => {
    try {
      if (!requireCategoryDatabase(res)) return;
      const {
        name, icon, displayOrder, isActive, description, image, parentCategory,
        productDetailAttributes, productDetailGroups,
      } = req.body;
      const normalizedName = typeof name === 'string' ? name.trim() : '';
      if (!normalizedName) {
        res.status(400).json({ success: false, error: 'Category name is required.' });
        return;
      }

      const slug = normalizedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      let detailConfiguration;
      try {
        detailConfiguration = normalizeCategoryDetailConfiguration(
          productDetailAttributes ?? [],
          productDetailGroups ?? []
        );
      } catch (error) {
        res.status(400).json({
          success: false,
          error: error instanceof Error ? error.message : 'Invalid category detail configuration.',
        });
        return;
      }

      const created = await CategoryModel.create({
        name: normalizedName,
        slug,
        description: normalizeOptionalString(description),
        icon: normalizeOptionalString(icon) || 'Tag',
        image: normalizeOptionalString(image),
        parentCategory: normalizeOptionalString(parentCategory),
        displayOrder:
          displayOrder === undefined ? (await CategoryModel.countDocuments()) + 1 : Number(displayOrder),
        isActive: isActive !== false,
        ...detailConfiguration,
      });
      res.status(201).json({ success: true, data: serializeCategory(created) });
    } catch (err: any) {
      console.error('Category create failed:', err);
      res.status(500).json({ success: false, error: 'Failed to create category.' });
    }
  }
);

router.put(
  '/:id',
  requireAuth,
  requireRole(['admin', 'super_admin', 'catalog_manager']),
  async (req: Request, res: Response) => {
    try {
      if (!requireCategoryDatabase(res)) return;
      const {
        name, icon, isActive, displayOrder, description, image, parentCategory, removeImage,
        productDetailAttributes, productDetailGroups,
      } = req.body;
      const updates: Record<string, any> = {};
      const updateFields: Record<string, any> = {};
      const existingCategory = await CategoryModel.findOne(categoryFilter(req.params.id));
      if (!existingCategory) {
        res.status(404).json({ success: false, error: 'Category not found.' });
        return;
      }

      if (name !== undefined) {
        const normalizedName = String(name).trim();
        if (!normalizedName) {
          res.status(400).json({ success: false, error: 'Category name is required.' });
          return;
        }
        updates.name = normalizedName;
        updates.slug = normalizedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        if (normalizedName !== existingCategory.name) {
          updates.aliases = [...new Set([
            ...(existingCategory.aliases || []),
            existingCategory.name,
            existingCategory.slug,
          ])];
        }
      }
      if (description !== undefined) {
        const normalizedDescription = normalizeOptionalString(description);
        updates.description = normalizedDescription;
      }
      if (icon !== undefined) updates.icon = normalizeOptionalString(icon) || 'Tag';
      if (parentCategory !== undefined) {
        updates.parentCategory = normalizeOptionalString(parentCategory);
      }
      if (image !== undefined) {
        const normalizedImage = normalizeOptionalString(image);
        if (normalizedImage) {
          updates.image = normalizedImage;
        } else {
          updateFields.$unset = { ...updateFields.$unset, image: '' };
        }
      }
      if (removeImage === true) {
        updateFields.$unset = { ...updateFields.$unset, image: '' };
      }
      if (isActive !== undefined) updates.isActive = Boolean(isActive);
      if (displayOrder !== undefined) updates.displayOrder = Number(displayOrder);
      if (productDetailAttributes !== undefined || productDetailGroups !== undefined) {
        try {
          const nextConfiguration = normalizeCategoryDetailConfiguration(
            productDetailAttributes ?? existingCategory.productDetailAttributes ?? [],
            productDetailGroups ?? existingCategory.productDetailGroups ?? []
          );
          const currentAttributes = normalizeCategoryDetailConfiguration(
            existingCategory.productDetailAttributes ?? [],
            existingCategory.productDetailGroups ?? []
          ).productDetailAttributes;
          const nextKeys = new Set(nextConfiguration.productDetailAttributes.map((attribute) => attribute.key));
          const removedKeys = currentAttributes
            .map((attribute) => attribute.key)
            .filter((key) => !nextKeys.has(key));
          if (removedKeys.length) {
            const categoryId = existingCategory._id.toString();
            const hasSavedValues = await ProductModel.exists({
              $or: removedKeys.map((key) => ({
                [`dynamicAttributes.${categoryId}.${key}`]: { $exists: true },
              })),
            });
            if (hasSavedValues) {
              res.status(409).json({
                success: false,
                error: 'One or more removed fields contain saved product data. Deactivate the field to preserve its history.',
                code: 'CATEGORY_ATTRIBUTE_IN_USE',
              });
              return;
            }
          }
          Object.assign(updates, nextConfiguration);
        } catch (error) {
          res.status(400).json({
            success: false,
            error: error instanceof Error ? error.message : 'Invalid category detail configuration.',
          });
          return;
        }
      }

      const category = await CategoryModel.findOneAndUpdate(
        categoryFilter(req.params.id),
        { ...updates, ...updateFields },
        {
          new: true,
          runValidators: true,
        }
      );
      if (!category) {
        res.status(404).json({ success: false, error: 'Category not found.' });
        return;
      }
      res.json({ success: true, data: serializeCategory(category) });
    } catch (err: any) {
      console.error('Category update failed:', err);
      res.status(500).json({ success: false, error: 'Failed to update category.' });
    }
  }
);

router.delete(
  '/:id',
  requireAuth,
  requireRole(['admin', 'super_admin', 'catalog_manager']),
  async (req: Request, res: Response) => {
    try {
      if (!requireCategoryDatabase(res)) return;
      const removed = await CategoryModel.findOneAndDelete(categoryFilter(req.params.id));
      if (!removed) {
        res.status(404).json({ success: false, error: 'Category not found.' });
        return;
      }
      res.json({ success: true, message: 'Category removed.' });
    } catch (err) {
      console.error('Category delete failed:', err);
      res.status(500).json({ success: false, error: 'Failed to delete category.' });
    }
  }
);

export default router;
