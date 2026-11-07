import React, { useState } from 'react';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import { addToast } from '../../features/toast/toastSlice';
import { Modal } from '../../components/modal/Modal';
import { ImageUploadField } from '../components/common/ImageUploadField';
import {
  CATEGORY_ATTRIBUTE_TYPES,
  CategoryAttributeDefinition,
  CategoryAttributeGroup,
} from '../../utils/categoryAttributes';
import {
  Layers,
  Plus,
  Edit2,
  Trash2,
  Tag,
  CheckCircle2,
  XCircle,
  Smartphone,
  Shirt,
  Home,
  Sparkles,
  Dumbbell,
  Gamepad2,
} from 'lucide-react';

interface CategoriesAdminPageProps {
  categories: any[];
  products: any[];
  onRefresh: () => void;
}

export const CategoriesAdminPage: React.FC<CategoriesAdminPageProps> = ({
  categories,
  products,
  onRefresh,
}) => {
  const dispatch = useAppDispatch();
  const { token } = useAppSelector((state) => state.auth);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [catName, setCatName] = useState('');
  const [catDescription, setCatDescription] = useState('');
  const [catIcon, setCatIcon] = useState('Tag');
  const [catImage, setCatImage] = useState('');
  const [catOrder, setCatOrder] = useState('1');
  const [catActive, setCatActive] = useState(true);
  const [detailAttributes, setDetailAttributes] = useState<CategoryAttributeDefinition[]>([]);
  const [detailGroups, setDetailGroups] = useState<CategoryAttributeGroup[]>([]);
  const [newGroupName, setNewGroupName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const createId = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

  const addDetailAttribute = () => {
    const id = createId('attribute');
    setDetailAttributes((current) => [
      ...current,
      {
        key: id,
        label: '',
        type: 'text',
        required: false,
        options: [],
        displayOrder: current.length + 1,
        isActive: true,
        showOnDetails: true,
        showInSpecifications: true,
        filterable: false,
        searchable: false,
      },
    ]);
  };

  const iconOptions = [
    { label: 'Smartphone / Tech', value: 'Smartphone', icon: Smartphone },
    { label: 'Shirt / Fashion', value: 'Shirt', icon: Shirt },
    { label: 'Home / Living', value: 'Home', icon: Home },
    { label: 'Sparkles / Beauty', value: 'Sparkles', icon: Sparkles },
    { label: 'Dumbbell / Sports', value: 'Dumbbell', icon: Dumbbell },
    { label: 'Gamepad / Toys', value: 'Gamepad2', icon: Gamepad2 },
    { label: 'Generic Tag', value: 'Tag', icon: Tag },
  ];

  const handleOpenCreateModal = () => {
    setEditingId(null);
    setCatName('');
    setCatDescription('');
    setCatIcon('Tag');
    setCatImage('');
    setCatOrder((categories.length + 1).toString());
    setCatActive(true);
    setDetailAttributes([]);
    setDetailGroups([]);
    setNewGroupName('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (c: any) => {
    setEditingId(c.id);
    setCatName(c.name);
    setCatDescription(c.description || '');
    setCatIcon(c.icon || 'Tag');
    setCatImage(c.image || '');
    setCatOrder((c.displayOrder || 1).toString());
    setCatActive(c.isActive !== false);
    setDetailAttributes(Array.isArray(c.productDetailAttributes) ? c.productDetailAttributes : []);
    setDetailGroups(Array.isArray(c.productDetailGroups) ? c.productDetailGroups : []);
    setNewGroupName('');
    setIsModalOpen(true);
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catName.trim()) {
      dispatch(addToast({ type: 'warning', message: 'Category name is required' }));
      return;
    }

    setIsSaving(true);
    try {
      const existingCategory = editingId ? categories.find((item) => item.id === editingId) : null;
      const shouldRemoveImage = Boolean(editingId && !catImage && existingCategory?.image);
      const payload = {
        name: catName.trim(),
        description: catDescription.trim(),
        icon: catIcon,
        image: catImage || '',
        removeImage: shouldRemoveImage,
        displayOrder: parseInt(catOrder, 10) || 1,
        isActive: catActive,
        productDetailAttributes: detailAttributes,
        productDetailGroups: detailGroups,
      };

      const url = editingId ? `/api/categories/${editingId}` : '/api/categories';
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
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to save category');

      dispatch(
        addToast({
          type: 'success',
          title: editingId ? 'Category Updated' : 'Category Created',
          message: `${catName} is available in storefront filters.`,
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

  const [deleteCategoryTarget, setDeleteCategoryTarget] = useState<{ id: string; name: string } | null>(null);

  const handleDeleteCategory = (id: string, name: string) => {
    setDeleteCategoryTarget({ id, name });
  };

  const confirmDeleteCategory = async () => {
    if (!deleteCategoryTarget) return;

    try {
      const res = await fetch(`/api/categories/${deleteCategoryTarget.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.success) {
        dispatch(addToast({ type: 'success', title: 'Deleted', message: `${deleteCategoryTarget.name} removed.` }));
        onRefresh();
      }
    } catch {
      dispatch(addToast({ type: 'error', message: 'Failed to delete category' }));
    } finally {
      setDeleteCategoryTarget(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Banner and Add Action */}
      <div className="bg-white rounded-2xl p-4 border border-gray-200/80 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-bold text-gray-900">Taxonomy Hierarchy & Navigation</h2>
          <p className="text-xs text-gray-500">
            Control the categories displayed on the ShopMax storefront homepage and filtering drawers.
          </p>
        </div>

        <button
          onClick={handleOpenCreateModal}
          className="flex items-center gap-1.5 px-4 py-2 bg-emerald-800 hover:bg-emerald-900 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer ml-auto sm:ml-0"
        >
          <Plus className="w-4 h-4" />
          <span>New Category</span>
        </button>
      </div>

      {/* Categories Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {categories.map((c) => {
          const productCount = products.filter((p) => p.category === c.name).length;
          const matchedIcon = iconOptions.find((i) => i.value === c.icon) || iconOptions[6];
          const IconComponent = matchedIcon.icon;
          const categoryImage = typeof c.image === 'string' && c.image.trim() ? c.image.trim() : '';

          return (
            <div
              key={c.id || c.name}
              className="bg-white rounded-2xl p-5 border border-gray-200/80 shadow-2xs hover:shadow-xs transition flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center border border-emerald-100 overflow-hidden">
                    {categoryImage ? (
                      <img
                        src={categoryImage}
                        alt={c.name}
                        className="w-full h-full object-cover"
                        onError={(event) => {
                          event.currentTarget.style.display = 'none';
                          const fallback = event.currentTarget.nextElementSibling as HTMLElement | null;
                          if (fallback) fallback.style.display = 'inline-flex';
                        }}
                      />
                    ) : null}
                    <span
                      className={categoryImage ? 'hidden' : 'inline-flex'}
                    >
                      <IconComponent className="w-5 h-5" />
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        c.isActive !== false
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {c.isActive !== false ? 'Active' : 'Disabled'}
                    </span>
                    <span className="text-[10px] font-mono font-bold text-gray-400 bg-gray-50 px-2 py-0.5 rounded border border-gray-100">
                      #{c.displayOrder || 1}
                    </span>
                  </div>
                </div>

                <h3 className="text-base font-bold text-gray-900">{c.name}</h3>
                <div className="text-xs text-gray-500 font-mono mt-0.5">slug: {c.slug}</div>

                <div className="mt-3 py-2 px-3 rounded-xl bg-gray-50 border border-gray-100 text-xs text-gray-600 flex items-center justify-between">
                  <span>Assigned Products:</span>
                  <span className="font-bold text-gray-900">{productCount} items</span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 mt-4 border-t border-gray-100">
                <button
                  onClick={() => handleOpenEditModal(c)}
                  className="px-3 py-1.5 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 font-semibold text-xs transition cursor-pointer flex items-center gap-1"
                >
                  <Edit2 className="w-3.5 h-3.5 text-gray-500" />
                  <span>Edit</span>
                </button>
                <button
                  onClick={() => handleDeleteCategory(c.id, c.name)}
                  className="p-1.5 rounded-xl text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                  title="Delete category"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingId ? 'Edit Category' : 'Create Store Category'}
        description="Organize your storefront navigation and product taxonomy."
      >
        <form onSubmit={handleSaveCategory} className="admin-modal-form space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">Category Title *</label>
            <input
              type="text"
              required
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
              placeholder="e.g. Health & Wellness"
              className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs focus:ring-1 focus:ring-emerald-800"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">Category Description</label>
            <textarea
              value={catDescription}
              onChange={(e) => setCatDescription(e.target.value)}
              rows={3}
              placeholder="Optional summary shown on category browsing and storefront contexts."
              className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs focus:ring-1 focus:ring-emerald-800 resize-none"
            />
          </div>

          <ImageUploadField
            value={catImage}
            onChange={setCatImage}
            label="Category Image (Optional)"
            folder="categories"
            helperText="Upload a JPG, PNG, or WebP image to replace the default category icon."
            token={token}
            showUrlInput={false}
          />

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">Associated Visual Icon</label>
            <select
              value={catIcon}
              onChange={(e) => setCatIcon(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs focus:ring-1 focus:ring-emerald-800 cursor-pointer bg-white"
            >
              {iconOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <section className="space-y-3 rounded-xl border border-gray-200 p-3">
            <div>
              <h3 className="text-xs font-bold text-gray-900">Product Details Fields</h3>
              <p className="mt-1 text-[11px] text-gray-500">
                Configure category-specific fields shown while creating products and on product detail pages.
                Deactivate fields with saved values; deleting those fields is blocked to protect product history.
              </p>
            </div>

            <div className="space-y-2">
              <label className="block text-[11px] font-bold text-gray-700">Specification groups</label>
              {detailGroups.map((group, index) => (
                <div key={group.id} className="flex items-center gap-2">
                  <input
                    value={group.name}
                    onChange={(event) => setDetailGroups((current) => current.map((item) =>
                      item.id === group.id ? { ...item, name: event.target.value } : item
                    ))}
                    aria-label="Group name"
                    className="min-w-0 flex-1 px-2.5 py-2 border border-gray-300 rounded-lg text-xs"
                  />
                  <input
                    type="number"
                    min="0"
                    value={group.displayOrder}
                    onChange={(event) => setDetailGroups((current) => current.map((item) =>
                      item.id === group.id ? { ...item, displayOrder: Number(event.target.value) } : item
                    ))}
                    aria-label="Group display order"
                    className="w-16 px-2 py-2 border border-gray-300 rounded-lg text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setDetailGroups((current) => current.filter((item) => item.id !== group.id))}
                    disabled={detailAttributes.some((attribute) => attribute.groupId === group.id)}
                    title={detailAttributes.some((attribute) => attribute.groupId === group.id)
                      ? 'Move assigned fields to another group before removing this group.'
                      : 'Remove group'}
                    className="px-2 py-2 text-xs font-semibold text-rose-600 disabled:text-gray-300"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <input
                  value={newGroupName}
                  onChange={(event) => setNewGroupName(event.target.value)}
                  placeholder="Add a group, e.g. Display"
                  className="min-w-0 flex-1 px-2.5 py-2 border border-gray-300 rounded-lg text-xs"
                />
                <button
                  type="button"
                  disabled={!newGroupName.trim()}
                  onClick={() => {
                    setDetailGroups((current) => [
                      ...current,
                      {
                        id: createId('group'),
                        name: newGroupName.trim(),
                        displayOrder: current.length + 1,
                        isActive: true,
                      },
                    ]);
                    setNewGroupName('');
                  }}
                  className="px-3 py-2 rounded-lg bg-gray-100 text-xs font-bold text-gray-700 disabled:opacity-50"
                >
                  Add Group
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {detailAttributes.map((attribute, index) => (
                <div key={attribute.key || index} className="space-y-2 rounded-lg bg-gray-50 p-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      value={attribute.label}
                      onChange={(event) => setDetailAttributes((current) => current.map((item) =>
                        item.key === attribute.key ? { ...item, label: event.target.value } : item
                      ))}
                      placeholder="Attribute label"
                      aria-label="Attribute label"
                      className="px-2.5 py-2 border border-gray-300 rounded-lg text-xs"
                    />
                    <input
                      value={attribute.key}
                      onChange={(event) => setDetailAttributes((current) => current.map((item) =>
                        item.key === attribute.key
                          ? { ...item, key: event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-') }
                          : item
                      ))}
                      placeholder="stable-key"
                      aria-label="Attribute key"
                      className="px-2.5 py-2 border border-gray-300 rounded-lg text-xs font-mono"
                    />
                    <select
                      value={attribute.type}
                      onChange={(event) => setDetailAttributes((current) => current.map((item) =>
                        item.key === attribute.key
                          ? { ...item, type: event.target.value as CategoryAttributeDefinition['type'] }
                          : item
                      ))}
                      aria-label="Attribute type"
                      className="px-2.5 py-2 border border-gray-300 rounded-lg text-xs bg-white"
                    >
                      {CATEGORY_ATTRIBUTE_TYPES.map((type) => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                    <select
                      value={attribute.groupId || ''}
                      onChange={(event) => setDetailAttributes((current) => current.map((item) =>
                        item.key === attribute.key
                          ? { ...item, groupId: event.target.value || undefined }
                          : item
                      ))}
                      aria-label="Specification group"
                      className="px-2.5 py-2 border border-gray-300 rounded-lg text-xs bg-white"
                    >
                      <option value="">Ungrouped</option>
                      {detailGroups.map((group) => (
                        <option key={group.id} value={group.id}>{group.name}</option>
                      ))}
                    </select>
                    <input
                      value={attribute.placeholder || ''}
                      onChange={(event) => setDetailAttributes((current) => current.map((item) =>
                        item.key === attribute.key ? { ...item, placeholder: event.target.value } : item
                      ))}
                      placeholder="Placeholder"
                      aria-label="Placeholder"
                      className="px-2.5 py-2 border border-gray-300 rounded-lg text-xs"
                    />
                    <input
                      value={attribute.helpText || ''}
                      onChange={(event) => setDetailAttributes((current) => current.map((item) =>
                        item.key === attribute.key ? { ...item, helpText: event.target.value } : item
                      ))}
                      placeholder="Help text"
                      aria-label="Help text"
                      className="px-2.5 py-2 border border-gray-300 rounded-lg text-xs"
                    />
                    {(attribute.type === 'select' || attribute.type === 'multiselect') && (
                      <input
                        value={attribute.options.join(', ')}
                        onChange={(event) => setDetailAttributes((current) => current.map((item) =>
                          item.key === attribute.key
                            ? { ...item, options: event.target.value.split(',').map((option) => option.trim()).filter(Boolean) }
                            : item
                        ))}
                        placeholder="Options, comma separated"
                        aria-label="Select options"
                        className="px-2.5 py-2 border border-gray-300 rounded-lg text-xs sm:col-span-2"
                      />
                    )}
                    <input
                      value={Array.isArray(attribute.defaultValue)
                        ? attribute.defaultValue.join(', ')
                        : typeof attribute.defaultValue === 'string' || typeof attribute.defaultValue === 'number' ||
                            typeof attribute.defaultValue === 'boolean'
                          ? String(attribute.defaultValue)
                          : ''}
                      onChange={(event) => setDetailAttributes((current) => current.map((item) =>
                        item.key === attribute.key
                          ? {
                              ...item,
                              defaultValue: item.type === 'multiselect'
                                ? event.target.value.split(',').map((option) => option.trim()).filter(Boolean)
                                : event.target.value,
                            }
                          : item
                      ))}
                      placeholder={attribute.type === 'multiselect'
                        ? 'Default options, comma separated'
                        : 'Default value (optional)'}
                      aria-label="Default value"
                      className="px-2.5 py-2 border border-gray-300 rounded-lg text-xs"
                    />
                    <input
                      type="number"
                      min="0"
                      value={attribute.displayOrder}
                      onChange={(event) => setDetailAttributes((current) => current.map((item) =>
                        item.key === attribute.key ? { ...item, displayOrder: Number(event.target.value) } : item
                      ))}
                      aria-label="Attribute display order"
                      className="px-2.5 py-2 border border-gray-300 rounded-lg text-xs"
                    />
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-gray-600">
                    {([
                      ['required', 'Required'],
                      ['isActive', 'Active'],
                      ['showOnDetails', 'Show on details'],
                      ['showInSpecifications', 'Show in specifications'],
                      ['filterable', 'Filterable'],
                      ['searchable', 'Searchable'],
                    ] as const).map(([field, label]) => (
                      <label key={field} className="inline-flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={attribute[field]}
                          onChange={(event) => setDetailAttributes((current) => current.map((item) =>
                            item.key === attribute.key ? { ...item, [field]: event.target.checked } : item
                          ))}
                        />
                        {label}
                      </label>
                    ))}
                    <button
                      type="button"
                      onClick={() => setDetailAttributes((current) => current.filter((item) => item.key !== attribute.key))}
                      className="ml-auto font-semibold text-rose-600"
                    >
                      Delete field
                    </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={addDetailAttribute}
                className="w-full rounded-lg border border-dashed border-gray-300 py-2 text-xs font-bold text-emerald-800"
              >
                Add Product Field
              </button>
            </div>
          </section>

          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">Display Sort Order</label>
            <input
              type="number"
              min="1"
              value={catOrder}
              onChange={(e) => setCatOrder(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-xl text-xs focus:ring-1 focus:ring-emerald-800"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="catActiveCheckbox"
              checked={catActive}
              onChange={(e) => setCatActive(e.target.checked)}
              className="w-4 h-4 text-emerald-800 rounded border-gray-300 cursor-pointer"
            />
            <label htmlFor="catActiveCheckbox" className="text-xs font-semibold text-gray-700 cursor-pointer">
              Active on customer navigation bar and category grid
            </label>
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
              disabled={isSaving}
              className="px-5 py-2 bg-emerald-800 hover:bg-emerald-900 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer flex items-center gap-1.5"
            >
              {isSaving && <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              <span>{editingId ? 'Save Changes' : 'Create Category'}</span>
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Category In-App Confirmation Modal */}
      <Modal
        isOpen={!!deleteCategoryTarget}
        onClose={() => setDeleteCategoryTarget(null)}
        title="Confirm Category Deletion"
        description={`Are you sure you want to delete category "${deleteCategoryTarget?.name}"? Existing products may need reassignment.`}
        maxWidth="sm"
      >
        <div className="flex justify-end gap-2 pt-4">
          <button
            type="button"
            onClick={() => setDeleteCategoryTarget(null)}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-xl text-xs font-semibold hover:bg-gray-50 transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirmDeleteCategory}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold transition shadow-xs cursor-pointer"
          >
            Delete Category
          </button>
        </div>
      </Modal>
    </div>
  );
};
