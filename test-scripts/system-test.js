// test-scripts/system-test.js
/**
 * System integration test script for WhatsApp messaging system
 * Tests all critical endpoints and functionality after system overhaul
 */

// Use dynamic import for ES modules compatibility
const fetch = (await import('node-fetch')).default;

const BASE_URL = process.env.BASE_URL || 'http://localhost:80';
const TEST_PATIENT_ID = process.env.TEST_PATIENT_ID || '1001';
const TEST_DATE = process.env.TEST_DATE || new Date().toISOString().split('T')[0];

// Test configuration
const config = {
  timeout: 10000, // 10 seconds
  retries: 3,
  baseUrl: BASE_URL
};

// Colors for console output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

/**
 * Utility function to make HTTP requests with timeout and retries
 */
async function makeRequest(url, options = {}, retries = config.retries) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (retries > 0 && (error.name === 'AbortError' || error.code === 'ECONNRESET')) {
      console.log(`  ${colors.yellow}Retrying... (${retries} attempts left)${colors.reset}`);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
      return makeRequest(url, options, retries - 1);
    }
    
    throw error;
  }
}

/**
 * Test result logger
 */
class TestLogger {
  constructor() {
    this.passed = 0;
    this.failed = 0;
    this.warnings = 0;
    this.startTime = Date.now();
  }

  success(testName, details = '') {
    this.passed++;
    console.log(`${colors.green}✅ PASS${colors.reset} ${testName}`);
    if (details) console.log(`   ${details}`);
  }

  fail(testName, error, details = '') {
    this.failed++;
    console.log(`${colors.red}❌ FAIL${colors.reset} ${testName}`);
    console.log(`   Error: ${error.message || error}`);
    if (details) console.log(`   ${details}`);
  }

  warn(testName, message) {
    this.warnings++;
    console.log(`${colors.yellow}⚠️  WARN${colors.reset} ${testName}`);
    console.log(`   ${message}`);
  }

  info(message) {
    console.log(`${colors.blue}ℹ️  ${message}${colors.reset}`);
  }

  summary() {
    const duration = Date.now() - this.startTime;
    console.log(`\n${colors.blue}=== TEST SUMMARY ===${colors.reset}`);
    console.log(`${colors.green}Passed: ${this.passed}${colors.reset}`);
    console.log(`${colors.red}Failed: ${this.failed}${colors.reset}`);
    console.log(`${colors.yellow}Warnings: ${this.warnings}${colors.reset}`);
    console.log(`Duration: ${Math.round(duration / 1000)}s`);
    
    if (this.failed === 0) {
      console.log(`${colors.green}🎉 All tests passed!${colors.reset}`);
      return true;
    } else {
      console.log(`${colors.red}💥 ${this.failed} test(s) failed${colors.reset}`);
      return false;
    }
  }
}

const logger = new TestLogger();

/**
 * Test suite functions
 */
async function testHealthEndpoints() {
  logger.info('Testing Health Endpoints...');

  try {
    // Test basic health endpoint
    const healthResponse = await makeRequest(`${config.baseUrl}/api/health`);
    const healthData = await healthResponse.json();

    if (healthResponse.ok && healthData.status) {
      logger.success('Health endpoint', `Status: ${healthData.status}`);
    } else {
      logger.fail('Health endpoint', new Error(`Unexpected status: ${healthResponse.status}`));
    }

    // Test detailed health endpoint
    const detailedResponse = await makeRequest(`${config.baseUrl}/api/health/detailed`);
    const detailedData = await detailedResponse.json();

    if (detailedResponse.ok && detailedData.overall !== undefined) {
      logger.success('Detailed health endpoint', `Overall: ${detailedData.overall}`);
      
      // Check individual components
      if (detailedData.checks) {
        detailedData.checks.forEach(check => {
          if (check.healthy) {
            logger.success(`Health check: ${check.name}`, check.message);
          } else {
            logger.warn(`Health check: ${check.name}`, check.message);
          }
        });
      }
    } else {
      logger.fail('Detailed health endpoint', new Error('Invalid response format'));
    }

  } catch (error) {
    logger.fail('Health endpoints', error);
  }
}

