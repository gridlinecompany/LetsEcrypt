// Certificate request handling
document.addEventListener('DOMContentLoaded', function() {
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
        const response = await fetch('/certificates/generate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ domain, email, challengeType })
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
    updateStatus('Checking DNS propagation...', 'info');
    
    try {
      const response = await fetch('/certificates/check-dns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ domain })
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        updateStatus('DNS check successful! DNS record has been properly set.', 'success');
        // Enable the certificate generation button
        document.getElementById('verify-dns-btn').disabled = false;
      } else {
        updateStatus(`DNS check failed: ${data.message}`, 'error');
        // Show detailed information if available
        if (data.details) {
          const detailsHtml = `
            <div class="alert alert-warning">
              <h6>DNS Check Details:</h6>
              <ul>
                ${data.details.map(detail => `<li>${detail}</li>`).join('')}
              </ul>
            </div>
          `;
          statusContainer.innerHTML += detailsHtml;
        }
      }
    } catch (error) {
      updateStatus(`Error checking DNS: ${error.message}`, 'error');
    }
  }
  
  // Function to verify DNS and complete certificate generation
  async function verifyDnsAndGetCertificate(domain) {
    updateStatus('Verifying DNS records and generating certificate...', 'info');
    
    // Disable the button to prevent multiple submissions
    document.getElementById('verify-dns-btn').disabled = true;
    
    try {
      const response = await fetch('/certificates/verify-dns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ domain })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        updateStatus('Certificate generation started. This may take a few minutes...', 'info');
        // Start polling for status updates
        startStatusPolling();
      } else {
        updateStatus(`Error: ${data.error} - ${data.message}`, 'error');
        // Re-enable the button in case of error
        document.getElementById('verify-dns-btn').disabled = false;
      }
    } catch (error) {
      updateStatus(`Error: ${error.message}`, 'error');
      // Re-enable the button in case of error
      document.getElementById('verify-dns-btn').disabled = false;
    }
  }
  
  // Function to poll for certificate status
  function startStatusPolling() {
    const pollInterval = 5000; // 5 seconds
    const maxPolls = 60; // Max 5 minutes of polling
    let pollCount = 0;
    
    const pollTimer = setInterval(async function() {
      pollCount++;
      
      try {
        const response = await fetch('/certificates/status');
        const data = await response.json();
        
        if (data.status === 'no_pending_requests') {
          // If no pending requests, the certificate generation is likely complete
          updateStatus('Certificate generation complete! Check your certificates page.', 'success');
          clearInterval(pollTimer);
          // Redirect to certificates page after 3 seconds
          setTimeout(() => {
            window.location.href = '/certificates';
          }, 3000);
        } else if (data.status === 'error') {
          updateStatus(`Error: ${data.message}`, 'error');
          clearInterval(pollTimer);
        } else if (pollCount >= maxPolls) {
          // Stop polling after max attempts
          updateStatus('Certificate process is taking longer than expected. Please check your certificates page later.', 'warning');
          clearInterval(pollTimer);
        }
      } catch (error) {
        console.error('Error polling for status:', error);
      }
    }, pollInterval);
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