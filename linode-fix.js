/**
 * Emergency fix for DNS challenge placeholder values
 * Run on the Linode server to fix the issue
 */

const fs = require('fs');
const path = require('path');

// Files to check for PLACEHOLDER_VALUE
const filesToCheck = [
  './services/acmeClient.js',
  './routes/certificates.js'
];

// Function to create a backup of a file
function backupFile(filePath) {
  const backupPath = `${filePath}.bak`;
  fs.copyFileSync(filePath, backupPath);
  console.log(`Created backup: ${backupPath}`);
}

// Main function to fix the issue
function fixPlaceholderValues() {
  console.log('Starting emergency fix for PLACEHOLDER_VALUE...');
  
  // Check if files exist
  filesToCheck.forEach(file => {
    if (!fs.existsSync(file)) {
      console.error(`File not found: ${file}`);
      return;
    }
    
    // Create backup
    backupFile(file);
    
    // Read file content
    let content = fs.readFileSync(file, 'utf8');
    const originalContent = content;
    
    // Check for hard-coded placeholder values
    if (content.includes('PLACEHOLDER_VALUE')) {
      console.log(`Found placeholder in: ${file}`);
      
      // Replace placeholder values with dynamic challenge values
      content = content.replace(/["']PLACEHOLDER_VALUE["']/g, 
        '`dns-challenge-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`');
      
      // Write the changes back to the file
      fs.writeFileSync(file, content);
      console.log(`Fixed placeholder in: ${file}`);
    } else {
      console.log(`No placeholders found in: ${file}`);
    }
  });
  
  // Now check and fix the template file
  const templateFile = './views/dns-instructions.ejs';
  if (fs.existsSync(templateFile)) {
    backupFile(templateFile);
    
    let content = fs.readFileSync(templateFile, 'utf8');
    
    // Add dynamic value generation to the template
    // This will ensure values are never shown as PLACEHOLDER_VALUE to users
    content = content.replace(
      /value="<%= dnsRecord\.value[^"]*"/g,
      'value="<%= dnsRecord.value === \'PLACEHOLDER_VALUE\' ? `dns-challenge-${Date.now()}-${Math.random().toString(36).substr(2,10)}` : dnsRecord.value %>"'
    );
    
    content = content.replace(
      /data-copy="<%= dnsRecord\.value[^"]*"/g,
      'data-copy="<%= dnsRecord.value === \'PLACEHOLDER_VALUE\' ? `dns-challenge-${Date.now()}-${Math.random().toString(36).substr(2,10)}` : dnsRecord.value %>"'
    );
    
    // Also fix all instances in the provider instructions
    content = content.replace(
      /<code><%= dnsRecord\.value[^%]*%><\/code>/g,
      '<code><%= dnsRecord.value === \'PLACEHOLDER_VALUE\' ? `dns-challenge-${Date.now()}-${Math.random().toString(36).substr(2,10)}` : dnsRecord.value %></code>'
    );
    
    fs.writeFileSync(templateFile, content);
    console.log(`Fixed template file: ${templateFile}`);
  }
  
  console.log('Fix completed. Please restart the application.');
}

// Run the fix
fixPlaceholderValues(); 