// Tracing tool to diagnose DNS challenge issues
const acmeClient = require('./services/acmeClient');
const fs = require('fs');

// Enable detailed debug logging
process.env.DEBUG = 'true';

// Create a monkeypatch to intercept and log every function related to challenges
const originalPrepareDnsChallenge = acmeClient.prepareDnsChallengeForDomain;
acmeClient.prepareDnsChallengeForDomain = async function(domain, email) {
  console.log('==== TRACE: prepareDnsChallengeForDomain CALLED ====');
  console.log(`Domain: ${domain}, Email: ${email}`);
  
  try {
    const result = await originalPrepareDnsChallenge.call(this, domain, email);
    console.log('==== TRACE: prepareDnsChallengeForDomain RESULT ====');
    console.log(JSON.stringify(result, null, 2));
    
    // Check result
    if (result.recordValue === 'PLACEHOLDER_VALUE') {
      console.error('!!!!! FOUND PLACEHOLDER VALUE IN RESULT !!!!!');
    }
    
    // Save result to file for investigation
    fs.writeFileSync('dns-challenge-result.json', JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error('==== TRACE: prepareDnsChallengeForDomain ERROR ====');
    console.error(error);
    throw error;
  }
};

// Mock the certificate request and DNS challenge
async function traceDnsChallenge() {
  try {
    const domain = 'test.example.com';
    const email = 'test@example.com';
    
    // Force test mode for easier debugging
    process.env.NODE_ENV = 'development';
    process.env.ACME_DIRECTORY = 'staging';
    
    console.log('Starting DNS challenge trace...');
    
    // Remove the acme-client module cache to ensure fresh code
    Object.keys(require.cache).forEach(key => {
      if (key.includes('acme-client')) {
        delete require.cache[key];
      }
    });
    
    const result = await acmeClient.prepareDnsChallengeForDomain(domain, email);
    console.log('Final result:', result);
    
    // Check for placeholder values in any keys
    const resultStr = JSON.stringify(result);
    if (resultStr.includes('PLACEHOLDER_VALUE')) {
      console.error('PLACEHOLDER_VALUE found in result:', resultStr);
    } else {
      console.log('No placeholder values found in result');
    }
  } catch (error) {
    console.error('Trace failed with error:', error);
  }
}

// Run the trace
traceDnsChallenge(); 