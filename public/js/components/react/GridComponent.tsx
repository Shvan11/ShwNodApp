import React, { useState, useEffect, useRef, CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext';
import tpStyles from './TimePointsSelector.module.css';
import styles from './GridComponent.module.css';

interface Props {
    personId?: number | null;
    tpCode?: string;
}

interface GalleryImage {
    name: string;
    width?: number;
    height?: number;
}

interface Timepoint {
    tpCode: string;
    tpDescription: string;
    tpDateTime: string;
}

interface ImageElement {
    id: string;
    index: number;
    alt: string;
    isLogo?: boolean;
}

interface CachedShareBlob {
    url: string | null;
    blob: Blob | null;
    fetchId: number;
}

interface PhotoSwipeLightbox {
    init: () => void;
    destroy: () => void;
    on: (event: string, callback: () => void) => void;
    pswp: PhotoSwipeInstance | null;
}

interface PhotoSwipeInstance {
    currSlide: { data: { src: string } };
    on: (event: string, callback: () => void) => void;
    ui: {
        registerElement: (config: PhotoSwipeUIElementConfig) => void;
    };
}

interface PhotoSwipeUIElementConfig {
    name: string;
    order: number;
    isButton: boolean;
    tagName: string;
    html: {
        isCustomSVG: boolean;
        inner: string;
        outlineID: string;
    };
    onInit: (el: HTMLElement, pswp: PhotoSwipeInstance) => void;
}

declare global {
    interface Window {
        PhotoSwipe: unknown;
        PhotoSwipeLightbox: new (config: {
            gallery: string;
            children: string;
            pswpModule: unknown;
            bgOpacity: number;
            showHideOpacity: boolean;
        }) => PhotoSwipeLightbox;
    }
}

const GridComponent = ({ personId, tpCode = '0' }: Props) => {
    const navigate = useNavigate();
    const toast = useToast();
    const [images, setImages] = useState<GalleryImage[]>([]);
    const [timepoints, setTimepoints] = useState<Timepoint[]>([]);
    const [loadingTimepoints, setLoadingTimepoints] = useState(true);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lightbox, setLightbox] = useState<PhotoSwipeLightbox | null>(null);
    const [screenSize, setScreenSize] = useState<'mobile' | 'tablet' | 'desktop'>('desktop');
    const componentRef = useRef<HTMLDivElement>(null);
    const isSharingRef = useRef(false);

    // Pre-cached blob for native sharing (mobile only)
    // Stores: { url, blob, fetchId } - fetchId prevents race conditions
    const cachedShareBlobRef = useRef<CachedShareBlob>({ url: null, blob: null, fetchId: 0 });

    // Image elements configuration
    const imageElements: ImageElement[] = [
        { id: 'pf', index: 0, alt: 'Profile' },
        { id: 'fr', index: 1, alt: 'Rest' },
        { id: 'fs', index: 2, alt: 'Smile' },
        { id: 'up', index: 3, alt: 'Upper' },
        { id: 'logo', index: 4, alt: 'Shwan Orthodontics', isLogo: true },
        { id: 'lw', index: 5, alt: 'Lower' },
        { id: 'rt', index: 6, alt: 'Right' },
        { id: 'ct', index: 7, alt: 'Center' },
        { id: 'lf', index: 8, alt: 'Left' }
    ];

    // File name mapping for share
    const fileNameMap: Record<string, string> = {
        'i10': 'Profile.jpg',
        'i12': 'Rest.jpg',
        'i13': 'Smile.jpg',
        'i23': 'Upper.jpg',
        'i24': 'Lower.jpg',
        'i20': 'Right.jpg',
        'i22': 'Center.jpg',
        'i21': 'Left.jpg'
    };

    // Get descriptive filename from image URL
    const getShareFileName = (imageUrl: string): string => {
        const fileName = imageUrl.substring(imageUrl.lastIndexOf('/') + 1);
        const extensionMatch = fileName.match(/\.([^.]+)$/);
        const extension = extensionMatch ? extensionMatch[1] : '';
        return fileNameMap[extension] || `patient_${personId}_photo.jpg`;
    };

    // Pre-fetch blob for current slide (called on slide change, mobile only)
    const prefetchBlobForShare = async (imageUrl: string) => {
        // Only pre-fetch if native share is available
        if (!navigator.share || !navigator.canShare) return;

        // Skip logo and placeholder images
        if (imageUrl.includes('logo.png') || imageUrl.includes('placeholder')) return;

        // Increment fetchId to handle race conditions
        const currentFetchId = ++cachedShareBlobRef.current.fetchId;

        // Clear previous cache immediately
        cachedShareBlobRef.current.url = null;
        cachedShareBlobRef.current.blob = null;

        try {
            const response = await fetch(imageUrl);
            if (!response.ok) return;

            const blob = await response.blob();

            // Only store if this is still the most recent fetch (race condition check)
            if (currentFetchId === cachedShareBlobRef.current.fetchId) {
                cachedShareBlobRef.current.url = imageUrl;
                cachedShareBlobRef.current.blob = blob;
            }
        } catch {
            // Silent fail - user will see "please wait" message if they try to share
        }
    };

    // Clear cached blob (called on lightbox close and component unmount)
    const clearCachedBlob = () => {
        cachedShareBlobRef.current = { url: null, blob: null, fetchId: 0 };
    };

    // Native share handler - uses pre-cached blob for instant sharing
    // IMPORTANT: Must be synchronous until navigator.share() to preserve user gesture
    const handleNativeShare = (pswp: PhotoSwipeInstance) => {
        if (isSharingRef.current) return;
        isSharingRef.current = true;

        const imageUrl = pswp.currSlide.data.src;
        const cached = cachedShareBlobRef.current;

        // Check if cached blob matches current slide
        if (cached.url !== imageUrl || !cached.blob) {
            toast.warning('Please wait a moment and try again');
            isSharingRef.current = false;
            return;
        }

        const shareFileName = getShareFileName(imageUrl);
        const file = new File([cached.blob], shareFileName, { type: 'image/jpeg' });

        navigator.share({ files: [file] })
            .catch((err: Error) => {
                if (err.name !== 'AbortError') {
                    toast.error('Failed to share photo');
                }
            })
            .finally(() => {
                isSharingRef.current = false;
            });
    };

    const loadTimepoints = async () => {
        // Skip loading if personId is not valid
        if (!personId) {
            setLoadingTimepoints(false);
            return;
        }

        try {
            setLoadingTimepoints(true);
            const response = await fetch(`/api/patients/${personId}/timepoints`);

            if (!response.ok) {
                throw new Error('Failed to load timepoints');
            }

            const data: Timepoint[] = await response.json();
            setTimepoints(data);
        } catch (err) {
            console.error('Error loading timepoints:', err);
        } finally {
            setLoadingTimepoints(false);
        }
    };

    const loadGalleryImages = async () => {
        // Skip loading if personId is not valid
        if (!personId) {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);

            const response = await fetch(`/api/patients/${personId}/gallery/${tpCode}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const galleryImages: GalleryImage[] = await response.json();
            setImages(galleryImages);
        } catch (err) {
            console.error('Error loading grid:', err);
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    };

    const getImageSrc = (element: ImageElement): string => {
        if (element.isLogo) {
            return '/images/logo.png';
        }

        const image = images[element.index];
        if (image && image.name) {
            return `/DolImgs/${image.name}`;
        }

        // Optimized placeholder image (single SVG replaces 3 PNGs: 327KB → 1KB)
        return '/images/placeholder.svg';
    };

    const getImageProps = (element: ImageElement): { width: string; height: string } => {
        if (element.isLogo) {
            return { width: '400', height: '400' };
        }

        const image = images[element.index];
        return {
            width: image?.width?.toString() || '800',
            height: image?.height?.toString() || '600'
        };
    };

    // Initialize PhotoSwipe AFTER images are loaded AND component is mounted
    useEffect(() => {
        // Only initialize if component is actually mounted and rendered in DOM
        if (!loading && images.length > 0 && componentRef.current) {
            const initPhotoSwipe = async () => {
                try {
                    // Clean up any existing lightbox
                    if (lightbox) {
                        lightbox.destroy();
                    }

                    // Wait a bit to ensure React has finished rendering DOM
                    await new Promise(resolve => setTimeout(resolve, 200));

                    // Check if our component's DOM elements exist (more specific check)
                    const galleryElement = componentRef.current?.querySelector('#dolph_gallery');
                    const links = componentRef.current?.querySelectorAll('#dolph_gallery a');

                    if (!galleryElement || !links || links.length === 0) {
                        return;
                    }

                    // Load PhotoSwipe UMD versions for browser compatibility (if not already loaded)
                    if (!window.PhotoSwipe || !window.PhotoSwipeLightbox) {
                        await new Promise<void>((resolve, reject) => {
                            // Check if PhotoSwipe main script is already loaded
                            if (!window.PhotoSwipe) {
                                const script1 = document.createElement('script');
                                script1.src = '/photoswipe/dist/umd/photoswipe.umd.min.js';
                                script1.onload = () => {
                                    // Load PhotoSwipeLightbox after PhotoSwipe
                                    if (!window.PhotoSwipeLightbox) {
                                        const script2 = document.createElement('script');
                                        script2.src = '/photoswipe/dist/umd/photoswipe-lightbox.umd.min.js';
                                        script2.onload = () => resolve();
                                        script2.onerror = () => reject(new Error('Failed to load PhotoSwipeLightbox'));
                                        document.head.appendChild(script2);
                                    } else {
                                        resolve();
                                    }
                                };
                                script1.onerror = () => reject(new Error('Failed to load PhotoSwipe'));
                                document.head.appendChild(script1);
                            } else if (!window.PhotoSwipeLightbox) {
                                // PhotoSwipe loaded but not PhotoSwipeLightbox
                                const script2 = document.createElement('script');
                                script2.src = '/photoswipe/dist/umd/photoswipe-lightbox.umd.min.js';
                                script2.onload = () => resolve();
                                script2.onerror = () => reject(new Error('Failed to load PhotoSwipeLightbox'));
                                document.head.appendChild(script2);
                            } else {
                                // Both already loaded
                                resolve();
                            }
                        });
                    }

                    if (!window.PhotoSwipeLightbox) {
                        throw new Error('PhotoSwipeLightbox not available');
                    }

                    // Initialize PhotoSwipe
                    const lightboxInstance = new window.PhotoSwipeLightbox({
                        gallery: '#dolph_gallery',
                        children: 'a',
                        pswpModule: window.PhotoSwipe,
                        bgOpacity: 0.9,
                        showHideOpacity: true
                    });

                    // Add custom buttons
                    lightboxInstance.on('uiRegister', () => {
                        if (!lightboxInstance.pswp) return;

                        // Add download button
                        lightboxInstance.pswp.ui.registerElement({
                            name: 'download-button',
                            order: 8,
                            isButton: true,
                            tagName: 'a',

                            html: {
                                isCustomSVG: true,
                                inner: '<path d="M20.5 14.3 17.1 18V10h-2.2v7.9l-3.4-3.6L10 16l6 6.1 6-6.1ZM23 23H9v2h14Z" id="pswp__icn-download"/>',
                                outlineID: 'pswp__icn-download'
                            },

                            onInit: (el: HTMLElement, pswp: PhotoSwipeInstance) => {
                                el.setAttribute('download', '');
                                el.setAttribute('target', '_blank');
                                el.setAttribute('rel', 'noopener');
                                el.setAttribute('title', 'Download Image');

                                pswp.on('change', () => {
                                    const imageUrl = pswp.currSlide.data.src;
                                    el.setAttribute('download', getShareFileName(imageUrl));
                                    (el as HTMLAnchorElement).href = imageUrl;
                                });
                            }
                        });

                        // Add native share button (mobile only)
                        if ('share' in navigator && 'canShare' in navigator) {
                            lightboxInstance.pswp!.ui.registerElement({
                                name: 'native-share-button',
                                order: 8.5,
                                isButton: true,
                                tagName: 'button',

                                html: {
                                    isCustomSVG: true,
                                    inner: '<path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z" id="pswp__icn-share"/>',
                                    outlineID: 'pswp__icn-share'
                                },

                                onInit: (el: HTMLElement, pswp: PhotoSwipeInstance) => {
                                    el.setAttribute('title', 'Share');
                                    el.setAttribute('aria-label', 'Share photo');

                                    el.addEventListener('click', () => handleNativeShare(pswp));
                                }
                            });
                        }

                        // Add send message button (desktop only - mobile uses native share)
                        if (!navigator.share || !navigator.canShare) {
                            lightboxInstance.pswp!.ui.registerElement({
                                name: 'send-message-button',
                                order: 9,
                                isButton: true,
                                tagName: 'button',

                                html: {
                                    isCustomSVG: true,
                                    inner: '<path d="M2 21l21-9L2 3v7l15 2-15 2v7z" id="pswp__icn-send"/>',
                                    outlineID: 'pswp__icn-send'
                                },

                                onInit: (el: HTMLElement, pswp: PhotoSwipeInstance) => {
                                    el.setAttribute('title', 'Send Message');
                                    el.setAttribute('aria-label', 'Send Message');

                                    el.addEventListener('click', async () => {
                                        const imageSrc = pswp.currSlide.data.src;

                                        try {
                                            let webPath = imageSrc;
                                            if (imageSrc.includes('://')) {
                                                const url = new URL(imageSrc);
                                                webPath = url.pathname.startsWith('/') ? url.pathname.substring(1) : url.pathname;
                                            }

                                            console.log('Original path:', imageSrc);
                                            console.log('Extracted web path:', webPath);

                                            const response = await fetch(`/api/convert-path?path=${encodeURIComponent(webPath)}`);

                                            if (!response.ok) {
                                                throw new Error(`Failed to convert path: ${response.statusText}`);
                                            }

                                            const { fullPath } = await response.json();

                                            // Use actual file path - backend will handle filename conversion
                                            const convertedPath = fullPath;
                                            console.log('Converted to full path:', convertedPath);

                                            const sendMessageUrl = `/send-message?file=${encodeURIComponent(convertedPath)}`;
                                            window.open(sendMessageUrl, '_blank');

                                        } catch (error) {
                                            console.error('Error converting path for send message:', error);
                                            toast.error('Failed to convert file path for messaging. Please check the console for details.');
                                        }
                                    });
                                }
                            });
                        }
                    });

                    // Pre-fetch blob for sharing (mobile only)
                    if ('share' in navigator && 'canShare' in navigator) {
                        // Pre-fetch on first slide when lightbox opens
                        lightboxInstance.on('firstUpdate', () => {
                            const pswp = lightboxInstance.pswp;
                            if (pswp?.currSlide?.data?.src) {
                                prefetchBlobForShare(pswp.currSlide.data.src);
                            }
                        });

                        // Pre-fetch on slide change
                        lightboxInstance.on('change', () => {
                            const pswp = lightboxInstance.pswp;
                            if (pswp?.currSlide?.data?.src) {
                                prefetchBlobForShare(pswp.currSlide.data.src);
                            }
                        });

                        // Clear cache when lightbox closes
                        lightboxInstance.on('destroy', () => {
                            clearCachedBlob();
                        });
                    }

                    lightboxInstance.init();
                    setLightbox(lightboxInstance);

                } catch (error) {
                    console.error('Failed to initialize PhotoSwipe:', error);
                }
            };

            initPhotoSwipe();
        }
    }, [loading, images]);

    // Screen size detection
    useEffect(() => {
        const checkScreenSize = () => {
            const width = window.innerWidth;
            if (width < 576) {
                setScreenSize('mobile');
            } else if (width < 992) {
                setScreenSize('tablet');
            } else {
                setScreenSize('desktop');
            }
        };

        checkScreenSize();
        window.addEventListener('resize', checkScreenSize);
        return () => window.removeEventListener('resize', checkScreenSize);
    }, []);

    // Load timepoints when component mounts
    useEffect(() => {
        if (personId) {
            loadTimepoints();
        }
    }, [personId]);

    // Load images when component mounts or dependencies change
    useEffect(() => {
        if (personId) {
            loadGalleryImages();
        }
    }, [personId, tpCode]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (lightbox) {
                lightbox.destroy();
            }
            // Clear cached share blob
            clearCachedBlob();
        };
    }, [lightbox]);

    const calculateGridStyle = (): CSSProperties => {
        // Get responsive grid configuration
        const getGridConfig = () => {
            switch (screenSize) {
                case 'mobile':
                    return { columns: 1, maxWidth: '100%' };
                case 'tablet':
                    return { columns: 2, maxWidth: '600px' };
                case 'desktop':
                default:
                    return { columns: 3, maxWidth: '900px' };
            }
        };

        const { columns, maxWidth } = getGridConfig();

        // For single column (mobile), just use auto heights
        if (columns === 1) {
            return {
                display: 'grid',
                gridTemplateColumns: '1fr',
                gridTemplateRows: 'repeat(9, auto)',
                width: '100%',
                maxWidth: maxWidth,
                margin: '0 auto',
                gap: '15px',
                justifyContent: 'center',
                alignItems: 'center',
                height: 'auto',
                overflow: 'visible'
            };
        }

        // For desktop: Calculate available height with proper ratios
        if (screenSize === 'desktop') {
            const availableHeight = window.innerHeight - 120; // Reduce padding for less waste
            const gap = 10;

            // Define row ratios: first row 44%, others 28% each
            const rowRatios = [0.44, 0.30, 0.26]; // 3 rows total
            const totalGapHeight = (rowRatios.length - 1) * gap;
            const usableHeight = availableHeight - totalGapHeight;

            // Calculate row heights based on ratios
            const rowHeights = rowRatios.map(ratio => `${usableHeight * ratio}px`);

            return {
                display: 'grid',
                gridTemplateColumns: `repeat(${columns}, 1fr)`,
                gridTemplateRows: rowHeights.join(' '),
                width: '100%',
                maxWidth: maxWidth,
                margin: '0 auto',
                gap: `${gap}px`,
                justifyContent: 'center',
                alignItems: 'center',
                height: `${availableHeight}px`,
                overflow: 'visible' // Keep visible as safety net
            };
        }

        // For tablet: use auto heights
        return {
            display: 'grid',
            gridTemplateColumns: `repeat(${columns}, 1fr)`,
            gridTemplateRows: 'repeat(3, auto)',
            width: '100%',
            maxWidth: maxWidth,
            margin: '0 auto',
            gap: '10px',
            justifyContent: 'center',
            alignItems: 'center',
            height: 'auto',
            overflow: 'visible'
        };
    };


    if (loading) {
        return (
            <div className={styles.loadingSpinner}>
                Loading gallery...
            </div>
        );
    }

    if (error) {
        return (
            <div className={styles.errorMessage}>
                Error: {error}
            </div>
        );
    }

    const formatDate = (dateTime: string): string => {
        if (!dateTime) return '';
        return dateTime.substring(0, 10).split("-").reverse().join("-");
    };

    const handleTimepointClick = (tp: string) => {
        navigate(`/patient/${personId}/photos/tp${tp}`);
    };

    const handleImageMouseEnter = (e: ReactMouseEvent<HTMLImageElement>) => {
        e.currentTarget.style.transform = 'scale(1.05)';
    };

    const handleImageMouseLeave = (e: ReactMouseEvent<HTMLImageElement>) => {
        e.currentTarget.style.transform = 'scale(1)';
    };

    return (
        <div
            ref={componentRef}
            className={styles.container}
        >
            {/* Timepoints Selector */}
            {!loadingTimepoints && timepoints.length > 0 && (
                <div className={tpStyles.selector}>
                    {timepoints.map((timepoint, index) => (
                        <button
                            key={`tp-${timepoint.tpCode}-${index}`}
                            className={`${tpStyles.tab} ${tpCode === timepoint.tpCode ? tpStyles.tabActive : ''}`}
                            onClick={() => handleTimepointClick(timepoint.tpCode)}
                        >
                            <div className={tpStyles.tabIcon}>
                                <i className="fas fa-camera"></i>
                            </div>
                            <div className={tpStyles.tabContent}>
                                <div className={tpStyles.tabDesc}>{timepoint.tpDescription}</div>
                                <div className={tpStyles.tabDate}>{formatDate(timepoint.tpDateTime)}</div>
                            </div>
                        </button>
                    ))}
                </div>
            )}

            <div
                id="dolph_gallery"
                className={`pswp-gallery ${styles.galleryPadded}`}
                style={calculateGridStyle()}
            >
                {imageElements.map(element => {
                    const imageSrc = getImageSrc(element);
                    const imageProps = getImageProps(element);


                    return (
                        <a
                            key={`dolph_gallery-${element.index}`}
                            id={`a${element.id}`}
                            href={imageSrc}
                            data-pswp-width={imageProps.width}
                            data-pswp-height={imageProps.height}
                            target="_blank"
                            rel="noreferrer"
                        >
                            <img
                                id={element.id}
                                src={imageSrc}
                                alt={element.alt}
                                className={`${styles.galleryImage} ${element.isLogo ? styles.logoBorder : ''}`}
                                onMouseEnter={handleImageMouseEnter}
                                onMouseLeave={handleImageMouseLeave}
                            />
                        </a>
                    );
                })}
            </div>
        </div>
    );
};

export default GridComponent;
