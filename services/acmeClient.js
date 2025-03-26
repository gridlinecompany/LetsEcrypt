const acme = require('acme-client');
const forge = require('node-forge');
const fs = require('fs');
const path = require('path');

// For storing challenge responses
const challengeResponses = new Map();

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
  
  const client = new acme.Client({
    directoryUrl: acme.directory.letsencrypt.staging, // Use staging for testing
    accountKey
  });
  
  // Register account if not already registered
  try {
    await client.createAccount({
      termsOfServiceAgreed: true,
      contact: [`mailto:${email}`]
    });
    console.log('Account registered successfully or already exists');
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

async function generateCertificate(domain, email) {
  try {
    // Get client with registered account
    const client = await getClient(email);
    const { csrPem, privateKeyPem } = generateCsr(domain);
    
    // Create a certificate order
    const order = await client.createOrder({
      identifiers: [{ type: 'dns', value: domain }]
    });
    
    // Get authorizations and select HTTP challenge
    const authorizations = await client.getAuthorizations(order);
    const httpChallenge = authorizations[0].challenges.find(
      challenge => challenge.type === 'http-01'
    );
    
    // Prepare key authorization for the HTTP challenge
    const keyAuthorization = await client.getChallengeKeyAuthorization(httpChallenge);
    
    // Store the challenge response for the HTTP challenge verification route
    challengeResponses.set(httpChallenge.token, keyAuthorization);
    
    // Let the CA know we're ready for the challenge
    await client.completeChallenge(httpChallenge);
    
    // Wait for the CA to validate the challenge
    await client.waitForValidStatus(httpChallenge);
    
    // Finalize the order and get the certificate
    await client.finalizeOrder(order, csrPem);
    const certificate = await client.getCertificate(order);
    
    // Clean up challenge response
    challengeResponses.delete(httpChallenge.token);
    
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
    console.error('Error generating certificate:', error);
    throw error;
  }
}

function getChallengeResponse(token) {
  return challengeResponses.get(token);
}

module.exports = {
  generateCertificate,
  getChallengeResponse
}; 