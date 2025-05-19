// utils/windows-service/cli.js

import { installService, uninstallService } from './service-manager.js';

const command = process.argv[2]?.toLowerCase();

switch (command) {
  case 'install':
    console.log('Installing Windows service...');
    installService();
    break;
  
  case 'uninstall':
    console.log('Uninstalling Windows service...');
    uninstallService();
    break;
  
  default:
    console.log('Usage: node cli.js [install|uninstall]');
    process.exit(1);
}