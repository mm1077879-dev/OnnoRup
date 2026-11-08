import React, { useState, useEffect } from 'react';
import { ProductCard } from '../components/ui/ProductCard';
import { SeedProduct } from '../../server/data/initialData';
import {
  ArrowRight,
  ShieldCheck,
  Truck,
  RotateCcw,
  Smartphone,
  Shirt,
  Home,
  Sparkles,
  Dumbbell,
  Gamepad2,
  ChevronLeft,
  ChevronRight,
  Crown,
  Star,
  Quote,
  Eye,
  Settings,
} from 'lucide-react';
import { AdvertisementPopup } from '../components/common/AdvertisementPopup';
import { useVisitorAnalytics } from '../hooks/useVisitorAnalytics';
import {
  HomepageSectionConfig,
  GenericBanner,
  interleaveProductsAndBanners,
  isBannerAvailableForDisplay,
} from '../utils/homepageBuilderRules';
import { useDelayedSkeleton } from '../hooks/useDelayedSkeleton';
import { HomepageSkeleton } from '../components/skeletons/HomepageSkeleton';
import { handleImageFallback } from '../utils/safeMarkdown';
import { BannerRenderer, sanitizeBannerLink } from '../components/banner/BannerRenderer';

interface HomePageProps {
  onNavigate: (view: string, params?: any) => void;
}

interface DynamicSlider {
  id: string;
  imageUrl?: string;
  lifestyleImage?: string;
  destinationLink?: string;
  openInNewTab?: boolean;
  altText?: string;
  displayOrder: number;
}

