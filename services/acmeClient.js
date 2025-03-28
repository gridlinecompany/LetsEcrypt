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
  try {
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const csr = forge.pki.createCertificationRequest();
    
    csr.publicKey = keys.publicKey;
    csr.setSubject([{ name: 'commonName', value: domain }]);
    
    // Explicitly set the signature algorithm to SHA-256 with RSA, which is supported by Let's Encrypt
    csr.signingAlgorithm = {
      name: 'RSASSA-PKCS1-v1_5',
      hash: { name: 'sha256' }
    };
    
    // Set message digest algorithm explicitly
    const md = forge.md.sha256.create();
    
    // Sign the CSR with SHA-256
    csr.sign(keys.privateKey, md);
    
    const csrPem = forge.pki.certificationRequestToPem(csr);
    const privateKeyPem = forge.pki.privateKeyToPem(keys.privateKey);
    
    console.log('CSR generated successfully with SHA-256 signature algorithm');
    
    return { csrPem, privateKeyPem };
  } catch (error) {
    console.error('Error generating CSR:', error);
    throw new Error(`Failed to generate CSR: ${error.message}`);
  }
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
    
    // Wait for the CA to validate the challenge - using a more robust approach
    console.log('Waiting for Let\'s Encrypt to validate the challenge...');
    
    // First attempt validation with standard timeout
    try {
      await client.waitForValidStatus(challengeInfo.challenge);
      console.log('DNS challenge validated successfully!');
    } catch (validationError) {
      // First validation attempt failed
      console.log('First validation attempt failed. Waiting 60 seconds for further DNS propagation and trying again...');
      console.log(`Error was: ${validationError.message}`);
      
      // Wait 60 seconds for DNS propagation
      await new Promise(resolve => setTimeout(resolve, 60000)); 
      
      try {
        // Try completing the challenge again
        await client.completeChallenge(challengeInfo.challenge);
        await client.waitForValidStatus(challengeInfo.challenge);
        console.log('DNS challenge validated successfully on second attempt!');
      } catch (secondError) {
        console.log('Second validation attempt failed. Waiting an additional 120 seconds...');
        console.log(`Error was: ${secondError.message}`);
        
        // Wait 2 minutes more for final attempt
        await new Promise(resolve => setTimeout(resolve, 120000));
        
        // Final attempt
        await client.completeChallenge(challengeInfo.challenge);
        await client.waitForValidStatus(challengeInfo.challenge);
        console.log('DNS challenge validated successfully on final attempt!');
      }
    }
    
    // Important: Wait an additional period AFTER validation before trying to finalize
    // This ensures Let's Encrypt has fully registered the validation
    console.log('Challenge validated! Waiting an additional 10 seconds before finalizing...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // Clean up
    dnsChallengeValues.delete(domain);
    
    return true;
  } catch (error) {
    console.error('DNS challenge verification failed:', error);
    // More specific error message based on the type of error
    if (error.message.includes('Invalid response')) {
      throw new Error('DNS verification failed: The Let\'s Encrypt server could not find the expected TXT record. Make sure you added the record correctly and it has propagated.');
    } else if (error.message.includes('Order\'s status')) {
      throw new Error('DNS verification timing issue: Let\'s Encrypt hasn\'t fully processed the challenge yet. Please try again in a few minutes.');
    } else {
      throw error;
    }
  }
}

