import React, { useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import { addToast } from '../../features/toast/toastSlice';
import { Modal } from '../../components/modal/Modal';
import { ImageUploadField } from '../components/common/ImageUploadField';
import { ProductGalleryImage, ProductGalleryUploadField } from '../components/common/ProductGalleryUploadField';
import { formatBDT } from '../../utils/currency';
import { CategoryAttributeDefinition } from '../../utils/categoryAttributes';
import {
  Package,
  Plus,
  Search,
  Filter,
  Edit2,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Image as ImageIcon,
  DollarSign,
  Tag,
} from 'lucide-react';

interface ProductsAdminPageProps {
  products: any[];
  onRefresh: () => void;
  categories: any[];
}

export const ProductsAdminPage: React.FC<ProductsAdminPageProps> = ({
  products,
  onRefresh,
  categories,
}) => {
  const dispatch = useAppDispatch();
  const { token } = useAppSelector((state) => state.auth);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [stockFilter, setStockFilter] = useState<'all' | 'in_stock' | 'low_stock' | 'out_of_stock'>('all');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [brand, setBrand] = useState('Novara');
  const [category, setCategory] = useState(categories[0]?.name || 'Electronics');
  const [dynamicAttributesByCategory, setDynamicAttributesByCategory] = useState<Record<string, Record<string, unknown>>>({});
  const [price, setPrice] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [stock, setStock] = useState('25');
  const [lowStockThreshold, setLowStockThreshold] = useState('5');
  const [badge, setBadge] = useState('');
  const [primaryImageUrl, setPrimaryImageUrl] = useState('');
  const [galleryImages, setGalleryImages] = useState<ProductGalleryImage[]>([]);
  const [isPrimaryImageUploading, setIsPrimaryImageUploading] = useState(false);
  const [isGalleryUploading, setIsGalleryUploading] = useState(false);
  const [description, setDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const getCategoryKey = (item: any) => String(item?.id || item?.slug || item?.name || '');
  const selectedCategoryRecord = categories.find((item) =>
    item.name === category || item.slug === category || item.aliases?.includes(category)
  );
  const categoryKey = getCategoryKey(selectedCategoryRecord);
  const categoryAttributeDefinitions: CategoryAttributeDefinition[] =
    Array.isArray(selectedCategoryRecord?.productDetailAttributes)
      ? selectedCategoryRecord.productDetailAttributes.filter((attribute: CategoryAttributeDefinition) => attribute.isActive)
      : [];
  const dynamicValues = dynamicAttributesByCategory[categoryKey] || {};

  const updateDynamicValue = (key: string, value: unknown) => {
    setDynamicAttributesByCategory((current) => ({
      ...current,
      [categoryKey]: { ...(current[categoryKey] || {}), [key]: value },
    }));
  };

  const changeCategory = (nextCategory: string) => {
    const nextConfig = categories.find((item) =>
      item.name === nextCategory || item.slug === nextCategory || item.aliases?.includes(nextCategory)
    );
    const nextKey = getCategoryKey(nextConfig);
    setCategory(nextCategory);
    if (nextKey) {
      setDynamicAttributesByCategory((current) => {
        if (current[nextKey]) return current;
        const defaults = Object.fromEntries(
          (nextConfig?.productDetailAttributes || [])
            .filter((attribute: CategoryAttributeDefinition) => attribute.defaultValue !== undefined)
            .map((attribute: CategoryAttributeDefinition) => [attribute.key, attribute.defaultValue])
        );
        return { ...current, [nextKey]: defaults };
      });
    }
  };

  // Filter products
  const filteredProducts = products.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.brand && p.brand.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesCategory = selectedCategory === 'all' || p.category === selectedCategory;

    let matchesStock = true;
    const threshold = p.lowStockThreshold || 5;
    if (stockFilter === 'out_of_stock') matchesStock = p.stock === 0;
    else if (stockFilter === 'low_stock') matchesStock = p.stock > 0 && p.stock <= threshold;
    else if (stockFilter === 'in_stock') matchesStock = p.stock > threshold;

    return matchesSearch && matchesCategory && matchesStock;
  });

  const handleOpenCreateModal = () => {
    setEditingId(null);
    setName('');
    setSku(`NOV-${Math.floor(1000 + Math.random() * 9000)}`);
    setBrand('Novara');
    const initialCategory = categories[0]?.name || 'Electronics';
    setCategory(initialCategory);
    const initialCategoryItem = categories.find((item) => item.name === initialCategory);
    const initialCategoryKey = getCategoryKey(initialCategoryItem);
    const initialDefaults = Object.fromEntries(
      (initialCategoryItem?.productDetailAttributes || [])
        .filter((attribute: CategoryAttributeDefinition) => attribute.defaultValue !== undefined)
        .map((attribute: CategoryAttributeDefinition) => [attribute.key, attribute.defaultValue])
    );
    setDynamicAttributesByCategory(initialCategoryKey ? { [initialCategoryKey]: initialDefaults } : {});
    setPrice('49.99');
    setSalePrice('');
    setStock('20');
    setLowStockThreshold('5');
    setBadge('New');
    setPrimaryImageUrl('');
    setGalleryImages([]);
    setDescription('High-performance premium product designed for superior usability and long-lasting durability.');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (p: any) => {
    setEditingId(p.id);
    setName(p.name);
    setSku(p.sku);
    setBrand(p.brand || 'Novara');
    const productCategory = categories.find((item) =>
      item.name === p.category || item.slug === p.category || item.aliases?.includes(p.category)
    );
    setCategory(productCategory?.name || p.category);
    const productCategoryKey = getCategoryKey(productCategory);
    const storedDynamicAttributes = p.dynamicAttributes;
    const savedCategoryValues = productCategoryKey && storedDynamicAttributes?.[productCategoryKey]
      ? storedDynamicAttributes[productCategoryKey]
      : (storedDynamicAttributes && typeof storedDynamicAttributes === 'object'
        ? storedDynamicAttributes
        : {});
    const categoryDefaults = Object.fromEntries(
      (productCategory?.productDetailAttributes || [])
        .filter((attribute: CategoryAttributeDefinition) => attribute.defaultValue !== undefined)
        .map((attribute: CategoryAttributeDefinition) => [attribute.key, attribute.defaultValue])
    );
    setDynamicAttributesByCategory({
      ...(storedDynamicAttributes && typeof storedDynamicAttributes === 'object' && !Array.isArray(storedDynamicAttributes)
        ? storedDynamicAttributes
        : {}),
      ...(productCategoryKey
        ? { [productCategoryKey]: { ...categoryDefaults, ...savedCategoryValues } }
        : {}),
    });
    setPrice(p.price.toString());
    setSalePrice(p.salePrice ? p.salePrice.toString() : '');
    setStock(p.stock.toString());
    setLowStockThreshold((p.lowStockThreshold || 5).toString());
    setBadge(p.badge || '');
    const productImages: ProductGalleryImage[] = (Array.isArray(p.images) ? p.images : [])
      .map((image: unknown) => {
        if (typeof image === 'string') return { url: image };
        if (image && typeof image === 'object') {
          const imageRecord = image as Record<string, unknown>;
          if (typeof imageRecord.url !== 'string') return null;
          return {
            url: imageRecord.url,
            ...(typeof imageRecord.alt === 'string' ? { alt: imageRecord.alt } : {}),
            ...(typeof imageRecord.publicId === 'string' ? { publicId: imageRecord.publicId } : {}),
            isPrimary: imageRecord.isPrimary === true,
          };
        }
        return null;
      })
      .filter((image: ProductGalleryImage | null): image is ProductGalleryImage => Boolean(image?.url.trim()));
    const primaryIndex = Math.max(0, productImages.findIndex((image) => image.isPrimary));
    const primaryImage = productImages[primaryIndex];
    setPrimaryImageUrl(primaryImage?.url || '');
    setGalleryImages(
      productImages.filter((image, index) => index !== primaryIndex && image.url !== primaryImage?.url)
    );
    setDescription(p.description || '');
    setIsModalOpen(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !sku.trim() || !price) {
      dispatch(addToast({ type: 'warning', message: 'Name, SKU, and regular price are required' }));
      return;
    }
    if (!primaryImageUrl.trim()) {
      dispatch(addToast({ type: 'warning', message: 'Upload a primary product image before saving.' }));
      return;
    }
    if (isPrimaryImageUploading || isGalleryUploading) {
      dispatch(addToast({ type: 'warning', message: 'Wait for image uploads to finish before saving.' }));
      return;
    }
    const missingRequiredAttribute = categoryAttributeDefinitions.find((attribute) => {
      const value = dynamicValues[attribute.key];
      return attribute.required && (
        value === undefined ||
        value === null ||
        value === '' ||
        (typeof value === 'string' && !value.trim()) ||
        (Array.isArray(value) && value.length === 0)
      );
    });
    if (missingRequiredAttribute) {
      dispatch(addToast({
        type: 'warning',
        message: `${missingRequiredAttribute.label} is required for ${selectedCategoryRecord?.name || 'this category'}.`,
      }));
      return;
    }

    setIsSaving(true);
    try {
      const submittedDynamicAttributes = Object.fromEntries(
        categoryAttributeDefinitions.map((attribute) => [
          attribute.key,
          dynamicValues[attribute.key] ?? '',
        ])
      );
      const payload = {
        name: name.trim(),
        sku: sku.trim().toUpperCase(),
        brand: brand.trim(),
        category: category.trim(),
        dynamicAttributes: submittedDynamicAttributes,
        price: parseFloat(price),
        salePrice: salePrice ? parseFloat(salePrice) : undefined,
        stock: parseInt(stock, 10) || 0,
        lowStockThreshold: parseInt(lowStockThreshold, 10) || 5,
        badge: badge.trim() || undefined,
        description: description.trim(),
        images: [
          {
            url: primaryImageUrl.trim(),
            isPrimary: true,
          },
          ...galleryImages.map((image) => ({ ...image, isPrimary: false })),
        ],
      };

      const url = editingId ? `/api/products/${editingId}` : '/api/products';
      const method = editingId ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to save product');

      dispatch(
        addToast({
          type: 'success',
          title: editingId ? 'Catalog Updated' : 'Product Created',
          message: `${name} has been published to the catalog.`,
        })
      );

      setIsModalOpen(false);
      onRefresh();
    } catch (err: any) {
      dispatch(addToast({ type: 'error', message: err.message }));
    } finally {
      setIsSaving(false);
    }
  };

  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const handleDelete = (id: string, prodName: string) => {
    setDeleteTarget({ id, name: prodName });
  };

  const confirmDeleteAction = async () => {
    if (!deleteTarget) return;

    try {
      const res = await fetch(`/api/products/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        dispatch(addToast({ type: 'success', title: 'Deleted', message: `${deleteTarget.name} removed.` }));
        onRefresh();
      } else {
        throw new Error(data.error || 'Deletion failed');
      }
    } catch (err: any) {
      dispatch(addToast({ type: 'error', message: err.message }));
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Action Bar */}
      <div className="bg-white rounded-2xl p-4 border border-gray-200/80 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by title, SKU, brand..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-900 focus:outline-emerald-800 transition"
          />
        </div>

        {/* Filters & Add Button */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Category Dropdown */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-700 focus:outline-emerald-800 transition cursor-pointer"
          >
            <option value="all">All Categories ({products.length})</option>
            {categories.map((c) => (
              <option key={c.id || c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>

          {/* Stock Filter Dropdown */}
          <select
            value={stockFilter}
            onChange={(e) => setStockFilter(e.target.value as any)}
            className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs text-gray-700 focus:outline-emerald-800 transition cursor-pointer"
          >
            <option value="all">All Stock Statuses</option>
            <option value="in_stock">In Stock</option>
            <option value="low_stock">Low Stock (≤ threshold)</option>
            <option value="out_of_stock">Out of Stock (0)</option>
          </select>

          <button
            onClick={handleOpenCreateModal}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-800 hover:bg-emerald-900 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer ml-auto"
          >
            <Plus className="w-4 h-4" />
            <span>Add New Product</span>
          </button>
        </div>
      </div>

      {/* Products Table */}
      <div className="bg-white rounded-2xl border border-gray-200/80 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50/80 text-gray-500 uppercase tracking-wider font-semibold border-b border-gray-100">
              <tr>
                <th className="py-3 px-4">Product Info</th>
                <th className="py-3 px-3">SKU</th>
                <th className="py-3 px-3">Category</th>
                <th className="py-3 px-3">Price</th>
                <th className="py-3 px-3">Stock Units</th>
                <th className="py-3 px-3">Badge</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-gray-500">
                    <Package className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                    <p className="font-semibold text-gray-700">No products found</p>
                    <p className="text-[11px] text-gray-400">Try adjusting your search terms or filters.</p>
                  </td>
                </tr>
              ) : (
                filteredProducts.map((p) => {
                  const threshold = p.lowStockThreshold || 5;
                  const isOutOfStock = p.stock === 0;
                  const isLowStock = p.stock > 0 && p.stock <= threshold;

                  return (
                    <tr key={p.id} className="hover:bg-gray-50/60 transition group">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <img
                            src={p.images?.[0]?.url || 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&q=80'}
                            alt={p.name}
                            className="w-10 h-10 rounded-lg object-cover border border-gray-100 shrink-0 bg-gray-50"
                          />
                          <div className="min-w-0">
                            <div className="font-bold text-gray-900 group-hover:text-emerald-800 transition truncate max-w-xs">
                              {p.name}
                            </div>
                            <div className="text-[11px] text-gray-500">{p.brand || 'Novara'}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-3 font-mono font-semibold text-gray-700">{p.sku}</td>
                      <td className="py-3 px-3">
                        <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 text-[11px] font-medium">
                          {p.category}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <div className="font-bold text-gray-900">
                          {formatBDT(p.salePrice || p.price)}
                        </div>
                        {p.salePrice && (
                          <div className="text-[10px] text-gray-400 line-through">
                            {formatBDT(p.price)}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`font-bold ${
                              isOutOfStock
                                ? 'text-rose-600'
                                : isLowStock
                                ? 'text-amber-600'
                                : 'text-emerald-700'
                            }`}
                          >
                            {p.stock}
                          </span>
                          {isOutOfStock && (
                            <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-rose-100 text-rose-800">
                              Out
                            </span>
                          )}
                          {isLowStock && (
                            <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-100 text-amber-800">
                              Low
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        {p.badge ? (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px]">
                            {p.badge}
                          </span>
                        ) : (
                          <span className="text-gray-300">-</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleOpenEditModal(p)}
                            className="p-1.5 rounded-lg text-gray-600 hover:text-emerald-800 hover:bg-emerald-50 transition cursor-pointer"
                            title="Edit product"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(p.id, p.name)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                            title="Delete product"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: Add or Edit Product */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingId ? 'Edit Product Details' : 'Add New Product to Catalog'}
        description={editingId ? 'Update product pricing, inventory, and catalog visibility.' : 'Create a new product listing in your store catalog.'}
        maxWidth="2xl"
      >
        <form onSubmit={handleSaveProduct} className="admin-modal-form space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-gray-700 mb-1">Product Title *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Ergonomic Office Chair"
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs focus:ring-1 focus:ring-emerald-800 focus:outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">SKU (Stock Keeping Unit) *</label>
              <input
                type="text"
                required
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="e.g. NOV-8842"
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs font-mono uppercase focus:ring-1 focus:ring-emerald-800 focus:outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Brand</label>
              <input
                type="text"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="Novara"
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs focus:ring-1 focus:ring-emerald-800 focus:outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => changeCategory(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs focus:ring-1 focus:ring-emerald-800 focus:outline-hidden cursor-pointer bg-white"
              >
                {categories.map((c) => (
                  <option key={c.id || c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {categoryAttributeDefinitions.length > 0 && (
              <div className="sm:col-span-2 space-y-3 rounded-xl border border-gray-200 p-3">
                <div>
                  <h3 className="text-xs font-bold text-gray-900">Category Specifications</h3>
                  <p className="text-[11px] text-gray-500">Values are saved with this product and used on its detail page.</p>
                </div>
                {categoryAttributeDefinitions.map((attribute) => {
                  const value = dynamicValues[attribute.key] ?? '';
                  const baseInputClass = 'w-full px-3 py-2 border border-gray-300 rounded-xl text-xs focus:ring-1 focus:ring-emerald-800 focus:outline-hidden';
                  const selectOptions = attribute.options || [];
                  let field: React.ReactNode;
                  if (attribute.type === 'textarea') {
                    field = (
                      <textarea
                        rows={3}
                        required={attribute.required}
                        value={String(value)}
                        onChange={(event) => updateDynamicValue(attribute.key, event.target.value)}
                        placeholder={attribute.placeholder}
                        className={baseInputClass}
                      />
                    );
                  } else if (attribute.type === 'boolean') {
                    field = (
                      <select
                        required={attribute.required}
                        value={value === true ? 'true' : value === false ? 'false' : ''}
                        onChange={(event) => updateDynamicValue(
                          attribute.key,
                          event.target.value === '' ? '' : event.target.value === 'true'
                        )}
                        className={`${baseInputClass} bg-white`}
                      >
                        <option value="">Select</option>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </select>
                    );
                  } else if (attribute.type === 'select') {
                    field = (
                      <select
                        value={String(value)}
                        onChange={(event) => updateDynamicValue(attribute.key, event.target.value)}
                        className={`${baseInputClass} bg-white`}
                      >
                        <option value="">Select</option>
                        {selectOptions.map((option: string) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    );
                  } else if (attribute.type === 'multiselect') {
                    field = (
                      <select
                        multiple
                        required={attribute.required}
                        value={Array.isArray(value) ? value.map(String) : []}
                        onChange={(event) => updateDynamicValue(
                          attribute.key,
                          Array.from(event.currentTarget.selectedOptions, (option) => option.value)
                        )}
                        className={`${baseInputClass} min-h-20 bg-white`}
                      >
                        {selectOptions.map((option: string) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    );
                  } else {
                    const inputType = attribute.type === 'decimal' || attribute.type === 'number'
                      ? 'number'
                      : attribute.type === 'color' || attribute.type === 'date' || attribute.type === 'url' || attribute.type === 'email'
                        ? attribute.type
                        : 'text';
                    field = (
                      <input
                        type={inputType}
                        step={attribute.type === 'decimal' ? 'any' : attribute.type === 'number' ? '1' : undefined}
                        required={attribute.required}
                        value={String(value)}
                        onChange={(event) => updateDynamicValue(
                          attribute.key,
                          attribute.type === 'number' || attribute.type === 'decimal'
                            ? event.target.value
                            : event.target.value
                        )}
                        placeholder={attribute.placeholder}
                        className={baseInputClass}
                      />
                    );
                  }
                  return (
                    <div key={attribute.key}>
                      <label className="mb-1 block text-xs font-bold text-gray-700">
                        {attribute.label}{attribute.required ? ' *' : ''}
                      </label>
                      {field}
                      {attribute.helpText && <p className="mt-1 text-[11px] text-gray-500">{attribute.helpText}</p>}
                    </div>
                  );
                })}
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Badge (Optional)</label>
              <input
                type="text"
                value={badge}
                onChange={(e) => setBadge(e.target.value)}
                placeholder="e.g. Hot, -20%, New"
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs focus:ring-1 focus:ring-emerald-800 focus:outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Regular Price (৳) *</label>
              <input
                type="number"
                step="1"
                required
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="4999"
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs focus:ring-1 focus:ring-emerald-800 focus:outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Sale Price (৳) (Optional)</label>
              <input
                type="number"
                step="1"
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
                placeholder="3999"
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs focus:ring-1 focus:ring-emerald-800 focus:outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Initial Stock Units</label>
              <input
                type="number"
                min="0"
                value={stock}
                onChange={(e) => setStock(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs focus:ring-1 focus:ring-emerald-800 focus:outline-hidden"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">Low-Stock Alert Threshold</label>
              <input
                type="number"
                min="1"
                value={lowStockThreshold}
                onChange={(e) => setLowStockThreshold(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs focus:ring-1 focus:ring-emerald-800 focus:outline-hidden"
              />
            </div>

            <div className="sm:col-span-2">
              <ImageUploadField
                label="Primary Product Image"
                value={primaryImageUrl}
                onChange={setPrimaryImageUrl}
                folder="products"
                token={token}
                helperText="Upload the main image used for product listings and the product page."
                required
                showUrlInput={false}
                onUploadingChange={setIsPrimaryImageUploading}
              />
            </div>

            <ProductGalleryUploadField
              images={galleryImages}
              onChange={setGalleryImages}
              token={token}
              disabled={isSaving}
              onUploadingChange={setIsGalleryUploading}
              />

            <div className="sm:col-span-2">
              <label className="block text-xs font-bold text-gray-700 mb-1">Product Description</label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Enter customer-facing product specifications and warranty details..."
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs focus:ring-1 focus:ring-emerald-800 focus:outline-hidden"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-xl text-xs font-semibold hover:bg-gray-50 transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || isPrimaryImageUploading || isGalleryUploading}
              className="px-5 py-2 bg-emerald-800 hover:bg-emerald-900 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer flex items-center gap-1.5"
            >
              {isSaving && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              <span>{editingId ? 'Save Changes' : 'Create Product'}</span>
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation In-App Modal */}
      <Modal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Confirm Deletion"
        description={`Are you sure you want to delete "${deleteTarget?.name}" from the catalog? This action cannot be undone.`}
        maxWidth="sm"
      >
        <div className="flex justify-end gap-2 pt-4">
          <button
            type="button"
            onClick={() => setDeleteTarget(null)}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-xl text-xs font-semibold hover:bg-gray-50 transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirmDeleteAction}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer"
          >
            Delete Product
          </button>
        </div>
      </Modal>
    </div>
  );
};
