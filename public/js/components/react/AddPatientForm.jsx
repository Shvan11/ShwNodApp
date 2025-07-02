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
        <div className="form-container">
            <h2 className="form-title">
                <i className="fas fa-user-plus"></i>
                Add New Patient
            </h2>

            {alert.show && (
                <div className={`alert alert-${alert.type}`} style={{ display: 'block' }}>
                    <i className={`fas ${alert.type === 'success' ? 'fa-check-circle' : 'fa-exclamation-triangle'}`}></i>
                    {alert.message}
                </div>
            )}

            <form onSubmit={handleSubmit}>
                {/* Basic Information */}
                <div className="form-row">
                    <div className="form-group">
                        <label className="form-label">
                            Patient Name <span className="required">*</span>
                        </label>
                        <input
                            type="text"
                            name="patientName"
                            value={formData.patientName}
                            onChange={handleInputChange}
                            className="form-control"
                            required
                        />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Patient ID</label>
                        <input
                            type="text"
                            name="patientID"
                            value={formData.patientID}
                            onChange={handleInputChange}
                            className="form-control"
                            maxLength="6"
                        />
                    </div>
                </div>

                <div className="form-row">
                    <div className="form-group">
                        <label className="form-label">First Name</label>
                        <input
                            type="text"
                            name="firstName"
                            value={formData.firstName}
                            onChange={handleInputChange}
                            className="form-control"
                        />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Last Name</label>
                        <input
                            type="text"
                            name="lastName"
                            value={formData.lastName}
                            onChange={handleInputChange}
                            className="form-control"
                        />
                    </div>
                </div>

                {/* Contact Information */}
                <div className="form-row">
                    <div className="form-group">
                        <label className="form-label">Phone</label>
                        <input
                            type="tel"
                            name="phone"
                            value={formData.phone}
                            onChange={handleInputChange}
                            className="form-control"
                        />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Phone 2</label>
                        <input
                            type="tel"
                            name="phone2"
                            value={formData.phone2}
                            onChange={handleInputChange}
                            className="form-control"
                        />
                    </div>
                </div>

                <div className="form-row">
                    <div className="form-group">
                        <label className="form-label">Email</label>
                        <input
                            type="email"
                            name="email"
                            value={formData.email}
                            onChange={handleInputChange}
                            className="form-control"
                        />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Country Code</label>
                        <input
                            type="text"
                            name="countryCode"
                            value={formData.countryCode}
                            onChange={handleInputChange}
                            className="form-control"
                            maxLength="5"
                        />
                    </div>
                </div>

                {/* Personal Information */}
                <div className="form-row">
                    <div className="form-group">
                        <label className="form-label">Date of Birth</label>
                        <input
                            type="date"
                            name="dateOfBirth"
                            value={formData.dateOfBirth}
                            onChange={handleInputChange}
                            className="form-control"
                        />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Gender</label>
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
                        <label className="form-label">Patient Type</label>
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
                        <label className="form-label">Language</label>
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

                {/* Referral and Address Information */}
                <div className="form-row">
                    <div className="form-group">
                        <label className="form-label">Referral Source</label>
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
                    <div className="form-group">
                        <label className="form-label">Address</label>
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

                {/* Notes and Alerts */}
                <div className="form-group">
                    <label className="form-label">Notes</label>
                    <textarea
                        name="notes"
                        value={formData.notes}
                        onChange={handleInputChange}
                        className="form-control"
                        rows="3"
                        maxLength="100"
                    />
                </div>

                <div className="form-group">
                    <label className="form-label">Alerts</label>
                    <textarea
                        name="alerts"
                        value={formData.alerts}
                        onChange={handleInputChange}
                        className="form-control"
                        rows="2"
                    />
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