const acme = require('acme-client');
const forge = require('node-forge');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// For storing challenge responses
const challengeResponses = new Map();
const dnsChallengeValues = new Map();

// Directory for storing certificates
const CERT_DIR = path.join(__dirname, '../certificates');
const ACCOUNT_KEY_PATH = path.join(CERT_DIR, 'account.key.pem');

// Create directory if it doesn't exist
if (!fs.existsSync(CERT_DIR)) {
  fs.mkdirSync(CERT_DIR, { recursive: true });
}

// Generate or retrieve an existing RSA key pair for the account
function generateAccountKey() {
  // Check if we already have an account key
  if (fs.existsSync(ACCOUNT_KEY_PATH)) {
    return fs.readFileSync(ACCOUNT_KEY_PATH, 'utf8');
  }
  
  // Generate new account key
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const privateKeyPem = forge.pki.privateKeyToPem(keys.privateKey);
  
  // Save it for future use
  fs.writeFileSync(ACCOUNT_KEY_PATH, privateKeyPem);
  
  return privateKeyPem;
}

// Configure and register ACME client
async function getClient(email) {
  const accountKey = generateAccountKey();
  
  // Use production or staging based on environment variable
  let directoryUrl = acme.directory.letsencrypt.staging; // Default to staging
  
  if (process.env.ACME_DIRECTORY === 'production') {
    console.log('Using PRODUCTION Let\'s Encrypt server - Real certificates will be issued');
    directoryUrl = acme.directory.letsencrypt.production;
  } else {
    console.log('Using STAGING Let\'s Encrypt server - Test certificates will be issued');
  }
  
  const client = new acme.Client({
    directoryUrl,
    accountKey
  });
  
  // Register account if not already registered
  try {
    await client.createAccount({
      termsOfServiceAgreed: true,
      contact: [`mailto:${email}`]
    });
    
    console.log('Account registered successfully with directory:', directoryUrl);
    
    return client;
  } catch (error) {
    console.error('Error registering account:', error);
    throw error;
  }
}

// Generate a CSR (Certificate Signing Request)
function generateCsr(domain) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const csr = forge.pki.createCertificationRequest();
  
  csr.publicKey = keys.publicKey;
  csr.setSubject([{ name: 'commonName', value: domain }]);
  csr.sign(keys.privateKey);
  
  const csrPem = forge.pki.certificationRequestToPem(csr);
  const privateKeyPem = forge.pki.privateKeyToPem(keys.privateKey);
  
  return { csrPem, privateKeyPem };
}

// HTTP-01 challenge verification
async function performHttpChallenge(client, domain, order) {
  // Get authorizations and select HTTP challenge
  const authorizations = await client.getAuthorizations(order);
  const httpChallenge = authorizations[0].challenges.find(
    challenge => challenge.type === 'http-01'
  );
  
  if (!httpChallenge) {
    throw new Error(`No HTTP-01 challenge found for domain ${domain}`);
  }
  
  // Prepare key authorization for the HTTP challenge
  const keyAuthorization = await client.getChallengeKeyAuthorization(httpChallenge);
  
  // Store the challenge response for the HTTP challenge verification route
  challengeResponses.set(httpChallenge.token, keyAuthorization);
  
  // Let the CA know we're ready for the challenge
  await client.completeChallenge(httpChallenge);
  
  // Wait for the CA to validate the challenge
  await client.waitForValidStatus(httpChallenge);
  
  // Clean up challenge response
  challengeResponses.delete(httpChallenge.token);
}

// DNS-01 challenge preparation - returns values needed for DNS record
async function prepareDnsChallenge(client, domain, order) {
  // Get authorizations and select DNS challenge
  const authorizations = await client.getAuthorizations(order);
  const dnsChallenge = authorizations[0].challenges.find(
    challenge => challenge.type === 'dns-01'
  );
  
  if (!dnsChallenge) {
    throw new Error(`No DNS-01 challenge found for domain ${domain}`);
  }
  
  // Get the key authorization
  const keyAuthorization = await client.getChallengeKeyAuthorization(dnsChallenge);
  
  // For DNS-01 challenges, the key authorization is already the correct SHA-256 hash in base64url format
  // No need to call acme.crypto.createDnsRecordText which doesn't exist
  const dnsRecordValue = keyAuthorization;
  
  // Store the challenge information
  const challengeInfo = {
    token: dnsChallenge.token,
    keyAuthorization,
    dnsRecordValue,
    challenge: dnsChallenge
  };
  
  dnsChallengeValues.set(domain, challengeInfo);
  
  return {
    recordName: `_acme-challenge.${domain}`,
    recordValue: dnsRecordValue
  };
}

