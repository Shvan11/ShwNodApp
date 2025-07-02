import React from 'react'
import ReactDOM from 'react-dom/client'
import AddPatientForm from '../components/react/AddPatientForm.jsx'
import '../../css/main.css'
import '../../css/pages/dashboard.css'

const AddPatientPage = () => {
    return (
        <div id="app">
            <header className="header">
                <div className="container">
                    <div className="logo">
                        <img src="/images/logo.png" alt="Shwan Orthodontics" />
                        <h1>Shwan Orthodontics</h1>
                    </div>
                    <div className="user-info">
                        <a href="/" style={{ color: 'white', textDecoration: 'none' }}>
                            <i className="fas fa-home"></i> Back to Dashboard
                        </a>
                    </div>
                </div>
            </header>

            <main className="main-content">
                <div className="container">
                    <AddPatientForm />
                </div>
            </main>

            <footer className="footer">
                <div className="container">
                    <p>&copy; 2024 Shwan Orthodontics - All Rights Reserved</p>
                </div>
            </footer>
        </div>
    );
};

// Initialize the add patient page
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Initializing React Add Patient Page...');
    
    // Mount React App
    const reactRoot = document.getElementById('react-root');
    if (reactRoot) {
        const root = ReactDOM.createRoot(reactRoot);
        root.render(React.createElement(AddPatientPage));
        console.log('✅ Add Patient page initialized');
    }
});

export default AddPatientPage;