export const HomePage: React.FC<HomePageProps> = ({ onNavigate }) => {
  useVisitorAnalytics('/');

  // Query parameter preview mode check
  const searchParams = new URLSearchParams(window.location.search);
  const isPreviewDraft = searchParams.get('preview') === 'draft';

  const [products, setProducts] = useState<SeedProduct[]>([]);
  const [sections, setSections] = useState<HomepageSectionConfig[]>([]);
  const [sliders, setSliders] = useState<DynamicSlider[]>([]);
  const [banners, setBanners] = useState<any[]>([]);
  const [bannersMap, setBannersMap] = useState<Record<string, any>>({});
  const [categories, setCategories] = useState<any[]>([]);
  const [categoryImageErrors, setCategoryImageErrors] = useState<Record<string, boolean>>({});
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [isSliderHovered, setIsSliderHovered] = useState(false);
  const [loading, setLoading] = useState(true);
  const [testimonialIndex, setTestimonialIndex] = useState(0);

  useEffect(() => {
    async function loadData() {
      try {
        const configUrl = isPreviewDraft
          ? '/api/homepage/config?preview=draft'
          : '/api/homepage/config';

        const [prodRes, configRes, slidersRes, bannersRes, catRes] = await Promise.all([
          fetch('/api/products?limit=50'),
          fetch(configUrl, { cache: 'no-store' }),
          fetch('/api/cms/sliders?activeOnly=true'),
          fetch('/api/cms/banners?activeOnly=true', { cache: 'no-store' }),
          fetch('/api/categories?activeOnly=true'),
        ]);

        const prodData = await prodRes.json();
        const configData = await configRes.json();
        const slidersData = await slidersRes.json();
        const bannersData = await bannersRes.json();
        const catData = await catRes.json();

        if (prodData.success) {
          setProducts(prodData.data);
        }

        if (catData.success && Array.isArray(catData.data)) {
          setCategories(catData.data);
        }

        if (configData.success && configData.data) {
          setSections(configData.data.sections || []);
        }

        // Merge published banners into bannersMap
        const publishedBanners =
          bannersData.success && Array.isArray(bannersData.data)
            ? bannersData.data.filter((banner: any) => isBannerAvailableForDisplay(banner))
            : [];
        setBanners(publishedBanners);

        const bMap: Record<string, any> = {};
        for (const bnr of publishedBanners) {
          bMap[bnr.id] = bnr;
        }
        setBannersMap(bMap);

        // Populate image-only sliders from database
        if (slidersData.success && Array.isArray(slidersData.data) && slidersData.data.length > 0) {
          setSliders(slidersData.data);
        } else if (configData.data?.sliders?.length > 0) {
          setSliders(configData.data.sliders);
        }
      } catch (err) {
        console.error('Failed to load dynamic homepage data', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [isPreviewDraft]);

  // Slider Autoplay (5s rotation, pauses when hovered)
  useEffect(() => {
    if (sliders.length <= 1 || isSliderHovered) return;

    const interval = setInterval(() => {
      setCurrentSlideIndex((prev) => (prev + 1) % sliders.length);
    }, 5000);

    return () => clearInterval(interval);
  }, [sliders.length, isSliderHovered]);

  const currentSlider = sliders.length > 0 ? sliders[currentSlideIndex] : null;

  const handleCategoryImageError = (key: string) => {
    setCategoryImageErrors((prev) => ({ ...prev, [key]: true }));
  };

  const handlePrevSlide = () => {
    if (sliders.length <= 1) return;
    setCurrentSlideIndex((prev) => (prev > 0 ? prev - 1 : sliders.length - 1));
  };

  const handleNextSlide = () => {
    if (sliders.length <= 1) return;
    setCurrentSlideIndex((prev) => (prev + 1) % sliders.length);
  };

  const categoryIcons: Record<string, React.ReactNode> = {
    electronics: <Smartphone className="w-5 h-5 text-gray-700" />,
    fashion: <Shirt className="w-5 h-5 text-gray-700" />,
    'home-living': <Home className="w-5 h-5 text-gray-700" />,
    'beauty-personal-care': <Sparkles className="w-5 h-5 text-gray-700" />,
    'sports-outdoors': <Dumbbell className="w-5 h-5 text-gray-700" />,
    'toys-games': <Gamepad2 className="w-5 h-5 text-gray-700" />,
  };

  // Helper to resolve products for a given product grid section
  const resolveProductsForSection = (sec: HomepageSectionConfig): SeedProduct[] => {
    const { productSource = 'featured', categorySlug, productLimit = 8, productIds = [] } =
      sec.settings;

    let result = [...products];

    if (productSource === 'featured') {
      result = result.filter((p) => p.isPopular);
    } else if (productSource === 'best_seller') {
      result = result.filter((p) => p.isBestSeller);
    } else if (productSource === 'new_arrivals') {
      result = [...products].reverse();
    } else if (productSource === 'discount') {
      result = result.filter((p) => (p as any).discountPercentage || (p.salePrice && p.salePrice < p.price));
    } else if (productSource === 'category' && categorySlug) {
      result = result.filter(
        (p) => p.category?.toLowerCase() === categorySlug.toLowerCase()
      );
    } else if (productSource === 'manual' && productIds.length > 0) {
      result = result.filter((p) => productIds.includes(p.id));
    }

    // Fallback if filter returned empty
    if (result.length === 0) {
      result = products;
    }

    return result.slice(0, productLimit);
  };

  const showSkeleton = useDelayedSkeleton(loading);

  if (loading) {
    if (showSkeleton) {
      return <HomepageSkeleton />;
    }
    return <div className="min-h-[60vh] w-full bg-white" aria-live="polite" aria-busy="true" />;
  }

  return (
    <div className="space-y-16 pb-12">
      {/* Draft Mode Indicator Banner */}
      {isPreviewDraft && (
        <div className="bg-amber-500 text-slate-950 px-4 py-2 text-center text-xs font-bold flex items-center justify-center gap-3 shadow-md sticky top-0 z-50">
          <Eye className="w-4 h-4" />
          <span>STAGING PREVIEW: Viewing unpublished draft layout.</span>
          <button
            onClick={() => onNavigate('admin', { module: 'cms-home' })}
            className="underline cursor-pointer hover:text-black font-extrabold flex items-center gap-1"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Open Builder</span>
          </button>
          <span>•</span>
          <a href="/" className="underline hover:text-black">
            Exit Preview
          </a>
        </div>
      )}

      {/* Render Dynamic Sections in Configured Sequence */}
      {sections.map((section) => {
        // 1. IMAGE-ONLY HERO SLIDER (Phase 10 Compliant)
        if (section.sectionType === 'hero_slider') {
          const mainBanner = banners.find((banner) => banner.placement === 'homepage-main');
          const activeSlide = sliders.length > 0 ? sliders[currentSlideIndex] : null;
          const slideImg = activeSlide?.imageUrl || activeSlide?.lifestyleImage || '';
          if (!slideImg && !mainBanner) return null;
          const slideTarget = sanitizeBannerLink(activeSlide?.destinationLink);

          return (
            <section key={section.id} className="relative w-full max-w-7xl mx-auto px-4 sm:px-6 pt-4 space-y-4">
              {mainBanner && <BannerRenderer banner={mainBanner} onNavigate={onNavigate} />}
              {slideImg && (
              <div
                onMouseEnter={() => setIsSliderHovered(true)}
                onMouseLeave={() => setIsSliderHovered(false)}
                className="relative rounded-3xl bg-gray-950 border border-gray-100 overflow-hidden shadow-xs group select-none min-h-[240px] sm:min-h-[360px] lg:min-h-[480px] flex items-center justify-center"
              >
                {/* Navigation arrow buttons */}
                {sliders.length > 1 && (
                  <>
                    <button
                      onClick={handlePrevSlide}
                      className="hidden sm:flex absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 hover:bg-white shadow-md items-center justify-center text-gray-800 z-20 transition cursor-pointer hover:scale-105"
                      aria-label="Previous slide"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <button
                      onClick={handleNextSlide}
                      className="hidden sm:flex absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 hover:bg-white shadow-md items-center justify-center text-gray-800 z-20 transition cursor-pointer hover:scale-105"
                      aria-label="Next slide"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </>
                )}

                {/* Hero Slide Image Container with Optional Click Action */}
                <div
                  onClick={() => {
                    if (!slideTarget) return;
                    if (slideTarget.isExternal) {
                      if (activeSlide?.openInNewTab) {
                        window.open(slideTarget.safeUrl, '_blank', 'noopener,noreferrer');
                      } else {
                        window.location.href = slideTarget.safeUrl;
                      }
                    } else {
                      onNavigate(slideTarget.safeUrl.replace(/^\//, '') || 'shop');
                    }
                  }}
                  className={`w-full h-full relative ${
                    slideTarget ? 'cursor-pointer' : ''
                  }`}
                >
                  <img
                    src={slideImg}
                    alt={activeSlide?.altText || 'Novara Hero Slide'}
                    onError={handleImageFallback}
                    className="w-full h-[240px] sm:h-[360px] lg:h-[480px] object-cover object-center transition-transform duration-700 group-hover:scale-[1.01]"
                  />
                </div>

                {/* Pagination Dots */}
                {sliders.length > 1 && (
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 z-20 bg-black/40 backdrop-blur-xs px-3.5 py-1.5 rounded-full">
                    {sliders.map((s, idx) => (
                      <button
                        key={s.id || idx}
                        onClick={() => setCurrentSlideIndex(idx)}
                        className={`transition-all duration-300 rounded-full cursor-pointer ${
                          currentSlideIndex === idx
                            ? 'w-7 h-2 bg-white shadow-xs'
                            : 'w-2 h-2 bg-white/60 hover:bg-white/90'
                        }`}
                        aria-label={`Go to slide ${idx + 1}`}
                      />
                    ))}
                  </div>
                )}
              </div>
              )}

              {/* 3 Trust Badges below Hero Slider */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-white/90 border border-gray-100 rounded-2xl p-4 shadow-2xs">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center shrink-0 border border-emerald-100">
                    <ShieldCheck className="w-4 h-4 text-[#00875a]" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-gray-900 block">Premium Quality Products</span>
                    <span className="text-[11px] text-gray-500">100% genuine verified items</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center shrink-0 border border-emerald-100">
                    <Truck className="w-4 h-4 text-[#00875a]" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-gray-900 block">Fast &amp; Reliable Delivery</span>
                    <span className="text-[11px] text-gray-500">All 64 districts of Bangladesh</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-800 flex items-center justify-center shrink-0 border border-emerald-100">
                    <RotateCcw className="w-4 h-4 text-[#00875a]" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-gray-900 block">Easy Return &amp; Refund</span>
                    <span className="text-[11px] text-gray-500">Hassle-free 30-day policy</span>
                  </div>
                </div>
              </div>
            </section>
          );
        }

        // 2. TRUST & VALUE BADGES
        if (section.sectionType === 'trust_badges') {
          return (
            <section key={section.id} className="max-w-7xl mx-auto px-4 sm:px-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 bg-emerald-50/40 border border-emerald-100 rounded-3xl p-6 sm:p-8">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-[#0c593f] flex items-center justify-center shrink-0">
                    <Truck className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="font-bold text-gray-900 text-sm">Free Express Shipping</h4>
                    <p className="text-xs text-gray-500 mt-0.5">On all domestic orders over ৳2,500</p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-[#0c593f] flex items-center justify-center shrink-0">
                    <ShieldCheck className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="font-bold text-gray-900 text-sm">30-Day Money Guarantee</h4>
                    <p className="text-xs text-gray-500 mt-0.5">Hassle-free 100% money back returns</p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-[#0c593f] flex items-center justify-center shrink-0">
                    <RotateCcw className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="font-bold text-gray-900 text-sm">24/7 Dedicated Support</h4>
                    <p className="text-xs text-gray-500 mt-0.5">Live support anytime, anywhere</p>
                  </div>
                </div>
              </div>
            </section>
          );
        }

        // 3. CATEGORY SHOWCASE
        if (section.sectionType === 'category_showcase') {
          const visibleCategories = [...categories]
            .filter((cat) => cat && (cat.isActive !== false))
            .sort((a, b) => (Number(a.displayOrder) || 0) - (Number(b.displayOrder) || 0))
            .slice(0, 8);
          const hasMoreCategories = categories.length > visibleCategories.length;
          const viewAllText = section.settings?.viewAllText || 'View All';

          return (
            <section key={section.id} className="max-w-7xl mx-auto px-4 sm:px-6">
              <div className="flex items-center justify-between mb-6 pb-3 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <h2 className="text-xl sm:text-2xl font-extrabold text-gray-900 tracking-tight">
                    {section.title || 'Shop by Category'}
                  </h2>
                  <span className="w-8 h-0.5 bg-[#00875a] hidden sm:inline-block rounded-full" />
                </div>
                {hasMoreCategories && (
                  <button
                    onClick={() => onNavigate('shop')}
                    className="text-xs sm:text-sm font-bold text-[#00875a] hover:text-[#00724c] flex items-center gap-1 transition cursor-pointer"
                  >
                    <span>{viewAllText}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-8 gap-3 sm:gap-4">
                {visibleCategories.map((cat) => {
                  const categoryKey = cat.slug || cat.id || cat.name || 'category';
                  const hasImage = Boolean(cat.image) && !categoryImageErrors[categoryKey];
                  const fallbackIcon = categoryIcons[cat.slug] || <Sparkles className="w-5 h-5 sm:w-6 sm:h-6 text-[#00875a]" />;

                  return (
                    <div
                      key={categoryKey}
                      onClick={() => onNavigate('shop', { category: cat.slug })}
                      className="group relative flex flex-col items-center justify-between p-3 sm:p-4 rounded-2xl bg-white border border-gray-100 hover:border-emerald-300 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 cursor-pointer overflow-hidden text-center"
                    >
                      <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-[#f0fdf4] group-hover:bg-[#dcfce7] text-[#00875a] flex items-center justify-center transition-transform duration-300 group-hover:scale-105 shadow-2xs border border-emerald-100 mb-3 shrink-0 overflow-hidden">
                        {hasImage ? (
                          <img
                            src={cat.image}
                            alt={cat.name}
                            className="w-full h-full object-cover"
                            onError={() => handleCategoryImageError(categoryKey)}
                          />
                        ) : (
                          fallbackIcon
                        )}
                      </div>
                      <span className="text-xs sm:text-sm font-bold text-gray-900 group-hover:text-[#00875a] transition-colors line-clamp-1 w-full text-center">
                        {cat.name}
                      </span>
                      <span className="text-[11px] text-gray-400 font-medium mt-1 group-hover:text-[#00875a] transition-colors flex items-center gap-0.5">
                        Explore &rarr;
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        }

        // 4. SPLIT CAMPAIGN CARDS
        if (section.sectionType === 'split_banners') {
          const configuredBanners = (section.settings.bannerIds || [])
            .map((id) => bannersMap[id])
            .filter(Boolean);
          const campaignBanners =
            configuredBanners.length > 0
              ? configuredBanners
              : banners.filter((banner) => banner.placement === 'homepage-secondary').slice(0, 2);
          if (campaignBanners.length === 0) return null;

          return (
            <section key={section.id} className="max-w-7xl mx-auto px-4 sm:px-6">
              <div className={`grid grid-cols-1 ${campaignBanners.length > 1 ? 'md:grid-cols-2' : ''} gap-6`}>
                {campaignBanners.map((banner: any) => (
                  <BannerRenderer key={banner.id} banner={banner} onNavigate={onNavigate} />
                ))}
              </div>
            </section>
          );
        }

        // 5. FULL-WIDTH PROMOTIONAL BANNER
        if (section.sectionType === 'promotional_banner') {
          const banner =
            bannersMap[section.settings.bannerId || ''] ||
            banners.find((item) => item.placement === 'homepage-promotion');
          if (!banner) return null;

          return (
            <section key={section.id} className="max-w-7xl mx-auto px-4 sm:px-6">
              <BannerRenderer banner={banner} onNavigate={onNavigate} />
            </section>
          );
        }

        // 6. DYNAMIC PRODUCT GRID WITH INTERLEAVED BANNERS
        if (section.sectionType === 'product_grid') {
          const sectionProducts = resolveProductsForSection(section);
          const interleavedItems = interleaveProductsAndBanners(
            sectionProducts,
            section.settings.bannerPlacements || [],
            bannersMap
          );

          const desktopColsClass =
            section.settings.desktopColumns === 5
              ? 'lg:grid-cols-5'
              : section.settings.desktopColumns === 3
              ? 'lg:grid-cols-3'
              : 'lg:grid-cols-4';

          // Strict Phase 4: Small and standard mobile devices display 1 product per row
          const gridColsClass = `grid-cols-1 sm:grid-cols-2 md:grid-cols-3 ${desktopColsClass} gap-4 sm:gap-6`;

          return (
            <section key={section.id} className="max-w-7xl mx-auto px-4 sm:px-6">
              {/* Section Header */}
              <div className="flex items-center justify-between mb-8 pb-3 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  {section.settings.productSource === 'best_seller' && (
                    <Crown className="w-5 h-5 text-amber-500" />
                  )}
                  <h2 className="text-xl sm:text-2xl font-extrabold text-gray-900 tracking-tight">
                    {section.title}
                  </h2>
                  <span className="w-8 h-0.5 bg-emerald-700 hidden sm:inline-block" />
                </div>

                {section.settings.viewAllText && (
                  <button
                    onClick={() => {
                      const link = section.settings.viewAllLink || '/shop';
                      onNavigate(link.replace('/', '') || 'shop');
                    }}
                    className="text-xs sm:text-sm font-bold text-emerald-800 hover:text-emerald-950 flex items-center gap-1 transition cursor-pointer"
                  >
                    <span>{section.settings.viewAllText}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                )}
              </div>

              {loading ? (
                <div className={`grid ${gridColsClass}`}>
                  {[...Array(section.settings.productLimit || 8)].map((_, i) => (
                    <div key={i} className="h-72 rounded-2xl bg-gray-100 animate-pulse" />
                  ))}
                </div>
              ) : (
                <div className={`grid ${gridColsClass}`}>
                  {interleavedItems.map((entry, idx) => {
                    if (entry.type === 'product') {
                      const product = entry.item as SeedProduct;
                      return (
                        <ProductCard
                          key={`${section.id}-prod-${product.id}-${idx}`}
                          product={product}
                          onViewProduct={(slug) => onNavigate('product', { slug })}
                        />
                      );
                    }

                    // INTERLEAVED BANNER (spans across the full width of the grid!)
                    const banner = entry.item as GenericBanner;
                    return (
                      <div
                        key={`${section.id}-bnr-${banner.id}-${idx}`}
                        className="col-span-full my-4 rounded-3xl p-6 sm:p-10 text-white flex flex-col md:flex-row items-center justify-between gap-6 shadow-xl relative overflow-hidden"
                        style={{ backgroundColor: banner.backgroundColor || '#0c261e' }}
                      >
                        <div className="relative z-10 space-y-2 max-w-xl">
                          {banner.tag && (
                            <span className="text-xs font-bold uppercase tracking-widest text-emerald-300">
                              {banner.tag}
                            </span>
                          )}
                          <h3 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
                            {banner.headline}
                          </h3>
                          {banner.subheadline && (
                            <p className="text-xs sm:text-sm text-emerald-100/90 leading-relaxed">
                              {banner.subheadline}
                            </p>
                          )}
                          <div className="pt-2">
                            <button
                              onClick={() => {
                                const link = banner.buttonLink || '/shop';
                                if (link.startsWith('/')) {
                                  onNavigate(link.replace('/', '') || 'shop');
                                } else {
                                  window.location.href = link;
                                }
                              }}
                              className="px-6 py-2.5 rounded-full bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-bold text-xs transition flex items-center gap-2 shadow cursor-pointer"
                            >
                              <span>{banner.buttonText || 'Shop Now'}</span>
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {banner.imageUrl && (
                          <div className="relative z-10 max-h-48 shrink-0">
                            <img
                              src={banner.imageUrl}
                              alt={banner.headline}
                              className="max-h-40 sm:max-h-48 object-contain rounded-2xl drop-shadow-lg"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        }

        // 7. TESTIMONIALS
        if (section.sectionType === 'testimonials') {
          const allTestimonials: Array<{ name: string; meta: string; avatar: string; quote: string }> = [];
          if (allTestimonials.length === 0) return null;
          const visibleTestimonials = allTestimonials.slice(testimonialIndex * 3, testimonialIndex * 3 + 3);

          return (
            <section key={section.id} className="max-w-7xl mx-auto px-4 sm:px-6">
              <div className="flex items-center justify-between mb-8 pb-3 border-b border-gray-100">
                <h2 className="text-xl sm:text-2xl font-extrabold text-gray-900 tracking-tight">
                  {section.title || 'What Our Customers Say'}
                </h2>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setTestimonialIndex((prev) => (prev > 0 ? prev - 1 : 1))}
                    className="w-8 h-8 rounded-full border border-gray-200 hover:border-gray-400 flex items-center justify-center text-gray-600 transition cursor-pointer"
                    aria-label="Previous review"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setTestimonialIndex((prev) => (prev < 1 ? prev + 1 : 0))}
                    className="w-8 h-8 rounded-full border border-gray-200 hover:border-gray-400 flex items-center justify-center text-gray-600 transition cursor-pointer"
                    aria-label="Next review"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {visibleTestimonials.map((item) => (
                  <div
                    key={item.name}
                    className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex items-center gap-3 mb-4">
                        <img
                          src={item.avatar}
                          alt={item.name}
                          onError={handleImageFallback}
                          className="w-11 h-11 rounded-full object-cover border border-emerald-100"
                        />
                        <div>
                          <div className="text-sm font-bold text-gray-900">{item.name}</div>
                          <div className="text-[11px] text-gray-500">{item.meta}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-amber-400 mb-3">
                        {[...Array(5)].map((_, i) => (
                          <Star key={i} className="w-3.5 h-3.5 fill-current" />
                        ))}
                      </div>
                      <p className="text-xs text-gray-600 leading-relaxed italic">
                        "{item.quote}"
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        }

        return null;
      })}

      {/* Promotional Ad Popup (if configured) */}
      <AdvertisementPopup onNavigate={onNavigate} />
    </div>
  );
};
