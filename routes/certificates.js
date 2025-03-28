const express = require('express');
const router = express.Router();
const acmeClient = require('../services/acmeClient');
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;

// Store certificates by user
const CERTIFICATES_FILE = path.join(__dirname, '../data/certificates.json');
const DATA_DIR = path.join(__dirname, '../data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize certificates file if it doesn't exist
if (!fs.existsSync(CERTIFICATES_FILE)) {
  fs.writeFileSync(CERTIFICATES_FILE, JSON.stringify([], null, 2));
}

// Helper functions
function getCertificates() {
  const data = fs.readFileSync(CERTIFICATES_FILE, 'utf8');
  return JSON.parse(data);
}

function saveCertificates(certificates) {
  fs.writeFileSync(CERTIFICATES_FILE, JSON.stringify(certificates, null, 2));
}

function getUserCertificates(userId) {
  const certificates = getCertificates();
  return certificates.filter(cert => cert.userId === userId);
}

// Dashboard - show all user certificates
router.get('/dashboard', (req, res) => {
  const userCerts = getUserCertificates(req.session.user.id);
  res.render('dashboard', { 
    user: req.session.user,
    certificates: userCerts 
  });
});

// Route to display the certificate request form
router.get('/request', (req, res) => {
  res.render('request-certificate', { user: req.session.user });
});

// Route to display a specific certificate
router.get('/view/:id', (req, res) => {
  const certificates = getCertificates();
  const certificate = certificates.find(c => c.id === req.params.id);
  
  if (!certificate || certificate.userId !== req.session.user.id) {
    return res.status(404).render('error', { 
      message: 'Certificate not found',
      user: req.session.user
    });
  }
  
  res.render('view-certificate', { 
    certificate,
    user: req.session.user
  });
});

// Generate certificate endpoint
router.post('/generate', async (req, res) => {
  try {
    const { domain, email, challengeType } = req.body;
    
    if (!domain || !email) {
      return res.status(400).json({ error: 'Domain and email are required' });
    }
    
    // Start the process but don't wait for it to complete
    if (challengeType === 'dns') {
      // For DNS challenge, just prepare the challenge and return the info
      const dnsData = await acmeClient.prepareDnsChallengeForDomain(domain, email);
      
      // Store the domain and email in session for the completion endpoint
      req.session.pendingDnsCertRequest = {
        domain,
        email,
        recordName: dnsData.recordName,
        recordValue: dnsData.recordValue,
        requestTime: Date.now()
      };
      
      return res.status(200).json({
        success: true,
        message: 'DNS challenge prepared successfully',
        dnsData,
        nextStep: {
          action: 'Create DNS TXT record with your DNS provider',
          verifyEndpoint: '/certificates/verify-dns',
          verificationMethod: 'Once the DNS record is set, visit the verification endpoint'
        }
      });
    } else {
      // For HTTP challenge, use a job queue or process in background
      // Respond immediately to prevent timeout
      res.status(202).json({
        success: true,
        message: 'Certificate generation started. This may take a few minutes.',
        status: 'processing'
      });
      
      // Continue processing in the background (after response is sent)
      process.nextTick(async () => {
        try {
          const result = await acmeClient.generateCertificateHttp(domain, email);
          // Store the result for later retrieval
          // You could save this to a database or session
          console.log('Certificate generated successfully:', result.certificatePath);
        } catch (error) {
          console.error('Background certificate generation failed:', error);
        }
      });
    }
  } catch (error) {
    console.error('Error in certificate generation:', error);
    res.status(500).json({ error: 'Certificate generation failed', message: error.message });
  }
});

// Add a new endpoint to verify DNS and complete the certificate process
router.post('/verify-dns', async (req, res) => {
  try {
    // Get the pending request from session
    const pendingRequest = req.session.pendingDnsCertRequest;
    
    if (!pendingRequest) {
      return res.status(400).json({
        error: 'No pending DNS certificate request found',
        message: 'Please start a new certificate request'
      });
    }
    
    const { domain, email } = pendingRequest;
    
    // Start the verification process but respond quickly
    res.status(202).json({
      success: true,
      message: 'Verification and certificate generation started. This may take a few minutes.',
      status: 'processing'
    });
    
    // Continue processing in the background (after response is sent)
    process.nextTick(async () => {
      try {
        const result = await acmeClient.completeDnsChallengeAndGetCertificate(domain, email);
        console.log('Certificate generated successfully:', result.certificatePath);
        // Clear the pending request
        req.session.pendingDnsCertRequest = null;
        // You could store the result in a database for retrieval
      } catch (error) {
        console.error('Background DNS verification failed:', error);
      }
    });
  } catch (error) {
    console.error('Error in DNS verification:', error);
    res.status(500).json({ error: 'DNS verification failed', message: error.message });
  }
});

// Add a status endpoint to check certificate generation status
router.get('/status', (req, res) => {
  // Here you would check the status of a certificate request
  // This could query a database or check session data
  const pendingRequest = req.session.pendingDnsCertRequest;
  
  if (pendingRequest) {
    return res.json({
      status: 'pending',
      domain: pendingRequest.domain,
      dnsRecord: {
        name: pendingRequest.recordName,
        value: pendingRequest.recordValue
      },
      requestTime: pendingRequest.requestTime
    });
  }
  
  res.json({
    status: 'no_pending_requests'
  });
});

// Route to download a certificate
router.get('/download/:id/:type', (req, res) => {
  const { id, type } = req.params;
  const certificates = getCertificates();
  const certificate = certificates.find(c => c.id === id);
  
  if (!certificate || certificate.userId !== req.session.user.id) {
    return res.status(404).render('error', { 
      message: 'Certificate not found',
      user: req.session.user
    });
  }
  
  let filePath;
  let fileName;
  
  if (type === 'cert') {
    filePath = certificate.certificatePath;
    fileName = `${certificate.domain}_certificate.pem`;
  } else if (type === 'key') {
    filePath = certificate.privateKeyPath;
    fileName = `${certificate.domain}_privatekey.pem`;
  } else {
    return res.status(400).render('error', { 
      message: 'Invalid download type',
      user: req.session.user
    });
  }
  
  res.download(filePath, fileName);
});

// Route to verify domain ownership (for HTTP-01 challenge)
router.get('/.well-known/acme-challenge/:token', (req, res) => {
  const { token } = req.params;
  const keyAuthorization = acmeClient.getChallengeResponse(token);
  
  if (!keyAuthorization) {
    return res.status(404).send('Not found');
  }
  
  res.set('Content-Type', 'text/plain');
  res.send(keyAuthorization);
});

// Add a new endpoint to check DNS propagation
router.post('/check-dns', async (req, res) => {
  try {
    // Get the pending request from session
    const pendingRequest = req.session.pendingDnsCertRequest;
    
    if (!pendingRequest) {
      return res.status(400).json({
        success: false,
        message: 'No pending DNS certificate request found'
      });
    }
    
    const { domain } = req.body;
    
    if (pendingRequest.domain !== domain) {
      return res.status(400).json({
        success: false,
        message: 'Domain mismatch with pending request'
      });
    }
    
    try {
      // Check DNS propagation using the stored record value
      await acmeClient.verifyDnsPropagation(domain, pendingRequest.recordValue);
      
      // If we get here, DNS record is correctly set
      return res.json({
        success: true,
        message: 'DNS record verified successfully',
        domain: domain
      });
    } catch (dnsError) {
      console.log('DNS check failed:', dnsError.message);
      // Construct a helpful message with details
      const details = [];
      
      if (dnsError.message.includes('DNS record not found')) {
        details.push('The DNS record could not be found. It may not have propagated yet.');
        details.push(`Check that you created a TXT record with name: ${pendingRequest.recordName}`);
        details.push(`And value: ${pendingRequest.recordValue}`);
        details.push('DNS changes can take 5 minutes to 48 hours to propagate fully.');
      } else if (dnsError.message.includes('doesn\'t match expected value')) {
        details.push('The DNS record was found but has an incorrect value.');
        details.push(`The value should be exactly: ${pendingRequest.recordValue}`);
        details.push('Make sure there are no extra spaces or quotes in the value.');
      }
      
      return res.status(400).json({
        success: false,
        message: 'DNS verification failed',
        details: details.length > 0 ? details : undefined,
        error: dnsError.message
      });
    }
  } catch (error) {
    console.error('Error in DNS check:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error checking DNS record',
      error: error.message
    });
  }
});

module.exports = router; 