import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { isDbConnected } from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
import { NavigationItemModel } from '../models/NavigationItem';

const router = Router();

function requireNavigationDatabase(res: Response): boolean {
  if (isDbConnected()) return true;
  res.status(503).json({
    success: false,
    error: 'Navigation requires persistent MongoDB storage, which is currently unavailable.',
    code: 'DATABASE_UNAVAILABLE',
  });
  return false;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const nextValue = String(value).trim();
  return nextValue || undefined;
}

function serializeNavigationItem(item: Record<string, unknown> & { _id?: unknown }) {
  const { _id, __v, ...rest } = typeof item?.toObject === 'function' ? item.toObject() : item;
  const id = _id ? String(_id) : typeof item.id === 'string' ? item.id : '';
  return { ...rest, id };
}

function normalizeDestination(type: string, destination: unknown) {
  const nextDestination = typeof destination === 'string' ? destination.trim() : '';

  if (type === 'dropdown') {
    return '';
  }

  if (type === 'external') {
    if (!nextDestination) {
      throw new Error('External navigation items require a destination URL.');
    }
    if (!/^https?:\/\//i.test(nextDestination) && !nextDestination.startsWith('//')) {
      throw new Error('External links must begin with http://, https://, or //');
    }
    return nextDestination;
  }

  if (!nextDestination) {
    if (type === 'link' || type === 'category') {
      throw new Error('A destination is required for this navigation item.');
    }
    return '';
  }

  return nextDestination;
}

