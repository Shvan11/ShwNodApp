// CompareComponent.js - Image comparison component for patient portal
const CompareComponent = ({ patientId, phone }) => {
    const { useState, useEffect, useRef } = React;
    
    const [timepoints, setTimepoints] = useState([]);
    const [selectedTimepoints, setSelectedTimepoints] = useState([]);
    const [selectedPhotoType, setSelectedPhotoType] = useState('');
    const [timepointImages, setTimepointImages] = useState({});
    const [, setImages] = useState({ img1: null, img2: null, logo: null });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [canvasSize, setCanvasSize] = useState('auto');
    const [selectedTool, setSelectedTool] = useState(1);
    const [comparison, setComparison] = useState(null);
    const [showWhatsAppModal, setShowWhatsAppModal] = useState(false);
    const [phoneNumber, setPhoneNumber] = useState(phone || '');
    const [sendingMessage, setSendingMessage] = useState(false);
    const [showLogo, setShowLogo] = useState(true);
    const [canvasDimensions, setCanvasDimensions] = useState({ width: 800, height: 600 });
    
    // Canvas ref for comparison
    const canvasRef = useRef(null);
    
    // Photo type options with improved categorization
    const photoTypes = [
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
    const canvasSizes = [
        { value: 'auto', label: 'Auto' },
        { value: '{"width":1080,"height":1350}', label: 'Post (1080 × 1350)' },
        { value: '{"width":1080,"height":1920}', label: 'Story (1080 × 1920)' },
        { value: '{"width":2060,"height":2700}', label: '2060 × 2700' }
    ];
    
    // Tool selection options
    const tools = [
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
    const isPhotoTypeAvailable = (photoCode) => {
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
        try {
            setLoading(true);
            const response = await fetch(`/api/gettimepoints?code=${patientId}`);
            if (!response.ok) throw new Error('Failed to load timepoints');
            
            const data = await response.json();
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
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };
    
    const initializeComparison = () => {
        if (!canvasRef.current) return;
        
        // Create comparison handler
        const comparisonHandler = {
            canvas: canvasRef.current,
            context: canvasRef.current.getContext('2d'),
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
                width: canvasRef.current.width,
                height: canvasRef.current.height
            },
            autoMode: true,
            
            loadImages: async function(urls) {
                console.log('Loading images:', urls);
                this.images = [];
                for (let i = 0; i < urls.length; i++) {
                    const url = urls[i];
                    const img = new Image();
                    
                    try {
                        await new Promise((resolve, reject) => {
                            const timeout = setTimeout(() => {
                                reject(new Error(`Timeout loading image: ${url}`));
                            }, 10000);
                            
                            img.onload = () => {
                                clearTimeout(timeout);
                                console.log(`✅ Image ${i} loaded successfully:`, url);
                                resolve();
                            };
                            
                            img.onerror = (error) => {
                                clearTimeout(timeout);
                                console.error(`❌ Image ${i} failed to load:`, url);
                                reject(new Error(`Failed to load image: ${url}`));
                            };
                            
                            img.src = url;
                        });
                        
                        this.images.push(img);
                    } catch (error) {
                        console.error(`❌ Error loading image ${url}:`, error);
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
                
                let canvasWidth, canvasHeight;
                
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
            
            drawImage: function(img, x, y, width, height, key) {
                const ctx = this.context;
                const transform = this.transform[key];
                
                if (!img.complete || img.naturalWidth === 0) return;
                
                // In auto mode, prioritize aspect ratio preservation over transforms
                if (this.autoMode && (transform.x === 0 && transform.y === 0 && transform.scale === 1 && transform.rotation === 0)) {
                    // Pure aspect ratio preservation without transforms
                    const aspectRatio = img.width / img.height;
                    const containerRatio = width / height;
                    
                    let drawWidth, drawHeight, drawX, drawY;
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
                    ctx.translate(x + width/2 + transform.x, y + height/2 + transform.y);
                    ctx.rotate(transform.rotation * Math.PI / 180);
                    ctx.scale(transform.scale, transform.scale);
                    
                    const aspectRatio = img.width / img.height;
                    const containerRatio = width / height;
                    
                    let drawWidth, drawHeight;
                    if (aspectRatio > containerRatio) {
                        drawWidth = width;
                        drawHeight = width / aspectRatio;
                    } else {
                        drawHeight = height;
                        drawWidth = height * aspectRatio;
                    }
                    
                    ctx.drawImage(img, -drawWidth/2, -drawHeight/2, drawWidth, drawHeight);
                    ctx.restore();
                }
            },
            
            drawLogo: function(img) {
                const ctx = this.context;
                const canvas = this.canvas;
                const transform = this.transform.logo;
                
                // In auto mode, use a reasonable fixed size relative to canvas
                let logoWidth, logoHeight;
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
                ctx.translate(logoX + logoWidth/2, logoY + logoHeight/2);
                ctx.rotate(transform.rotation * Math.PI / 180);
                ctx.scale(transform.scale, transform.scale);
                ctx.drawImage(img, -logoWidth/2, -logoHeight/2, logoWidth, logoHeight);
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
            moveImage: function(direction, amount = 10) {
                const key = this.selectedImage === 1 ? 'img1' : this.selectedImage === 2 ? 'img2' : 'logo';
                const transform = this.transform[key];
                
                switch (direction) {
                    case 'left': transform.x -= amount; break;
                    case 'right': transform.x += amount; break;
                    case 'up': transform.y -= amount; break;
                    case 'down': transform.y += amount; break;
                }
                this.render();
            },
            
            zoomImage: function(direction) {
                const key = this.selectedImage === 1 ? 'img1' : this.selectedImage === 2 ? 'img2' : 'logo';
                const transform = this.transform[key];
                const factor = direction === 'in' ? 1.1 : 0.9;
                
                transform.scale *= factor;
                transform.scale = Math.max(0.1, Math.min(5, transform.scale));
                this.render();
            },
            
            rotateImage: function(direction) {
                const key = this.selectedImage === 1 ? 'img1' : this.selectedImage === 2 ? 'img2' : 'logo';
                const transform = this.transform[key];
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
            
            const getCategoryCode = (photoId) => {
                const categoryMap = {
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
                '/logo_white.png'
            ];
            
            await comparison.loadImages(urls);
            setImages({
                img1: urls[0],
                img2: urls[1],
                logo: urls[2]
            });
            
        } catch (err) {
            console.error('Error loading comparison images:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };
    
    const handleTimepointSelection = async (tpCode, checked) => {
        if (checked) {
            if (selectedTimepoints.length >= 2) {
                alert('You can only select two timepoints for comparison');
                return;
            }
            
            if (timepointImages[tpCode]) {
                setSelectedTimepoints([...selectedTimepoints, tpCode]);
                return;
            }
            
            try {
                const response = await fetch(`/api/gettimepointimgs?code=${patientId}&tp=${tpCode}`);
                let images;
                if (!response.ok) {
                    images = ['10', '12', '13', '20', '21', '22', '23', '24'];
                } else {
                    images = await response.json();
                }
                
                setTimepointImages(prev => ({ ...prev, [tpCode]: images }));
                setSelectedTimepoints([...selectedTimepoints, tpCode]);
            } catch (error) {
                const defaultImages = ['10', '12', '13', '20', '21', '22', '23', '24'];
                setTimepointImages(prev => ({ ...prev, [tpCode]: defaultImages }));
                setSelectedTimepoints([...selectedTimepoints, tpCode]);
            }
        } else {
            setSelectedTimepoints(selectedTimepoints.filter(tp => tp !== tpCode));
        }
    };
    
    const handleCanvasSizeChange = (value) => {
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
                const size = JSON.parse(value);
                canvasRef.current.width = size.width;
                canvasRef.current.height = size.height;
                setCanvasDimensions({ width: size.width, height: size.height });
                comparison.originalDimensions = { width: size.width, height: size.height };
            }
            
            comparison.render();
        }
    };
    
    const handleWhatsAppSend = async (e) => {
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
                alert('Image sent successfully!');
                setShowWhatsAppModal(false);
            } else {
                throw new Error('Failed to send image');
            }
        } catch (err) {
            console.error('Error sending WhatsApp message:', err);
            alert('Failed to send image: ' + err.message);
        } finally {
            setSendingMessage(false);
        }
    };
    
    if (loading && timepoints.length === 0) {
        return React.createElement('div', { 
            className: 'loading-spinner' 
        }, 'Loading compare page...');
    }
    
    if (error) {
        return React.createElement('div', { 
            className: 'error-message' 
        }, [
            React.createElement('h3', { key: 'title' }, 'Error'),
            React.createElement('p', { key: 'message' }, error),
            React.createElement('button', { 
                key: 'retry',
                onClick: () => window.location.reload() 
            }, 'Retry')
        ]);
    }
    
    return React.createElement('div', { 
        className: 'compare-container',
        style: { padding: '20px', maxWidth: '1400px', margin: '0 auto' }
    }, [
        // Status indicator
        React.createElement('div', { 
            key: 'status',
            style: { 
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
            }
        }, [
            React.createElement('strong', { key: 'title' }, 'Status: '),
            React.createElement('span', { key: 'message' }, 
                selectedTimepoints.length === 0 ? 'Select 2 timepoints to begin' :
                selectedTimepoints.length === 1 ? 'Select 1 more timepoint' :
                selectedTimepoints.length === 2 && !selectedPhotoType ? 'Now select a photo type' :
                selectedTimepoints.length === 2 && selectedPhotoType ? 'Ready! Images should appear in canvas below' :
                'Please select timepoints and photo type'
            )
        ]),
        
        // Main Content Area - Canvas, Controls, and Selection
        React.createElement('div', {
            key: 'main-content',
            style: {
                display: 'flex',
                gap: '20px',
                marginBottom: '20px',
                flexWrap: 'wrap' // Allow wrapping on narrow screens
            }
        }, [
            // Canvas Container
            React.createElement('div', {
                key: 'canvas-container',
                style: {
                    flex: '1',
                    minWidth: '600px', // Increased minimum width
                    display: 'flex',
                    justifyContent: 'center',
                    padding: '20px',
                    backgroundColor: '#f8f9fa',
                    borderRadius: '8px',
                    border: '1px solid #dee2e6',
                    overflow: 'auto' // Allow scrolling if needed
                }
            }, React.createElement('canvas', {
                ref: canvasRef,
                id: 'comparison-canvas',
                width: 800,
                height: 600,
                style: {
                    border: '1px solid #ccc',
                    borderRadius: '4px',
                    backgroundColor: 'white',
                    display: 'block',
                    // Responsive sizing with max dimensions to prevent huge display
                    maxWidth: '600px',
                    maxHeight: '800px', // Increased for vertical layouts
                    width: 'auto',
                    height: 'auto',
                    objectFit: 'contain'
                }
            })),
            
            // Controls Panel
            React.createElement('div', {
                key: 'controls',
                style: {
                    width: '280px',
                    backgroundColor: '#ffffff',
                    border: '1px solid #dee2e6',
                    borderRadius: '8px',
                    padding: '20px',
                    height: 'fit-content'
                }
            }, [
                React.createElement('h3', { 
                    key: 'title',
                    style: { margin: '0 0 15px 0', color: '#495057' }
                }, 'Canvas Controls'),
                
                // Canvas Dimensions Display
                React.createElement('div', { 
                    key: 'dimensions-display',
                    style: {
                        marginBottom: '20px',
                        padding: '10px',
                        backgroundColor: '#f8f9fa',
                        border: '1px solid #dee2e6',
                        borderRadius: '6px',
                        textAlign: 'center'
                    }
                }, [
                    React.createElement('div', { 
                        key: 'label',
                        style: { 
                            fontSize: '12px', 
                            fontWeight: 'bold', 
                            color: '#6c757d',
                            marginBottom: '5px'
                        }
                    }, 'Canvas Size'),
                    React.createElement('div', { 
                        key: 'dimensions',
                        style: { 
                            fontSize: '16px', 
                            fontWeight: 'bold', 
                            color: '#495057',
                            fontFamily: 'monospace'
                        }
                    }, `${canvasDimensions.width} × ${canvasDimensions.height}`)
                ]),
                
                // Canvas Size
                React.createElement('div', { key: 'size-control', style: { marginBottom: '15px' } }, [
                    React.createElement('label', { 
                        key: 'size-label',
                        style: { display: 'block', marginBottom: '5px', fontWeight: 'bold' }
                    }, 'Canvas Size:'),
                    React.createElement('select', {
                        key: 'size-select',
                        value: canvasSize,
                        onChange: (e) => handleCanvasSizeChange(e.target.value),
                        title: 'Choose canvas dimensions - Auto fits to container, other options set specific pixel dimensions for social media',
                        style: {
                            width: '100%',
                            padding: '8px',
                            border: '1px solid #ddd',
                            borderRadius: '4px',
                            cursor: 'pointer'
                        }
                    }, canvasSizes.map(size =>
                        React.createElement('option', {
                            key: size.value,
                            value: size.value
                        }, size.label)
                    ))
                ]),
                
                // Tool Selection
                React.createElement('div', { key: 'tool-control', style: { marginBottom: '15px' } }, [
                    React.createElement('label', { 
                        key: 'tool-label',
                        style: { display: 'block', marginBottom: '5px', fontWeight: 'bold' }
                    }, 'Selected Tool:'),
                    React.createElement('select', {
                        key: 'tool-select',
                        value: selectedTool,
                        onChange: (e) => {
                            setSelectedTool(Number(e.target.value));
                            if (comparison) comparison.selectedImage = Number(e.target.value);
                        },
                        title: 'Choose which element to manipulate - Image 1 (top/left), Image 2 (bottom/right), or Logo (overlay)',
                        style: {
                            width: '100%',
                            padding: '8px',
                            border: '1px solid #ddd',
                            borderRadius: '4px',
                            cursor: 'pointer'
                        }
                    }, tools.map(tool =>
                        React.createElement('option', {
                            key: tool.value,
                            value: tool.value
                        }, tool.label)
                    ))
                ]),
                
                // Movement Controls
                React.createElement('div', { key: 'movement', style: { marginBottom: '15px' } }, [
                    React.createElement('label', { 
                        key: 'movement-label',
                        style: { display: 'block', marginBottom: '10px', fontWeight: 'bold', textAlign: 'center' }
                    }, 'Move Selected Image:'),
                    React.createElement('div', { 
                        key: 'movement-grid',
                        style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '5px', maxWidth: '120px', margin: '0 auto' }
                    }, [
                        React.createElement('div', { key: 'empty1' }),
                        React.createElement('button', {
                            key: 'move-up',
                            onClick: () => comparison && comparison.moveImage('up'),
                            title: 'Move Up - Move the selected image upward',
                            style: { padding: '8px', fontSize: '12px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }
                        }, '↑'),
                        React.createElement('div', { key: 'empty2' }),
                        React.createElement('button', {
                            key: 'move-left',
                            onClick: () => comparison && comparison.moveImage('left'),
                            title: 'Move Left - Move the selected image to the left',
                            style: { padding: '8px', fontSize: '12px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }
                        }, '←'),
                        React.createElement('div', { 
                            key: 'center',
                            style: { display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#666' }
                        }, '⊕'),
                        React.createElement('button', {
                            key: 'move-right',
                            onClick: () => comparison && comparison.moveImage('right'),
                            title: 'Move Right - Move the selected image to the right',
                            style: { padding: '8px', fontSize: '12px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }
                        }, '→'),
                        React.createElement('div', { key: 'empty3' }),
                        React.createElement('button', {
                            key: 'move-down',
                            onClick: () => comparison && comparison.moveImage('down'),
                            title: 'Move Down - Move the selected image downward',
                            style: { padding: '8px', fontSize: '12px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }
                        }, '↓'),
                        React.createElement('div', { key: 'empty4' })
                    ])
                ]),

                // Control Buttons
                React.createElement('div', { key: 'buttons', style: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' } }, [
                    React.createElement('button', {
                        key: 'zoom-in',
                        onClick: () => comparison && comparison.zoomImage('in'),
                        title: 'Zoom In - Enlarge the selected image',
                        style: { padding: '8px', fontSize: '12px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }
                    }, '🔍+'),
                    React.createElement('button', {
                        key: 'zoom-out',
                        onClick: () => comparison && comparison.zoomImage('out'),
                        title: 'Zoom Out - Shrink the selected image',
                        style: { padding: '8px', fontSize: '12px', backgroundColor: '#17a2b8', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }
                    }, '🔍-'),
                    React.createElement('button', {
                        key: 'rotate-cw',
                        onClick: () => comparison && comparison.rotateImage('clockwise'),
                        title: 'Rotate Clockwise - Rotate the selected image 15° clockwise',
                        style: { padding: '8px', fontSize: '12px', backgroundColor: '#fd7e14', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }
                    }, '↻'),
                    React.createElement('button', {
                        key: 'rotate-ccw',
                        onClick: () => comparison && comparison.rotateImage('counterclockwise'),
                        title: 'Rotate Counter-Clockwise - Rotate the selected image 15° counter-clockwise',
                        style: { padding: '8px', fontSize: '12px', backgroundColor: '#6f42c1', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }
                    }, '↺'),
                    React.createElement('button', {
                        key: 'toggle-orientation',
                        onClick: () => comparison && comparison.toggleOrientation(),
                        title: 'Toggle Layout - Switch between vertical and horizontal image arrangement',
                        style: { padding: '8px', fontSize: '12px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }
                    }, '⟲'),
                    React.createElement('button', {
                        key: 'toggle-bisect',
                        onClick: () => comparison && comparison.toggleBisect(),
                        title: 'Toggle Bisect Line - Show/hide alignment line between images',
                        style: { padding: '8px', fontSize: '12px', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }
                    }, '═'),
                    React.createElement('button', {
                        key: 'toggle-logo',
                        onClick: () => {
                            setShowLogo(!showLogo);
                            if (comparison) {
                                comparison.toggleLogo();
                            }
                        },
                        title: showLogo ? 'Hide Logo - Remove logo from comparison' : 'Show Logo - Add logo to comparison',
                        style: { padding: '8px', fontSize: '12px', backgroundColor: showLogo ? '#ffc107' : '#28a745', color: showLogo ? '#212529' : 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }
                    }, showLogo ? 'Hide Logo' : 'Show Logo'),
                    React.createElement('button', {
                        key: 'reset',
                        onClick: () => comparison && comparison.reset(),
                        title: 'Reset All - Return all images to their original position, size, and rotation',
                        style: { padding: '8px', fontSize: '12px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }
                    }, 'Reset'),
                    React.createElement('button', {
                        key: 'whatsapp',
                        onClick: () => setShowWhatsAppModal(true),
                        title: 'Send to WhatsApp - Export the comparison image and send via WhatsApp',
                        style: { padding: '8px', fontSize: '12px', backgroundColor: '#25d366', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }
                    }, 'WhatsApp')
                ])
            ]),
            
            // Merged Selection Panel (Timepoints + Photo Types)
            React.createElement('div', {
                key: 'selection-panel',
                style: {
                    width: '320px',
                    backgroundColor: '#ffffff',
                    border: '1px solid #dee2e6',
                    borderRadius: '8px',
                    padding: '20px',
                    height: 'fit-content',
                    maxHeight: '600px',
                    overflowY: 'auto'
                }
            }, [
                React.createElement('h3', { 
                    key: 'title',
                    style: { margin: '0 0 20px 0', color: '#495057', textAlign: 'center' }
                }, 'Image Selection'),
                
                // Step 1: Timepoints Selection
                React.createElement('div', { 
                    key: 'timepoints-section',
                    style: {
                        marginBottom: '25px',
                        padding: '15px',
                        backgroundColor: '#f8f9fa',
                        borderRadius: '6px',
                        border: '1px solid #e9ecef'
                    }
                }, [
                    React.createElement('h4', { 
                        key: 'timepoints-title',
                        style: { 
                            margin: '0 0 15px 0', 
                            color: '#495057',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                        }
                    }, [
                        React.createElement('span', { 
                            key: 'step',
                            style: {
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
                            }
                        }, '1'),
                        React.createElement('span', { key: 'title' }, 'Select 2 Timepoints')
                    ]),
                    React.createElement('div', { 
                        key: 'timepoints-list',
                        style: { maxHeight: '180px', overflowY: 'auto' }
                    }, 
                        timepoints.map(tp =>
                            React.createElement('label', {
                                key: tp.tpCode,
                                style: { 
                                    display: 'block', 
                                    marginBottom: '8px',
                                    padding: '8px',
                                    backgroundColor: selectedTimepoints.includes(tp.tpCode) ? '#e3f2fd' : 'white',
                                    border: '1px solid #ddd',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontSize: '14px'
                                }
                            }, [
                                React.createElement('input', {
                                    key: 'checkbox',
                                    type: 'checkbox',
                                    checked: selectedTimepoints.includes(tp.tpCode),
                                    onChange: (e) => handleTimepointSelection(tp.tpCode, e.target.checked),
                                    style: { marginRight: '8px' }
                                }),
                                React.createElement('span', { key: 'label' }, 
                                    `${tp.tpDescription} (${new Date(tp.tpDateTime).toLocaleDateString()})`
                                )
                            ])
                        )
                    )
                ]),
                
                // Step 2: Photo Type Selection
                React.createElement('div', { 
                    key: 'photo-types-section',
                    style: {
                        padding: '15px',
                        backgroundColor: selectedTimepoints.length === 2 ? '#f8f9fa' : '#f1f3f4',
                        borderRadius: '6px',
                        border: '1px solid #e9ecef',
                        opacity: selectedTimepoints.length === 2 ? 1 : 0.6
                    }
                }, [
                    React.createElement('h4', { 
                        key: 'photo-types-title',
                        style: { 
                            margin: '0 0 15px 0', 
                            color: '#495057',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px'
                        }
                    }, [
                        React.createElement('span', { 
                            key: 'step',
                            style: {
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
                            }
                        }, '2'),
                        React.createElement('span', { key: 'title' }, 'Select Photo Type')
                    ]),
                    selectedTimepoints.length < 2 && React.createElement('p', {
                        key: 'instruction',
                        style: { 
                            margin: '0 0 15px 0', 
                            fontSize: '13px', 
                            color: '#6c757d',
                            fontStyle: 'italic'
                        }
                    }, 'Select 2 timepoints first'),
                    React.createElement('div', { 
                        key: 'photo-types-list',
                        style: { maxHeight: '200px', overflowY: 'auto' }
                    }, 
                        ['facial', 'occlusal', 'intraoral'].map(category =>
                            React.createElement('div', { 
                                key: category,
                                style: { marginBottom: '12px' }
                            }, [
                                React.createElement('h5', { 
                                    key: 'category-title',
                                    style: { 
                                        margin: '0 0 8px 0', 
                                        textTransform: 'capitalize',
                                        color: '#495057',
                                        fontSize: '13px',
                                        fontWeight: '600'
                                    }
                                }, category),
                                React.createElement('div', { key: 'options' },
                                    photoTypes.filter(pt => pt.category === category).map(photoType =>
                                        React.createElement('label', {
                                            key: photoType.id,
                                            style: { 
                                                display: 'block', 
                                                marginBottom: '4px',
                                                padding: '6px 8px',
                                                backgroundColor: selectedPhotoType === photoType.id ? '#e3f2fd' : 'white',
                                                border: '1px solid #ddd',
                                                borderRadius: '4px',
                                                cursor: isPhotoTypeAvailable(photoType.code) && selectedTimepoints.length === 2 ? 'pointer' : 'not-allowed',
                                                opacity: isPhotoTypeAvailable(photoType.code) && selectedTimepoints.length === 2 ? 1 : 0.5,
                                                fontSize: '13px'
                                            }
                                        }, [
                                            React.createElement('input', {
                                                key: 'radio',
                                                type: 'radio',
                                                name: 'photoType',
                                                value: photoType.id,
                                                checked: selectedPhotoType === photoType.id,
                                                disabled: !isPhotoTypeAvailable(photoType.code) || selectedTimepoints.length !== 2,
                                                onChange: (e) => setSelectedPhotoType(e.target.value),
                                                style: { marginRight: '6px' }
                                            }),
                                            React.createElement('span', { key: 'label' }, photoType.label)
                                        ])
                                    )
                                )
                            ])
                        )
                    )
                ])
            ])
        ]),
        
        // WhatsApp Modal
        showWhatsAppModal && React.createElement('div', {
            key: 'whatsapp-modal',
            style: {
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
            }
        }, React.createElement('div', {
            style: {
                backgroundColor: 'white',
                padding: '30px',
                borderRadius: '8px',
                width: '400px',
                maxWidth: '90vw'
            }
        }, [
            React.createElement('h3', { key: 'title' }, 'Send to WhatsApp'),
            React.createElement('form', {
                key: 'form',
                onSubmit: handleWhatsAppSend
            }, [
                React.createElement('input', {
                    key: 'phone',
                    type: 'tel',
                    placeholder: 'Phone number',
                    value: phoneNumber,
                    onChange: (e) => setPhoneNumber(e.target.value),
                    required: true,
                    style: {
                        width: '100%',
                        padding: '10px',
                        marginBottom: '20px',
                        border: '1px solid #ddd',
                        borderRadius: '4px'
                    }
                }),
                React.createElement('div', { 
                    key: 'buttons',
                    style: { display: 'flex', gap: '10px', justifyContent: 'flex-end' }
                }, [
                    React.createElement('button', {
                        key: 'cancel',
                        type: 'button',
                        onClick: () => setShowWhatsAppModal(false),
                        style: {
                            padding: '10px 20px',
                            backgroundColor: '#6c757d',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px'
                        }
                    }, 'Cancel'),
                    React.createElement('button', {
                        key: 'send',
                        type: 'submit',
                        disabled: sendingMessage,
                        style: {
                            padding: '10px 20px',
                            backgroundColor: '#25d366',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px'
                        }
                    }, sendingMessage ? 'Sending...' : 'Send')
                ])
            ])
        ]))
    ]);
};

window.CompareComponent = CompareComponent;