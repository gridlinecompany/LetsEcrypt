// Certificate request handling
document.addEventListener('DOMContentLoaded', function() {
  // Use fixed API URL instead of dynamic window.location.origin
  const API_URL = 'https://freesslcerts.com';
  
  const certForm = document.getElementById('certificate-form');
  const dnsVerifyForm = document.getElementById('dns-verify-form');
  const statusContainer = document.getElementById('status-container');
  
  if (certForm) {
    certForm.addEventListener('submit', async function(e) {
      e.preventDefault();
      
      const domain = document.getElementById('domain').value;
      const email = document.getElementById('email').value;
      const challengeType = document.querySelector('input[name="challengeType"]:checked').value;
      
      // Show loading status
      updateStatus('Submitting certificate request...', 'info');
      
      try {
        const response = await fetch(`${API_URL}/certificates/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ domain, email, challengeType }),
          credentials: 'include' // Use include for cross-domain
        });
        
        const data = await response.json();
        
        if (response.ok) {
          if (challengeType === 'dns') {
            // For DNS challenge, show DNS instructions
            updateStatus('DNS challenge prepared successfully. Please add the following TXT record:', 'success');
            
            // Show DNS record information
            const dnsInfoHtml = `
              <div class="card mt-4 mb-4">
                <div class="card-header bg-light">
                  <h3 class="h5 mb-0">DNS Record Information</h3>
                </div>
                <div class="card-body">
                  <p><strong>Record Type:</strong> TXT</p>
                  <p><strong>Record Name:</strong> <code>${data.dnsData.recordName}</code></p>
                  <p><strong>Record Value:</strong> <code>${data.dnsData.recordValue}</code></p>
                  <hr>
                  <div class="mt-3">
                    <p class="mb-3">After adding this record, please allow time for DNS propagation (can take 5 minutes to several hours).</p>
                    <div class="d-grid gap-2 d-md-flex">
                      <button id="check-dns-btn" class="btn btn-secondary">
                        Check DNS Propagation
                      </button>
                      <button id="verify-dns-btn" class="btn btn-primary" disabled>
                        Generate Certificate
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            `;
            statusContainer.innerHTML += dnsInfoHtml;
            
            // Add event listener for check button
            document.getElementById('check-dns-btn').addEventListener('click', async function() {
              checkDnsPropagation(domain);
            });
            
            // Add event listener for verify button
            document.getElementById('verify-dns-btn').addEventListener('click', async function() {
              verifyDnsAndGetCertificate(domain);
            });
          } else {
            // For HTTP challenge, start polling for certificate status
            updateStatus('Certificate generation started. This may take a few minutes...', 'info');
            
            // Clean up any existing polling first
            cleanupExistingPolling();
            
            // Start polling for status updates
            startStatusPolling();
          }
        } else {
          updateStatus(`Error: ${data.error} - ${data.message}`, 'error');
        }
      } catch (error) {
        updateStatus(`Error: ${error.message}`, 'error');
      }
    });
  }
  
  // Function to check DNS propagation
  async function checkDnsPropagation(domain) {
    // Clear any previous check results first
    const previousResults = document.querySelectorAll('.dns-check-result');
    previousResults.forEach(el => el.remove());
    
    // Update status with timestamp to show it's a new check
    const timestamp = new Date().toLocaleTimeString();
    updateStatus(`[${timestamp}] Checking DNS propagation...`, 'info');
    
    try {
      // Disable the button during checking and show spinner
      const checkBtn = document.getElementById('check-dns-btn');
      if (checkBtn) {
        checkBtn.disabled = true;
        const originalText = checkBtn.innerHTML;
        checkBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Checking...';
      }
      
      // Get the recordValue directly from the DOM to avoid session dependency
      const recordValueElement = document.querySelector('.card-body code:nth-of-type(2)');
      const recordValue = recordValueElement ? recordValueElement.textContent.trim() : '';
      
      const response = await fetch(`${API_URL}/certificates/check-dns`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store',
          'Pragma': 'no-cache'
        },
        body: JSON.stringify({ 
          domain,
          recordValue, // Send the record value in the request
          _t: Date.now() // Add timestamp to prevent caching
        }),
        credentials: 'include' // Use include for cross-domain requests
      });
      
      // Re-enable the button and restore text
      if (checkBtn) {
        checkBtn.disabled = false;
        checkBtn.innerHTML = 'Check DNS Propagation';
      }
      
      let data;
      try {
        data = await response.json();
      } catch (jsonError) {
        console.error('Error parsing JSON response:', jsonError);
        updateStatus(`[${timestamp}] Error parsing server response. Please try again.`, 'error');
        return;
      }
      
      if (response.ok && data.success) {
        // Create result with timestamp
        const resultHtml = `
          <div class="alert alert-success mb-3 dns-check-result">
            <strong>[${timestamp}] DNS check successful!</strong> 
            <p>DNS record has been properly set and verified.</p>
          </div>
        `;
        statusContainer.innerHTML = resultHtml + statusContainer.innerHTML;
        
        // Enable the certificate generation button
        document.getElementById('verify-dns-btn').disabled = false;
      } else {
        // Handle session issues
        if (data.message && data.message.includes('No pending DNS certificate request')) {
          updateStatus(`[${timestamp}] Session expired or not found. Please refresh the page and try again.`, 'error');
          
          // Show refresh button
          const refreshBtn = document.createElement('button');
          refreshBtn.className = 'btn btn-warning mt-3';
          refreshBtn.textContent = 'Refresh Page';
          refreshBtn.onclick = () => window.location.reload();
          statusContainer.prepend(refreshBtn);
          
          return;
        }
        
        updateStatus(`[${timestamp}] DNS check failed: ${data.message}`, 'error');
        // Show detailed information if available
        if (data.details) {
          const detailsHtml = `
            <div class="alert alert-warning mt-3 dns-check-result">
              <h6>DNS Check Details:</h6>
              <ul>
                ${data.details.map(detail => `<li>${detail}</li>`).join('')}
              </ul>
            </div>
          `;
          statusContainer.innerHTML = detailsHtml + statusContainer.innerHTML;
        }
      }
    } catch (error) {
      console.error('Network error during DNS check:', error);
      updateStatus(`[${timestamp}] Error checking DNS: ${error.message}. Please try again.`, 'error');
      
      // Re-enable the button in case of error
      const checkBtn = document.getElementById('check-dns-btn');
      if (checkBtn) {
        checkBtn.disabled = false;
        checkBtn.innerHTML = 'Check DNS Propagation';
      }
    }
  }
  
  // Function to clean up any existing polling
  function cleanupExistingPolling() {
    if (window.currentPollTimer) {
      console.log('Cleaning up existing poll timer');
      clearInterval(window.currentPollTimer);
      window.currentPollTimer = null;
    }
  }
  
  // Function to verify DNS and complete certificate generation
  async function verifyDnsAndGetCertificate(domain) {
    updateStatus('Generating certificate using verified DNS challenge...', 'info');
    
    // Disable the button to prevent multiple submissions
    document.getElementById('verify-dns-btn').disabled = true;
    
    try {
      // Add flag to indicate we want to use the verified challenge (not create a new one)
      const response = await fetch(`${API_URL}/certificates/verify-dns`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store',
          'Pragma': 'no-cache'
        },
        body: JSON.stringify({ 
          domain,
          useVerifiedChallenge: true  // Flag to reuse the verified challenge
        }),
        credentials: 'include' // Use include for cross-domain
      });
      
      let data;
      try {
        data = await response.json();
      } catch (jsonError) {
        console.error('Error parsing JSON response:', jsonError);
        updateStatus('Error parsing server response. Please try again.', 'error');
        document.getElementById('verify-dns-btn').disabled = false;
        return;
      }
      
      if (response.ok) {
        updateStatus('Certificate generation started. This may take a few minutes...', 'info');
        
        // Clean up any existing polling first
        cleanupExistingPolling();
        
        // Start polling for status updates
        startStatusPolling();
      } else {
        // Handle session issues
        if (data.message && data.message.includes('No pending DNS certificate request')) {
          updateStatus('Session expired or not found. Please refresh the page and try again.', 'error');
          
          // Show refresh button
          const refreshBtn = document.createElement('button');
          refreshBtn.className = 'btn btn-warning mt-3';
          refreshBtn.textContent = 'Refresh Page';
          refreshBtn.onclick = () => window.location.reload();
          statusContainer.prepend(refreshBtn);
          
          return;
        }
        
        updateStatus(`Error: ${data.error} - ${data.message}`, 'error');
        // Re-enable the button in case of error
        document.getElementById('verify-dns-btn').disabled = false;
      }
    } catch (error) {
      console.error('Network error during verification:', error);
      updateStatus(`Error: ${error.message}. Please try again.`, 'error');
      // Re-enable the button in case of error
      document.getElementById('verify-dns-btn').disabled = false;
    }
  }
  
  // Function to poll for certificate status
  function startStatusPolling() {
    const pollInterval = 5000; // 5 seconds
    const maxPolls = 60; // Max 5 minutes of polling
    let pollCount = 0;
    let previousStatus = '';
    
    updateStatus('Monitoring certificate generation progress...', 'info');
    
    const pollTimer = setInterval(async function() {
      pollCount++;
      
      try {
        const response = await fetch(`${API_URL}/certificates/status`, {
          credentials: 'include', // Use include for cross-domain
          cache: 'no-store' // Prevent caching
        });
        const data = await response.json();
        
        // Log status data for debugging
        console.log(`Poll ${pollCount}, Status:`, data);
        
        if (data.status === 'no_pending_requests') {
          // If no pending requests, the certificate generation is likely complete
          clearInterval(pollTimer);
          updateStatus('Certificate generation complete! Redirecting to certificates page...', 'success');
          // Redirect to certificates page after 3 seconds
          setTimeout(() => {
            window.location.href = '/certificates';
          }, 3000);
        } else if (data.status === 'completed') {
          // If we have a completed status, show success and redirect
          clearInterval(pollTimer);
          updateStatus(`Certificate for ${data.domain} has been successfully generated!`, 'success');
          setTimeout(() => {
            window.location.href = '/certificates';
          }, 3000);
        } else if (data.status === 'error') {
          // If we have an error status, show error and stop polling
          clearInterval(pollTimer);
          updateStatus(`Error: ${data.message}`, 'error');
        } else if (data.status === 'pending') {
          // Only show update if status changed to avoid flooding
          if (previousStatus !== JSON.stringify(data)) {
            updateStatus(`Certificate generation in progress for ${data.domain}. Please wait...`, 'info');
            previousStatus = JSON.stringify(data);
          }
        } else if (pollCount >= maxPolls) {
          // Stop polling after max attempts
          clearInterval(pollTimer);
          updateStatus('Certificate process is taking longer than expected. Please check your certificates page later.', 'warning');
        }
      } catch (error) {
        console.error('Error polling for status:', error);
        
        // After 3 consecutive errors, stop polling
        if (pollCount % 3 === 0) {
          clearInterval(pollTimer);
          updateStatus('Error checking certificate status. Please check your certificates page manually.', 'error');
        }
      }
    }, pollInterval);
    
    // Store the timer ID in a global variable so we can cancel it if needed
    window.currentPollTimer = pollTimer;
  }
  
  // Function to update status display
  function updateStatus(message, type) {
    if (!statusContainer) return;
    
    const statusClass = {
      'info': 'alert-info',
      'success': 'alert-success',
      'error': 'alert-danger',
      'warning': 'alert-warning'
    };
    
    // Append new status message
    const statusHtml = `
      <div class="alert ${statusClass[type]} mb-3">
        ${message}
      </div>
    `;
    
    // Clear any default content if this is the first update
    if (statusContainer.querySelector('.text-muted')) {
      statusContainer.innerHTML = '';
    }
    
    // Add the new status at the top
    statusContainer.innerHTML = statusHtml + statusContainer.innerHTML;
  }
}); 