import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { ArticleModel } from '../models/Article';
import { requireAuth, requireRole } from '../middleware/auth';
import { isDbConnected } from '../db';

const router = Router();
const BLOG_STAFF_ROLES = ['super_admin', 'admin', 'catalog_manager'] as const;

function requireDatabase(res: Response): boolean {
  if (isDbConnected()) return true;
  res.status(503).json({
    success: false,
    error: 'Blog content requires persistent MongoDB storage, which is currently unavailable.',
    code: 'DATABASE_UNAVAILABLE',
  });
  return false;
}

function serializeArticle(article: any) {
  return {
    ...article,
    id: article._id ? article._id.toString() : article.id,
    _id: undefined,
    __v: undefined,
  };
}

function normalizeContent(content: unknown): string {
  if (Array.isArray(content)) {
    return content.map((paragraph) => String(paragraph).trim()).filter(Boolean).join('\n\n');
  }
  return typeof content === 'string' ? content.trim() : '';
}

function normalizeTags(tags: unknown): string[] {
  const values = Array.isArray(tags) ? tags : String(tags || '').split(',');
  return values.map((tag) => String(tag).trim()).filter(Boolean);
}

function articleFilter(id: string) {
  return mongoose.isValidObjectId(id) ? { _id: id } : { slug: id };
}

router.get('/', async (req: Request, res: Response) => {
  try {
    if (!requireDatabase(res)) return;
    const { category, tag, search, featured } = req.query;
    const query: Record<string, any> = {};

    if (category && category !== 'all') {
      query.category = { $regex: new RegExp(`^${String(category)}$`, 'i') };
    }
    if (tag) query.tags = tag;
    if (featured === 'true') query.featured = true;
    if (search) {
      const term = String(search).trim();
      query.$or = [
        { title: { $regex: term, $options: 'i' } },
        { excerpt: { $regex: term, $options: 'i' } },
        { tags: { $regex: term, $options: 'i' } },
      ];
    }

    const articles = await ArticleModel.find(query).sort({ publishedAt: -1 }).lean();
    const data = articles.map(serializeArticle);
    res.json({ success: true, data, count: data.length });
  } catch (err) {
    console.error('[Blog List Error]', err);
    res.status(500).json({ success: false, error: 'Failed to fetch articles' });
  }
});

router.get('/:slug', async (req: Request, res: Response) => {
  try {
    if (!requireDatabase(res)) return;
    const article = await ArticleModel.findOneAndUpdate(
      { slug: req.params.slug },
      { $inc: { viewsCount: 1 } },
      { returnDocument: 'after' }
    ).lean();

    if (!article) {
      res.status(404).json({ success: false, error: 'Article not found' });
      return;
    }

    const related = await ArticleModel.find({
      slug: { $ne: article.slug },
      category: article.category,
    })
      .sort({ publishedAt: -1 })
      .limit(3)
      .lean();

    res.json({
      success: true,
      data: serializeArticle(article),
      related: related.map(serializeArticle),
    });
  } catch (err) {
    console.error('[Blog Single Error]', err);
    res.status(500).json({ success: false, error: 'Failed to fetch article details' });
  }
});

