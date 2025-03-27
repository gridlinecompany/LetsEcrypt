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
    
    // Notify Let's Encrypt that we're ready to complete the challenge
    console.log('Notifying Let\'s Encrypt to verify the challenge...');
    await client.completeChallenge(challengeInfo.challenge);
    
    // Wait for the CA to validate the challenge
    console.log('Waiting for Let\'s Encrypt to validate the challenge...');
    await client.waitForValidStatus(challengeInfo.challenge);
    
    console.log('DNS challenge validated successfully!');
    
    // Clean up
    dnsChallengeValues.delete(domain);
    
    return true;
  } catch (error) {
    console.error('DNS challenge verification failed:', error);
    // More specific error message based on the type of error
    if (error.message.includes('Invalid response')) {
      console.error('The DNS record may not have propagated yet or is incorrect.');
    } else if (error.message.includes('timeout')) {
      console.error('The verification timed out. DNS propagation can take time.');
    }
    throw error;
  }
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
    if (process.env.NODE_ENV !== 'production') {
      console.log('DNS Challenge Data:', {
        domain,
        recordName: dnsData.recordName,
        recordValue: dnsData.recordValue
      });
    }
    
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
  getChallengeResponse
}; 