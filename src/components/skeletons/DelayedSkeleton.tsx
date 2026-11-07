import React from 'react';
import { useDelayedSkeleton, DEFAULT_SKELETON_DELAY_MS } from '../../hooks/useDelayedSkeleton';

interface DelayedSkeletonProps {
  isLoading: boolean;
  delayMs?: number;
  skeleton: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/**
 * Reusable delayed-skeleton wrapper.
 *
 * The skeleton must remain visible while a page is pending so the user sees the
 * structural layout instead of a blank white region. Once loading resolves, the
 * final content renders normally.
 */
export const DelayedSkeleton: React.FC<DelayedSkeletonProps> = ({
  isLoading,
  delayMs = DEFAULT_SKELETON_DELAY_MS,
  skeleton,
  children,
  className = '',
}) => {
  const showSkeleton = useDelayedSkeleton(isLoading, delayMs);

  if (isLoading) {
    return <div className={`delayed-skeleton-container ${className}`}>{skeleton}</div>;
  }

  return <>{children}</>;
};
