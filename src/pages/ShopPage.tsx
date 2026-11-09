import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ProductCard } from '../components/ui/ProductCard';
import { SeedProduct } from '../../server/data/initialData';
import { Filter, SlidersHorizontal, ArrowUpDown, X, Tag } from 'lucide-react';
import { useDelayedSkeleton } from '../hooks/useDelayedSkeleton';
import { ShopSkeleton } from '../components/skeletons/ShopSkeleton';
import { formatBDT } from '../utils/currency';
import { ProductCardSkeleton } from '../components/skeletons/ProductCardSkeleton';

const PRODUCT_PAGE_SIZE = 20;

interface ShopPageProps {
  initialCategory?: string;
  initialQuery?: string;
  onViewProduct: (slug: string) => void;
}

export const ShopPage: React.FC<ShopPageProps> = ({
  initialCategory,
  initialQuery,
  onViewProduct,
}) => {
  const [products, setProducts] = useState<SeedProduct[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [brandOptions, setBrandOptions] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>(initialCategory || 'all');
  const [selectedBrand, setSelectedBrand] = useState<string>('all');
  const [priceRange, setPriceRange] = useState<number>(100000);
  const [sortOption, setSortOption] = useState<string>('popular');
  const [searchQuery, setSearchQuery] = useState<string>(initialQuery || '');
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [hasNextPage, setHasNextPage] = useState<boolean>(false);
  const [initialError, setInitialError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [retryInitial, setRetryInitial] = useState<number>(0);
  const [mobileFilterOpen, setMobileFilterOpen] = useState<boolean>(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef<number>(0);
  const activeControllerRef = useRef<AbortController | null>(null);
  const nextPageRef = useRef<number>(2);
  const loadingMoreRef = useRef<boolean>(false);

  const normalizeCategoryKey = (value?: string) =>
    (value || '')
      .trim()
      .toLowerCase()
      .replace(/[-_]+/g, ' ')
      .replace(/&/g, ' and ')
      .replace(/\s+/g, ' ');

  const getActiveCategory = (list = categories) => {
    if (selectedCategory === 'all') return null;
    return list.find((category) => {
      const normalizedCategory = normalizeCategoryKey(category.slug || category.name);
      const normalizedSelected = normalizeCategoryKey(selectedCategory);
      return normalizedCategory === normalizedSelected;
    }) || null;
  };

  const selectedCategoryDisplay = getActiveCategory()?.name || (selectedCategory === 'all' ? 'All Categories' : selectedCategory);

  useEffect(() => {
    if (initialCategory !== undefined) setSelectedCategory(initialCategory);
    if (initialQuery !== undefined) setSearchQuery(initialQuery);
  }, [initialCategory, initialQuery]);

  useEffect(() => {
    const controller = new AbortController();
    let isMounted = true;
    async function fetchCategories() {
      try {
        const catRes = await fetch('/api/categories', { signal: controller.signal });
        if (!catRes.ok) throw new Error(`Could not load categories (${catRes.status}).`);
        const catData = await catRes.json();
        if (!catData.success || !Array.isArray(catData.data)) {
          throw new Error(catData.error || 'Could not load categories.');
        }
        if (isMounted) setCategories(catData.data);
      } catch (err) {
        if (!controller.signal.aborted) console.error('Error loading shop categories', err);
      }
    }
    void fetchCategories();
    return () => {
      isMounted = false;
      controller.abort();
    };
  }, []);

  const buildProductsUrl = (page: number) => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(PRODUCT_PAGE_SIZE),
      sort: sortOption,
    });
    if (selectedCategory !== 'all') params.set('category', selectedCategory);
    if (selectedBrand !== 'all') params.set('brand', selectedBrand);
    params.set('effectiveMaxPrice', String(priceRange));
    if (searchQuery.trim()) {
      params.set('q', searchQuery.trim());
      return `/api/products/search?${params.toString()}`;
    }
    return `/api/products?${params.toString()}`;
  };

  useEffect(() => {
    const controller = new AbortController();
    const requestId = ++requestIdRef.current;
    activeControllerRef.current = controller;
    nextPageRef.current = 2;
    loadingMoreRef.current = false;
    setProducts([]);
    setBrandOptions([]);
    setHasNextPage(false);
    setLoading(true);
    setLoadingMore(false);
    setInitialError(null);
    setLoadMoreError(null);

    async function fetchFirstPage() {
      try {
        const response = await fetch(buildProductsUrl(1), { signal: controller.signal });
        if (!response.ok) throw new Error(`Could not load products (${response.status}).`);
        const result = await response.json();
        if (!result.success || !Array.isArray(result.data)) {
          throw new Error(result.error || 'The product response was invalid.');
        }
        if (controller.signal.aborted || requestId !== requestIdRef.current) return;

        const firstPage = result.data as SeedProduct[];
        setProducts(firstPage);
        setBrandOptions(Array.isArray(result.brands)
          ? result.brands.filter((brand: unknown): brand is string => typeof brand === 'string')
          : [...new Set(firstPage.map((product) => product.brand).filter(Boolean))]);
        setHasNextPage(typeof result.pagination?.hasNextPage === 'boolean'
          ? result.pagination.hasNextPage
          : firstPage.length === PRODUCT_PAGE_SIZE);
      } catch (err) {
        if (!controller.signal.aborted && requestId === requestIdRef.current) {
          setInitialError(err instanceof Error ? err.message : 'Could not load products.');
          console.error('Error loading shop products', err);
        }
      } finally {
        if (!controller.signal.aborted && requestId === requestIdRef.current) setLoading(false);
      }
    }

    void fetchFirstPage();
    return () => {
      controller.abort();
      if (requestId === requestIdRef.current) requestIdRef.current += 1;
    };
  }, [selectedCategory, selectedBrand, sortOption, priceRange, searchQuery, retryInitial]);

  const loadMore = useCallback(async () => {
    if (!hasNextPage || loading || loadingMoreRef.current) return;
    const controller = activeControllerRef.current;
    const requestId = requestIdRef.current;
    if (!controller || controller.signal.aborted) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(null);
    const page = nextPageRef.current;

    try {
      const response = await fetch(buildProductsUrl(page), { signal: controller.signal });
      if (!response.ok) throw new Error(`Could not load more products (${response.status}).`);
      const result = await response.json();
      if (!result.success || !Array.isArray(result.data)) {
        throw new Error(result.error || 'The product response was invalid.');
      }
      if (controller.signal.aborted || requestId !== requestIdRef.current) return;

      const nextProducts = result.data as SeedProduct[];
      setProducts((current) => {
        const existingIds = new Set(current.map((product) => product.id));
        const uniqueProducts = nextProducts.filter((product) => {
          if (existingIds.has(product.id)) return false;
          existingIds.add(product.id);
          return true;
        });
        return [...current, ...uniqueProducts];
      });
      nextPageRef.current = page + 1;
      setHasNextPage(typeof result.pagination?.hasNextPage === 'boolean'
        ? result.pagination.hasNextPage
        : nextProducts.length === PRODUCT_PAGE_SIZE);
    } catch (err) {
      if (!controller.signal.aborted && requestId === requestIdRef.current) {
        setLoadMoreError(err instanceof Error ? err.message : 'Could not load more products.');
        console.error('Error loading more shop products', err);
      }
    } finally {
      if (requestId === requestIdRef.current) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [hasNextPage, loading, selectedCategory, selectedBrand, sortOption, priceRange, searchQuery]);

  useEffect(() => {
    if (!hasNextPage || loading || loadingMore || loadMoreError || !sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMore();
      },
      { rootMargin: '500px 0px' }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasNextPage, loading, loadingMore, loadMoreError, loadMore]);

  const brands = brandOptions;

  const handleClearFilters = () => {
    setSelectedCategory('all');
    setSelectedBrand('all');
    setPriceRange(100000);
    setSearchQuery('');
    setSortOption('popular');
  };

  const showSkeleton = useDelayedSkeleton(loading);

  if (loading) {
    if (showSkeleton) {
      return <ShopSkeleton />;
    }
    return <div className="min-h-[60vh] w-full bg-white" aria-live="polite" aria-busy="true" />;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      {/* Header & Breadcrumb */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-gray-100 gap-4">
        <div>
          <div className="text-xs text-gray-400 font-medium mb-1">
            Home / Shop {selectedCategory !== 'all' ? `/ ${selectedCategoryDisplay}` : ''}
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
            {searchQuery ? `Results for "${searchQuery}"` : selectedCategory !== 'all' ? selectedCategoryDisplay : 'All Products'}
          </h1>
          <p className="text-xs text-gray-500 mt-1">
            Showing {products.length} {products.length === 1 ? 'item' : 'items'}
          </p>
        </div>

        {/* Sorting & Mobile Filter Toggle */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setMobileFilterOpen(!mobileFilterOpen)}
            className="md:hidden flex items-center gap-1.5 px-3.5 py-2 border border-gray-200 rounded-xl text-xs font-semibold text-gray-700 hover:bg-gray-50 transition"
          >
            <Filter className="w-3.5 h-3.5 text-emerald-800" />
            <span>Filters</span>
          </button>

          <div className="flex items-center gap-2">
            <ArrowUpDown className="w-4 h-4 text-gray-400" />
            <select
              value={sortOption}
              onChange={(e) => setSortOption(e.target.value)}
              className="text-xs font-semibold bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-emerald-700 cursor-pointer"
            >
              <option value="popular">Most Popular</option>
              <option value="rating">Highest Rated</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-8 pt-8">
        {/* Desktop Filter Sidebar */}
        <aside className={`md:block ${mobileFilterOpen ? 'block' : 'hidden'} md:col-span-1 space-y-6`}>
          <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-2xs space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-gray-900">
                <SlidersHorizontal className="w-4 h-4 text-emerald-800" />
                <span>Filters</span>
              </div>
              <button
                onClick={handleClearFilters}
                className="text-xs font-semibold text-emerald-800 hover:underline cursor-pointer"
              >
                Clear All
              </button>
            </div>

            {/* Category Filter */}
            <div>
              <label className="text-xs font-bold text-gray-700 uppercase tracking-wider block mb-2.5">
                Category
              </label>
              <div className="space-y-1.5">
                <button
                  onClick={() => setSelectedCategory('all')}
                  className={`block w-full text-left text-xs py-1.5 px-2.5 rounded-lg transition ${
                    selectedCategory === 'all'
                      ? 'bg-emerald-800 text-white font-semibold'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  All Categories
                </button>
                {categories.map((c) => (
                  <button
                    key={c.slug}
                    onClick={() => setSelectedCategory(c.slug || c.name)}
                    className={`block w-full text-left text-xs py-1.5 px-2.5 rounded-lg transition ${
                      normalizeCategoryKey(selectedCategory) === normalizeCategoryKey(c.slug || c.name)
                        ? 'bg-emerald-800 text-white font-semibold'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Price Range Slider */}
            <div>
              <div className="flex justify-between items-center text-xs font-bold text-gray-700 mb-2">
                <span className="uppercase tracking-wider">Max Price</span>
                <span className="text-emerald-900 font-extrabold">{formatBDT(priceRange)}</span>
              </div>
              <input
                type="range"
                min="500"
                max="100000"
                step="500"
                value={priceRange}
                onChange={(e) => setPriceRange(parseFloat(e.target.value))}
                className="w-full accent-emerald-800 cursor-pointer"
              />
              <div className="flex justify-between text-[11px] text-gray-400 mt-1">
                <span>{formatBDT(500)}</span>
                <span>{formatBDT(100000)}</span>
              </div>
            </div>

            {/* Brands */}
            {brands.length > 0 && (
              <div>
                <label className="text-xs font-bold text-gray-700 uppercase tracking-wider block mb-2.5">
                  Brand
                </label>
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  <button
                    onClick={() => setSelectedBrand('all')}
                    className={`block w-full text-left text-xs py-1 px-2 rounded-md ${
                      selectedBrand === 'all'
                        ? 'bg-emerald-100 text-emerald-900 font-bold'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    All Brands
                  </button>
                  {brands.map((b) => (
                    <button
                      key={b}
                      onClick={() => setSelectedBrand(b)}
                      className={`block w-full text-left text-xs py-1 px-2 rounded-md ${
                        selectedBrand === b
                          ? 'bg-emerald-100 text-emerald-900 font-bold'
                          : 'text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* Product Grid Area */}
        <main className="md:col-span-3">
          {initialError ? (
            <div role="alert" className="text-center py-16 bg-white rounded-2xl border border-gray-100 p-8 shadow-2xs">
              <h3 className="text-base font-bold text-gray-800">Products could not be loaded</h3>
              <p className="text-xs text-gray-500 mt-1 mb-5">{initialError}</p>
              <button
                onClick={() => setRetryInitial((attempt) => attempt + 1)}
                className="px-5 py-2.5 bg-[#00875a] hover:bg-[#00724c] text-white text-xs font-bold rounded-xl transition"
              >
                Try Again
              </button>
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-2xl border border-gray-100 p-8 shadow-2xs">
              <Tag className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <h3 className="text-base font-bold text-gray-800">No products match your criteria</h3>
              <p className="text-xs text-gray-500 mt-1 mb-5">
                Try widening your price range or clearing active filters.
              </p>
              <button
                onClick={handleClearFilters}
                className="px-5 py-2.5 bg-[#00875a] hover:bg-[#00724c] text-white text-xs font-bold rounded-xl transition"
              >
                Reset Filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {products.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onViewProduct={onViewProduct}
                />
              ))}
              {loadingMore && [...Array(6)].map((_, index) => (
                <ProductCardSkeleton key={`loading-${index}`} />
              ))}
            </div>
          )}
          {products.length > 0 && (
            <>
              <div ref={sentinelRef} className="h-1" aria-hidden="true" />
              {loadMoreError && (
                <div role="alert" className="text-center py-6">
                  <p className="text-sm text-rose-700 mb-3">{loadMoreError}</p>
                  <button
                    onClick={() => {
                      setLoadMoreError(null);
                      void loadMore();
                    }}
                    className="px-4 py-2 bg-[#00875a] hover:bg-[#00724c] text-white text-xs font-bold rounded-xl transition"
                  >
                    Retry Loading Products
                  </button>
                </div>
              )}
              {loadingMore && <p className="sr-only" aria-live="polite">Loading more products</p>}
            </>
          )}
        </main>
      </div>
    </div>
  );
};
