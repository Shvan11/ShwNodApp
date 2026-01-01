/**
 * CompareComponent - Advanced image comparison tool for patient portal
 *
 * Provides sophisticated image comparison with canvas manipulation tools
 * Memoized to prevent unnecessary re-renders when props haven't changed
 */

import React, { useState, useEffect, useRef, ChangeEvent, FormEvent } from 'react';
import { useToast } from '../../contexts/ToastContext';

interface Props {
    patientId?: string;
    phone?: string;
}

interface Timepoint {
    tpCode: number;
    tpDescription: string;
    tpDateTime: string;
}

interface PhotoType {
    id: string;
    label: string;
    code: string;
    category: string;
}

interface CanvasSize {
    value: string;
    label: string;
}

interface Tool {
    value: number;
    label: string;
}

interface Transform {
    x: number;
    y: number;
    scale: number;
    rotation: number;
}

interface TransformState {
    img1: Transform;
    img2: Transform;
    logo: Transform;
}

interface CanvasDimensions {
    width: number;
    height: number;
}

interface AutoImageSize {
    width: number;
    height: number;
}

interface ComparisonHandler {
    canvas: HTMLCanvasElement;
    context: CanvasRenderingContext2D;
    images: HTMLImageElement[];
    transform: TransformState;
    orientation: 'vertical' | 'horizontal';
    showBisect: boolean;
    selectedImage: number;
    showLogo: boolean;
    updateDimensions: React.Dispatch<React.SetStateAction<CanvasDimensions>>;
    originalDimensions: CanvasDimensions;
    autoMode: boolean;
    autoImageSize?: AutoImageSize;
    loadImages: (urls: string[]) => Promise<void>;
    resizeCanvasToFitImages: () => void;
    render: () => void;
    renderVertical: () => void;
    renderHorizontal: () => void;
    drawImage: (img: HTMLImageElement, x: number, y: number, width: number, height: number, key: string) => void;
    drawLogo: (img: HTMLImageElement) => void;
    drawBisectLine: () => void;
    moveImage: (direction: string, amount?: number) => void;
    zoomImage: (direction: string) => void;
    rotateImage: (direction: string) => void;
    toggleOrientation: () => void;
    toggleBisect: () => void;
    toggleLogo: () => void;
    reset: () => void;
    toDataURL: () => string;
}

interface ImageState {
    img1: string | null;
    img2: string | null;
    logo: string | null;
}

