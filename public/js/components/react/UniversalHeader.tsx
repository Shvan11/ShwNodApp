import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useGlobalState, type UserData } from '../../contexts/GlobalStateContext';
import { fetchJSON } from '@/core/http';
import * as patientContract from '@shared/contracts/patient.contract';
import * as authContract from '@shared/contracts/auth.contract';

interface Patient {
    code: string | number;
    name: string;
    [key: string]: unknown;
}

interface User {
    username: string;
    fullName?: string;
    role: string;
}

interface NavigationContext {
    currentPage: string;
    previousPage: string;
    breadcrumbs: Array<{
        name: string;
        url: string;
    }>;
}

interface NavigationItem {
    key: string;
    label: string;
    icon: string;
    onClick: () => void;
    isActive: boolean;
    disabled?: boolean;
}

const UniversalHeader = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { setUser } = useGlobalState();

    const [currentPatient, setCurrentPatient] = useState<Patient | null>(null);
    const [navigationContext, setNavigationContext] = useState<NavigationContext | null>(null);
    const [currentUser, setCurrentUser] = useState<User | null>(null);

    const userControllerRef = useRef<AbortController | null>(null);
    const patientControllerRef = useRef<AbortController | null>(null);

    useEffect(() => {
        userControllerRef.current?.abort();
        userControllerRef.current = new AbortController();
        loadCurrentUser(userControllerRef.current.signal);
        return () => userControllerRef.current?.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        patientControllerRef.current?.abort();
        patientControllerRef.current = new AbortController();
        loadPatientData(patientControllerRef.current.signal);
        setupNavigationContext();
        return () => patientControllerRef.current?.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.pathname]);

    const loadPatientData = (signal: AbortSignal) => {
        const patientCode = extractPatientCodeFromURL();

        if (patientCode) {
            fetchJSON<{ person_id?: number; patient_name?: string; name?: string; [key: string]: unknown }>(`/api/patients/${patientCode}/info`, { signal, schema: patientContract.patientInfo.response })
                .then(data => {
                    // `/info` returns a single patient object (not an array). Map
                    // it onto the header's {code,name} shape; person_id is the code.
                    if (data && data.person_id) {
                        setCurrentPatient({
                            ...data,
                            code: data.person_id,
                            name: data.patient_name ?? data.name ?? '',
                        });
                    } else {
                        setCurrentPatient(null);
                    }
                })
                .catch(error => {
                    if (error instanceof Error && error.name !== 'AbortError') {
                        setCurrentPatient(null);
                    }
                });
        }
    };

    const loadCurrentUser = (signal: AbortSignal) => {
        fetchJSON<{ success?: boolean; user?: User & UserData }>('/api/auth/me', { signal, schema: authContract.me.response })
            .then(data => {
                if (data && data.success && data.user) {
                    setCurrentUser(data.user);
                    setUser(data.user);
                }
            })
            .catch(error => {
                if (error instanceof Error && error.name !== 'AbortError') {
                    // silently ignore — header degrades gracefully
                }
            });
    };

    const extractPatientCodeFromURL = (): string | null => {
        const path = location.pathname;
        const patientMatch = path.match(/\/patient\/(\d+)/);
        return patientMatch ? patientMatch[1] : null;
    };

    const setupNavigationContext = () => {
        const referrer = document.referrer;
        const currentPath = window.location.pathname;

        const context: NavigationContext = {
            currentPage: getCurrentPageType(currentPath),
            previousPage: getCurrentPageType(referrer),
            breadcrumbs: []
        };

        // Simple breadcrumb logic - can be enhanced
        if (referrer && referrer !== currentPath) {
            context.breadcrumbs.push({
                name: context.previousPage,
                url: referrer
            });
        }

        setNavigationContext(context);
    };

    const getCurrentPageType = (url: string): string => {
        if (!url) return 'Unknown';

        if (url.includes('/search')) return 'Search';
        if (url.includes('/patient')) return 'Patient';
        if (url.includes('/appointment')) return 'Appointments';
        if (url.includes('/home')) return 'Home';

        return 'Dashboard';
    };

    const navigateToPatient = (patientCode: string | number) => {
        navigate(`/patient/${patientCode}/photos/tp0`);
    };

    const navigateBack = () => {
        window.history.back();
    };

    const navigateToDashboard = () => {
        navigate('/dashboard');
    };

    const navigateToAppointments = () => {
        // Restore last viewed date or default to today
        const lastDate = sessionStorage.getItem('lastAppointmentDate');

        if (lastDate) {
            navigate(`/appointments?date=${lastDate}`);
        } else {
            // Default to today for first visit
            const today = new Date();
            const year = today.getFullYear();
            const month = String(today.getMonth() + 1).padStart(2, '0');
            const day = String(today.getDate()).padStart(2, '0');
            const dateParam = `${year}-${month}-${day}`;
            navigate(`/appointments?date=${dateParam}`);
        }
    };

    const navigateToPatientManagement = () => {
        // Restore last search params if available
        const lastSearch = sessionStorage.getItem('lastPatientSearch');
        if (lastSearch) {
            navigate(`/patient-management?${lastSearch}`);
        } else {
            navigate('/patient-management');
        }
    };

    // Header navigation items configuration
    const getNavigationItems = (): NavigationItem[] => {
        return [
            {
                key: 'dashboard',
                label: 'Dashboard',
                icon: 'fas fa-home',
                onClick: navigateToDashboard,
                isActive: location.pathname === '/' || location.pathname === '/dashboard'
            },
            {
                key: 'appointments',
                label: 'Appointments',
                icon: 'fas fa-calendar-alt',
                onClick: navigateToAppointments,
                isActive: location.pathname.includes('/appointment')
            },
            {
                key: 'search',
                label: 'Search',
                icon: 'fas fa-search',
                onClick: navigateToPatientManagement,
                isActive: location.pathname.includes('/patient-management')
            },
        ];
    };

    return (
        <header className="universal-header">
            <div className="header-container">
                {/* Header Left - Logo/Brand */}
                <div className="header-left">
                    <div className="logo-section" onClick={() => navigate('/')}>
                        <h1 className="clinic-name">Shwan Orthodontics</h1>
                    </div>
                </div>

                {/* Header Center - Main Navigation */}
                <div className="header-center">
                    <nav className="main-navigation">
                        {getNavigationItems().map(item => (
                            <button
                                key={item.key}
                                className={`nav-btn ${item.isActive ? 'active' : ''} ${item.disabled ? 'disabled' : ''}`}
                                onClick={item.onClick}
                                disabled={item.disabled}
                            >
                                <i className={item.icon} />
                                <span>{item.label}</span>
                            </button>
                        ))}

                        {/* Current Patient Navigation */}
                        {currentPatient && (
                            <button
                                className="nav-btn patient-nav active"
                                onClick={() => navigateToPatient(currentPatient.code)}
                            >
                                <i className="fas fa-user" />
                                <span>{currentPatient.name}</span>
                            </button>
                        )}
                    </nav>
                </div>

                {/* Header Right - Quick Actions */}
                <div className="header-right">
                    {/* Current User Info */}
                    {currentUser && (
                        <div className="user-info">
                            <i className="fas fa-user-circle" />
                            <div className="user-details">
                                <span className="user-name">{currentUser.fullName || currentUser.username}</span>
                                <span className="user-role">{currentUser.role}</span>
                            </div>
                        </div>
                    )}

                    {/* Back Button */}
                    {navigationContext && navigationContext.breadcrumbs.length > 0 && (
                        <button className="back-btn" onClick={navigateBack}>
                            <i className="fas fa-arrow-left" />
                        </button>
                    )}
                </div>
            </div>
        </header>
    );
};

export default UniversalHeader;
