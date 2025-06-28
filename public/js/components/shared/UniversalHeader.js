class UniversalHeader extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            currentPatient: null,
            navigationContext: null,
            isSearchVisible: false,
            searchResults: [],
            searchTerm: '',
            allPatients: []
        };
        
        this.searchTimeoutRef = null;
    }

    componentDidMount() {
        this.loadPatientData();
        this.setupNavigationContext();
        this.loadAllPatients();
    }

    loadPatientData() {
        const urlParams = new URLSearchParams(window.location.search);
        const patientCode = this.extractPatientCodeFromURL();
        
        if (patientCode) {
            fetch(`/api/getinfos?code=${patientCode}`)
                .then(response => response.json())
                .then(data => {
                    if (data && data.length > 0) {
                        this.setState({ currentPatient: data[0] });
                    }
                })
                .catch(error => console.error('Error loading patient data:', error));
        }
    }

    extractPatientCodeFromURL() {
        const path = window.location.pathname;
        const patientMatch = path.match(/\/patient\/(\d+)/);
        return patientMatch ? patientMatch[1] : null;
    }

    setupNavigationContext() {
        const referrer = document.referrer;
        const currentPath = window.location.pathname;
        
        let context = {
            currentPage: this.getCurrentPageType(currentPath),
            previousPage: this.getCurrentPageType(referrer),
            patientId: this.extractPatientCodeFromURL(),
            breadcrumb: []
        };

        if (referrer.includes('/simplified')) {
            context.breadcrumb.push({ name: 'Appointments', url: '/simplified' });
        }
        if (referrer.includes('/search')) {
            context.breadcrumb.push({ name: 'Search', url: '/search' });
        }

        this.setState({ navigationContext: context });
    }

    getCurrentPageType(url) {
        if (!url) return 'unknown';
        if (url.includes('/simplified')) return 'appointments';
        if (url.includes('/search')) return 'search';
        if (url.includes('/patient/')) return 'patient';
        return 'other';
    }

    async loadAllPatients() {
        try {
            const response = await fetch('/api/patientsPhones');
            const patients = await response.json();
            this.setState({ allPatients: patients });
        } catch (error) {
            console.error('Error loading patients:', error);
        }
    }

    handleSearchInput = (event) => {
        const searchTerm = event.target.value;
        this.setState({ searchTerm });

        if (this.searchTimeoutRef) {
            clearTimeout(this.searchTimeoutRef);
        }

        this.searchTimeoutRef = setTimeout(() => {
            this.performSearch(searchTerm);
        }, 300);
    }

    performSearch = (term) => {
        if (!term || term.length < 2) {
            this.setState({ searchResults: [] });
            return;
        }

        const { allPatients } = this.state;
        const results = allPatients.filter(patient => 
            patient.nom.toLowerCase().includes(term.toLowerCase()) ||
            patient.phone?.includes(term) ||
            patient.id.toString().includes(term)
        ).slice(0, 8);

        this.setState({ searchResults: results });
    }

    toggleSearch = () => {
        this.setState(prevState => ({ 
            isSearchVisible: !prevState.isSearchVisible,
            searchTerm: '',
            searchResults: []
        }));
    }

    navigateToPatient = (patientId) => {
        window.location.href = `/patient/${patientId}/grid`;
    }

    navigateToAppointments = () => {
        window.location.href = '/simplified';
    }

    navigateToSearch = () => {
        window.location.href = '/search';
    }

    navigateBack = () => {
        const { navigationContext } = this.state;
        if (navigationContext?.breadcrumb.length > 0) {
            const lastBreadcrumb = navigationContext.breadcrumb[navigationContext.breadcrumb.length - 1];
            window.location.href = lastBreadcrumb.url;
        } else {
            window.history.back();
        }
    }

    render() {
        const { currentPatient, navigationContext, isSearchVisible, searchResults, searchTerm } = this.state;

        return React.createElement('div', { className: 'universal-header' },
            React.createElement('div', { className: 'header-container' },
                React.createElement('div', { className: 'header-left' },
                    React.createElement('div', { className: 'logo-section' },
                        React.createElement('h1', { 
                            className: 'clinic-name',
                            onClick: () => window.location.href = '/'
                        }, 'Shwan Orthodontics')
                    ),
                    navigationContext?.breadcrumb.length > 0 && 
                    React.createElement('div', { className: 'breadcrumb' },
                        navigationContext.breadcrumb.map((crumb, index) => 
                            React.createElement('span', { key: index, className: 'breadcrumb-item' },
                                React.createElement('a', { 
                                    href: crumb.url,
                                    className: 'breadcrumb-link'
                                }, crumb.name),
                                index < navigationContext.breadcrumb.length - 1 && 
                                React.createElement('span', { className: 'breadcrumb-separator' }, ' › ')
                            )
                        )
                    )
                ),
                
                React.createElement('div', { className: 'header-center' },
                    React.createElement('nav', { className: 'main-navigation' },
                        React.createElement('button', {
                            className: `nav-btn ${navigationContext?.currentPage === 'appointments' ? 'active' : ''}`,
                            onClick: this.navigateToAppointments
                        }, 
                            React.createElement('i', { className: 'fas fa-calendar-alt' }),
                            ' Appointments'
                        ),
                        React.createElement('button', {
                            className: `nav-btn ${navigationContext?.currentPage === 'search' ? 'active' : ''}`,
                            onClick: this.navigateToSearch
                        }, 
                            React.createElement('i', { className: 'fas fa-search' }),
                            ' Search Patients'
                        ),
                        currentPatient && React.createElement('button', {
                            className: `nav-btn ${navigationContext?.currentPage === 'patient' ? 'active' : ''}`,
                            onClick: () => this.navigateToPatient(currentPatient.id)
                        }, 
                            React.createElement('i', { className: 'fas fa-user' }),
                            ` ${currentPatient.nom}`
                        )
                    )
                ),

                React.createElement('div', { className: 'header-right' },
                    React.createElement('div', { className: 'quick-search-section' },
                        React.createElement('button', {
                            className: 'search-toggle-btn',
                            onClick: this.toggleSearch,
                            title: 'Quick Patient Search'
                        }, React.createElement('i', { className: 'fas fa-search' })),
                        
                        isSearchVisible && React.createElement('div', { className: 'quick-search-dropdown' },
                            React.createElement('input', {
                                type: 'text',
                                placeholder: 'Search patients...',
                                value: searchTerm,
                                onChange: this.handleSearchInput,
                                className: 'quick-search-input',
                                autoFocus: true
                            }),
                            searchResults.length > 0 && React.createElement('div', { className: 'search-results' },
                                searchResults.map(patient => 
                                    React.createElement('div', {
                                        key: patient.id,
                                        className: 'search-result-item',
                                        onClick: () => this.navigateToPatient(patient.id)
                                    },
                                        React.createElement('div', { className: 'patient-name' }, patient.nom),
                                        React.createElement('div', { className: 'patient-details' }, 
                                            `ID: ${patient.id}`,
                                            patient.phone && ` • ${patient.phone}`
                                        )
                                    )
                                )
                            )
                        )
                    ),

                    navigationContext?.breadcrumb.length > 0 && 
                    React.createElement('button', {
                        className: 'back-btn',
                        onClick: this.navigateBack,
                        title: 'Go Back'
                    }, React.createElement('i', { className: 'fas fa-arrow-left' }))
                )
            )
        );
    }
}

window.UniversalHeader = UniversalHeader;