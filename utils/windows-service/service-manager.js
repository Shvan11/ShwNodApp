// utils/windows-service/service-manager.js

import { Service } from 'node-windows';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

// Load environment variables from .env file
config();

// Get the directory name in ES module context
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to compiled application (run `npm run build:server` before installing service)
const appPath = path.resolve(__dirname, '../../dist-server/index.js');

// Service account configuration (from environment variables)
// This ensures the service runs as Administrator instead of SYSTEM,
// which is required for WhatsApp/Puppeteer to find Chrome in the user's cache
const serviceAccount = process.env.SERVICE_ACCOUNT || '.\\Administrator';
const servicePassword = process.env.SERVICE_PASSWORD;

// Common service configuration
const serviceConfig = {
  name: 'webapp',
  displayName: 'Web App',
  description: 'My personal web app for appointments and patients photos.',
  script: appPath,
  nodeOptions: [
    '--harmony',
    '--max_old_space_size=4096'
  ],
  env: [{
    name: 'NODE_ENV',
    value: 'production'
  }],
  stopparentfirst: false
};

// Add logOnAs configuration if password is provided
// This makes the service run as the specified user instead of SYSTEM
if (servicePassword) {
  serviceConfig.logOnAs = {
    account: serviceAccount,
    password: servicePassword
  };
  console.log(`Service will run as: ${serviceAccount}`);
} else {
  console.log('WARNING: SERVICE_PASSWORD not set in .env file');
  console.log('Service will run as SYSTEM account (WhatsApp may not work!)');
  console.log('Add these to your .env file:');
  console.log('  SERVICE_ACCOUNT=.\\\\Administrator');
  console.log('  SERVICE_PASSWORD=YourPassword');
}

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