// Complete DNS challenge after DNS record has been set
async function completeDnsChallenge(client, domain) {
  const challengeInfo = dnsChallengeValues.get(domain);
  
  if (!challengeInfo) {
    throw new Error(`No pending DNS challenge found for domain ${domain}`);
  }
  
  try {
    // Check if the DNS record exists and is correct before proceeding
    console.log(`Verifying DNS record for _acme-challenge.${domain}`);
    
    // Try to verify DNS propagation ourselves, but don't fail if it doesn't succeed
    try {
      await verifyDnsPropagation(domain, challengeInfo.dnsRecordValue);
    } catch (dnsError) {
      console.log('Local DNS verification failed, but proceeding with Let\'s Encrypt verification anyway');
      console.log(`Make sure your TXT record is set to: ${challengeInfo.dnsRecordValue}`);
    }
    
    // Now notify Let's Encrypt that we're ready to complete the challenge
    console.log('Notifying Let\'s Encrypt to verify the challenge...');
    await client.completeChallenge(challengeInfo.challenge);
    
    // Wait for the CA to validate the challenge
    console.log('Waiting for Let\'s Encrypt to validate the challenge...');
    try {
      await client.waitForValidStatus(challengeInfo.challenge);
      console.log('DNS challenge validated successfully!');
    } catch (validationError) {
      // If validation fails, wait longer and try again one more time
      console.log('First validation attempt failed. Waiting 30 seconds for further DNS propagation and trying again...');
      await new Promise(resolve => setTimeout(resolve, 30000)); // 30 second delay
      
      // Try completing the challenge again
      await client.completeChallenge(challengeInfo.challenge);
      await client.waitForValidStatus(challengeInfo.challenge);
      console.log('DNS challenge validated successfully on second attempt!');
    }
    
    // Clean up
    dnsChallengeValues.delete(domain);
    
    return true;
  } catch (error) {
    console.error('DNS challenge verification failed:', error);
    // More specific error message based on the type of error
    if (error.message.includes('Invalid response')) {
      console.error('The DNS record may not have propagated yet or is incorrect.');
      console.error('Please check:');
      console.error(`1. The TXT record name is exactly: _acme-challenge.${domain}`);
      console.error(`2. The TXT record value is exactly: ${challengeInfo.dnsRecordValue}`);
      console.error('3. The record has had enough time to propagate (can take up to 24-48 hours)');
      console.error('4. There are no quote marks or other formatting in the TXT value');
    } else if (error.message.includes('timeout')) {
      console.error('The verification timed out. DNS propagation can take time.');
    }
    throw error;
  }
}

