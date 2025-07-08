import React, { useState, useEffect, useRef } from 'react'

const GridComponent = ({ patientId, tpCode = '0' }) => {
    const [images, setImages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [lightbox, setLightbox] = useState(null);
    const [screenSize, setScreenSize] = useState('desktop');
    const componentRef = useRef(null);
    
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
    
    const loadGalleryImages = async () => {
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
        
        // Placeholder images
        if (element.index < 3) {
            return '/images/No_img_f.png';
        } else if (element.index < 6) {
            return '/images/No_img_o.png';
        } else {
            return '/images/No_img_r.png';
        }
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
                    
                    // Load PhotoSwipe UMD versions for browser compatibility
                    await new Promise((resolve, reject) => {
                        const script1 = document.createElement('script');
                        script1.src = '/photoswipe/dist/umd/photoswipe.umd.min.js';
                        script1.onload = () => {
                            const script2 = document.createElement('script');
                            script2.src = '/photoswipe/dist/umd/photoswipe-lightbox.umd.min.js';
                            script2.onload = resolve;
                            script2.onerror = reject;
                            document.head.appendChild(script2);
                        };
                        script1.onerror = reject;
                        document.head.appendChild(script1);
                    });
                    
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
                        
                        // Add send message button
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
                                        
                                        // Apply same descriptive renaming as download
                                        const fileName = webPath.substring(webPath.lastIndexOf('/') + 1);
                                        const extensionMatch = fileName.match(/\.([^.]+)$/);
                                        const extension = extensionMatch ? extensionMatch[1] : '';
                                        
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
                                        
                                        const patientPrefix = fileName.split('.')[0]; // e.g., "21400"
                                        const descriptiveName = fileNameMap[extension] || `${patientPrefix}.jpg`;
                                        const convertedPath = fullPath.replace(/[^/\\]+$/, descriptiveName);
                                        console.log('Converted to full path:', convertedPath);
                                        
                                        const sendMessageUrl = `/views/messaging/send-message.html?file=${encodeURIComponent(convertedPath)}`;
                                        window.open(sendMessageUrl, '_blank');
                                        
                                    } catch (error) {
                                        console.error('Error converting path for send message:', error);
                                        
                                        const sendMessageUrl = `/views/messaging/send-message.html?file=${encodeURIComponent(imageSrc)}`;
                                        window.open(sendMessageUrl, '_blank');
                                    }
                                });
                            }
                        });
                    });
                    
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
    
    return (
        <div 
            ref={componentRef}
            style={{ 
                padding: '20px',
                height: '100%',
                overflowY: 'auto',
                overflowX: 'hidden'
            }}
        >
            <div
                id="dolph_gallery" 
                className="pswp-gallery"
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
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    objectFit: 'contain',
                                    objectPosition: 'center',
                                    backgroundColor: '#f8f9fa',
                                    borderRadius: '8px',
                                    cursor: 'pointer',
                                    transition: 'transform 0.2s ease',
                                    border: element.isLogo ? '2px solid #ddd' : 'none'
                                }}
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