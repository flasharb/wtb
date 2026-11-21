export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true" className="shrink-0">
        <defs>
          <linearGradient id="sa-g" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
            <stop stopColor="#c4b5fd" />
            <stop offset="0.5" stopColor="#8b5cf6" />
            <stop offset="1" stopColor="#6d28d9" />
          </linearGradient>
        </defs>
        <path
          d="M16 2 L29 24 H22 L16 13 L10 24 H3 Z M11.5 27 H20.5 L18.4 30.5 H13.6 Z"
          fill="url(#sa-g)"
        />
      </svg>
      <span className="font-display text-lg font-bold tracking-tight text-white">
        Stack<span className="text-brand-400">Alpha</span>
      </span>
    </span>
  );
}
