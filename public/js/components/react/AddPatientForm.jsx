/**
 * AddPatientForm - React component for adding new patients
 * 
 * Provides a comprehensive form for patient registration following the app's design patterns
 */

import React, { useState, useEffect } from 'react'

const AddPatientForm = () => {
    const [formData, setFormData] = useState({
        patientName: '',
        patientID: '',
        firstName: '',
        lastName: '',
        phone: '',
        phone2: '',
        email: '',
        countryCode: '',
        dateOfBirth: '',
        gender: '',
        addressID: '',
        referralSourceID: '',
        patientTypeID: '',
        language: '0',
        notes: '',
        alerts: ''
    });

    const [loading, setLoading] = useState(false);
    const [alert, setAlert] = useState({ show: false, message: '', type: 'danger' });
    const [dropdownData, setDropdownData] = useState({
        referralSources: [],
        patientTypes: [],
        addresses: [],
        genders: []
    });

    // Load dropdown data on component mount
    useEffect(() => {
        const loadDropdownData = async () => {
            try {
                const [referralSources, patientTypes, addresses, genders] = await Promise.all([
                    fetch('/api/referral-sources').then(res => res.json()),
                    fetch('/api/patient-types').then(res => res.json()),
                    fetch('/api/addresses').then(res => res.json()),
                    fetch('/api/genders').then(res => res.json())
                ]);

                setDropdownData({
                    referralSources,
                    patientTypes,
                    addresses,
                    genders
                });
            } catch (error) {
                console.error('Error loading dropdown data:', error);
                showAlert('Failed to load form data. Please refresh the page.');
            }
        };

        loadDropdownData();
    }, []);

    // Auto-fill patient name from first and last name
    useEffect(() => {
        const { firstName, lastName } = formData;
        if (firstName.trim() || lastName.trim()) {
            setFormData(prev => ({
                ...prev,
                patientName: `${firstName} ${lastName}`.trim()
            }));
        }
    }, [formData.firstName, formData.lastName]);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const showAlert = (message, type = 'danger') => {
        setAlert({ show: true, message, type });
        
        if (type === 'success') {
            setTimeout(() => {
                window.location.href = '/';
            }, 2000);
        }
    };

    const hideAlert = () => {
        setAlert({ show: false, message: '', type: 'danger' });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        // Basic validation
        if (!formData.patientName.trim()) {
            showAlert('Patient name is required.');
            return;
        }

        setLoading(true);
        hideAlert();

        try {
            const response = await fetch('/api/patients', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(formData)
            });

            const result = await response.json();

            if (response.ok) {
                showAlert(`Patient "${formData.patientName}" has been successfully added with ID: ${result.personId}`, 'success');
                // Reset form
                setFormData({
                    patientName: '',
                    patientID: '',
                    firstName: '',
                    lastName: '',
                    phone: '',
                    phone2: '',
                    email: '',
                    countryCode: '',
                    dateOfBirth: '',
                    gender: '',
                    addressID: '',
                    referralSourceID: '',
                    patientTypeID: '',
                    language: '0',
                    notes: '',
                    alerts: ''
                });
            } else {
                showAlert(result.error || 'Failed to add patient. Please try again.');
            }
        } catch (error) {
            console.error('Error adding patient:', error);
            showAlert('Network error. Please check your connection and try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="add-patient-form-container">
            <h2 className="add-patient-title">
                <i className="fas fa-user-plus"></i>
                Add New Patient
            </h2>

            {alert.show && (
                <div className={`alert alert-${alert.type}`}>
                    <i className={`fas ${alert.type === 'success' ? 'fa-check-circle' : 'fa-exclamation-triangle'}`}></i>
                    {alert.message}
                </div>
            )}

            <form onSubmit={handleSubmit}>
                <div className="form-content">
                    {/* Left Column */}
                    <div className="form-column">
                        {/* Basic Information Section */}
                        <div className="form-section">
                            <h3 className="form-section-title">
                                <i className="fas fa-user"></i>
                                Basic Information
                            </h3>
                            
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">
                                        <i className="fas fa-signature"></i>
                                        Patient Name <span className="required">*</span>
                                    </label>
                                    <input
                                        type="text"
                                        name="patientName"
                                        value={formData.patientName}
                                        onChange={handleInputChange}
                                        className="form-control"
                                        placeholder="Enter full patient name"
                                        required
                                    />
                                </div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">
                                        <i className="fas fa-user"></i>
                                        First Name
                                    </label>
                                    <input
                                        type="text"
                                        name="firstName"
                                        value={formData.firstName}
                                        onChange={handleInputChange}
                                        className="form-control"
                                        placeholder="First name"
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">
                                        <i className="fas fa-user"></i>
                                        Last Name
                                    </label>
                                    <input
                                        type="text"
                                        name="lastName"
                                        value={formData.lastName}
                                        onChange={handleInputChange}
                                        className="form-control"
                                        placeholder="Last name"
                                    />
                                </div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">
                                        <i className="fas fa-id-card"></i>
                                        Patient ID
                                    </label>
                                    <input
                                        type="text"
                                        name="patientID"
                                        value={formData.patientID}
                                        onChange={handleInputChange}
                                        className="form-control"
                                        placeholder="Auto-generated if empty"
                                        maxLength="6"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Contact Information Section */}
                        <div className="form-section">
                            <h3 className="form-section-title">
                                <i className="fas fa-address-book"></i>
                                Contact Information
                            </h3>
                            
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">
                                        <i className="fas fa-phone"></i>
                                        Primary Phone
                                    </label>
                                    <input
                                        type="tel"
                                        name="phone"
                                        value={formData.phone}
                                        onChange={handleInputChange}
                                        className="form-control"
                                        placeholder="Primary phone number"
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">
                                        <i className="fas fa-phone-alt"></i>
                                        Secondary Phone
                                    </label>
                                    <input
                                        type="tel"
                                        name="phone2"
                                        value={formData.phone2}
                                        onChange={handleInputChange}
                                        className="form-control"
                                        placeholder="Secondary phone number"
                                    />
                                </div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">
                                        <i className="fas fa-envelope"></i>
                                        Email Address
                                    </label>
                                    <input
                                        type="email"
                                        name="email"
                                        value={formData.email}
                                        onChange={handleInputChange}
                                        className="form-control"
                                        placeholder="patient@example.com"
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">
                                        <i className="fas fa-globe"></i>
                                        Country Code
                                    </label>
                                    <input
                                        type="text"
                                        name="countryCode"
                                        value={formData.countryCode}
                                        onChange={handleInputChange}
                                        className="form-control"
                                        placeholder="e.g., +1, +44"
                                        maxLength="5"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Right Column */}
                    <div className="form-column">
                        {/* Personal Information Section */}
                        <div className="form-section">
                            <h3 className="form-section-title">
                                <i className="fas fa-user-circle"></i>
                                Personal Information
                            </h3>
                            
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">
                                        <i className="fas fa-calendar"></i>
                                        Date of Birth
                                    </label>
                                    <input
                                        type="date"
                                        name="dateOfBirth"
                                        value={formData.dateOfBirth}
                                        onChange={handleInputChange}
                                        className="form-control"
                                    />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">
                                        <i className="fas fa-venus-mars"></i>
                                        Gender
                                    </label>
                                    <select
                                        name="gender"
                                        value={formData.gender}
                                        onChange={handleInputChange}
                                        className="form-control"
                                    >
                                        <option value="">Select Gender</option>
                                        {dropdownData.genders.map(gender => (
                                            <option key={gender.id} value={gender.id}>
                                                {gender.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">
                                        <i className="fas fa-language"></i>
                                        Language
                                    </label>
                                    <select
                                        name="language"
                                        value={formData.language}
                                        onChange={handleInputChange}
                                        className="form-control"
                                    >
                                        <option value="0">English</option>
                                        <option value="1">Arabic</option>
                                        <option value="2">Kurdish</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* Medical Information Section */}
                        <div className="form-section">
                            <h3 className="form-section-title">
                                <i className="fas fa-stethoscope"></i>
                                Medical Information
                            </h3>
                            
                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">
                                        <i className="fas fa-user-tag"></i>
                                        Patient Type
                                    </label>
                                    <select
                                        name="patientTypeID"
                                        value={formData.patientTypeID}
                                        onChange={handleInputChange}
                                        className="form-control"
                                    >
                                        <option value="">Select Patient Type</option>
                                        {dropdownData.patientTypes.map(type => (
                                            <option key={type.id} value={type.id}>
                                                {type.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label className="form-label">
                                        <i className="fas fa-handshake"></i>
                                        Referral Source
                                    </label>
                                    <select
                                        name="referralSourceID"
                                        value={formData.referralSourceID}
                                        onChange={handleInputChange}
                                        className="form-control"
                                    >
                                        <option value="">Select Referral Source</option>
                                        {dropdownData.referralSources.map(source => (
                                            <option key={source.id} value={source.id}>
                                                {source.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label className="form-label">
                                        <i className="fas fa-map-marker-alt"></i>
                                        Address
                                    </label>
                                    <select
                                        name="addressID"
                                        value={formData.addressID}
                                        onChange={handleInputChange}
                                        className="form-control"
                                    >
                                        <option value="">Select Address</option>
                                        {dropdownData.addresses.map(address => (
                                            <option key={address.id} value={address.id}>
                                                {address.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Full-width Additional Information Section */}
                <div className="form-section full-width">
                    <h3 className="form-section-title">
                        <i className="fas fa-clipboard"></i>
                        Additional Information
                    </h3>
                    
                    <div className="form-row">
                        <div className="form-group">
                            <label className="form-label">
                                <i className="fas fa-sticky-note"></i>
                                Notes
                            </label>
                            <textarea
                                name="notes"
                                value={formData.notes}
                                onChange={handleInputChange}
                                className="form-control"
                                rows="3"
                                maxLength="100"
                                placeholder="Additional notes about the patient..."
                            />
                        </div>
                        <div className="form-group">
                            <label className="form-label">
                                <i className="fas fa-exclamation-triangle"></i>
                                Alerts
                            </label>
                            <textarea
                                name="alerts"
                                value={formData.alerts}
                                onChange={handleInputChange}
                                className="form-control"
                                rows="3"
                                placeholder="Important alerts or warnings..."
                            />
                        </div>
                    </div>
                </div>

                {/* Form Actions */}
                <div className="form-actions">
                    <button 
                        type="button" 
                        className="btn btn-secondary" 
                        onClick={() => window.history.back()}
                        disabled={loading}
                    >
                        <i className="fas fa-times"></i>
                        Cancel
                    </button>
                    <button 
                        type="submit" 
                        className="btn btn-primary"
                        disabled={loading}
                    >
                        {loading ? (
                            <>
                                <div className="loading-spinner"></div>
                                Adding Patient...
                            </>
                        ) : (
                            <>
                                <i className="fas fa-save"></i>
                                Add Patient
                            </>
                        )}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default AddPatientForm;