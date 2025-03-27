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
              <div class="dns-instructions bg-gray-100 p-4 rounded mt-4">
                <h3 class="font-bold">DNS Record Information:</h3>
                <p><strong>Record Type:</strong> TXT</p>
                <p><strong>Record Name:</strong> <code>${data.dnsData.recordName}</code></p>
                <p><strong>Record Value:</strong> <code>${data.dnsData.recordValue}</code></p>
                <div class="mt-4">
                  <p>After adding this record, please allow time for DNS propagation (can take 5 minutes to several hours).</p>
                  <button id="verify-dns-btn" class="mt-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
                    Verify & Complete Certificate
                  </button>
                </div>
              </div>
            `;
            statusContainer.innerHTML += dnsInfoHtml;
            
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
  
  // Function to verify DNS and complete certificate generation
  async function verifyDnsAndGetCertificate(domain) {
    updateStatus('Verifying DNS records and generating certificate...', 'info');
    
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
        updateStatus('Verification process started. This may take a few minutes...', 'info');
        // Start polling for status updates
        startStatusPolling();
      } else {
        updateStatus(`Error: ${data.error} - ${data.message}`, 'error');
      }
    } catch (error) {
      updateStatus(`Error: ${error.message}`, 'error');
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
      'info': 'bg-blue-100 text-blue-800',
      'success': 'bg-green-100 text-green-800',
      'error': 'bg-red-100 text-red-800',
      'warning': 'bg-yellow-100 text-yellow-800'
    };
    
    // Append new status message
    const statusHtml = `
      <div class="status-update ${statusClass[type]} p-3 rounded mt-2">
        ${message}
      </div>
    `;
    
    statusContainer.innerHTML = statusHtml + statusContainer.innerHTML;
  }
}); 