async function testWhatsAppEndpoints() {
  logger.info('Testing WhatsApp Endpoints...');

  try {
    // Test WhatsApp status
    const statusResponse = await makeRequest(`${config.baseUrl}/api/wa/status`);
    const statusData = await statusResponse.json();

    if (statusResponse.ok) {
      logger.success('WhatsApp status endpoint', `Client Ready: ${statusData.clientReady}`);
      
      if (statusData.circuitBreakerOpen) {
        logger.warn('WhatsApp circuit breaker', 'Circuit breaker is open');
      }
    } else {
      logger.fail('WhatsApp status endpoint', new Error(`Status: ${statusResponse.status}`));
    }

    // Test update endpoint
    const updateResponse = await makeRequest(`${config.baseUrl}/api/update`);
    const updateData = await updateResponse.json();

    if (updateResponse.ok && updateData.success !== false) {
      logger.success('Update endpoint', `Client Ready: ${updateData.clientReady}`);
    } else {
      logger.fail('Update endpoint', new Error('Invalid response'));
    }

    // Test messaging circuit breaker status
    const cbResponse = await makeRequest(`${config.baseUrl}/api/messaging/circuit-breaker-status`);
    const cbData = await cbResponse.json();

    if (cbResponse.ok && cbData.success) {
      const dbState = cbData.database?.state || 'unknown';
      logger.success('Messaging circuit breaker', `State: ${dbState}`);
    } else {
      logger.fail('Messaging circuit breaker', new Error('Failed to get status'));
    }

  } catch (error) {
    logger.fail('WhatsApp endpoints', error);
  }
}

async function testDatabaseConnectivity() {
  logger.info('Testing Database Connectivity...');

  try {
    // Test patients endpoint (requires database)
    const patientsResponse = await makeRequest(`${config.baseUrl}/api/patientsPhones`);
    
    if (patientsResponse.ok) {
      const patientsData = await patientsResponse.json();
      
      if (Array.isArray(patientsData)) {
        logger.success('Database connectivity', `Retrieved ${patientsData.length} patient records`);
      } else {
        logger.warn('Database connectivity', 'Unexpected data format');
      }
    } else {
      logger.fail('Database connectivity', new Error(`Status: ${patientsResponse.status}`));
    }

    // Test appointments endpoint
    const appsResponse = await makeRequest(`${config.baseUrl}/api/getWebApps?PDate=${TEST_DATE}`);
    
    if (appsResponse.ok) {
      const appsData = await appsResponse.json();
      logger.success('Appointments endpoint', `Retrieved data for ${TEST_DATE}`);
    } else {
      logger.fail('Appointments endpoint', new Error(`Status: ${appsResponse.status}`));
    }

  } catch (error) {
    logger.fail('Database connectivity', error);
  }
}

async function testPatientEndpoints() {
  logger.info('Testing Patient Endpoints...');

  try {
    // Test patient info endpoint
    const infoResponse = await makeRequest(`${config.baseUrl}/api/getinfos?code=${TEST_PATIENT_ID}`);
    
    if (infoResponse.ok) {
      const infoData = await infoResponse.json();
      
      if (infoData && typeof infoData === 'object') {
        logger.success('Patient info endpoint', `Retrieved info for patient ${TEST_PATIENT_ID}`);
      } else {
        logger.warn('Patient info endpoint', 'No data returned - patient may not exist');
      }
    } else {
      logger.fail('Patient info endpoint', new Error(`Status: ${infoResponse.status}`));
    }

    // Test timepoints endpoint
    const tpResponse = await makeRequest(`${config.baseUrl}/api/gettimepoints?code=${TEST_PATIENT_ID}`);
    
    if (tpResponse.ok) {
      const tpData = await tpResponse.json();
      
      if (Array.isArray(tpData)) {
        logger.success('Timepoints endpoint', `Retrieved ${tpData.length} timepoints`);
      } else {
        logger.warn('Timepoints endpoint', 'Unexpected data format');
      }
    } else {
      logger.fail('Timepoints endpoint', new Error(`Status: ${tpResponse.status}`));
    }

  } catch (error) {
    logger.fail('Patient endpoints', error);
  }
}