const CompareComponent = ({ patientId, phone }: Props) => {
    const toast = useToast();
    const [timepoints, setTimepoints] = useState<Timepoint[]>([]);
    const [selectedTimepoints, setSelectedTimepoints] = useState<number[]>([]);
    const [selectedPhotoType, setSelectedPhotoType] = useState('');
    const [timepointImages, setTimepointImages] = useState<Record<number, string[]>>({});
    const [, setImages] = useState<ImageState>({ img1: null, img2: null, logo: null });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [canvasSize, setCanvasSize] = useState('auto');
    const [selectedTool, setSelectedTool] = useState(1);
    const [comparison, setComparison] = useState<ComparisonHandler | null>(null);
    const [showWhatsAppModal, setShowWhatsAppModal] = useState(false);
    const [phoneNumber, setPhoneNumber] = useState(phone || '');
    const [sendingMessage, setSendingMessage] = useState(false);
    const [showLogo, setShowLogo] = useState(true);
    const [canvasDimensions, setCanvasDimensions] = useState<CanvasDimensions>({ width: 800, height: 600 });

    // Canvas ref for comparison
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Photo type options with improved categorization
    const photoTypes: PhotoType[] = [
        { id: 'profile', label: 'Facial Profile', code: '10', category: 'facial' },
        { id: 'rest', label: 'Facial Rest', code: '12', category: 'facial' },
        { id: 'smile', label: 'Facial Smile', code: '13', category: 'facial' },
        { id: 'upper', label: 'Occlusal Upper', code: '23', category: 'occlusal' },
        { id: 'lower', label: 'Occlusal Lower', code: '24', category: 'occlusal' },
        { id: 'right', label: 'Intra-oral Right', code: '20', category: 'intraoral' },
        { id: 'center', label: 'Intra-oral Center', code: '22', category: 'intraoral' },
        { id: 'left', label: 'Intra-oral Left', code: '21', category: 'intraoral' }
    ];

    // Canvas size options
    const canvasSizes: CanvasSize[] = [
        { value: 'auto', label: 'Auto' },
        { value: '{"width":1080,"height":1350}', label: 'Post (1080 × 1350)' },
        { value: '{"width":1080,"height":1920}', label: 'Story (1080 × 1920)' },
        { value: '{"width":2060,"height":2700}', label: '2060 × 2700' }
    ];

    // Tool selection options
    const tools: Tool[] = [
        { value: 1, label: 'Image 1' },
        { value: 2, label: 'Image 2' },
        { value: 3, label: 'Logo' }
    ];

    useEffect(() => {
        loadTimepoints();
    }, [patientId]);

    useEffect(() => {
        if (canvasRef.current && !comparison) {
            initializeComparison();
        }
    }, [canvasRef.current]);

    useEffect(() => {
        if (selectedTimepoints.length === 2 && selectedPhotoType) {
            loadComparisonImages();
        }
    }, [selectedTimepoints, selectedPhotoType, comparison]);

    useEffect(() => {
        if (comparison) {
            comparison.showLogo = showLogo;
            comparison.render();
        }
    }, [showLogo, comparison]);

    useEffect(() => {
        if (canvasRef.current) {
            setCanvasDimensions({
                width: canvasRef.current.width,
                height: canvasRef.current.height
            });
        }
    }, [canvasRef.current]);

    // Helper function to check if a photo type is available
    const isPhotoTypeAvailable = (photoCode: string): boolean => {
        if (selectedTimepoints.length === 0) return true;

        const hasImageData = selectedTimepoints.some(tpCode => timepointImages[tpCode]);
        if (!hasImageData) return true;

        const allHaveImageData = selectedTimepoints.every(tpCode => timepointImages[tpCode]);
        if (!allHaveImageData) return true;

        return selectedTimepoints.every(tpCode => {
            const images = timepointImages[tpCode];
            return images && images.includes(photoCode);
        });
    };

    const loadTimepoints = async () => {
        if (!patientId || patientId === 'new') {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            const response = await fetch(`/api/patients/${patientId}/timepoints`);
            if (!response.ok) throw new Error('Failed to load timepoints');

            const data: Timepoint[] = await response.json();
            console.log('Loaded timepoints data:', data);
            setTimepoints(data);

            // Auto-select first and last timepoints (skip tpCode 0)
            if (data.length >= 2) {
                const validTimepoints = data.filter(tp => tp.tpCode > 0);

                if (validTimepoints.length >= 2) {
                    setSelectedTimepoints([validTimepoints[0].tpCode, validTimepoints[validTimepoints.length - 1].tpCode]);
                } else if (validTimepoints.length === 1 && data.length >= 2) {
                    setSelectedTimepoints([data[0].tpCode, data[1].tpCode]);
                }
            }
        } catch (err) {
            console.error('Error loading timepoints:', err);
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    };

    const initializeComparison = () => {
        if (!canvasRef.current) return;

        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');
        if (!context) return;

        // Create comparison handler (keeping original complex logic)
        const comparisonHandler: ComparisonHandler = {
            canvas: canvas,
            context: context,
            images: [],
            transform: {
                img1: { x: 0, y: 0, scale: 1, rotation: 0 },
                img2: { x: 0, y: 0, scale: 1, rotation: 0 },
                logo: { x: 0, y: 0, scale: 1, rotation: 0 }
            },
            orientation: 'vertical',
            showBisect: false,
            selectedImage: 1,
            showLogo: showLogo,
            updateDimensions: setCanvasDimensions,
            originalDimensions: {
                width: canvas.width,
                height: canvas.height
            },
            autoMode: true,

            loadImages: async function(urls: string[]) {
                console.log('Loading images:', urls);
                this.images = [];
                for (let i = 0; i < urls.length; i++) {
                    const url = urls[i];
                    const img = new Image();

                    try {
                        await new Promise<void>((resolve, reject) => {
                            const timeout = setTimeout(() => {
                                reject(new Error(`Timeout loading image: ${url}`));
                            }, 10000);

                            img.onload = () => {
                                clearTimeout(timeout);
                                console.log(`Image ${i} loaded successfully:`, url);
                                resolve();
                            };

                            img.onerror = () => {
                                clearTimeout(timeout);
                                console.error(`Image ${i} failed to load:`, url);
                                reject(new Error(`Failed to load image: ${url}`));
                            };

                            img.src = url;
                        });

                        this.images.push(img);
                    } catch (error) {
                        console.error(`Error loading image ${url}:`, error);
                        return;
                    }
                }
                console.log(`Loaded ${this.images.length} images, rendering...`);

                // Auto-resize canvas if in auto mode
                if (this.autoMode) {
                    this.resizeCanvasToFitImages();
                }

                this.render();
            },

            resizeCanvasToFitImages: function() {
                if (this.images.length < 2) return;

                const img1 = this.images[0];
                const img2 = this.images[1];

                if (!img1.complete || !img2.complete) return;

                // Simple approach: use the larger dimensions to ensure both fit without distortion
                const containerWidth = Math.max(img1.width, img2.width);
                const containerHeight = Math.max(img1.height, img2.height);

                let canvasWidth: number, canvasHeight: number;

                if (this.orientation === 'vertical') {
                    canvasWidth = containerWidth;
                    canvasHeight = containerHeight * 2;
                } else {
                    canvasWidth = containerWidth * 2;
                    canvasHeight = containerHeight;
                }

                // Store the common container size for rendering
                this.autoImageSize = { width: containerWidth, height: containerHeight };

                // Apply the new dimensions
                this.canvas.width = canvasWidth;
                this.canvas.height = canvasHeight;

                // Update React state
                if (this.updateDimensions) {
                    this.updateDimensions({ width: canvasWidth, height: canvasHeight });
                }

                console.log(`Auto-resized canvas to ${canvasWidth}x${canvasHeight} for ${this.orientation} orientation with container size ${containerWidth}x${containerHeight}`);
            },

            render: function() {
                if (this.images.length < 2) return;

                const canvas = this.canvas;
                const ctx = this.context;

                if (!canvas || !ctx) return;

                // Clear canvas
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = 'black';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                if (this.orientation === 'vertical') {
                    this.renderVertical();
                } else {
                    this.renderHorizontal();
                }

                if (this.showBisect) {
                    this.drawBisectLine();
                }
            },

            renderVertical: function() {
                const canvas = this.canvas;

                if (this.autoMode && this.images.length >= 2 && this.autoImageSize) {
                    // In auto mode, use common smallest dimensions for both images
                    const commonWidth = this.autoImageSize.width;
                    const commonHeight = this.autoImageSize.height;

                    if (this.images[0]) {
                        this.drawImage(this.images[0], 0, 0, commonWidth, commonHeight, 'img1');
                    }
                    if (this.images[1]) {
                        this.drawImage(this.images[1], 0, commonHeight, commonWidth, commonHeight, 'img2');
                    }
                } else {
                    // Fixed mode - use split layout
                    const halfHeight = canvas.height / 2;

                    if (this.images[0]) {
                        this.drawImage(this.images[0], 0, 0, canvas.width, halfHeight, 'img1');
                    }
                    if (this.images[1]) {
                        this.drawImage(this.images[1], 0, halfHeight, canvas.width, halfHeight, 'img2');
                    }
                }

                if (this.images[2] && this.showLogo) {
                    this.drawLogo(this.images[2]);
                }
            },

            renderHorizontal: function() {
                const canvas = this.canvas;

                if (this.autoMode && this.images.length >= 2 && this.autoImageSize) {
                    // In auto mode, give each image a container but let them maintain aspect ratio
                    const containerWidth = this.autoImageSize.width;
                    const containerHeight = this.autoImageSize.height;

                    if (this.images[0]) {
                        // First image gets left container
                        this.drawImage(this.images[0], 0, 0, containerWidth, containerHeight, 'img1');
                    }
                    if (this.images[1]) {
                        // Second image gets right container
                        this.drawImage(this.images[1], containerWidth, 0, containerWidth, containerHeight, 'img2');
                    }
                } else {
                    // Fixed mode - use split layout
                    const halfWidth = canvas.width / 2;

                    if (this.images[0]) {
                        this.drawImage(this.images[0], 0, 0, halfWidth, canvas.height, 'img1');
                    }
                    if (this.images[1]) {
                        this.drawImage(this.images[1], halfWidth, 0, halfWidth, canvas.height, 'img2');
                    }
                }

                if (this.images[2] && this.showLogo) {
                    this.drawLogo(this.images[2]);
                }
            },

            drawImage: function(img: HTMLImageElement, x: number, y: number, width: number, height: number, key: string) {
                const ctx = this.context;
                const transform = this.transform[key as keyof TransformState];

                if (!img.complete || img.naturalWidth === 0) return;

                // In auto mode, prioritize aspect ratio preservation over transforms
                if (this.autoMode && (transform.x === 0 && transform.y === 0 && transform.scale === 1 && transform.rotation === 0)) {
                    // Pure aspect ratio preservation without transforms
                    const aspectRatio = img.width / img.height;
                    const containerRatio = width / height;

                    let drawWidth: number, drawHeight: number, drawX: number, drawY: number;
                    if (aspectRatio > containerRatio) {
                        // Image is wider - fit to width, center vertically
                        drawWidth = width;
                        drawHeight = width / aspectRatio;
                        drawX = x;
                        drawY = y + (height - drawHeight) / 2;
                    } else {
                        // Image is taller - fit to height, center horizontally
                        drawHeight = height;
                        drawWidth = height * aspectRatio;
                        drawX = x + (width - drawWidth) / 2;
                        drawY = y;
                    }

                    ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
                } else {
                    // Standard mode with transforms
                    ctx.save();
                    ctx.translate(x + width / 2 + transform.x, y + height / 2 + transform.y);
                    ctx.rotate(transform.rotation * Math.PI / 180);
                    ctx.scale(transform.scale, transform.scale);

                    const aspectRatio = img.width / img.height;
                    const containerRatio = width / height;

                    let drawWidth: number, drawHeight: number;
                    if (aspectRatio > containerRatio) {
                        drawWidth = width;
                        drawHeight = width / aspectRatio;
                    } else {
                        drawHeight = height;
                        drawWidth = height * aspectRatio;
                    }

                    ctx.drawImage(img, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
                    ctx.restore();
                }
            },

            drawLogo: function(img: HTMLImageElement) {
                const ctx = this.context;
                const canvas = this.canvas;
                const transform = this.transform.logo;

                // In auto mode, use a reasonable fixed size relative to canvas
                let logoWidth: number, logoHeight: number;
                if (this.autoMode) {
                    // Use a percentage of canvas width for reasonable logo size
                    logoWidth = canvas.width * 0.15; // 15% of canvas width
                    logoHeight = (img.height * logoWidth) / img.width;
                } else {
                    // Original logic for fixed modes
                    logoWidth = img.width / 6;
                    logoHeight = (img.height * logoWidth) / img.width;
                }

                const logoX = canvas.width / 2 - logoWidth / 2 + transform.x;
                const logoY = canvas.height / 2 - logoHeight / 1.3 + transform.y;

                ctx.save();
                ctx.translate(logoX + logoWidth / 2, logoY + logoHeight / 2);
                ctx.rotate(transform.rotation * Math.PI / 180);
                ctx.scale(transform.scale, transform.scale);
                ctx.drawImage(img, -logoWidth / 2, -logoHeight / 2, logoWidth, logoHeight);
                ctx.restore();
            },

            drawBisectLine: function() {
                const ctx = this.context;
                const canvas = this.canvas;

                ctx.save();
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
                ctx.lineWidth = 2;
                ctx.setLineDash([10, 5]);

                ctx.beginPath();
                if (this.orientation === 'vertical') {
                    ctx.moveTo(0, canvas.height / 2);
                    ctx.lineTo(canvas.width, canvas.height / 2);
                } else {
                    ctx.moveTo(canvas.width / 2, 0);
                    ctx.lineTo(canvas.width / 2, canvas.height);
                }
                ctx.stroke();
                ctx.restore();
            },

            // Control methods
            moveImage: function(direction: string, amount: number = 10) {
                const key = this.selectedImage === 1 ? 'img1' : this.selectedImage === 2 ? 'img2' : 'logo';
                const transform = this.transform[key as keyof TransformState];

                switch (direction) {
                    case 'left': transform.x -= amount; break;
                    case 'right': transform.x += amount; break;
                    case 'up': transform.y -= amount; break;
                    case 'down': transform.y += amount; break;
                }
                this.render();
            },

            zoomImage: function(direction: string) {
                const key = this.selectedImage === 1 ? 'img1' : this.selectedImage === 2 ? 'img2' : 'logo';
                const transform = this.transform[key as keyof TransformState];
                const factor = direction === 'in' ? 1.1 : 0.9;

                transform.scale *= factor;
                transform.scale = Math.max(0.1, Math.min(5, transform.scale));
                this.render();
            },

            rotateImage: function(direction: string) {
                const key = this.selectedImage === 1 ? 'img1' : this.selectedImage === 2 ? 'img2' : 'logo';
                const transform = this.transform[key as keyof TransformState];
                const amount = direction === 'clockwise' ? 15 : -15;

                transform.rotation += amount;
                this.render();
            },

            toggleOrientation: function() {
                this.orientation = this.orientation === 'vertical' ? 'horizontal' : 'vertical';

                // Auto-resize canvas if in auto mode
                if (this.autoMode && this.images.length >= 2) {
                    this.resizeCanvasToFitImages();
                }

                this.render();
            },

            toggleBisect: function() {
                this.showBisect = !this.showBisect;
                this.render();
            },

            toggleLogo: function() {
                this.showLogo = !this.showLogo;
                this.render();
            },


            reset: function() {
                this.transform = {
                    img1: { x: 0, y: 0, scale: 1, rotation: 0 },
                    img2: { x: 0, y: 0, scale: 1, rotation: 0 },
                    logo: { x: 0, y: 0, scale: 1, rotation: 0 }
                };

                // Reset canvas to original dimensions
                const canvas = this.canvas;
                if (this.originalDimensions) {
                    canvas.width = this.originalDimensions.width;
                    canvas.height = this.originalDimensions.height;
                    if (this.updateDimensions) {
                        this.updateDimensions({
                            width: this.originalDimensions.width,
                            height: this.originalDimensions.height
                        });
                    }
                }

                this.render();
            },

            toDataURL: function() {
                return this.canvas.toDataURL('image/png');
            }
        };

        setComparison(comparisonHandler);
    };

    const loadComparisonImages = async () => {
        if (!comparison || selectedTimepoints.length !== 2 || !selectedPhotoType) return;

        try {
            setLoading(true);

            const photoType = photoTypes.find(p => p.id === selectedPhotoType);
            if (!photoType) throw new Error('Invalid photo type');

            const sortedTimepoints = [...selectedTimepoints].sort((a, b) => a - b);

            const getCategoryCode = (photoId: string): string => {
                const categoryMap: Record<string, string> = {
                    'profile': '.I10', 'rest': '.I12', 'smile': '.I13',
                    'upper': '.I23', 'lower': '.I24', 'right': '.I20',
                    'center': '.I22', 'left': '.I21'
                };
                return categoryMap[photoId] || '';
            };

            const categoryCode = getCategoryCode(selectedPhotoType);

            const urls = [
                `/DolImgs/${patientId}0${sortedTimepoints[0]}${categoryCode}`,
                `/DolImgs/${patientId}0${sortedTimepoints[1]}${categoryCode}`,
                '/images/logo_white.png'
            ];

            await comparison.loadImages(urls);
            setImages({
                img1: urls[0],
                img2: urls[1],
                logo: urls[2]
            });

        } catch (err) {
            console.error('Error loading comparison images:', err);
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    };

    const handleTimepointSelection = async (tpCode: number, checked: boolean) => {
        if (checked) {
            if (selectedTimepoints.length >= 2) {
                toast.warning('You can only select two timepoints for comparison');
                return;
            }

            if (timepointImages[tpCode]) {
                setSelectedTimepoints([...selectedTimepoints, tpCode]);
                return;
            }

            try {
                const response = await fetch(`/api/patients/${patientId}/timepoints/${tpCode}/images`);
                let images: string[];
                if (!response.ok) {
                    images = ['10', '12', '13', '20', '21', '22', '23', '24'];
                } else {
                    images = await response.json();
                }

                setTimepointImages(prev => ({ ...prev, [tpCode]: images }));
                setSelectedTimepoints([...selectedTimepoints, tpCode]);
            } catch {
                const defaultImages = ['10', '12', '13', '20', '21', '22', '23', '24'];
                setTimepointImages(prev => ({ ...prev, [tpCode]: defaultImages }));
                setSelectedTimepoints([...selectedTimepoints, tpCode]);
            }
        } else {
            setSelectedTimepoints(selectedTimepoints.filter(tp => tp !== tpCode));
        }
    };

    const handleCanvasSizeChange = (value: string) => {
        setCanvasSize(value);

        if (canvasRef.current && comparison) {
            if (value === 'auto') {
                // Enable auto mode and resize to fit images
                comparison.autoMode = true;
                if (comparison.images.length >= 2) {
                    comparison.resizeCanvasToFitImages();
                } else {
                    // Default size when no images loaded yet
                    canvasRef.current.width = 800;
                    canvasRef.current.height = 600;
                    setCanvasDimensions({ width: 800, height: 600 });
                }
            } else {
                // Disable auto mode and use fixed size
                comparison.autoMode = false;
                const size = JSON.parse(value) as CanvasDimensions;
                canvasRef.current.width = size.width;
                canvasRef.current.height = size.height;
                setCanvasDimensions({ width: size.width, height: size.height });
                comparison.originalDimensions = { width: size.width, height: size.height };
            }

            comparison.render();
        }
    };

    const handleWhatsAppSend = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!phoneNumber || !comparison) return;

        try {
            setSendingMessage(true);

            const imageData = comparison.toDataURL();
            const formData = new FormData();
            formData.append('phone', phoneNumber);
            formData.append('file', imageData);

            const response = await fetch('/sendmedia', {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                toast.success('Image sent successfully!');
                setShowWhatsAppModal(false);
            } else {
                throw new Error('Failed to send image');
            }
        } catch (err) {
            console.error('Error sending WhatsApp message:', err);
            toast.error('Failed to send image: ' + (err instanceof Error ? err.message : 'Unknown error'));
        } finally {
            setSendingMessage(false);
        }
    };

    if (loading && timepoints.length === 0) {
        return (
            <div className="loading-spinner">
                Loading compare page...
            </div>
        );
    }

    if (error) {
        return (
            <div className="error-message">
                <h3>Error</h3>
                <p>{error}</p>
                <button onClick={() => window.location.reload()}>Retry</button>
            </div>
        );
    }

    return (
        <div
            className="compare-container"
            style={{ padding: '20px', maxWidth: '1400px', margin: '0 auto' }}
        >
            {/* Status indicator */}
            <div
                style={{
                    padding: '15px',
                    marginBottom: '20px',
                    backgroundColor: selectedTimepoints.length === 2 && selectedPhotoType ? '#d4edda' : '#fff3cd',
                    border: '2px solid',
                    borderColor: selectedTimepoints.length === 2 && selectedPhotoType ? '#c3e6cb' : '#ffeaa7',
                    borderRadius: '8px',
                    color: selectedTimepoints.length === 2 && selectedPhotoType ? '#155724' : '#856404',
                    fontSize: '16px',
                    fontWeight: '500',
                    textAlign: 'center'
                }}
            >
                <strong>Status: </strong>
                <span>
                    {selectedTimepoints.length === 0 ? 'Select 2 timepoints to begin' :
                    selectedTimepoints.length === 1 ? 'Select 1 more timepoint' :
                    selectedTimepoints.length === 2 && !selectedPhotoType ? 'Now select a photo type' :
                    selectedTimepoints.length === 2 && selectedPhotoType ? 'Ready! Images should appear in canvas below' :
                    'Please select timepoints and photo type'}
                </span>
            </div>

            {/* Main Content Area - Canvas, Controls, and Selection */}
            <div style={{
                display: 'flex',
                gap: '20px',
                marginBottom: '20px',
                flexWrap: 'wrap'
            }}>
                {/* Canvas Container */}
                <div style={{
                    flex: '1',
                    minWidth: '600px',
                    display: 'flex',
                    justifyContent: 'center',
                    padding: '20px',
                    backgroundColor: '#f8f9fa',
                    borderRadius: '8px',
                    border: '1px solid #dee2e6',
                    overflow: 'auto'
                }}>
                    <canvas
                        ref={canvasRef}
                        id="comparison-canvas"
                        width={800}
                        height={600}
                        style={{
                            border: '1px solid #ccc',
                            borderRadius: '4px',
                            backgroundColor: 'white',
                            display: 'block',
                            maxWidth: '600px',
                            maxHeight: '800px',
                            width: 'auto',
                            height: 'auto',
                            objectFit: 'contain'
                        }}
                    />
                </div>

                {/* Controls Panel */}
                <div style={{
                    width: '280px',
                    backgroundColor: '#ffffff',
                    border: '1px solid #dee2e6',
                    borderRadius: '8px',
                    padding: '20px',
                    height: 'fit-content'
                }}>
                    <h3 style={{ margin: '0 0 15px 0', color: '#495057' }}>
                        Canvas Controls
                    </h3>

                    {/* Canvas Dimensions Display */}
                    <div style={{
                        marginBottom: '20px',
                        padding: '10px',
                        backgroundColor: '#f8f9fa',
                        border: '1px solid #dee2e6',
                        borderRadius: '6px',
                        textAlign: 'center'
                    }}>
                        <div style={{
                            fontSize: '12px',
                            fontWeight: 'bold',
                            color: '#6c757d',
                            marginBottom: '5px'
                        }}>
                            Canvas Size
                        </div>
                        <div style={{
                            fontSize: '16px',
                            fontWeight: 'bold',
                            color: '#495057',
                            fontFamily: 'monospace'
                        }}>
                            {canvasDimensions.width} × {canvasDimensions.height}
                        </div>
                    </div>

                    {/* Canvas Size */}
                    <div style={{ marginBottom: '15px' }}>
                        <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                            Canvas Size:
                        </label>
                        <select
                            value={canvasSize}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => handleCanvasSizeChange(e.target.value)}
                            title="Choose canvas dimensions - Auto fits to container, other options set specific pixel dimensions for social media"
                            style={{
                                width: '100%',
                                padding: '8px',
                                border: '1px solid #ddd',
                                borderRadius: '4px',
                                cursor: 'pointer'
                            }}
                        >
                            {canvasSizes.map(size => (
                                <option key={size.value} value={size.value}>
                                    {size.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Tool Selection */}
                    <div style={{ marginBottom: '15px' }}>
                        <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                            Selected Tool:
                        </label>
                        <select
                            value={selectedTool}
                            onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                                setSelectedTool(Number(e.target.value));
                                if (comparison) comparison.selectedImage = Number(e.target.value);
                            }}
                            title="Choose which element to manipulate - Image 1 (top/left), Image 2 (bottom/right), or Logo (overlay)"
                            style={{
                                width: '100%',
                                padding: '8px',
                                border: '1px solid #ddd',
                                borderRadius: '4px',
                                cursor: 'pointer'
                            }}
                        >
                            {tools.map(tool => (
                                <option key={tool.value} value={tool.value}>
                                    {tool.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Movement Controls */}
                    <div style={{ marginBottom: '15px' }}>
                        <label style={{ display: 'block', marginBottom: '10px', fontWeight: 'bold', textAlign: 'center' }}>
                            Move Selected Image:
                        </label>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '5px', maxWidth: '120px', margin: '0 auto' }}>
                            <div />
                            <button
                                onClick={() => comparison && comparison.moveImage('up')}
                                title="Move Up - Move the selected image upward"
                                style={{ padding: '8px', fontSize: '12px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                            >
                                ↑
                            </button>
                            <div />
                            <button
                                onClick={() => comparison && comparison.moveImage('left')}
                                title="Move Left - Move the selected image to the left"
                                style={{ padding: '8px', fontSize: '12px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                            >
                                ←
                            </button>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#666' }}>
                                ⊕
                            </div>
                            <button
                                onClick={() => comparison && comparison.moveImage('right')}
                                title="Move Right - Move the selected image to the right"
                                style={{ padding: '8px', fontSize: '12px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                            >
                                →
                            </button>
                            <div />
                            <button
                                onClick={() => comparison && comparison.moveImage('down')}
                                title="Move Down - Move the selected image downward"
                                style={{ padding: '8px', fontSize: '12px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                            >
                                ↓
                            </button>
                            <div />
                        </div>
                    </div>

                    {/* Control Buttons */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                        <button
                            onClick={() => comparison && comparison.zoomImage('in')}
                            title="Zoom In - Enlarge the selected image"
                            style={{ padding: '8px', fontSize: '12px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                        >
                            🔍+
                        </button>
                        <button
                            onClick={() => comparison && comparison.zoomImage('out')}
                            title="Zoom Out - Shrink the selected image"
                            style={{ padding: '8px', fontSize: '12px', backgroundColor: '#17a2b8', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                        >
                            🔍-
                        </button>
                        <button
                            onClick={() => comparison && comparison.rotateImage('clockwise')}
                            title="Rotate Clockwise - Rotate the selected image 15° clockwise"
                            style={{ padding: '8px', fontSize: '12px', backgroundColor: '#fd7e14', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                        >
                            ↻
                        </button>
                        <button
                            onClick={() => comparison && comparison.rotateImage('counterclockwise')}
                            title="Rotate Counter-Clockwise - Rotate the selected image 15° counter-clockwise"
                            style={{ padding: '8px', fontSize: '12px', backgroundColor: '#6f42c1', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                        >
                            ↺
                        </button>
                        <button
                            onClick={() => comparison && comparison.toggleOrientation()}
                            title="Toggle Layout - Switch between vertical and horizontal image arrangement"
                            style={{ padding: '8px', fontSize: '12px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                        >
                            ⟲
                        </button>
                        <button
                            onClick={() => comparison && comparison.toggleBisect()}
                            title="Toggle Bisect Line - Show/hide alignment line between images"
                            style={{ padding: '8px', fontSize: '12px', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                        >
                            ═
                        </button>
                        <button
                            onClick={() => {
                                setShowLogo(!showLogo);
                                if (comparison) {
                                    comparison.toggleLogo();
                                }
                            }}
                            title={showLogo ? 'Hide Logo - Remove logo from comparison' : 'Show Logo - Add logo to comparison'}
                            style={{ padding: '8px', fontSize: '12px', backgroundColor: showLogo ? '#ffc107' : '#28a745', color: showLogo ? '#212529' : 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                        >
                            {showLogo ? 'Hide Logo' : 'Show Logo'}
                        </button>
                        <button
                            onClick={() => comparison && comparison.reset()}
                            title="Reset All - Return all images to their original position, size, and rotation"
                            style={{ padding: '8px', fontSize: '12px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                        >
                            Reset
                        </button>
                        <button
                            onClick={() => setShowWhatsAppModal(true)}
                            title="Send to WhatsApp - Export the comparison image and send via WhatsApp"
                            style={{ padding: '8px', fontSize: '12px', backgroundColor: '#25d366', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                        >
                            WhatsApp
                        </button>
                    </div>
                </div>

                {/* Merged Selection Panel (Timepoints + Photo Types) */}
                <div style={{
                    width: '320px',
                    backgroundColor: '#ffffff',
                    border: '1px solid #dee2e6',
                    borderRadius: '8px',
                    padding: '20px',
                    height: 'fit-content',
                    maxHeight: '600px',
                    overflowY: 'auto'
                }}>
                    <h3 style={{ margin: '0 0 20px 0', color: '#495057', textAlign: 'center' }}>
                        Image Selection
                    </h3>

                    {/* Step 1: Timepoints Selection */}
                    <div style={{
                        marginBottom: '25px',
                        padding: '15px',
                        backgroundColor: '#f8f9fa',
                        borderRadius: '6px',
                        border: '1px solid #e9ecef'
                    }}>
                        <h4 style={{
                            margin: '0 0 15px 0',
                            color: '#495057',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                        }}>
                            <span style={{
                                backgroundColor: selectedTimepoints.length === 2 ? '#28a745' : '#6c757d',
                                color: 'white',
                                borderRadius: '50%',
                                width: '20px',
                                height: '20px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '12px',
                                fontWeight: 'bold'
                            }}>
                                1
                            </span>
                            <span>Select 2 Timepoints</span>
                        </h4>
                        <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
                            {timepoints.map(tp => (
                                <label
                                    key={tp.tpCode}
                                    style={{
                                        display: 'block',
                                        marginBottom: '8px',
                                        padding: '8px',
                                        backgroundColor: selectedTimepoints.includes(tp.tpCode) ? '#e3f2fd' : 'white',
                                        border: '1px solid #ddd',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        fontSize: '14px'
                                    }}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedTimepoints.includes(tp.tpCode)}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => handleTimepointSelection(tp.tpCode, e.target.checked)}
                                        style={{ marginRight: '8px' }}
                                    />
                                    <span>
                                        {tp.tpDescription} ({new Date(tp.tpDateTime).toLocaleDateString()})
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Step 2: Photo Type Selection */}
                    <div style={{
                        padding: '15px',
                        backgroundColor: selectedTimepoints.length === 2 ? '#f8f9fa' : '#f1f3f4',
                        borderRadius: '6px',
                        border: '1px solid #e9ecef',
                        opacity: selectedTimepoints.length === 2 ? 1 : 0.6
                    }}>
                        <h4 style={{
                            margin: '0 0 15px 0',
                            color: '#495057',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                        }}>
                            <span style={{
                                backgroundColor: selectedTimepoints.length === 2 && selectedPhotoType ? '#28a745' : '#6c757d',
                                color: 'white',
                                borderRadius: '50%',
                                width: '20px',
                                height: '20px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '12px',
                                fontWeight: 'bold'
                            }}>
                                2
                            </span>
                            <span>Select Photo Type</span>
                        </h4>
                        {selectedTimepoints.length < 2 && (
                            <p style={{
                                margin: '0 0 15px 0',
                                fontSize: '13px',
                                color: '#6c757d',
                                fontStyle: 'italic'
                            }}>
                                Select 2 timepoints first
                            </p>
                        )}
                        <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                            {['facial', 'occlusal', 'intraoral'].map(category => (
                                <div key={category} style={{ marginBottom: '12px' }}>
                                    <h5 style={{
                                        margin: '0 0 8px 0',
                                        textTransform: 'capitalize',
                                        color: '#495057',
                                        fontSize: '13px',
                                        fontWeight: '600'
                                    }}>
                                        {category}
                                    </h5>
                                    <div>
                                        {photoTypes.filter(pt => pt.category === category).map(photoType => (
                                            <label
                                                key={photoType.id}
                                                style={{
                                                    display: 'block',
                                                    marginBottom: '4px',
                                                    padding: '6px 8px',
                                                    backgroundColor: selectedPhotoType === photoType.id ? '#e3f2fd' : 'white',
                                                    border: '1px solid #ddd',
                                                    borderRadius: '4px',
                                                    cursor: isPhotoTypeAvailable(photoType.code) && selectedTimepoints.length === 2 ? 'pointer' : 'not-allowed',
                                                    opacity: isPhotoTypeAvailable(photoType.code) && selectedTimepoints.length === 2 ? 1 : 0.5,
                                                    fontSize: '13px'
                                                }}
                                            >
                                                <input
                                                    type="radio"
                                                    name="photoType"
                                                    value={photoType.id}
                                                    checked={selectedPhotoType === photoType.id}
                                                    disabled={!isPhotoTypeAvailable(photoType.code) || selectedTimepoints.length !== 2}
                                                    onChange={(e: ChangeEvent<HTMLInputElement>) => setSelectedPhotoType(e.target.value)}
                                                    style={{ marginRight: '6px' }}
                                                />
                                                <span>{photoType.label}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* WhatsApp Modal */}
            {showWhatsAppModal && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1000
                }}>
                    <div style={{
                        backgroundColor: 'white',
                        padding: '30px',
                        borderRadius: '8px',
                        width: '400px',
                        maxWidth: '90vw'
                    }}>
                        <h3>Send to WhatsApp</h3>
                        <form onSubmit={handleWhatsAppSend}>
                            <input
                                type="tel"
                                placeholder="Phone number"
                                value={phoneNumber}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => setPhoneNumber(e.target.value)}
                                required
                                style={{
                                    width: '100%',
                                    padding: '10px',
                                    marginBottom: '20px',
                                    border: '1px solid #ddd',
                                    borderRadius: '4px'
                                }}
                            />
                            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                                <button
                                    type="button"
                                    onClick={() => setShowWhatsAppModal(false)}
                                    style={{
                                        padding: '10px 20px',
                                        backgroundColor: '#6c757d',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '4px'
                                    }}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={sendingMessage}
                                    style={{
                                        padding: '10px 20px',
                                        backgroundColor: '#25d366',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '4px'
                                    }}
                                >
                                    {sendingMessage ? 'Sending...' : 'Send'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

// Memoize to prevent unnecessary re-renders
// Only re-renders when patientId or phone props change
export default React.memo(CompareComponent);
