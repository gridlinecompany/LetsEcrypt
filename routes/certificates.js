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
      const result = await acmeClient.generateCertificate(domain, email);
      
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
    // For DNS-01 challenge (to be implemented)
    else if (verificationMethod === 'dns') {
      // In a real implementation, we would:
      // 1. Start the ACME DNS challenge process
      // 2. Get the actual challenge token from Let's Encrypt
      // For this demo, we're using a placeholder
      
      // Store domain info in session for the verification step
      req.session.pendingDnsVerification = {
        domain,
        email,
        challengeValue: 'PLACEHOLDER_VALUE', // In real app, this would be the actual challenge
        timestamp: Date.now()
      };
      
      res.render('dns-instructions', {
        domain,
        user: req.session.user,
        dnsRecord: {
          type: 'TXT',
          name: `_acme-challenge.${domain}`,
          value: 'PLACEHOLDER_VALUE' // This would come from actual ACME challenge
        }
      });
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

    // In a real implementation, we would:
    // 1. Check if the DNS record is correctly set
    // 2. Complete the ACME challenge
    // 3. Get the actual certificate
    
    // For demo purposes, let's simulate checking the DNS record
    let dnsVerified = false;
    try {
      // Try to resolve the TXT record
      const recordName = `_acme-challenge.${domain}`;
      const records = await dns.resolveTxt(recordName);
      
      // Check if any of the records match our expected value
      dnsVerified = records.some(record => 
        record.includes(pendingVerification.challengeValue)
      );
    } catch (error) {
      // DNS record not found or other DNS error
      dnsVerified = false;
    }
    
    if (dnsVerified) {
      // Simulate successful certificate generation
      const certificateResult = {
        certificate: '-----BEGIN CERTIFICATE-----\nMIIFLTCCBBWgAwIBAgISA+sgp+EeUCovR/rRj4pWEi/dMA0GCSqGSIb3DQEBCwUA\n... (simulated certificate) ...\n-----END CERTIFICATE-----',
        privateKey: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDGuXlYnkm+...\n... (simulated key) ...\n-----END PRIVATE KEY-----'
      };
      
      // Save certificate files (in a real app)
      const timestamp = Date.now();
      const domainSafe = domain.replace(/\*/g, 'wildcard').replace(/[^a-z0-9]/gi, '_');
      const certPath = path.join(path.dirname(CERTIFICATES_FILE), `${domainSafe}_${timestamp}.cert.pem`);
      const keyPath = path.join(path.dirname(CERTIFICATES_FILE), `${domainSafe}_${timestamp}.key.pem`);
      
      fs.writeFileSync(certPath, certificateResult.certificate);
      fs.writeFileSync(keyPath, certificateResult.privateKey);
      
      // Save certificate info
      const certificates = getCertificates();
      const newCert = {
        id: Date.now().toString(),
        userId: req.session.user.id,
        domain,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        certificatePath: certPath,
        privateKeyPath: keyPath,
        verificationMethod: 'dns'
      };
      
      certificates.push(newCert);
      saveCertificates(certificates);
      
      // Clear pending verification from session
      delete req.session.pendingDnsVerification;
      
      // Render success page
      res.render('certificate-result', { 
        success: true,
        certificateData: {
          certificate: certificateResult.certificate,
          privateKey: certificateResult.privateKey
        },
        domain,
        user: req.session.user
      });
    } else {
      // DNS verification failed
      res.render('error', {
        message: 'DNS verification failed. Please make sure you added the TXT record correctly and try again.',
        user: req.session.user
      });
    }
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