router.get('/', async (req: Request, res: Response) => {
  try {
    if (!requireNavigationDatabase(res)) return;

    const query: Record<string, unknown> = req.query.activeOnly === 'true' ? { isActive: true } : {};
    const items = await NavigationItemModel.find(query).sort({ parentId: 1, displayOrder: 1, createdAt: 1 }).lean();

    const normalizedItems = items.map((item) => serializeNavigationItem(item as Record<string, unknown> & { _id?: unknown }));
    const nestedItems = normalizedItems.filter((item) => !item.parentId || item.parentId === null || item.parentId === undefined);

    const childrenByParent = new Map<string, typeof normalizedItems>();
    for (const item of normalizedItems) {
      if (item.parentId) {
        const key = String(item.parentId);
        const current = childrenByParent.get(key) ?? [];
        current.push(item);
        childrenByParent.set(key, current);
      }
    }

    const response = nestedItems.map((item) => ({
      ...item,
      children: childrenByParent.get(item.id) ?? [],
    }));

    res.json({ success: true, data: response });
  } catch (error) {
    console.error('Navigation load failed:', error);
    res.status(500).json({ success: false, error: 'Failed to load navigation data.' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    if (!requireNavigationDatabase(res)) return;

    const item = await NavigationItemModel.findOne({
      _id: mongoose.isValidObjectId(req.params.id) ? req.params.id : undefined,
    }).lean();

    if (!item) {
      res.status(404).json({ success: false, error: 'Navigation item not found.' });
      return;
    }

    res.json({ success: true, data: serializeNavigationItem(item as Record<string, unknown> & { _id?: unknown }) });
  } catch (error) {
    console.error('Navigation detail load failed:', error);
    res.status(500).json({ success: false, error: 'Failed to load navigation item.' });
  }
});

router.post('/', requireAuth, requireRole(['admin', 'super_admin', 'catalog_manager']), async (req: Request, res: Response) => {
  try {
    if (!requireNavigationDatabase(res)) return;

    const { label, type, destination, parentId, displayOrder, isActive, image, description } = req.body;
    const normalizedLabel = typeof label === 'string' ? label.trim() : '';
    if (!normalizedLabel) {
      res.status(400).json({ success: false, error: 'Navigation label is required.' });
      return;
    }

    const normalizedType = typeof type === 'string' && ['link', 'dropdown', 'category', 'external'].includes(type) ? type : 'link';
    const normalizedDestination = normalizeDestination(normalizedType, destination);
    const normalizedParentId = normalizeOptionalString(parentId);

    if (normalizedParentId) {
      const parentItem = await NavigationItemModel.findById(normalizedParentId).lean();
      if (!parentItem || parentItem.type !== 'dropdown') {
        res.status(400).json({ success: false, error: 'Child navigation items must belong to a dropdown parent.' });
        return;
      }
    }

    const resolvedDisplayOrder =
      displayOrder === undefined
        ? (await NavigationItemModel.countDocuments({ parentId: normalizedParentId ?? null })) + 1
        : Number(displayOrder) || 1;

    const created = await NavigationItemModel.create({
      label: normalizedLabel,
      type: normalizedType,
      destination: normalizedDestination,
      parentId: normalizedParentId ?? null,
      displayOrder: resolvedDisplayOrder,
      isActive: isActive !== false,
      image: normalizeOptionalString(image) || '',
      description: normalizeOptionalString(description) || '',
    });

    res.status(201).json({ success: true, data: serializeNavigationItem(created as Record<string, unknown> & { _id?: unknown }), message: 'Navigation item created.' });
  } catch (error) {
    console.error('Navigation create failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create navigation item.',
    });
  }
});

router.put('/:id', requireAuth, requireRole(['admin', 'super_admin', 'catalog_manager']), async (req: Request, res: Response) => {
  try {
    if (!requireNavigationDatabase(res)) return;

    const item = await NavigationItemModel.findById(req.params.id);
    if (!item) {
      res.status(404).json({ success: false, error: 'Navigation item not found.' });
      return;
    }

    const { label, type, destination, parentId, displayOrder, isActive, image, description } = req.body;
    const nextType = typeof type === 'string' && ['link', 'dropdown', 'category', 'external'].includes(type) ? type : item.type;
    const nextLabel = typeof label === 'string' ? label.trim() : item.label;

    if (!nextLabel) {
      res.status(400).json({ success: false, error: 'Navigation label is required.' });
      return;
    }

    const nextParentId = parentId === undefined || parentId === '' || parentId === null ? null : String(parentId);
    if (nextParentId) {
      const parentItem = await NavigationItemModel.findById(nextParentId).lean();
      if (!parentItem || parentItem.type !== 'dropdown') {
        res.status(400).json({ success: false, error: 'Child navigation items must belong to a dropdown parent.' });
        return;
      }
    }

    const nextDestination = normalizeDestination(nextType, destination ?? item.destination);
    const updates: Record<string, unknown> = {
      label: nextLabel,
      type: nextType,
      destination: nextDestination,
      parentId: nextParentId,
      displayOrder: displayOrder === undefined ? item.displayOrder : Number(displayOrder) || item.displayOrder,
      isActive: isActive === undefined ? item.isActive : Boolean(isActive),
      image: image === undefined ? item.image || '' : normalizeOptionalString(image) || '',
      description: description === undefined ? item.description || '' : normalizeOptionalString(description) || '',
    };

    const updated = await NavigationItemModel.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
    if (!updated) {
      res.status(404).json({ success: false, error: 'Navigation item not found.' });
      return;
    }

    res.json({ success: true, data: serializeNavigationItem(updated as Record<string, unknown> & { _id?: unknown }), message: 'Navigation item updated.' });
  } catch (error) {
    console.error('Navigation update failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to update navigation item.',
    });
  }
});

router.delete('/:id', requireAuth, requireRole(['admin', 'super_admin', 'catalog_manager']), async (req: Request, res: Response) => {
  try {
    if (!requireNavigationDatabase(res)) return;

    const result = await NavigationItemModel.deleteMany({
      $or: [{ _id: req.params.id }, { parentId: req.params.id }],
    });

    if (!result.deletedCount) {
      res.status(404).json({ success: false, error: 'Navigation item not found.' });
      return;
    }

    res.json({ success: true, message: 'Navigation item removed.' });
  } catch (error) {
    console.error('Navigation delete failed:', error);
    res.status(500).json({ success: false, error: 'Failed to delete navigation item.' });
  }
});

export default router;
