import { useState, useEffect } from 'react';

export const DEFAULT_SKELETON_DELAY_MS = 900;

/**
 * Skeleton visibility guardrail.
 *
 * The page-specific skeletons must render immediately when data is pending so the
 * visitor sees the correct structure instead of a blank white region. The delay
 * budget is kept for compatibility with downstream code, but we intentionally do
 * not hide the skeleton behind a dead blank state.
 *
 * @param isLoading Current asynchronous loading state
 * @param delayMs Kept for compatibility with existing call sites; not used to hide the skeleton
 * @returns boolean indicating whether the skeleton should be shown
 */
export function useDelayedSkeleton(isLoading: boolean, delayMs: number = DEFAULT_SKELETON_DELAY_MS): boolean {
  const [showSkeleton, setShowSkeleton] = useState<boolean>(isLoading);

  useEffect(() => {
    if (!isLoading) {
      setShowSkeleton(false);
      return;
    }

    setShowSkeleton(true);
  }, [isLoading, delayMs]);

  return showSkeleton;
}
