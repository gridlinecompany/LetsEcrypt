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
      
      // Debug domain before submission
      console.log('Submitting certificate request for domain:', domain);
      
      // Validate inputs
      if (!domain) {
        updateStatus('Please enter a domain name', 'error');
        return;
      }
      
      if (!email) {
        updateStatus('Please enter an email address', 'error');
        return;
      }
      
      // Remember domain in localStorage as fallback
      localStorage.setItem('last_certificate_domain', domain);
      
      // Disable form submission button
      const submitBtn = document.getElementById('request-cert-btn');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Processing...';
      }
      
      // Clear any previous status
      updateStatus('Preparing certificate request...', 'info');
      
      try {
        // Use relative path for URLs
        const baseUrl = '';
        
        // Make API request to start certificate request
        const response = await fetch(`${baseUrl}/certificates/generate`, {
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
        console.log('Certificate request response:', data);
        
        if (data.success) {
          if (challengeType === 'dns') {
            // For DNS challenge, we now need to poll for challenge details
            if (data.status === 'processing') {
              updateStatus('DNS challenge preparation started. Please wait...', 'info');
              
              // Show a loading indicator
              const loadingDiv = document.createElement('div');
              loadingDiv.className = 'text-center my-4';
              loadingDiv.innerHTML = `
                <div class="spinner-border text-primary" role="status">
                  <span class="visually-hidden">Loading...</span>
                </div>
                <p class="mt-2">Preparing DNS challenge for ${domain}. This may take a few moments...</p>
              `;
              document.getElementById('dns-info').innerHTML = '';
              document.getElementById('dns-info').appendChild(loadingDiv);
              document.getElementById('dns-info').classList.remove('d-none');
              
              // Start polling for challenge details
              await pollForDnsChallenge(domain);
            } else if (data.dnsData) {
              // If we already have DNS data, display it immediately
              // Ensure the domain is included in the dnsData
              const enhancedDnsData = {
                ...data.dnsData,
                domain: data.dnsData.domain || domain
              };
              displayDnsRecordInfo(enhancedDnsData);
            }
          } else {
            // For HTTP challenge, start polling for certificate status
            updateStatus('HTTP challenge initialized. Attempting verification...', 'info');
            cleanupExistingPolling();
            startStatusPolling();
          }
        } else {
          updateStatus(`Error: ${data.message || 'Unknown error occurred'}`, 'error');
          
          // Re-enable form submission button
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Request Certificate';
          }
        }
      } catch (error) {
        console.error('Error requesting certificate:', error);
        
        // Special handling for Gateway Timeout errors
        if (error.message.includes('504') || error.message.includes('Gateway Time-out')) {
          updateStatus(`Server timeout occurred. The certificate request may still be processing. Please wait 30 seconds and check DNS challenge status...`, 'warning');
          
          // After a brief delay, attempt to recover by polling for DNS status
          setTimeout(() => {
            const domain = localStorage.getItem('last_certificate_domain') || document.getElementById('domain').value.trim();
            if (domain) {
              console.log('Attempting to recover from timeout by polling DNS challenge for:', domain);
              pollForDnsChallenge(domain);
            }
          }, 20000);  // Wait 20 seconds before recovery attempt
        } else {
          updateStatus(`Error: ${error.message}. Please try again or check your server connection.`, 'error');
        }
        
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
    let dnsData = data;
    
    // If data contains a dnsData property, use that instead
    if (data.dnsData) {
      console.log('Using nested dnsData property');
      dnsData = data.dnsData;
    }
    
    // Get domain from session data or from input field as fallback
    const domain = dnsData.domain || document.getElementById('domain').value.trim();
    const recordName = dnsData.recordName || '';
    const recordValue = dnsData.recordValue || '';
    
    console.log('Extracted DNS data:', { domain, recordName, recordValue });
    
    // Make the container visible
    dnsInfoContainer.classList.remove('d-none');
    
    // Display the DNS record information in a card
    dnsInfoContainer.innerHTML = `
      <div class="card mt-4" data-domain="${domain}" data-record-value="${recordValue}">
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
      verifyCertificateProcess(domain);
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
    
    if (window.currentTimerInterval) {
      clearInterval(window.currentTimerInterval);
      window.currentTimerInterval = null;
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
    
    // If domain is not provided, try to get it from the data attribute or input field
    if (!domain) {
      const dnsCard = document.querySelector('#dns-info .card');
      if (dnsCard && dnsCard.dataset.domain) {
        domain = dnsCard.dataset.domain;
      } else {
        domain = document.getElementById('domain').value.trim();
      }
      console.log('Retrieved domain from fallback:', domain);
    }
    
    // Get the recordValue from the data attribute
    const dnsCard = document.querySelector('#dns-info .card');
    let recordValue = '';
    
    if (dnsCard && dnsCard.dataset.recordValue) {
      recordValue = dnsCard.dataset.recordValue;
    } else {
      // Only as a fallback, try to get from DOM structure
      const recordValueElement = document.querySelector('.card-body code:nth-of-type(2)');
      if (recordValueElement) {
        recordValue = recordValueElement.textContent.trim();
      }
    }
    
    console.log('Using record value:', recordValue);
    
    // Validate that we have both domain and recordValue
    if (!domain || !recordValue) {
      updateStatus('Error: Domain or record value is missing. Please refresh the page and try again.', 'error');
      if (verifyBtn) {
        verifyBtn.disabled = false;
        verifyBtn.innerHTML = 'Try Again';
      }
      return;
    }
    
    updateStatus('Step 1/3: Verifying DNS record... (This may take a few moments)', 'info');
    
    try {
      // First, verify the DNS record
      console.log('Sending check-dns request with:', { domain, recordValue });
      
      // Use relative path or full URL depending on environment
      const baseUrl = '';
      
      const checkResponse = await fetch(`${baseUrl}/certificates/check-dns`, {
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
      const certResponse = await fetch(`${baseUrl}/certificates/verify-dns`, {
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
    const pollInterval = 8000; // 8 seconds - more patient polling
    const maxPolls = 120; // Max 16 minutes of polling (increased from 5 minutes)
    let pollCount = 0;
    let previousStatus = '';
    
    // Use relative path for URLs
    const baseUrl = '';
    
    updateStatus('Certificate generation started. This process can take 5-10 minutes...', 'info');
    
    // Add a timer display to show progress
    let startTime = Date.now();
    const timerDiv = document.createElement('div');
    timerDiv.className = 'mt-3 text-center';
    timerDiv.innerHTML = `
      <div class="progress mb-2">
        <div class="progress-bar progress-bar-striped progress-bar-animated" role="progressbar" style="width: 0%"></div>
      </div>
      <small class="text-muted">Time elapsed: 0:00 - Please be patient, certificate generation can take several minutes</small>
    `;
    statusContainer.appendChild(timerDiv);
    
    // Update timer function
    function updateTimer() {
      const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
      const minutes = Math.floor(elapsedSeconds / 60);
      const seconds = elapsedSeconds % 60;
      const progressPercent = Math.min(100, (pollCount / maxPolls) * 100);
      
      const progressBar = timerDiv.querySelector('.progress-bar');
      if (progressBar) {
        progressBar.style.width = `${progressPercent}%`;
      }
      
      const timeDisplay = timerDiv.querySelector('small');
      if (timeDisplay) {
        timeDisplay.textContent = `Time elapsed: ${minutes}:${seconds.toString().padStart(2, '0')} - Please be patient, certificate generation can take several minutes`;
      }
    }
    
    // Start timer updates
    const timerInterval = setInterval(updateTimer, 1000);
    
    const pollTimer = setInterval(async function() {
      pollCount++;
      updateTimer();
      
      try {
        const response = await fetch(`${baseUrl}/certificates/status`, {
          credentials: 'include',
          cache: 'no-store'
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
          clearInterval(timerInterval);
          updateStatus('Certificate generation complete! Redirecting to certificates page...', 'success');
          // Redirect to certificates page after 3 seconds
          setTimeout(() => {
            window.location.href = '/certificates';
          }, 3000);
        } else if (data.status === 'completed') {
          // If we have a completed status, show success and redirect
          clearInterval(pollTimer);
          clearInterval(timerInterval);
          updateStatus(`Certificate for ${data.domain} has been successfully generated!`, 'success');
          setTimeout(() => {
            window.location.href = '/certificates';
          }, 3000);
        } else if (data.status === 'error') {
          // If we have an error status, show error and stop polling
          clearInterval(pollTimer);
          clearInterval(timerInterval);
          updateStatus(`Error: ${data.message}`, 'error');
          if (data.details && data.details.length > 0) {
            const detailsList = document.createElement('ul');
            detailsList.className = 'mt-2';
            data.details.forEach(detail => {
              const li = document.createElement('li');
              li.textContent = detail;
              detailsList.appendChild(li);
            });
            statusContainer.appendChild(detailsList);
          }
        } else if (data.status === 'pending') {
          // Only show update if status changed to avoid flooding
          if (previousStatus !== JSON.stringify(data)) {
            // Show different messages based on elapsed time
            if (pollCount < 6) {
              updateStatus(`Certificate generation in progress for ${data.domain}. Starting verification...`, 'info');
            } else if (pollCount < 12) {
              updateStatus(`Certificate generation in progress for ${data.domain}. Validating DNS records with Let's Encrypt...`, 'info');
            } else if (pollCount < 24) {
              updateStatus(`Certificate generation in progress for ${data.domain}. Waiting for DNS validation to complete...`, 'info');
            } else {
              updateStatus(`Certificate generation in progress for ${data.domain}. This can take several minutes, please be patient...`, 'info');
            }
            previousStatus = JSON.stringify(data);
          }
        } else if (pollCount >= maxPolls) {
          // Stop polling after max attempts
          clearInterval(pollTimer);
          clearInterval(timerInterval);
          updateStatus('Certificate process is taking longer than expected. Please check your certificates page later.', 'warning');
        }
      } catch (error) {
        console.error('Error polling for status:', error);
        
        // After 3 consecutive errors, stop polling
        if (pollCount % 3 === 0) {
          clearInterval(pollTimer);
          clearInterval(timerInterval);
          updateStatus('Error checking certificate status. Please check your certificates page manually.', 'error');
        }
      }
    }, pollInterval);
    
    // Store the timer IDs in global variables so we can cancel them if needed
    window.currentPollTimer = pollTimer;
    window.currentTimerInterval = timerInterval;
  }

  // Function to poll for DNS challenge details
  async function pollForDnsChallenge(domain) {
    const maxRetries = 15;  // Maximum number of retries (2 minutes total with 8s interval)
    const pollInterval = 8000;  // Poll every 8 seconds
    let retryCount = 0;
    const baseUrl = '';
    
    // Log the domain being polled
    console.log(`Starting to poll for DNS challenge for domain: ${domain}`);
    
    // Ensure we have the domain
    if (!domain) {
      domain = localStorage.getItem('last_certificate_domain') || document.getElementById('domain').value.trim();
      console.log(`Retrieved domain from fallback: ${domain}`);
    }
    
    // If we still don't have a domain, show error
    if (!domain) {
      updateStatus('Error: Unable to determine domain for DNS challenge. Please refresh and try again.', 'error');
      return;
    }
    
    const pollTimer = setInterval(async () => {
      try {
        retryCount++;
        console.log(`Polling for DNS challenge details, attempt ${retryCount}/${maxRetries} for domain: ${domain}`);
        
        const response = await fetch(`${baseUrl}/certificates/dns-challenge-status`, {
          credentials: 'include',
          cache: 'no-store'
        });
        
        if (!response.ok) {
          throw new Error(`Server returned ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('DNS challenge status response:', data);
        
        if (data.success) {
          if (data.status === 'ready' && data.dnsData) {
            // Challenge is ready, stop polling and display DNS info
            clearInterval(pollTimer);
            
            // Ensure the domain is included in the dnsData
            const enhancedDnsData = {
              ...data.dnsData,
              domain: data.dnsData.domain || domain
            };
            
            displayDnsRecordInfo(enhancedDnsData);
            updateStatus('DNS challenge prepared successfully. Please add the TXT record to your DNS settings.', 'success');
          } else if (data.status === 'error') {
            // Error occurred, stop polling and show error
            clearInterval(pollTimer);
            updateStatus(`Error preparing DNS challenge: ${data.message}`, 'error');
            
            // Re-enable the request button
            const submitBtn = document.getElementById('request-cert-btn');
            if (submitBtn) {
              submitBtn.disabled = false;
              submitBtn.innerHTML = 'Request Certificate';
            }
          }
          // If still preparing, continue polling
        } else {
          if (retryCount >= maxRetries) {
            // Reached max retries, stop polling
            clearInterval(pollTimer);
            updateStatus('DNS challenge preparation is taking longer than expected. Please refresh the page and try again.', 'warning');
            
            // Re-enable the request button
            const submitBtn = document.getElementById('request-cert-btn');
            if (submitBtn) {
              submitBtn.disabled = false;
              submitBtn.innerHTML = 'Request Certificate';
            }
          }
        }
      } catch (error) {
        console.error('Error polling for DNS challenge:', error);
        
        if (retryCount >= maxRetries) {
          clearInterval(pollTimer);
          updateStatus(`Error polling for DNS challenge: ${error.message}. Please refresh and try again.`, 'error');
          
          // Re-enable the request button
          const submitBtn = document.getElementById('request-cert-btn');
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Request Certificate';
          }
        }
      }
    }, pollInterval);
  }
}); 