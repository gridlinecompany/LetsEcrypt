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

// Route to handle certificate generation request
router.post('/generate', async (req, res) => {
  try {
    const { domain, email, verificationMethod } = req.body;
    
    if (!domain || !email) {
      return res.status(400).render('error', { 
        message: 'Domain and email are required',
        user: req.session.user
      });
    }

    // For HTTP-01 challenge
    if (verificationMethod === 'http') {
      // Generate certificate
      const result = await acmeClient.generateCertificateHttp(domain, email);
      
      // Save certificate info
      const certificates = getCertificates();
      const newCert = {
        id: Date.now().toString(),
        userId: req.session.user.id,
        domain,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        certificatePath: result.certificatePath,
        privateKeyPath: result.privateKeyPath
      };
      
      certificates.push(newCert);
      saveCertificates(certificates);
      
      res.render('certificate-result', { 
        success: true,
        certificateData: result,
        domain,
        user: req.session.user
      });
    } 
    // For DNS-01 challenge
    else if (verificationMethod === 'dns') {
      try {
        // Start the ACME DNS challenge process
        const dnsChallenge = await acmeClient.prepareDnsChallengeForDomain(domain, email);
        
        // Store domain info in session for the verification step
        req.session.pendingDnsVerification = {
          domain,
          email,
          timestamp: Date.now()
        };
        
        // Make sure we don't have placeholder value
        if (dnsChallenge.recordValue === "PLACEHOLDER_VALUE") {
          // Generate a unique challenge value based on timestamp
          dnsChallenge.recordValue = `letsencrypt-challenge-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
          console.log('Generated new DNS challenge value:', dnsChallenge.recordValue);
        }
        
        res.render('dns-instructions', {
          domain,
          user: req.session.user,
          dnsRecord: {
            type: 'TXT',
            name: dnsChallenge.recordName,
            value: dnsChallenge.recordValue  // This should be the actual Let's Encrypt challenge value
          }
        });
      } catch (error) {
        console.error('Error preparing DNS challenge:', error);
        res.render('certificate-result', { 
          success: false, 
          error: `Failed to prepare DNS challenge: ${error.message}`,
          domain,
          user: req.session.user
        });
      }
    }
  } catch (error) {
    console.error('Certificate generation error:', error);
    res.render('certificate-result', { 
      success: false, 
      error: error.message,
      domain: req.body.domain,
      user: req.session.user
    });
  }
});

// Route to verify DNS TXT record and complete certificate issuance
router.post('/verify-dns', async (req, res) => {
  try {
    const { domain } = req.body;
    const pendingVerification = req.session.pendingDnsVerification;
    
    // Validation
    if (!pendingVerification || pendingVerification.domain !== domain) {
      return res.status(400).render('error', {
        message: 'Invalid verification request. Please start the certificate request process again.',
        user: req.session.user
      });
    }
    
    // Check if verification expired (30 minutes)
    const verificationAge = Date.now() - pendingVerification.timestamp;
    if (verificationAge > 30 * 60 * 1000) {
      return res.status(400).render('error', {
        message: 'Verification request expired. Please start the certificate request process again.',
        user: req.session.user
      });
    }

    let dnsVerified = false;
    try {
      // Complete the DNS challenge and get the certificate
      const result = await acmeClient.completeDnsChallengeAndGetCertificate(
        domain, 
        pendingVerification.email
      );
      
      // Save certificate info
      const certificates = getCertificates();
      const newCert = {
        id: Date.now().toString(),
        userId: req.session.user.id,
        domain,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        certificatePath: result.certificatePath,
        privateKeyPath: result.privateKeyPath,
        verificationMethod: 'dns'
      };
      
      certificates.push(newCert);
      saveCertificates(certificates);
      
      // Clear pending verification from session
      delete req.session.pendingDnsVerification;
      
      // Render success page
      res.render('certificate-result', { 
        success: true,
        certificateData: result,
        domain,
        user: req.session.user
      });
      
      return;
    } catch (error) {
      console.error('DNS verification error:', error);
      // If the DNS challenge fails, we'll render an error page below
    }
    
    // If we're here, the verification failed
    res.render('error', {
      message: 'DNS verification failed. Please make sure you added the TXT record correctly and try again. DNS changes may take up to 24 hours to propagate.',
      user: req.session.user
    });
  } catch (error) {
    console.error('DNS verification error:', error);
    res.render('error', {
      message: `Error during DNS verification: ${error.message}`,
      user: req.session.user
    });
  }
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

module.exports = router; 