// Simple test script for DNS challenge
const acmeClient = require('./services/acmeClient');

// Force development mode
process.env.NODE_ENV = 'development';
process.env.ACME_DIRECTORY = 'staging';

async function testDnsChallenge() {
  try {
    const domain = 'test.example.com';
    const email = 'test@gmail.com'; // Use a valid email domain
    
    console.log('Testing DNS challenge preparation...');
    console.log('Environment:', process.env.NODE_ENV);
    console.log('ACME Directory:', process.env.ACME_DIRECTORY);
    
    const dnsChallenge = await acmeClient.prepareDnsChallengeForDomain(domain, email);
    
    console.log('DNS Challenge Result:');
    console.log('Record Name:', dnsChallenge.recordName);
    console.log('Record Value:', dnsChallenge.recordValue);
    
    if (dnsChallenge.recordValue === 'PLACEHOLDER_VALUE') {
      console.error('ERROR: Still using placeholder value!');
    } else {
      console.log('SUCCESS: Placeholder value was replaced with:', dnsChallenge.recordValue);
    }
  } catch (error) {
    console.error('Test failed with error:', error);
  }
}

// Run the test
testDnsChallenge(); 