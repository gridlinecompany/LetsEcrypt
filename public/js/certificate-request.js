// Certificate request handling
document.addEventListener('DOMContentLoaded', function() {
  const API_URL = '';
  const statusContainer = document.getElementById('status-container');
  let statusPollInterval;
  
  // Show status container and update status
  function updateStatus(message, type = 'info') {
    if (!statusContainer) return;
    
    statusContainer.classList.remove('d-none');
    
    // Map type to Bootstrap alert class
    const alertClass = {
      'info': 'alert-info',
      'success': 'alert-success',
      'error': 'alert-danger',
      'warning': 'alert-warning'
    }[type] || 'alert-info';
    
    statusContainer.innerHTML = `
      <div class="alert ${alertClass}">
        ${message}
      </div>
    `;
  }

  // Form submission
  const certForm = document.getElementById('cert-request-form');
  if (certForm) {
    certForm.addEventListener('submit', async function(e) {
      e.preventDefault();
      
      const domain = document.getElementById('domain').value.trim();
      const email = document.getElementById('email').value.trim();
      const challengeType = document.querySelector('input[name="challengeType"]:checked').value;
      
      // Disable form submission button
      const submitBtn = document.getElementById('request-cert-btn');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Processing...';
      }
      
      // Clear any previous status
      updateStatus('Preparing certificate request...', 'info');
      
      try {
        // Make API request to start certificate request - using correct endpoint
        const response = await fetch(`/certificates/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            domain,
            email,
            challengeType
          }),
          credentials: 'include'
        });
        
        // Check if response is OK before trying to parse JSON
        if (!response.ok) {
          throw new Error(`Server returned ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Re-enable form submission button
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = 'Request Certificate';
        }
        
        if (data.success) {
          if (challengeType === 'dns') {
            // For DNS challenge, access the correct property from response
            // The /generate endpoint returns the DNS data directly, not nested in dnsData
            displayDnsRecordInfo(data);
          } else {
            // For HTTP challenge, start polling for certificate status
            updateStatus('HTTP challenge initialized. Attempting verification...', 'info');
            cleanupExistingPolling();
            startStatusPolling();
          }
        } else {
          updateStatus(`Error: ${data.message || 'Unknown error occurred'}`, 'error');
        }
      } catch (error) {
        console.error('Error requesting certificate:', error);
        updateStatus(`Error: ${error.message}. Please try again or check your server connection.`, 'error');
        
        // Re-enable form submission button
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = 'Request Certificate';
        }
      }
    });
  }
  
  // Function to display DNS record information
  function displayDnsRecordInfo(data) {
    const dnsInfoContainer = document.getElementById('dns-info');
    if (!dnsInfoContainer) return;

    console.log('DNS data received:', data);

    // Access the correct properties based on server response structure
    // The data structure from /generate endpoint has dnsData nested
    let dnsData = data;
    
    // If data contains a dnsData property, use that instead
    if (data.dnsData) {
      console.log('Using nested dnsData property');
      dnsData = data.dnsData;
    }
    
    const domain = dnsData.domain || '';
    const recordName = dnsData.recordName || '';
    const recordValue = dnsData.recordValue || '';
    
    console.log('Extracted DNS data:', { domain, recordName, recordValue });
    
    // Make the container visible
    dnsInfoContainer.classList.remove('d-none');
    
    // Display the DNS record information in a card
    dnsInfoContainer.innerHTML = `
      <div class="card mt-4">
        <div class="card-header bg-primary text-white">
          <h5 class="mb-0">DNS Challenge Details</h5>
        </div>
        <div class="card-body">
          <p>Add this TXT record to your domain's DNS settings:</p>
          <p><strong>Record Type:</strong> <code>TXT</code></p>
          <p><strong>Record Name:</strong> <code>${recordName}</code></p>
          <p><strong>Record Value:</strong> <code>${recordValue}</code></p>
          <div class="alert alert-info">
            <i class="fas fa-info-circle"></i> DNS propagation can take 5-30 minutes. After adding the record, click the button below.
          </div>
          <button id="verify-dns-btn" class="btn btn-success mt-2">
            Verify and Generate Certificate
          </button>
        </div>
      </div>
    `;
    
    // Add event listener to the verify DNS button
    document.getElementById('verify-dns-btn').addEventListener('click', function() {
      verifyCertificateProcess(domain || dnsData.domain || data.domain);
    });
    
    // Show status container with initial message
    const statusContainer = document.getElementById('status-container');
    statusContainer.classList.remove('d-none');
    updateStatus('Please add the DNS record shown above to your domain, then click "Verify and Generate Certificate"', 'info');
  }
  
  // Function to clean up any existing polling
  function cleanupExistingPolling() {
    if (window.currentPollTimer) {
      console.log('Cleaning up existing poll timer');
      clearInterval(window.currentPollTimer);
      window.currentPollTimer = null;
    }
  }
  
  // Combined function for DNS verification and certificate generation
  async function verifyCertificateProcess(domain) {
    console.log('Verify process started for domain:', domain);
    
    // Get the button and disable it to prevent multiple clicks
    const verifyBtn = document.getElementById('verify-dns-btn');
    if (verifyBtn) {
      verifyBtn.disabled = true;
      verifyBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Verifying DNS and Generating Certificate...';
    }
    
    // Get the recordValue directly from the DOM
    const recordValueElement = document.querySelector('.card-body code:nth-of-type(2)');
    const recordValue = recordValueElement ? recordValueElement.textContent.trim() : '';
    console.log('Using record value from DOM:', recordValue);
    
    updateStatus('Step 1/3: Verifying DNS record... (This may take a few moments)', 'info');
    
    try {
      // First, verify the DNS record
      console.log('Sending check-dns request with:', { domain, recordValue });
      const checkResponse = await fetch(`/certificates/check-dns`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store'
        },
        body: JSON.stringify({ 
          domain,
          recordValue,
          _t: Date.now()
        }),
        credentials: 'include'
      });
      
      // Check if response is OK before trying to parse JSON
      if (!checkResponse.ok) {
        throw new Error(`Server returned ${checkResponse.status}: ${checkResponse.statusText}`);
      }
      
      const checkData = await checkResponse.json();
      console.log('DNS check response:', checkData);
      
      if (!checkData.success) {
        // If DNS verification failed, show error and re-enable button
        updateStatus(`DNS verification failed: ${checkData.message || 'Please check your DNS settings'}`, 'error');
        if (checkData.details) {
          const detailsHtml = `
            <div class="alert alert-warning mt-3">
              <h6>DNS Check Details:</h6>
              <ul>
                ${checkData.details.map(detail => `<li>${detail}</li>`).join('')}
              </ul>
            </div>
          `;
          statusContainer.innerHTML += detailsHtml;
        }
        
        if (verifyBtn) {
          verifyBtn.disabled = false;
          verifyBtn.innerHTML = 'Try Again';
        }
        return;
      }
      
      // DNS verification succeeded
      updateStatus('Step 2/3: DNS verified successfully! Generating certificate...', 'success');
      
      // Now, generate the certificate
      const certResponse = await fetch(`/certificates/verify-dns`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store'
        },
        body: JSON.stringify({ 
          domain,
          useVerifiedChallenge: true
        }),
        credentials: 'include'
      });
      
      // Check if response is OK before trying to parse JSON
      if (!certResponse.ok) {
        throw new Error(`Server returned ${certResponse.status}: ${certResponse.statusText}`);
      }
      
      const certData = await certResponse.json();
      
      if (certData.success) {
        updateStatus('Step 3/3: Certificate generation started. Please wait...', 'info');
        
        // Clean up any existing polling and start new polling
        cleanupExistingPolling();
        startStatusPolling();
      } else {
        // If certificate generation failed, show error
        updateStatus(`Certificate generation failed: ${certData.message || 'Please try again'}`, 'error');
        if (verifyBtn) {
          verifyBtn.disabled = false;
          verifyBtn.innerHTML = 'Try Again';
        }
      }
    } catch (error) {
      console.error('Error during verification process:', error);
      updateStatus(`Error: ${error.message}. Please try again or check your server connection.`, 'error');
      if (verifyBtn) {
        verifyBtn.disabled = false;
        verifyBtn.innerHTML = 'Try Again';
      }
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
        const response = await fetch(`/certificates/status`, {
          credentials: 'include', // Use include for cross-domain
          cache: 'no-store' // Prevent caching
        });
        
        // Check if response is OK before trying to parse JSON
        if (!response.ok) {
          throw new Error(`Server returned ${response.status}: ${response.statusText}`);
        }
        
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
}); 