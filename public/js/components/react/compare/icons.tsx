/**
 * Inline stroke icons for the compare page (replaces the old emoji buttons).
 * All inherit currentColor; decorative by default (aria-hidden) — the owning
 * button carries the accessible label.
 */

import React from 'react';

interface IconProps {
    size?: number;
}

const base = (size: number) => ({
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
});

export const IconShare = ({ size = 18 }: IconProps) => (
    <svg {...base(size)}>
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
    </svg>
);

export const IconPlay = ({ size = 18 }: IconProps) => (
    <svg {...base(size)} fill="currentColor" stroke="none">
        <path d="M8 5v14l11-7z" />
    </svg>
);

export const IconExpand = ({ size = 18 }: IconProps) => (
    <svg {...base(size)}>
        <path d="M15 3h6v6M9 21H3v-15M21 3l-7 7M3 21l7-7" />
    </svg>
);

export const IconCompress = ({ size = 18 }: IconProps) => (
    <svg {...base(size)}>
        <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
    </svg>
);

export const IconClose = ({ size = 18 }: IconProps) => (
    <svg {...base(size)}>
        <path d="M18 6L6 18M6 6l12 12" />
    </svg>
);

export const IconChevronLeft = ({ size = 18 }: IconProps) => (
    <svg {...base(size)}>
        <path d="M15 18l-6-6 6-6" />
    </svg>
);

export const IconChevronRight = ({ size = 18 }: IconProps) => (
    <svg {...base(size)}>
        <path d="M9 18l6-6-6-6" />
    </svg>
);

export const IconArrowUp = ({ size = 18 }: IconProps) => (
    <svg {...base(size)}>
        <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
);

export const IconArrowDown = ({ size = 18 }: IconProps) => (
    <svg {...base(size)}>
        <path d="M12 5v14M19 12l-7 7-7-7" />
    </svg>
);

export const IconArrowLeft = ({ size = 18 }: IconProps) => (
    <svg {...base(size)}>
        <path d="M19 12H5M12 5l-7 7 7 7" />
    </svg>
);

export const IconArrowRight = ({ size = 18 }: IconProps) => (
    <svg {...base(size)}>
        <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
);

export const IconZoomIn = ({ size = 18 }: IconProps) => (
    <svg {...base(size)}>
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.35-4.35M11 8v6M8 11h6" />
    </svg>
);

export const IconZoomOut = ({ size = 18 }: IconProps) => (
    <svg {...base(size)}>
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.35-4.35M8 11h6" />
    </svg>
);

export const IconRotateCw = ({ size = 18 }: IconProps) => (
    <svg {...base(size)}>
        <path d="M21 12a9 9 0 1 1-3.2-6.9" />
        <path d="M21 4v6h-6" />
    </svg>
);

export const IconRotateCcw = ({ size = 18 }: IconProps) => (
    <svg {...base(size)}>
        <path d="M3 12a9 9 0 1 0 3.2-6.9" />
        <path d="M3 4v6h6" />
    </svg>
);

export const IconLayout = ({ size = 18 }: IconProps) => (
    <svg {...base(size)}>
        <rect x="3" y="3" width="7.5" height="18" rx="1.2" />
        <rect x="13.5" y="3" width="7.5" height="18" rx="1.2" />
    </svg>
);

export const IconBisect = ({ size = 18 }: IconProps) => (
    <svg {...base(size)}>
        <path d="M3 12h3M9 12h2M13 12h2M18 12h3" />
        <path d="M12 5v3M12 16v3" />
    </svg>
);

export const IconBadge = ({ size = 18 }: IconProps) => (
    <svg {...base(size)}>
        <circle cx="12" cy="9" r="5" />
        <path d="M8.5 13.5L7 21l5-2.5L17 21l-1.5-7.5" />
    </svg>
);

export const IconContrast = ({ size = 18 }: IconProps) => (
    <svg {...base(size)}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
    </svg>
);

export const IconReset = ({ size = 18 }: IconProps) => (
    <svg {...base(size)}>
        <path d="M3 12a9 9 0 1 0 2.6-6.3" />
        <path d="M3 4v5h5" />
    </svg>
);

export const IconCrop = ({ size = 18 }: IconProps) => (
    <svg {...base(size)}>
        <path d="M6 2v14a2 2 0 0 0 2 2h14" />
        <path d="M2 6h14a2 2 0 0 1 2 2v14" />
    </svg>
);

export const IconDownload = ({ size = 18 }: IconProps) => (
    <svg {...base(size)}>
        <path d="M12 3v12M7 10l5 5 5-5" />
        <path d="M4 19h16" />
    </svg>
);

export const IconCompare = ({ size = 18 }: IconProps) => (
    <svg {...base(size)}>
        <rect x="2.5" y="5" width="8.5" height="14" rx="1.5" />
        <rect x="13" y="5" width="8.5" height="14" rx="1.5" strokeDasharray="3 2.4" />
    </svg>
);
