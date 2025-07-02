class NavigationContext {
    constructor() {
        this.state = {
            currentPage: null,
            currentPatient: null,
            previousPage: null,
            breadcrumb: [],
            navigationHistory: [],
            searchHistory: []
        };
        
        this.subscribers = [];
        this.maxHistorySize = 10;
        
        this.init();
    }

    init() {
        this.updateCurrentContext();
        this.setupEventListeners();
        this.loadStoredState();
    }

    updateCurrentContext() {
        const path = window.location.pathname;
        const searchParams = new URLSearchParams(window.location.search);
        
        this.state.currentPage = this.getPageTypeFromPath(path);
        this.state.currentPatient = this.extractPatientFromPath(path);
        
        this.updateBreadcrumb();
        this.addToHistory(path);
        this.notifySubscribers();
    }

    getPageTypeFromPath(path) {
        if (path === '/' || path === '/index.html') return 'home';
        if (path.includes('/daily-appointments')) return 'appointments';
        if (path.includes('/search')) return 'search';
        if (path.includes('/patient/')) return 'patient';
        if (path.includes('/send-message')) return 'messaging';
        if (path.includes('/auth')) return 'auth';
        return 'other';
    }

    extractPatientFromPath(path) {
        const patientMatch = path.match(/\/patient\/(\d+)/);
        return patientMatch ? patientMatch[1] : null;
    }

    updateBreadcrumb() {
        const breadcrumb = [];
        const currentPage = this.state.currentPage;
        const currentPatient = this.state.currentPatient;

        if (currentPage === 'patient' && currentPatient) {
            const referrer = document.referrer;
            if (referrer.includes('/daily-appointments')) {
                breadcrumb.push({ name: 'Appointments', url: '/daily-appointments', icon: 'fas fa-calendar-alt' });
            } else if (referrer.includes('/search')) {
                breadcrumb.push({ name: 'Search', url: '/search', icon: 'fas fa-search' });
            }
        }

        this.state.breadcrumb = breadcrumb;
    }

    addToHistory(path) {
        if (this.state.navigationHistory[this.state.navigationHistory.length - 1] !== path) {
            this.state.navigationHistory.push(path);
            if (this.state.navigationHistory.length > this.maxHistorySize) {
                this.state.navigationHistory.shift();
            }
            this.saveState();
        }
    }

    addToSearchHistory(searchTerm, resultCount) {
        if (!searchTerm) return;
        
        const searchEntry = {
            term: searchTerm,
            timestamp: new Date().toISOString(),
            resultCount: resultCount
        };

        this.state.searchHistory = this.state.searchHistory.filter(entry => entry.term !== searchTerm);
        this.state.searchHistory.unshift(searchEntry);
        
        if (this.state.searchHistory.length > this.maxHistorySize) {
            this.state.searchHistory.pop();
        }
        
        this.saveState();
    }

    setupEventListeners() {
        window.addEventListener('popstate', () => {
            this.updateCurrentContext();
        });

        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;

        history.pushState = (...args) => {
            originalPushState.apply(history, args);
            this.updateCurrentContext();
        };

        history.replaceState = (...args) => {
            originalReplaceState.apply(history, args);
            this.updateCurrentContext();
        };

        // Setup WebSocket navigation events
        this.setupWebSocketEvents();
    }

    setupWebSocketEvents() {
        // Listen for WebSocket navigation events
        if (window.addEventListener) {
            window.addEventListener('navigation_update', (event) => {
                this.handleNavigationUpdate(event.detail);
            });
            
            window.addEventListener('patient_loaded', (event) => {
                if (event.detail?.patientId) {
                    this.setCurrentPatient(event.detail.patientId);
                }
            });
            
            window.addEventListener('patient_unloaded', () => {
                this.state.currentPatient = null;
                this.notifySubscribers();
            });
        }
    }

    handleNavigationUpdate(data) {
        if (data?.action) {
            switch (data.action) {
                case 'navigate_to_patient':
                    if (data.patientId) {
                        this.navigateToPage('patient', { 
                            patientId: data.patientId, 
                            section: data.section || 'grid',
                            timepoint: data.timepoint 
                        });
                    }
                    break;
                case 'navigate_to_appointments':
                    this.navigateToPage('appointments');
                    break;
                case 'navigate_to_search':
                    this.navigateToPage('search');
                    break;
            }
        }
    }

    // Method to broadcast navigation events via WebSocket
    broadcastNavigationEvent(eventType, data) {
        if (window.CustomEvent) {
            const event = new CustomEvent('navigation_broadcast', {
                detail: {
                    type: eventType,
                    data: data,
                    timestamp: new Date().toISOString(),
                    source: this.state.currentPage
                }
            });
            window.dispatchEvent(event);
        }
    }

    subscribe(callback) {
        this.subscribers.push(callback);
        return () => {
            this.subscribers = this.subscribers.filter(sub => sub !== callback);
        };
    }

    notifySubscribers() {
        this.subscribers.forEach(callback => {
            try {
                callback(this.state);
            } catch (error) {
                console.error('Error in navigation context subscriber:', error);
            }
        });
    }

    saveState() {
        try {
            const stateToSave = {
                navigationHistory: this.state.navigationHistory,
                searchHistory: this.state.searchHistory
            };
            sessionStorage.setItem('navigationContext', JSON.stringify(stateToSave));
        } catch (error) {
            console.warn('Could not save navigation state:', error);
        }
    }

    loadStoredState() {
        try {
            const saved = sessionStorage.getItem('navigationContext');
            if (saved) {
                const parsedState = JSON.parse(saved);
                this.state.navigationHistory = parsedState.navigationHistory || [];
                this.state.searchHistory = parsedState.searchHistory || [];
            }
        } catch (error) {
            console.warn('Could not load navigation state:', error);
        }
    }

    getState() {
        return { ...this.state };
    }

    getCurrentPatientId() {
        return this.state.currentPatient;
    }

    getCurrentPageType() {
        return this.state.currentPage;
    }

    getBreadcrumb() {
        return [...this.state.breadcrumb];
    }

    getNavigationHistory() {
        return [...this.state.navigationHistory];
    }

    getSearchHistory() {
        return [...this.state.searchHistory];
    }

    canGoBack() {
        return this.state.navigationHistory.length > 1 || this.state.breadcrumb.length > 0;
    }

    goBack() {
        if (this.state.breadcrumb.length > 0) {
            const lastBreadcrumb = this.state.breadcrumb[this.state.breadcrumb.length - 1];
            window.location.href = lastBreadcrumb.url;
        } else if (this.state.navigationHistory.length > 1) {
            const previousPage = this.state.navigationHistory[this.state.navigationHistory.length - 2];
            window.location.href = previousPage;
        } else {
            window.history.back();
        }
    }

    navigateToPage(page, options = {}) {
        let url;
        
        switch (page) {
            case 'home':
                url = '/';
                break;
            case 'appointments':
                url = '/daily-appointments';
                break;
            case 'search':
                url = '/search';
                break;
            case 'patient':
                if (!options.patientId) {
                    console.error('Patient ID required for patient navigation');
                    return;
                }
                url = `/patient/${options.patientId}/${options.section || 'grid'}`;
                if (options.timepoint) {
                    url += `?tp=${options.timepoint}`;
                }
                break;
            case 'messaging':
                url = '/send-message';
                break;
            default:
                console.error('Unknown page type:', page);
                return;
        }

        if (options.newTab) {
            window.open(url, '_blank');
        } else {
            window.location.href = url;
        }
    }

    setCurrentPatient(patientData) {
        this.state.currentPatient = patientData?.id || patientData;
        this.notifySubscribers();
    }

    clearContext() {
        this.state = {
            currentPage: null,
            currentPatient: null,
            previousPage: null,
            breadcrumb: [],
            navigationHistory: [],
            searchHistory: []
        };
        sessionStorage.removeItem('navigationContext');
        this.notifySubscribers();
    }
}

const navigationContext = new NavigationContext();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = NavigationContext;
} else {
    window.NavigationContext = NavigationContext;
    window.navigationContext = navigationContext;
}