router.post(
  '/',
  requireAuth,
  requireRole([...BLOG_STAFF_ROLES]),
  async (req: Request, res: Response) => {
    try {
      if (!requireDatabase(res)) return;
      const {
        title,
        slug: requestedSlug,
        excerpt,
        content,
        coverImage,
        category,
        readTimeMinutes = 5,
        featured = false,
        tags = [],
        author,
        authorName,
      } = req.body || {};
      const normalizedTitle = typeof title === 'string' ? title.trim() : '';
      const normalizedExcerpt = typeof excerpt === 'string' ? excerpt.trim() : '';
      const normalizedContent = normalizeContent(content);
      const normalizedCoverImage = typeof coverImage === 'string' ? coverImage.trim() : '';
      const normalizedCategory = typeof category === 'string' ? category.trim() : '';

      if (!normalizedTitle || !normalizedExcerpt || !normalizedContent || !normalizedCoverImage || !normalizedCategory) {
        res.status(400).json({
          success: false,
          error: 'Title, excerpt, article content, cover image, and category are required.',
        });
        return;
      }

      const baseSlug = String(requestedSlug || normalizedTitle)
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || `article-${Date.now()}`;
      let slug = baseSlug;
      let suffix = 1;
      while (await ArticleModel.exists({ slug })) {
        slug = `${baseSlug}-${suffix++}`;
      }

      const created = await ArticleModel.create({
        title: normalizedTitle,
        slug,
        excerpt: normalizedExcerpt,
        content: normalizedContent,
        coverImage: normalizedCoverImage,
        category: normalizedCategory,
        author: {
          name: String(author?.name || authorName || (req as any).user?.name || 'Editorial Staff').trim(),
          role: String(author?.role || 'Editorial Staff').trim(),
          ...(author?.avatar ? { avatar: String(author.avatar).trim() } : {}),
        },
        readTimeMinutes: Math.max(1, Number(readTimeMinutes) || 5),
        featured: Boolean(featured),
        tags: normalizeTags(tags),
      });

      res.status(201).json({
        success: true,
        message: 'Article published to storefront blog.',
        data: serializeArticle(created.toObject()),
      });
    } catch (err) {
      console.error('[Blog Create Error]', err);
      res.status(500).json({ success: false, error: 'Failed to create article' });
    }
  }
);

router.put(
  '/:id',
  requireAuth,
  requireRole([...BLOG_STAFF_ROLES]),
  async (req: Request, res: Response) => {
    try {
      if (!requireDatabase(res)) return;
      const updates = req.body || {};
      const $set: Record<string, any> = {};

      if (updates.title !== undefined) $set.title = String(updates.title).trim();
      if (updates.excerpt !== undefined) $set.excerpt = String(updates.excerpt).trim();
      if (updates.content !== undefined) $set.content = normalizeContent(updates.content);
      if (updates.coverImage !== undefined) $set.coverImage = String(updates.coverImage).trim();
      if (updates.category !== undefined) $set.category = String(updates.category).trim();
      if (updates.readTimeMinutes !== undefined) {
        $set.readTimeMinutes = Math.max(1, Number(updates.readTimeMinutes) || 5);
      }
      if (updates.featured !== undefined) $set.featured = Boolean(updates.featured);
      if (updates.tags !== undefined) $set.tags = normalizeTags(updates.tags);
      if (updates.author !== undefined) {
        $set.author = {
          name: String(updates.author?.name || '').trim(),
          role: String(updates.author?.role || 'Editorial Staff').trim(),
          ...(updates.author?.avatar ? { avatar: String(updates.author.avatar).trim() } : {}),
        };
      }

      const article = await ArticleModel.findOneAndUpdate(
        articleFilter(req.params.id),
        { $set },
        { new: true, runValidators: true }
      ).lean();

      if (!article) {
        res.status(404).json({ success: false, error: 'Article not found' });
        return;
      }

      res.json({
        success: true,
        message: 'Article updated successfully.',
        data: serializeArticle(article),
      });
    } catch (err) {
      console.error('[Blog Update Error]', err);
      res.status(500).json({ success: false, error: 'Failed to update article' });
    }
  }
);

router.delete(
  '/:id',
  requireAuth,
  requireRole([...BLOG_STAFF_ROLES]),
  async (req: Request, res: Response) => {
    try {
      if (!requireDatabase(res)) return;
      const article = await ArticleModel.findOneAndDelete(articleFilter(req.params.id));
      if (!article) {
        res.status(404).json({ success: false, error: 'Article not found' });
        return;
      }

      res.json({ success: true, message: 'Article removed from storefront blog.' });
    } catch (err) {
      console.error('[Blog Delete Error]', err);
      res.status(500).json({ success: false, error: 'Failed to delete article' });
    }
  }
);

export default router;
