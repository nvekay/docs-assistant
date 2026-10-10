/** Placeholder block shown while data loads, sized like the content it stands in for */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-slate-200/80 dark:bg-slate-800 ${className}`} aria-hidden />;
}
