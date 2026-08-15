type IconProps = { className?: string };

const base = "shrink-0";

export function CheckCircleIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={`${base} ${className ?? ""}`} aria-hidden>
      <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.5 10.2 8.7 12.4 13.5 7.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SpinnerIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={`${base} animate-spin ${className ?? ""}`} aria-hidden>
      <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.5" opacity="0.2" />
      <path d="M18.5 10a8.5 8.5 0 0 0-8.5-8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function AlertTriangleIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={`${base} ${className ?? ""}`} aria-hidden>
      <path d="M10 3.2 17.5 16.4H2.5L10 3.2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M10 8.2v3.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="10" cy="14.1" r="0.9" fill="currentColor" />
    </svg>
  );
}

export function XCircleIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={`${base} ${className ?? ""}`} aria-hidden>
      <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7.3 7.3 12.7 12.7M12.7 7.3 7.3 12.7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={`${base} ${className ?? ""}`} aria-hidden>
      <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M13.5 13.5 17.5 17.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function MapPinIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={`${base} ${className ?? ""}`} aria-hidden>
      <path
        d="M10 17.5S16 12.2 16 8a6 6 0 1 0-12 0c0 4.2 6 9.5 6 9.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function BuildingIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={`${base} ${className ?? ""}`} aria-hidden>
      <rect x="4.5" y="2.5" width="8" height="15" rx="0.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M12.5 8.5h3v9h-3" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M7 5.5h1.5M7 8.5h1.5M7 11.5h1.5M7 14.5h1.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function BlockIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={`${base} ${className ?? ""}`} aria-hidden>
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10 2v16M2 10h16" stroke="currentColor" strokeWidth="1.2" strokeDasharray="1.6 1.8" />
    </svg>
  );
}

export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={`${base} ${className ?? ""}`} aria-hidden>
      <path d="M7.5 4.5 13 10l-5.5 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ClockIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={`${base} ${className ?? ""}`} aria-hidden>
      <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10 6v4.3l3 1.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
