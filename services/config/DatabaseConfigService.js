/**
 * Database Configuration Service
 * Manages database configuration through environment files and provides connection testing
 */

import EnvironmentManager from './EnvironmentManager.js';
import { Connection, TYPES } from 'tedious';

class DatabaseConfigService {
    constructor() {
        this.envManager = new EnvironmentManager();
    }

    /**
     * Get current database configuration (with masked password)
     * @param {boolean} includeSensitive - Whether to include sensitive data
     * @returns {Promise<Object>} Database configuration
     */
    async getCurrentConfig(includeSensitive = false) {
        try {
            const config = await this.envManager.getDatabaseConfig();
            
            if (!includeSensitive && config.DB_PASSWORD) {
                config.DB_PASSWORD = '••••••••';
            }

            return {
                success: true,
                config: config,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                config: null
            };
        }
    }

    /**
     * Test database connection with provided configuration
     * @param {Object} testConfig - Database configuration to test
     * @returns {Promise<Object>} Connection test result
     */
    async testConnection(testConfig) {
        return new Promise((resolve) => {
            const startTime = Date.now();
            
            try {
                // Validate required fields
                const required = ['DB_SERVER', 'DB_INSTANCE', 'DB_DATABASE', 'DB_USER', 'DB_PASSWORD'];
                const missing = required.filter(field => !testConfig[field] || testConfig[field].trim() === '');
                
                if (missing.length > 0) {
                    return resolve({
                        success: false,
                        message: 'Missing required configuration',
                        details: `Required fields: ${missing.join(', ')}`,
                        duration: Date.now() - startTime
                    });
                }

                // Prepare Tedious connection configuration
                const connectionConfig = {
                    server: testConfig.DB_SERVER,
                    options: {
                        instanceName: testConfig.DB_INSTANCE,
                        database: testConfig.DB_DATABASE,
                        encrypt: testConfig.DB_ENCRYPT === 'true',
                        trustServerCertificate: testConfig.DB_TRUST_CERTIFICATE === 'true',
                        connectTimeout: parseInt(testConfig.DB_CONNECTION_TIMEOUT || '30000'),
                        requestTimeout: parseInt(testConfig.DB_REQUEST_TIMEOUT || '15000'),
                        rowCollectionOnRequestCompletion: true,
                        useColumnNames: false,
                        debug: {
                            packet: false,
                            data: false,
                            payload: false,
                            token: false
                        }
                    },
                    authentication: {
                        type: 'default',
                        options: {
                            userName: testConfig.DB_USER,
                            password: testConfig.DB_PASSWORD
                        }
                    }
                };

                console.log(`Testing database connection to ${testConfig.DB_SERVER}\\${testConfig.DB_INSTANCE}`);

                const connection = new Connection(connectionConfig);
                let connectionResult = null;

                // Set up event handlers
                connection.on('connect', (err) => {
                    if (err) {
                        console.error('Database connection test failed:', err.message);
                        connectionResult = {
                            success: false,
                            message: 'Connection failed',
                            details: err.message,
                            errorCode: err.code,
                            duration: Date.now() - startTime
                        };
                    } else {
                        console.log('Database connection test successful');
                        connectionResult = {
                            success: true,
                            message: 'Connection successful',
                            details: `Connected to ${testConfig.DB_SERVER}\\${testConfig.DB_INSTANCE}`,
                            serverVersion: connection.serverName || 'Unknown',
                            duration: Date.now() - startTime
                        };
                    }
                    
                    // Close connection
                    connection.close();
                });

                connection.on('end', () => {
                    console.log('Database connection test completed');
                    if (connectionResult) {
                        resolve(connectionResult);
                    }
                });

                connection.on('error', (err) => {
                    console.error('Database connection error:', err.message);
                    if (!connectionResult) {
                        connectionResult = {
                            success: false,
                            message: 'Connection error',
                            details: err.message,
                            errorCode: err.code,
                            duration: Date.now() - startTime
                        };
                        resolve(connectionResult);
                    }
                });

                // Set timeout to prevent hanging
                const timeout = setTimeout(() => {
                    if (!connectionResult) {
                        console.warn('Database connection test timed out');
                        connection.close();
                        resolve({
                            success: false,
                            message: 'Connection timeout',
                            details: 'Connection attempt timed out after 30 seconds',
                            duration: Date.now() - startTime
                        });
                    }
                }, 30000);

                // Clear timeout when connection completes
                connection.on('end', () => clearTimeout(timeout));
                connection.on('error', () => clearTimeout(timeout));

                // Initiate connection
                connection.connect();

            } catch (error) {
                console.error('Database connection test error:', error);
                resolve({
                    success: false,
                    message: 'Test configuration error',
                    details: error.message,
                    duration: Date.now() - startTime
                });
            }
        });
    }