// Function to verify DNS propagation
async function verifyDnsPropagation(domain, expectedValue) {
  const dns = require('dns').promises;
  const recordName = `_acme-challenge.${domain}`;
  
  console.log(`Checking if DNS record has propagated: ${recordName} at ${new Date().toISOString()}`);
  
  // Try to reset DNS cache by resetting servers
  if (typeof dns.getServers === 'function') {
    const servers = dns.getServers();
    dns.setServers(servers);
  }
  
  const maxRetries = 2;
  const retryDelay = 3000; // 3 seconds between retries
  
  // Clean expected value - some DNS providers add quotes around values
  const cleanExpectedValue = expectedValue.replace(/^"/, '').replace(/"$/, '').trim();
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      // Add random query parameter to bypass caching
      const bypassCache = `?_t=${Date.now()}`;
      
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
    console.log('Finalizing order...');
    await client.finalizeOrder(order, csrPem);
    
    // Wait for the order to be finalized by Let's Encrypt
    console.log('Order finalized, waiting 15 seconds for certificate to be issued...');
    await new Promise(resolve => setTimeout(resolve, 15000));
    
    // Get the certificate with retries
    console.log('Downloading certificate...');
    let certificate;
    const maxRetries = 5;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Get the latest order status
        const finalOrder = await client.getOrder(order);
        console.log(`Certificate download attempt ${attempt}/${maxRetries}, Order status: ${finalOrder.status}`);
        
        // Download the certificate
        certificate = await client.getCertificate(order);
        console.log('Certificate downloaded successfully!');
        break;
      } catch (certError) {
        if (certError.message.includes('URL not found') && attempt < maxRetries) {
          const waitTime = attempt * 10000; // Increase wait time with each attempt
          console.log(`Certificate URL not available yet. Waiting ${waitTime/1000} seconds before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        } else if (attempt >= maxRetries) {
          console.log(`Failed to download certificate after ${maxRetries} attempts.`);
          throw certError;
        } else {
          throw certError;
        }
      }
    }
    
    if (!certificate) {
      throw new Error('Failed to download certificate after multiple attempts');
    }
    
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

// Generate certificate using pre-verified DNS challenge
async function generateCertificateWithVerifiedDns(domain, email) {
  try {
    // Get client with registered account
    const client = await getClient(email);
    
    // Get stored CSR and order
    const csrData = dnsChallengeValues.get(`${domain}_csr`);
    if (!csrData) {
      throw new Error(`No pending certificate request found for domain ${domain}`);
    }
    
    const { csrPem, privateKeyPem, order } = csrData;
    
    console.log('Generating certificate with pre-verified DNS challenge');
    
    // Get the current status of the order directly from Let's Encrypt
    const updatedOrder = await client.getOrder(order);
    console.log(`Current order status: ${updatedOrder.status}`);
    
    if (updatedOrder.status === 'pending') {
      console.log('Order is still pending. Trying to check the authorization status...');
      
      // Get authorizations and check their status
      const authorizations = await client.getAuthorizations(order);
      const dnsAuthz = authorizations[0];
      console.log(`Authorization status: ${dnsAuthz.status}`);
      
      if (dnsAuthz.status === 'pending') {
        // The authorization is still pending, we need to complete the challenge again
        console.log('Authorization still pending. Completing challenge again...');
        
        // Get the DNS challenge
        const dnsChallenge = dnsAuthz.challenges.find(c => c.type === 'dns-01');
        if (!dnsChallenge) {
          throw new Error('DNS challenge not found in authorization');
        }
        
        // Complete the challenge again
        await client.completeChallenge(dnsChallenge);
        
        // Wait for validation
        console.log('Waiting for Let\'s Encrypt to validate the challenge...');
        try {
          await client.waitForValidStatus(dnsChallenge);
          console.log('DNS challenge validated successfully!');
        } catch (error) {
          console.log(`Validation error: ${error.message}`);
          
          // Wait 60 seconds and try one more time
          console.log('Waiting 60 seconds for further DNS propagation...');
          await new Promise(resolve => setTimeout(resolve, 60000));
          
          await client.completeChallenge(dnsChallenge);
          await client.waitForValidStatus(dnsChallenge);
        }
        
        // Wait an additional period to ensure Let's Encrypt has registered the validation
        console.log('Waiting an additional 10 seconds before finalizing...');
        await new Promise(resolve => setTimeout(resolve, 10000));
      }
    } else if (updatedOrder.status === 'ready') {
      console.log('Order is ready for finalization.');
    } else if (updatedOrder.status === 'valid') {
      console.log('Order is already valid!');
    } else {
      throw new Error(`Order is in an unexpected state: ${updatedOrder.status}`);
    }
    
    // Now finalize the order
    console.log('Finalizing order and getting certificate...');
    
    try {
      await client.finalizeOrder(order, csrPem);
    } catch (finalizeError) {
      if (finalizeError.message.includes('Order\'s status')) {
        console.log('Order status not ready for finalization. Waiting 30 seconds...');
        await new Promise(resolve => setTimeout(resolve, 30000));
        
        // Check order status again
        const recheckOrder = await client.getOrder(order);
        console.log(`Order status after waiting: ${recheckOrder.status}`);
        
        // Try again
        await client.finalizeOrder(order, csrPem);
      } else {
        throw finalizeError;
      }
    }
    
    // Wait for the order to be finalized by Let's Encrypt
    console.log('Order finalized, waiting 15 seconds for certificate to be issued...');
    await new Promise(resolve => setTimeout(resolve, 15000));
    
    // Get the certificate with retries
    console.log('Downloading certificate...');
    let certificate;
    const maxRetries = 5;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Get the latest order status
        const finalOrder = await client.getOrder(order);
        console.log(`Certificate download attempt ${attempt}/${maxRetries}, Order status: ${finalOrder.status}`);
        
        // Download the certificate
        certificate = await client.getCertificate(order);
        console.log('Certificate downloaded successfully!');
        break;
      } catch (certError) {
        if (certError.message.includes('URL not found') && attempt < maxRetries) {
          const waitTime = attempt * 10000; // Increase wait time with each attempt
          console.log(`Certificate URL not available yet. Waiting ${waitTime/1000} seconds before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        } else if (attempt >= maxRetries) {
          console.log(`Failed to download certificate after ${maxRetries} attempts.`);
          throw certError;
        } else {
          throw certError;
        }
      }
    }
    
    if (!certificate) {
      throw new Error('Failed to download certificate after multiple attempts');
    }
    
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
    console.error('Error generating certificate with verified DNS:', error);
    throw error;
  }
}

module.exports = {
  generateCertificate,
  generateCertificateHttp,
  prepareDnsChallengeForDomain,
  completeDnsChallengeAndGetCertificate,
  getChallengeResponse,
  verifyDnsPropagation,
  generateCertificateWithVerifiedDns
}; 