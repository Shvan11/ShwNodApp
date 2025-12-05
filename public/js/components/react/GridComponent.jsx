import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../../contexts/ToastContext.jsx';

const GridComponent = ({ patientId, tpCode = '0' }) => {
    const navigate = useNavigate();
    const toast = useToast();
    const [images, setImages] = useState([]);
    const [timepoints, setTimepoints] = useState([]);
    const [loadingTimepoints, setLoadingTimepoints] = useState(true);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [lightbox, setLightbox] = useState(null);
    const [screenSize, setScreenSize] = useState('desktop');
    const componentRef = useRef(null);
    const isSharingRef = useRef(false);

    // Pre-cached blob for native sharing (mobile only)
    // Stores: { url, blob, fetchId } - fetchId prevents race conditions
    const cachedShareBlobRef = useRef({ url: null, blob: null, fetchId: 0 });

    // Image elements configuration
    const imageElements = [
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
    const fileNameMap = {
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
    const getShareFileName = (imageUrl) => {
        const fileName = imageUrl.substring(imageUrl.lastIndexOf('/') + 1);
        const extensionMatch = fileName.match(/\.([^.]+)$/);
        const extension = extensionMatch ? extensionMatch[1] : '';
        return fileNameMap[extension] || `patient_${patientId}_photo.jpg`;
    };

    // Pre-fetch blob for current slide (called on slide change, mobile only)
    const prefetchBlobForShare = async (imageUrl) => {
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
        } catch (err) {
            // Silent fail - share will fallback to URL
            console.warn('Pre-fetch for share failed:', err.message);
        }
    };

    // Clear cached blob (called on lightbox close and component unmount)
    const clearCachedBlob = () => {
        cachedShareBlobRef.current = { url: null, blob: null, fetchId: 0 };
    };

    // Native share handler - uses pre-cached blob for instant sharing
    const handleNativeShare = async (pswp, buttonEl) => {
        if (isSharingRef.current) return;
        isSharingRef.current = true;

        try {
            const slide = pswp.currSlide;
            const imageUrl = slide.data.src;
            const shareFileName = getShareFileName(imageUrl);
            const photoName = shareFileName.replace('.jpg', '');

            // Check if we have a cached blob for this exact URL
            const cached = cachedShareBlobRef.current;

            if (cached.url !== imageUrl || !cached.blob) {
                // No cached blob available - photo not ready for sharing yet
                toast.warning('Please wait a moment and try again');
                return;
            }

            // Use cached blob - instant share, no async before share()
            const file = new File([cached.blob], shareFileName, {
                type: cached.blob.type || 'image/jpeg'
            });

            const shareData = {
                files: [file],
                title: `Patient Photo - ${photoName}`,
                text: `Patient ${patientId} - ${photoName}`
            };

            if (navigator.canShare(shareData)) {
                await navigator.share(shareData);
            } else {
                throw new Error('File sharing not supported');
            }
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error('Share failed:', err.name, err.message);
                toast.error('Failed to share photo');
            }
        } finally {
            isSharingRef.current = false;
        }
    };

    const loadTimepoints = async () => {
        // Skip loading if patientId is not a valid number
        if (!patientId || isNaN(parseInt(patientId))) {
            setLoadingTimepoints(false);
            return;
        }

        try {
            setLoadingTimepoints(true);
            const response = await fetch(`/api/gettimepoints?code=${patientId}`);

            if (!response.ok) {
                throw new Error('Failed to load timepoints');
            }

            const data = await response.json();
            setTimepoints(data);
        } catch (err) {
            console.error('Error loading timepoints:', err);
        } finally {
            setLoadingTimepoints(false);
        }
    };

    const loadGalleryImages = async () => {
        // Skip loading if patientId is not a valid number
        if (!patientId || isNaN(parseInt(patientId))) {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);

            const response = await fetch(`/api/getgal?code=${patientId}&tp=${tpCode}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const galleryImages = await response.json();
            setImages(galleryImages);
        } catch (err) {
            console.error('Error loading grid:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };
    
    const getImageSrc = (element) => {
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
    
    const getImageProps = (element) => {
        if (element.isLogo) {
            return { width: '400', height: '400' };
        }
        
        const image = images[element.index];
        return {
            width: image?.width || '800',
            height: image?.height || '600'
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
                        await new Promise((resolve, reject) => {
                            // Check if PhotoSwipe main script is already loaded
                            if (!window.PhotoSwipe) {
                                const script1 = document.createElement('script');
                                script1.src = '/photoswipe/dist/umd/photoswipe.umd.min.js';
                                script1.onload = () => {
                                    // Load PhotoSwipeLightbox after PhotoSwipe
                                    if (!window.PhotoSwipeLightbox) {
                                        const script2 = document.createElement('script');
                                        script2.src = '/photoswipe/dist/umd/photoswipe-lightbox.umd.min.js';
                                        script2.onload = resolve;
                                        script2.onerror = reject;
                                        document.head.appendChild(script2);
                                    } else {
                                        resolve();
                                    }
                                };
                                script1.onerror = reject;
                                document.head.appendChild(script1);
                            } else if (!window.PhotoSwipeLightbox) {
                                // PhotoSwipe loaded but not PhotoSwipeLightbox
                                const script2 = document.createElement('script');
                                script2.src = '/photoswipe/dist/umd/photoswipe-lightbox.umd.min.js';
                                script2.onload = resolve;
                                script2.onerror = reject;
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
                    let lightboxInstance = new window.PhotoSwipeLightbox({
                        gallery: '#dolph_gallery',
                        children: 'a',
                        pswpModule: window.PhotoSwipe,
                        bgOpacity: 0.9,
                        showHideOpacity: true
                    });
                    
                    // Add custom buttons
                    lightboxInstance.on('uiRegister', () => {
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
                            
                            onInit: (el, pswp) => {
                                el.setAttribute('download', '');
                                el.setAttribute('target', '_blank');
                                el.setAttribute('rel', 'noopener');
                                el.setAttribute('title', 'Download Image');
                                
                                pswp.on('change', () => {
                                    const downloadLink = pswp.currSlide.data.src;
                                    const fileName = downloadLink.substring(downloadLink.lastIndexOf('/') + 1);
                                    
                                    // Extract the extension code (like i10, i12, etc.)
                                    const extensionMatch = fileName.match(/\.([^.]+)$/);
                                    const extension = extensionMatch ? extensionMatch[1] : '';
                                    
                                    // Map extension codes to descriptive names
                                    const fileNameMap = {
                                        'i10': 'Profile.jpg',
                                        'i12': 'Rest.jpg',
                                        'i13': 'Smile.jpg',
                                        'i23': 'Upper.jpg',
                                        'i24': 'Lower.jpg',
                                        'i20': 'Right.jpg',
                                        'i22': 'Center.jpg',
                                        'i21': 'Left.jpg'
                                    };
                                    
                                    // Get descriptive name or use original with patient prefix
                                    const downloadFileName = fileNameMap[extension] || `patient_${patientId}_${fileName}`;
                                    
                                    el.setAttribute('download', downloadFileName);
                                    el.href = downloadLink;
                                });
                            }
                        });

                        // Add native share button (mobile only)
                        if (navigator.share && navigator.canShare) {
                            lightboxInstance.pswp.ui.registerElement({
                                name: 'native-share-button',
                                order: 8.5,
                                isButton: true,
                                tagName: 'button',

                                html: {
                                    isCustomSVG: true,
                                    inner: '<path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z" id="pswp__icn-share"/>',
                                    outlineID: 'pswp__icn-share'
                                },

                                onInit: (el, pswp) => {
                                    el.setAttribute('title', 'Share');
                                    el.setAttribute('aria-label', 'Share photo');

                                    el.addEventListener('click', () => {
                                        handleNativeShare(pswp, el);
                                    });
                                }
                            });
                        }

                        // Add send message button (desktop only - mobile uses native share)
                        if (!navigator.share || !navigator.canShare) {
                            lightboxInstance.pswp.ui.registerElement({
                                name: 'send-message-button',
                                order: 9,
                                isButton: true,
                                tagName: 'button',

                                html: {
                                    isCustomSVG: true,
                                    inner: '<path d="M2 21l21-9L2 3v7l15 2-15 2v7z" id="pswp__icn-send"/>',
                                    outlineID: 'pswp__icn-send'
                                },

                                onInit: (el, pswp) => {
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
                    if (navigator.share && navigator.canShare) {
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
        if (patientId) {
            loadTimepoints();
        }
    }, [patientId]);

    // Load images when component mounts or dependencies change
    useEffect(() => {
        if (patientId) {
            loadGalleryImages();
        }
    }, [patientId, tpCode]);
    
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
    
    const calculateGridStyle = () => {
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
            <div className="loading-spinner">
                Loading gallery...
            </div>
        );
    }
    
    if (error) {
        return (
            <div className="error-message">
                Error: {error}
            </div>
        );
    }
    
    const formatDate = (dateTime) => {
        if (!dateTime) return '';
        return dateTime.substring(0, 10).split("-").reverse().join("-");
    };

    const handleTimepointClick = (tp) => {
        navigate(`/patient/${patientId}/photos/tp${tp}`);
    };

    return (
        <div
            ref={componentRef}
            className="grid-component-container"
        >
            {/* Timepoints Selector */}
            {!loadingTimepoints && timepoints.length > 0 && (
                <div className="timepoints-selector">
                    {timepoints.map((timepoint, index) => (
                        <button
                            key={`tp-${timepoint.tpCode}-${index}`}
                            className={`timepoint-tab ${tpCode === timepoint.tpCode ? 'active' : ''}`}
                            onClick={() => handleTimepointClick(timepoint.tpCode)}
                        >
                            <div className="timepoint-tab-icon">
                                <i className="fas fa-camera"></i>
                            </div>
                            <div className="timepoint-tab-content">
                                <div className="timepoint-tab-desc">{timepoint.tpDescription}</div>
                                <div className="timepoint-tab-date">{formatDate(timepoint.tpDateTime)}</div>
                            </div>
                        </button>
                    ))}
                </div>
            )}

            <div
                id="dolph_gallery"
                className="pswp-gallery pswp-gallery-padded"
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
                                className={`gallery-image ${element.isLogo ? 'logo-border' : ''}`}
                                onMouseEnter={(e) => {
                                    e.target.style.transform = 'scale(1.05)';
                                }}
                                onMouseLeave={(e) => {
                                    e.target.style.transform = 'scale(1)';
                                }}
                            />
                        </a>
                    );
                })}
            </div>
        </div>
    );
};

export default GridComponent;