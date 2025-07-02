import React, { useState } from 'react'
import Navigation from './components/react/Navigation.jsx'
import GridComponent from './components/react/GridComponent.jsx'
import UniversalHeader from './components/shared/UniversalHeader.jsx'

const App = () => {
    const [currentPath, setCurrentPath] = useState('/patient/demo/grid');
    const [patientId] = useState('demo');

    const handleNavigate = (path) => {
        setCurrentPath(path);
        console.log('Navigating to:', path);
    };

    return (
        <div className="app">
            <UniversalHeader />
            
            <div className="app-content">
                <h1>JSX Development Test - Shwan Orthodontics</h1>
                <p><strong>Current Path:</strong> {currentPath}</p>
                <p><strong>Patient ID:</strong> {patientId}</p>
                
                <div className="demo-components">
                    <div className="demo-section">
                        <h2>Navigation Component</h2>
                        <Navigation 
                            patientId={patientId}
                            currentPath={currentPath}
                            onNavigate={handleNavigate}
                        />
                    </div>
                    
                    <div className="demo-section">
                        <h2>Grid Component</h2>
                        <GridComponent 
                            patientId={patientId}
                            tpCode="0"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default App;