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

// Helper function to extract detailed error information
function extractErrorDetails(error) {
  const details = [];
  
  if (error.message.includes('Invalid response')) {
    details.push('The DNS record could not be verified by Let\'s Encrypt.');
    details.push('This typically happens when the DNS record is not properly propagated.');
  } else if (error.message.includes('No pending DNS challenge')) {
    details.push('No pending challenge was found. The challenge may have expired.');
    details.push('Please restart the certificate request process.');
  } else if (error.message.includes('timeout')) {
    details.push('The verification process timed out.');
    details.push('DNS propagation can take time. Please wait and try again.');
  } else if (error.message.includes('rate limit')) {
    details.push('Let\'s Encrypt rate limit hit.');
    details.push('You may have requested too many certificates recently.');
    details.push('Please wait at least 1 hour before trying again.');
  }
  
  return details.length > 0 ? details : ['An unexpected error occurred. Please try again later.'];
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
    
    // Sanitize domain
    const cleanDomain = domain.trim().toLowerCase();
    console.log(`Certificate request received for domain: ${cleanDomain}, email: ${email}, challenge: ${challengeType}`);
    
    // For DNS challenge, use an immediate response pattern
    if (challengeType === 'dns') {
      // Send an immediate response to prevent timeout
      res.status(202).json({
        success: true,
        message: 'DNS challenge preparation started',
        status: 'processing',
        dnsData: {
          domain: cleanDomain,
          recordName: `_acme-challenge.${cleanDomain}`,
          recordValue: 'preparing...'  // Placeholder value
        }
      });
      
      // Process in background
      process.nextTick(async () => {
        try {
          console.log(`Starting DNS challenge preparation for ${cleanDomain}`);
          const dnsData = await acmeClient.prepareDnsChallengeForDomain(cleanDomain, email);
          console.log(`DNS challenge prepared for ${cleanDomain}:`, dnsData);
          
          // Ensure domain is included in the challenge data
          dnsData.domain = cleanDomain;
          
          // Store the challenge data in a way that can be retrieved by client polling
          // Store the domain and email in session for the completion endpoint
          if (req.session) {
            req.session.pendingDnsCertRequest = {
              domain: cleanDomain,
              email,
              recordName: dnsData.recordName,
              recordValue: dnsData.recordValue,
              requestTime: Date.now(),
              prepared: true
            };
            
            // Explicitly save the session to ensure data is persisted
            req.session.save(err => {
              if (err) {
                console.error('Session save error:', err);
              } else {
                console.log('Session saved successfully with pendingDnsCertRequest');
              }
            });
          } else {
            console.error('Session not available for storing DNS challenge data');
          }
        } catch (error) {
          console.error(`Background DNS challenge preparation failed for ${cleanDomain}:`, error);
          
          // Store the error in session if available
          if (req.session) {
            req.session.certificateError = {
              message: error.message,
              details: extractErrorDetails(error)
            };
            
            req.session.save(err => {
              if (err) {
                console.error('Error saving session after challenge preparation error:', err);
              }
            });
          }
        }
      });
      
      return;
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
          const result = await acmeClient.generateCertificateHttp(cleanDomain, email);
          
          // Save certificate info to database
          const certificates = getCertificates();
          const newCert = {
            id: Date.now().toString(),
            userId: req.session.user ? req.session.user.id : 'guest',
            domain: cleanDomain,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
            certificatePath: result.certificatePath,
            privateKeyPath: result.privateKeyPath,
            verificationMethod: 'http'
          };
          
          certificates.push(newCert);
          saveCertificates(certificates);
          
          // Store the completion info in session
          req.session.completedCertificate = {
            domain: cleanDomain,
            id: newCert.id,
            certificatePath: result.certificatePath
          };
          
          console.log('Certificate generated successfully:', result.certificatePath);
        } catch (error) {
          console.error('Background certificate generation failed:', error);
          
          // Store the error in session
          req.session.certificateError = {
            message: error.message,
            details: extractErrorDetails(error)
          };
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
    // Debug session data
    console.log('Verify DNS session data:', JSON.stringify({
      hasPendingRequest: !!req.session.pendingDnsCertRequest,
      requestBody: req.body,
      sessionID: req.sessionID
    }));
    
    // Get the pending request from session
    const pendingRequest = req.session.pendingDnsCertRequest;
    
    if (!pendingRequest) {
      console.error('No pending DNS certificate request found in session');
      return res.status(400).json({
        success: false,
        error: 'No pending DNS certificate request found',
        message: 'Please start a new certificate request'
      });
    }
    
    console.log('Found pending DNS certificate request:', JSON.stringify(pendingRequest));
    
    const { domain, useVerifiedChallenge } = req.body;
    
    if (!domain) {
      return res.status(400).json({
        success: false,
        error: 'Missing domain',
        message: 'Domain is required'
      });
    }
    
    if (pendingRequest.domain !== domain) {
      return res.status(400).json({
        success: false,
        error: 'Domain mismatch',
        message: `Domain mismatch. Request domain: ${domain}, stored domain: ${pendingRequest.domain}`
      });
    }
    
    // Make sure we have an email - either from pendingRequest or fallback to user's email
    let email = pendingRequest.email;
    if (!email && req.session.user && req.session.user.email) {
      email = req.session.user.email;
      console.log(`Using user's email as fallback: ${email}`);
    }
    
    if (!email) {
      console.error('No email found for certificate generation');
      return res.status(400).json({
        success: false,
        error: 'Missing email',
        message: 'Email is required for certificate generation'
      });
    }
    
    // Start the verification process but respond quickly
    res.status(202).json({
      success: true,
      message: 'Certificate generation started. This may take a few minutes.',
      status: 'processing'
    });
    
    // Continue processing in the background (after response is sent)
    process.nextTick(async () => {
      try {
        console.log(`Starting certificate generation for domain: ${domain}, email: ${email}`);
        console.log(`Using verified challenge: ${useVerifiedChallenge ? 'yes' : 'no'}`);
        
        // Check if we should skip challenge verification (already verified)
        let result;
        
        if (useVerifiedChallenge) {
          console.log('Using previously verified DNS challenge - skipping verification step');
          // Use a modified function that skips the verification step
          result = await acmeClient.generateCertificateWithVerifiedDns(domain, email);
        } else {
          // Regular flow - verify challenge first
          console.log('Verifying DNS challenge before generating certificate');
          result = await acmeClient.completeDnsChallengeAndGetCertificate(domain, email);
        }
        
        console.log('Certificate generated successfully:', result.certificatePath);
        
        // Save certificate info to database
        const certificates = getCertificates();
        const newCert = {
          id: Date.now().toString(),
          userId: req.session.user ? req.session.user.id : 'guest',
          domain,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
          certificatePath: result.certificatePath,
          privateKeyPath: result.privateKeyPath,
          verificationMethod: 'dns'
        };
        
        certificates.push(newCert);
        saveCertificates(certificates);
        
        // Store the completion info in session
        req.session.completedCertificate = {
          domain,
          id: newCert.id,
          certificatePath: result.certificatePath
        };
        
        // Clear the pending request
        req.session.pendingDnsCertRequest = null;
        
        // Save session explicitly
        req.session.save(err => {
          if (err) {
            console.error('Error saving session after certificate completion:', err);
          } else {
            console.log('Session saved successfully after certificate completion');
          }
        });
      } catch (error) {
        console.error('Background certificate generation failed:', error);
        console.error('Error stack:', error.stack);
        
        // Store the error in session
        req.session.certificateError = {
          message: error.message,
          details: extractErrorDetails(error)
        };
        
        // Save session explicitly
        req.session.save(err => {
          if (err) {
            console.error('Error saving session after certificate error:', err);
          } else {
            console.log('Session saved successfully after certificate error');
          }
        });
      }
    });
  } catch (error) {
    console.error('Error in DNS verification:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      error: 'DNS verification failed', 
      message: error.message 
    });
  }
});