async function testErrorHandling() {
  logger.info('Testing Error Handling...');

  try {
    // Test invalid endpoint
    const invalidResponse = await makeRequest(`${config.baseUrl}/api/nonexistent`);
    
    if (invalidResponse.status === 404) {
      logger.success('404 handling', 'Correctly returns 404 for invalid endpoints');
    } else {
      logger.warn('404 handling', `Expected 404, got ${invalidResponse.status}`);
    }

    // Test invalid patient ID
    const invalidPatientResponse = await makeRequest(`${config.baseUrl}/api/getinfos?code=invalid123`);
    
    if (invalidPatientResponse.ok) {
      logger.success('Invalid patient handling', 'Handles invalid patient IDs gracefully');
    } else {
      logger.warn('Invalid patient handling', `Status: ${invalidPatientResponse.status}`);
    }

  } catch (error) {
    logger.fail('Error handling', error);
  }
}

async function testSystemLoad() {
  logger.info('Testing System Under Load...');

  try {
    const concurrentRequests = 10;
    const promises = [];

    // Create multiple concurrent requests
    for (let i = 0; i < concurrentRequests; i++) {
      promises.push(makeRequest(`${config.baseUrl}/api/health`));
    }

    const results = await Promise.allSettled(promises);
    const successful = results.filter(r => r.status === 'fulfilled' && r.value.ok).length;
    const failed = results.length - successful;

    if (successful >= concurrentRequests * 0.8) { // 80% success rate
      logger.success('Concurrent requests', `${successful}/${concurrentRequests} requests succeeded`);
    } else {
      logger.warn('Concurrent requests', `Only ${successful}/${concurrentRequests} requests succeeded`);
    }

  } catch (error) {
    logger.fail('System load test', error);
  }
}

/**
 * Main test execution
 */
async function runSystemTests() {
  console.log(`${colors.blue}🚀 Starting System Integration Tests${colors.reset}`);
  console.log(`Base URL: ${config.baseUrl}`);
  console.log(`Test Date: ${TEST_DATE}`);
  console.log(`Test Patient ID: ${TEST_PATIENT_ID}\n`);

  try {
    // Run all test suites
    await testHealthEndpoints();
    await testWhatsAppEndpoints();
    await testDatabaseConnectivity();
    await testPatientEndpoints();
    await testErrorHandling();
    await testSystemLoad();

    // Print summary
    const success = logger.summary();
    
    // Exit with appropriate code
    process.exit(success ? 0 : 1);

  } catch (error) {
    console.error(`${colors.red}💥 Test execution failed:${colors.reset}`);
    console.error(error);
    process.exit(1);
  }
}

/**
 * Handle script arguments
 */
function parseArguments() {
  const args = process.argv.slice(2);
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--help':
      case '-h':
        console.log(`
Usage: node system-test.js [options]

Options:
  --base-url <url>     Base URL for testing (default: http://localhost:80)
  --patient-id <id>    Test patient ID (default: 1001)
  --date <date>        Test date in YYYY-MM-DD format (default: today)
  --timeout <ms>       Request timeout in milliseconds (default: 10000)
  --help, -h           Show this help message

Environment Variables:
  BASE_URL             Same as --base-url
  TEST_PATIENT_ID      Same as --patient-id
  TEST_DATE            Same as --date
        `);
        process.exit(0);
        break;
        
      case '--base-url':
        config.baseUrl = args[++i];
        break;
        
      case '--patient-id':
        process.env.TEST_PATIENT_ID = args[++i];
        break;
        
      case '--date':
        process.env.TEST_DATE = args[++i];
        break;
        
      case '--timeout':
        config.timeout = parseInt(args[++i]);
        break;
        
      default:
        console.log(`Unknown argument: ${arg}`);
        console.log('Use --help for usage information');
        process.exit(1);
    }
  }
}

// Parse arguments and run tests
parseArguments();
runSystemTests();