    /**
     * Update database configuration
     * @param {Object} newConfig - New database configuration
     * @returns {Promise<Object>} Update result
     */
    async updateConfiguration(newConfig) {
        try {
            console.log('Updating database configuration...');
            
            // Validate configuration
            const validation = this.validateConfiguration(newConfig);
            if (!validation.valid) {
                return {
                    success: false,
                    message: 'Configuration validation failed',
                    errors: validation.errors
                };
            }

            // Update environment file
            const updatedConfig = await this.envManager.updateDatabaseConfig(newConfig);
            
            console.log('Database configuration updated successfully');
            
            return {
                success: true,
                message: 'Database configuration updated successfully',
                config: updatedConfig,
                requiresRestart: true,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error('Failed to update database configuration:', error);
            return {
                success: false,
                message: 'Configuration update failed',
                error: error.message
            };
        }
    }

    /**
     * Validate database configuration
     * @param {Object} config - Configuration to validate
     * @returns {Object} Validation result
     */
    validateConfiguration(config) {
        const errors = [];
        
        // Required fields
        const required = [
            { field: 'DB_SERVER', name: 'Database Server' },
            { field: 'DB_INSTANCE', name: 'Instance Name' },
            { field: 'DB_DATABASE', name: 'Database Name' },
            { field: 'DB_USER', name: 'Username' },
            { field: 'DB_PASSWORD', name: 'Password' }
        ];

        for (const { field, name } of required) {
            if (!config[field] || config[field].trim() === '') {
                errors.push(`${name} is required`);
            }
        }

        // Validate boolean fields
        const booleanFields = ['DB_ENCRYPT', 'DB_TRUST_CERTIFICATE'];
        for (const field of booleanFields) {
            if (config[field] && !['true', 'false'].includes(config[field])) {
                errors.push(`${field} must be 'true' or 'false'`);
            }
        }

        // Validate numeric fields
        const numericFields = ['DB_CONNECTION_TIMEOUT', 'DB_REQUEST_TIMEOUT'];
        for (const field of numericFields) {
            if (config[field]) {
                const num = parseInt(config[field]);
                if (isNaN(num) || num < 1000 || num > 300000) {
                    errors.push(`${field} must be a number between 1000 and 300000`);
                }
            }
        }

        // Validate server name format
        if (config.DB_SERVER) {
            const serverName = config.DB_SERVER.trim();
            if (serverName.includes(' ') || serverName.length > 255) {
                errors.push('Server name contains invalid characters or is too long');
            }
        }

        return {
            valid: errors.length === 0,
            errors: errors
        };
    }

    /**
     * Create backup of current configuration
     * @returns {Promise<Object>} Backup result
     */
    async createBackup() {
        try {
            const success = await this.envManager.createBackup();
            return {
                success: success,
                message: success ? 'Configuration backup created successfully' : 'No configuration file to backup',
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                success: false,
                message: 'Failed to create backup',
                error: error.message
            };
        }
    }

    /**
     * Restore configuration from backup
     * @returns {Promise<Object>} Restore result
     */
    async restoreFromBackup() {
        try {
            await this.envManager.restoreFromBackup();
            return {
                success: true,
                message: 'Configuration restored from backup successfully',
                requiresRestart: true,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                success: false,
                message: 'Failed to restore from backup',
                error: error.message
            };
        }
    }

    /**
     * Get configuration file status and diagnostics
     * @returns {Promise<Object>} Status information
     */
    async getConfigurationStatus() {
        try {
            const fileStatus = await this.envManager.getFileStatus();
            const validation = await this.envManager.validateEnvironment();
            
            return {
                success: true,
                files: fileStatus,
                validation: validation,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                success: false,
                message: 'Failed to get configuration status',
                error: error.message
            };
        }
    }

    /**
     * Export current configuration (sanitized)
     * @returns {Promise<Object>} Export result with configuration data
     */
    async exportConfiguration() {
        try {
            const config = await this.envManager.getDatabaseConfig();
            
            // Sanitize sensitive data
            const sanitizedConfig = { ...config };
            sanitizedConfig.DB_PASSWORD = '••••••••';
            
            return {
                success: true,
                message: 'Configuration exported successfully',
                config: sanitizedConfig,
                exportDate: new Date().toISOString(),
                version: '1.0'
            };
        } catch (error) {
            return {
                success: false,
                message: 'Failed to export configuration',
                error: error.message
            };
        }
    }

    /**
     * Get database connection presets/templates
     * @returns {Array} Array of connection presets
     */
    getConnectionPresets() {
        return [
            {
                id: 'local_sqlexpress',
                name: 'Local SQL Server Express',
                description: 'Local SQL Server Express instance',
                config: {
                    DB_SERVER: 'localhost',
                    DB_INSTANCE: 'SQLEXPRESS',
                    DB_DATABASE: 'ShwanNew',
                    DB_USER: '',
                    DB_PASSWORD: '',
                    DB_ENCRYPT: 'false',
                    DB_TRUST_CERTIFICATE: 'true'
                }
            },
            {
                id: 'clinic_dolphin',
                name: 'Clinic Dolphin Database',
                description: 'Main clinic database server',
                config: {
                    DB_SERVER: 'CLINIC',
                    DB_INSTANCE: 'DOLPHIN',
                    DB_DATABASE: 'ShwanNew',
                    DB_USER: 'Staff',
                    DB_PASSWORD: '',
                    DB_ENCRYPT: 'false',
                    DB_TRUST_CERTIFICATE: 'true'
                }
            },
            {
                id: 'remote_secure',
                name: 'Remote Secure Connection',
                description: 'Remote database with encryption',
                config: {
                    DB_SERVER: '',
                    DB_INSTANCE: '',
                    DB_DATABASE: 'ShwanNew',
                    DB_USER: '',
                    DB_PASSWORD: '',
                    DB_ENCRYPT: 'true',
                    DB_TRUST_CERTIFICATE: 'false'
                }
            }
        ];
    }
}

export default DatabaseConfigService;