import React, { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { Provider } from 'react-redux';
import { store } from './app/store';
import { StorefrontLayout } from './layouts/StorefrontLayout';
import { AdminLayout } from './admin/layouts/AdminLayout';
import { CartFlyProvider } from './context/CartFlyContext';
import { GlobalReloadOverlay } from './components/common/GlobalReloadOverlay';

import { HomePage } from './pages/HomePage';
import { ShopPage } from './pages/ShopPage';
import { ProductDetailPage } from './pages/ProductDetailPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { CustomerAccountPage } from './pages/CustomerAccountPage';
import { WishlistPage } from './pages/WishlistPage';
import { AboutPage } from './pages/AboutPage';
import { BlogPage } from './pages/BlogPage';
import { ContactPage } from './pages/ContactPage';
import { CartPage } from './pages/CartPage';

interface AppHistoryState {
  view?: string;
  params?: any;
  __appScroll?: {
    key: string;
    y: number;
  };
  [key: string]: unknown;
}

function getHistoryState(value: unknown): AppHistoryState {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as AppHistoryState
    : {};
}

function getScrollMetadata(state: AppHistoryState) {
  const metadata = state.__appScroll;
  return metadata && typeof metadata.key === 'string' && Number.isFinite(metadata.y)
    ? metadata
    : undefined;
}

function createHistoryEntryKey() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function setDocumentScrollTop(top: number) {
  window.scrollTo({ top, left: 0, behavior: 'instant' });
}

function AppContent() {
  // Parse initial route from browser URL
  const getInitialState = () => {
    const path = window.location.pathname;
    if (path.startsWith('/admin')) {
      const parts = path.split('/').filter(Boolean);
      const mod = parts[1] || 'dashboard';
      return { view: 'admin', params: { module: mod } };
    }
    if (path.startsWith('/shop')) {
      const searchParams = new URLSearchParams(window.location.search);
      const q = searchParams.get('q') || '';
      const cat = searchParams.get('category') || '';
      return { view: 'shop', params: { q, category: cat } };
    }
    if (path.startsWith('/cart')) {
      return { view: 'cart', params: {} };
    }
    if (path.startsWith('/product/')) {
      const slug = path.replace('/product/', '');
      return { view: 'product', params: { slug } };
    }
    if (path.startsWith('/checkout')) {
      return { view: 'checkout', params: {} };
    }
    if (path.startsWith('/account')) {
      return { view: 'account', params: {} };
    }
    if (path.startsWith('/wishlist')) {
      return { view: 'wishlist', params: {} };
    }
    if (path.startsWith('/blog/')) {
      const slug = path.replace('/blog/', '');
      return { view: 'blog', params: { slug } };
    }
    if (path.startsWith('/blog')) {
      return { view: 'blog', params: {} };
    }
    if (path.startsWith('/about')) {
      return { view: 'about', params: {} };
    }
    if (path.startsWith('/contact')) {
      return { view: 'contact', params: {} };
    }
    return { view: 'home', params: {} };
  };

  const [currentView, setCurrentView] = useState<string>(() => getInitialState().view);
  const [viewParams, setViewParams] = useState<any>(() => getInitialState().params);
  const [historyEntryKey, setHistoryEntryKey] = useState(() => {
    const metadata = getScrollMetadata(getHistoryState(window.history.state));
    return metadata?.key || createHistoryEntryKey();
  });
  const activeHistoryEntryKey = useRef(historyEntryKey);
  const pendingScrollRestoration = useRef<{ key: string; y: number } | null>(null);

  const saveScrollPosition = useCallback((y = window.scrollY) => {
    const currentState = getHistoryState(window.history.state);
    window.history.replaceState({
      ...currentState,
      __appScroll: { key: activeHistoryEntryKey.current, y },
    }, '');
  }, []);

  // Keep the active history entry's position current for Back/Forward and reloads.
  useEffect(() => {
    let frameId: number | null = null;
    const handleScroll = () => {
      if (pendingScrollRestoration.current || frameId !== null) return;
      frameId = requestAnimationFrame(() => {
        frameId = null;
        if (!pendingScrollRestoration.current) saveScrollPosition();
      });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [saveScrollPosition]);

  // Disable native restoration so it cannot race the app's route/layout updates.
  useLayoutEffect(() => {
    window.history.scrollRestoration = 'manual';
    const currentState = getHistoryState(window.history.state);
    const metadata = getScrollMetadata(currentState);
    const key = metadata?.key || historyEntryKey;
    const y = 0;
    activeHistoryEntryKey.current = key;
    pendingScrollRestoration.current = { key, y };
    setDocumentScrollTop(y);
    window.history.replaceState({
      ...currentState,
      view: currentView,
      params: viewParams,
      __appScroll: { key, y },
    }, '');
  }, []);

  // Restore only when the destination can accommodate the saved position.
  useLayoutEffect(() => {
    const pending = pendingScrollRestoration.current;
    if (!pending || pending.key !== historyEntryKey) return;

    let completed = false;
    let frameId: number | null = null;
    let timeoutId: number | null = null;
    const observer = pending.y > 0 ? new ResizeObserver(() => restore()) : null;

    const finish = (force = false) => {
      if (completed) return;
      const documentHeight = Math.max(
        document.documentElement.scrollHeight,
        document.body?.scrollHeight || 0,
      );
      const maxY = Math.max(0, documentHeight - window.innerHeight);
      if (!force && maxY < pending.y) return;

      completed = true;
      observer?.disconnect();
      if (frameId !== null) cancelAnimationFrame(frameId);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (pendingScrollRestoration.current === pending) {
        pendingScrollRestoration.current = null;
      }
      setDocumentScrollTop(Math.min(pending.y, maxY));
      saveScrollPosition(Math.min(pending.y, maxY));
    };

    const restore = () => finish();
    if (pending.y === 0) {
      finish(true);
    } else {
      observer?.observe(document.documentElement);
      frameId = requestAnimationFrame(restore);
      timeoutId = window.setTimeout(() => finish(true), 2500);
    }

    return () => {
      completed = true;
      observer?.disconnect();
      if (frameId !== null) cancelAnimationFrame(frameId);
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [historyEntryKey, saveScrollPosition]);

  // Synchronize history state
  const handleNavigate = useCallback((view: string, params: any = {}) => {
    // Update browser URL seamlessly
    let targetPath = '/';
    if (view === 'home') targetPath = '/';
    else if (view === 'admin') targetPath = params.module ? `/admin/${params.module}` : '/admin';
    else if (view === 'shop') {
      const qp = new URLSearchParams();
      if (params.category && params.category !== 'all') qp.set('category', params.category);
      if (params.q) qp.set('q', params.q);
      const qs = qp.toString();
      targetPath = qs ? `/shop?${qs}` : '/shop';
    }
    else if (view === 'cart') targetPath = '/cart';
    else if (view === 'product') targetPath = `/product/${params.slug || 'wireless-headphones'}`;
    else if (view === 'checkout') targetPath = '/checkout';
    else if (view === 'account') targetPath = '/account';
    else if (view === 'wishlist') targetPath = '/wishlist';
    else if (view === 'blog') targetPath = params.slug ? `/blog/${params.slug}` : '/blog';
    else if (view === 'about') targetPath = '/about';
    else if (view === 'contact') targetPath = '/contact';

    const currentFull = window.location.pathname + window.location.search;
    if (currentFull !== targetPath) {
      if (!pendingScrollRestoration.current) saveScrollPosition();
      setDocumentScrollTop(0);
      const key = createHistoryEntryKey();
      window.history.pushState({
        view,
        params,
        __appScroll: { key, y: 0 },
      }, '', targetPath);
      activeHistoryEntryKey.current = key;
      pendingScrollRestoration.current = { key, y: 0 };
      setHistoryEntryKey(key);
    }
    setCurrentView(view);
    setViewParams(params);
  }, [saveScrollPosition]);

  // Handle browser back/forward buttons
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      const state = getHistoryState(e.state);
      const initial = getInitialState();
      const view = state.view || initial.view;
      const params = state.params || initial.params;
      const metadata = getScrollMetadata(state);
      const key = metadata?.key || createHistoryEntryKey();
      const y = metadata?.y ?? 0;

      activeHistoryEntryKey.current = key;
      pendingScrollRestoration.current = { key, y };
      window.history.replaceState({
        ...state,
        view,
        params,
        __appScroll: { key, y },
      }, '');
      setHistoryEntryKey(key);
      setCurrentView(view);
      setViewParams(params);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // 1. ISOLATED ADMIN LAYOUT: Completely independent layout with zero customer header/footer
  if (currentView === 'admin') {
    return (
      <AdminLayout
        initialModule={viewParams.module || 'dashboard'}
        onGoToStorefront={() => handleNavigate('home')}
      />
    );
  }

  // 2. STOREFRONT LAYOUT: Public storefront layout with customer navbar, search, cart drawer, and footer
  return (
    <StorefrontLayout currentView={currentView} onNavigate={handleNavigate}>
      {currentView === 'home' && (
        <HomePage onNavigate={handleNavigate} />
      )}

      {currentView === 'shop' && (
        <ShopPage
          key={`${viewParams.q || ''}-${viewParams.category || ''}`}
          initialCategory={viewParams.category}
          initialQuery={viewParams.q}
          onViewProduct={(slug) => handleNavigate('product', { slug })}
        />
      )}

      {currentView === 'cart' && (
        <CartPage
          onNavigate={handleNavigate}
          onNavigateToCheckout={() => handleNavigate('checkout')}
          onNavigateToShop={() => handleNavigate('shop')}
          onViewProduct={(slug) => handleNavigate('product', { slug })}
        />
      )}

      {currentView === 'product' && (
        <ProductDetailPage
          slug={viewParams.slug || 'wireless-headphones'}
          onNavigateToShop={() => handleNavigate('shop')}
          onNavigateToCheckout={() => handleNavigate('checkout')}
          onViewProduct={(slug) => handleNavigate('product', { slug })}
        />
      )}

      {currentView === 'checkout' && (
        <CheckoutPage
          onOrderSuccess={(order) => handleNavigate('account', { tab: 'orders' })}
          onNavigateToShop={() => handleNavigate('shop')}
        />
      )}

      {currentView === 'account' && (
        <CustomerAccountPage
          initialTab={viewParams.tab || 'orders'}
          onNavigateToShop={() => handleNavigate('shop')}
        />
      )}

      {currentView === 'wishlist' && (
        <WishlistPage
          onViewProduct={(slug) => handleNavigate('product', { slug })}
          onNavigateToShop={() => handleNavigate('shop')}
          onNavigateToContact={() => handleNavigate('contact')}
        />
      )}

      {currentView === 'about' && (
        <AboutPage onNavigate={handleNavigate} />
      )}

      {currentView === 'blog' && (
        <BlogPage initialSlug={viewParams.slug} onNavigate={handleNavigate} />
      )}

      {currentView === 'contact' && (
        <ContactPage />
      )}
    </StorefrontLayout>
  );
}

export default function App() {
  return (
    <Provider store={store}>
      <CartFlyProvider>
        <GlobalReloadOverlay />
        <AppContent />
      </CartFlyProvider>
    </Provider>
  );
}