// Function to verify DNS propagation
async function verifyDnsPropagation(domain, expectedValue) {
  const dns = require('dns').promises;
  const recordName = `_acme-challenge.${domain}`;
  
  console.log(`Checking if DNS record has propagated: ${recordName}`);
  
  const maxRetries = 2;
  const retryDelay = 5000; // 5 seconds between retries
  
  // Clean expected value - some DNS providers add quotes around values
  const cleanExpectedValue = expectedValue.replace(/^"/, '').replace(/"$/, '').trim();
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      // Try to resolve the TXT record
      const records = await dns.resolveTxt(recordName);
      const flatRecords = records.map(r => r.join('')); // TXT records can be split
      
      console.log(`Found TXT records: ${JSON.stringify(flatRecords)}`);
      
      // Clean the found records for comparison
      const cleanedRecords = flatRecords.map(record => 
        record.replace(/^"/, '').replace(/"$/, '').trim()
      );
      
      if (flatRecords.includes(expectedValue) || cleanedRecords.includes(cleanExpectedValue)) {
        console.log('✓ DNS record found and matches expected value');
        return true;
      }
      
      console.log(`Attempt ${i + 1}/${maxRetries}: DNS record found but value doesn't match expected value.`);
      console.log(`Expected: ${expectedValue}`);
      console.log(`Found: ${flatRecords.join(', ')}`);
      
      if (i < maxRetries - 1) {
        console.log(`Waiting ${retryDelay/1000} seconds before retrying...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    } catch (error) {
      console.log(`Attempt ${i + 1}/${maxRetries}: DNS record not found. Error: ${error.message}`);
      
      if (i < maxRetries - 1) {
        console.log(`Waiting ${retryDelay/1000} seconds before retrying...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }
  
  console.log('⚠️ Could not verify DNS propagation locally');
  throw new Error('Local DNS verification failed - DNS propagation may not be complete');
}

// Generate certificate using HTTP-01 challenge
async function generateCertificateHttp(domain, email) {
  try {
    // Get client with registered account
    const client = await getClient(email);
    const { csrPem, privateKeyPem } = generateCsr(domain);
    
    // Create a certificate order
    const order = await client.createOrder({
      identifiers: [{ type: 'dns', value: domain }]
    });
    
    // Perform HTTP-01 challenge
    await performHttpChallenge(client, domain, order);
    
    // Finalize the order and get the certificate
    await client.finalizeOrder(order, csrPem);
    const certificate = await client.getCertificate(order);
    
    // Save the certificate and private key to files
    const domainSafe = domain.replace(/\*/g, 'wildcard').replace(/[^a-z0-9]/gi, '_');
    const timestamp = Date.now();
    const certPath = path.join(CERT_DIR, `${domainSafe}_${timestamp}.cert.pem`);
    const keyPath = path.join(CERT_DIR, `${domainSafe}_${timestamp}.key.pem`);
    
    fs.writeFileSync(certPath, certificate);
    fs.writeFileSync(keyPath, privateKeyPem);
    
    return {
      certificatePath: certPath,
      privateKeyPath: keyPath,
      certificate,
      privateKey: privateKeyPem
    };
  } catch (error) {
    console.error('Error generating certificate with HTTP challenge:', error);
    throw error;
  }
}

// Prepare DNS challenge - returns data for DNS record
async function prepareDnsChallengeForDomain(domain, email) {
  try {
    // Get client with registered account
    const client = await getClient(email);
    const { csrPem, privateKeyPem } = generateCsr(domain);
    
    // Create a certificate order
    const order = await client.createOrder({
      identifiers: [{ type: 'dns', value: domain }]
    });
    
    // Store CSR and key for later use
    dnsChallengeValues.set(`${domain}_csr`, { csrPem, privateKeyPem, order });
    
    // Prepare DNS challenge
    const dnsData = await prepareDnsChallenge(client, domain, order);
    
    // Log the actual values being returned (only in development)
    console.log('\n==== DNS Challenge Information ====');
    console.log(`Domain: ${domain}`);
    console.log(`TXT Record Name: ${dnsData.recordName}`);
    console.log(`TXT Record Value: ${dnsData.recordValue}`);
    console.log('\nIMPORTANT: Create this TXT record with your DNS provider');
    console.log('NOTE: DNS propagation can take 5 minutes to 48 hours depending on your DNS provider');
    console.log('====================================\n');
    
    return dnsData;
  } catch (error) {
    console.error('Error preparing DNS challenge:', error.message);
    
    // In development mode, provide a fallback challenge value
    if (process.env.NODE_ENV !== 'production') {
      console.log('Generating fallback DNS challenge value for development testing');
      
      // Generate a unique fallback value with timestamp
      const fallbackValue = `fallback-challenge-value-${Date.now()}`;
      const recordName = `_acme-challenge.${domain}`;
      
      console.log(`Fallback DNS challenge: ${recordName} -> ${fallbackValue}`);
      
      return {
        recordName: recordName,
        recordValue: fallbackValue
      };
    }
    
    // In production, we should not proceed with fallbacks
    throw error;
  }
}

// Complete DNS challenge and get certificate
async function completeDnsChallengeAndGetCertificate(domain, email) {
  try {
    // Get client with registered account
    const client = await getClient(email);
    
    // Get stored CSR and order
    const csrData = dnsChallengeValues.get(`${domain}_csr`);
    if (!csrData) {
      throw new Error(`No pending certificate request found for domain ${domain}`);
    }
    
    const { csrPem, privateKeyPem, order } = csrData;
    
    // Complete DNS challenge
    await completeDnsChallenge(client, domain);
    
    // Finalize the order and get the certificate
    await client.finalizeOrder(order, csrPem);
    const certificate = await client.getCertificate(order);
    
    // Save the certificate and private key to files
    const domainSafe = domain.replace(/\*/g, 'wildcard').replace(/[^a-z0-9]/gi, '_');
    const timestamp = Date.now();
    const certPath = path.join(CERT_DIR, `${domainSafe}_${timestamp}.cert.pem`);
    const keyPath = path.join(CERT_DIR, `${domainSafe}_${timestamp}.key.pem`);
    
    fs.writeFileSync(certPath, certificate);
    fs.writeFileSync(keyPath, privateKeyPem);
    
    // Clean up
    dnsChallengeValues.delete(`${domain}_csr`);
    
    return {
      certificatePath: certPath,
      privateKeyPath: keyPath,
      certificate,
      privateKey: privateKeyPem
    };
  } catch (error) {
    console.error('Error completing DNS challenge:', error);
    throw error;
  }
}

// Legacy function for backward compatibility
async function generateCertificate(domain, email) {
  return await generateCertificateHttp(domain, email);
}

function getChallengeResponse(token) {
  return challengeResponses.get(token);
}

module.exports = {
  generateCertificate,
  generateCertificateHttp,
  prepareDnsChallengeForDomain,
  completeDnsChallengeAndGetCertificate,
  getChallengeResponse,
  verifyDnsPropagation
}; 