// Add a status endpoint to check certificate generation status
router.get('/status', (req, res) => {
  // Get any pending request from session
  const pendingRequest = req.session.pendingDnsCertRequest;
  
  // Get any completed certificates from session
  const completedCert = req.session.completedCertificate;
  
  // Check for errors
  const certError = req.session.certificateError;
  
  if (certError) {
    // Return the error and clear it
    const error = { ...certError };
    req.session.certificateError = null;
    return res.json({
      status: 'error',
      message: error.message,
      details: error.details
    });
  }
  
  if (completedCert) {
    // Return completed status and clear it
    const cert = { ...completedCert };
    req.session.completedCertificate = null;
    return res.json({
      status: 'completed',
      domain: cert.domain,
      message: 'Certificate has been successfully generated',
      certificateId: cert.id
    });
  }
  
  if (pendingRequest) {
    return res.json({
      status: 'pending',
      domain: pendingRequest.domain,
      dnsRecord: {
        name: pendingRequest.recordName,
        value: pendingRequest.recordValue
      },
      requestTime: pendingRequest.requestTime,
      elapsedTime: Date.now() - pendingRequest.requestTime
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
    // Debug session data
    console.log('Session data:', JSON.stringify({
      hasPendingRequest: !!req.session.pendingDnsCertRequest,
      requestBody: req.body,
      sessionID: req.sessionID,
      timestamp: new Date().toISOString()
    }));
    
    // Get the pending request from session
    const pendingRequest = req.session.pendingDnsCertRequest;
    
    // Extract domain and recordValue from the request body
    const { domain, recordValue: requestRecordValue } = req.body;
    
    if (!domain) {
      return res.status(400).json({
        success: false,
        message: 'Domain is required'
      });
    }
    
    // Use session data if available, otherwise use request data
    let recordValue;
    let recordName;
    
    if (pendingRequest && pendingRequest.domain === domain) {
      console.log('Using record value from session');
      recordValue = pendingRequest.recordValue;
      recordName = pendingRequest.recordName;
    } else if (requestRecordValue) {
      console.log('Using record value from request body');
      recordValue = requestRecordValue;
      recordName = `_acme-challenge.${domain}`;
    } else {
      // For debugging: check entire session
      console.log('Full session:', JSON.stringify(req.session));
      
      return res.status(400).json({
        success: false,
        message: 'No DNS challenge information found. Please provide record value or start a new certificate request.'
      });
    }
    
    console.log('Checking DNS:', { 
      domain,
      recordValue,
      timestamp: new Date().toISOString()
    });
    
    try {
      // Explicitly clear any DNS cache before checking
      const dns = require('dns').promises;
      
      // Force a fresh DNS lookup by clearing the DNS module's internal cache if possible
      if (typeof dns.getServers === 'function') {
        const servers = dns.getServers();
        dns.setServers(servers);
      }
      
      // Check DNS propagation using the stored record value
      console.log('Performing DNS check for:', {
        domain: domain,
        recordValue: recordValue,
        timestamp: new Date().toISOString()
      });
      
      // Call the verifyDnsPropagation function
      await acmeClient.verifyDnsPropagation(domain, recordValue);
      
      // If we get here, DNS record is correctly set
      // Store verification status in session
      if (pendingRequest) {
        pendingRequest.dnsVerified = true;
        pendingRequest.verificationTime = Date.now();
        
        // Save session explicitly
        await new Promise((resolve, reject) => {
          req.session.save(err => {
            if (err) {
              console.error('Error saving DNS verification status to session:', err);
              reject(err);
            } else {
              console.log('DNS verification status saved to session');
              resolve();
            }
          });
        });
      }
      
      // Send success response after saving session
      return res.json({
        success: true,
        message: 'DNS record verified successfully',
        domain: domain,
        recordValue: recordValue, // Include the value that was checked
        timestamp: new Date().toISOString()
      });
    } catch (dnsError) {
      console.log('DNS check failed:', dnsError.message);
      // Construct a helpful message with details
      const details = [];
      
      if (dnsError.message.includes('DNS record not found')) {
        details.push('The DNS record could not be found. It may not have propagated yet.');
        details.push(`Check that you created a TXT record with name: ${recordName}`);
        details.push(`And value: ${recordValue}`);
        details.push('DNS changes can take 5 minutes to 48 hours to propagate fully.');
      } else if (dnsError.message.includes('doesn\'t match expected value')) {
        details.push('The DNS record was found but has an incorrect value.');
        details.push(`The value should be exactly: ${recordValue}`);
        details.push('Make sure there are no extra spaces or quotes in the value.');
      }
      
      return res.status(400).json({
        success: false,
        message: 'DNS verification failed',
        details: details.length > 0 ? details : undefined,
        error: dnsError.message,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('Error in DNS check:', error);
    res.status(500).json({ 
      success: false,
      message: 'Error checking DNS record',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Add an endpoint to check the DNS challenge preparation status
router.get('/dns-challenge-status', (req, res) => {
  try {
    // Get the pending request from session
    const pendingRequest = req.session.pendingDnsCertRequest;
    
    // Check for errors
    const certError = req.session.certificateError;
    
    if (certError) {
      // Return the error
      return res.json({
        success: false,
        status: 'error',
        message: certError.message,
        details: certError.details
      });
    }
    
    if (!pendingRequest) {
      return res.json({
        success: false,
        status: 'not_found',
        message: 'No pending DNS challenge found'
      });
    }
    
    // Ensure domain exists
    const domain = pendingRequest.domain;
    if (!domain) {
      console.error('Domain missing in pendingRequest:', pendingRequest);
      return res.json({
        success: false,
        status: 'error',
        message: 'Domain information is missing in the session'
      });
    }
    
    // Check if the challenge preparation is complete
    if (pendingRequest.prepared) {
      return res.json({
        success: true,
        status: 'ready',
        message: 'DNS challenge prepared successfully',
        dnsData: {
          domain: domain,
          recordName: pendingRequest.recordName,
          recordValue: pendingRequest.recordValue
        },
        nextStep: {
          action: 'Create DNS TXT record with your DNS provider',
          verifyEndpoint: '/certificates/verify-dns',
          verificationMethod: 'Once the DNS record is set, visit the verification endpoint'
        }
      });
    } else {
      // Challenge preparation is still in progress
      return res.json({
        success: true,
        status: 'preparing',
        message: 'DNS challenge preparation in progress',
        domain: domain
      });
    }
  } catch (error) {
    console.error('Error checking DNS challenge status:', error);
    res.status(500).json({
      success: false,
      status: 'error',
      message: 'Error checking DNS challenge status'
    });
  }
});

module.exports = router; 