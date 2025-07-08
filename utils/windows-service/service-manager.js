// utils/windows-service/service-manager.js

import { Service } from 'node-windows';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name in ES module context
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to your main application file
const appPath = path.resolve(__dirname, '../../index.js');

// Common service configuration
const serviceConfig = {
  name: 'Web app',
  description: 'My personal web app for appointments and patients photos.',
  script: appPath,
  nodeOptions: [
    '--harmony',
    '--max_old_space_size=4096'
  ],
  env: [{
    name: 'NODE_ENV',
    value: 'production'
  }]
};

/**
 * Installs the application as a Windows service
 */
export function installService() {
  const svc = new Service(serviceConfig);
  
  svc.on('install', function() {
    svc.start();
    console.log('Service installed and started successfully');
  });
  
  svc.on('error', function() {
    console.log('Error during service installation');
  });
  
  svc.on('start', function() {
    console.log('Service started');
  });
  
  svc.on('stop', function() {
    console.log('Service stopped');
  });
  
  svc.on('invalidinstallation', function() {
    console.log('Invalid installation');
  });
  
  svc.install();
  
  return svc;
}

/**
 * Uninstalls the Windows service
 */
export function uninstallService() {
  const svc = new Service(serviceConfig);
  
  svc.on('uninstall', function() {
    console.log('Uninstall complete');
    console.log('The service exists:', svc.exists);
  });
  
  svc.uninstall();
  
  return svc;
}