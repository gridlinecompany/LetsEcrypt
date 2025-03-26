# Let's Encrypt Certificate Generator

A web application that allows users to generate free SSL/TLS certificates from Let's Encrypt.

## Features

- Simple web interface for requesting Let's Encrypt certificates
- Automatic HTTP-01 challenge verification
- Certificate and private key generation and display
- Easy to follow instructions for implementation

## Requirements

- Node.js (v14 or higher)
- A publicly accessible domain where you can host this application
- The application must be hosted on the domain for which you want to generate certificates

## Installation

1. Clone this repository:
   ```
   git clone https://github.com/yourusername/letsencrypt-generator.git
   cd letsencrypt-generator
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file (optional):
   ```
   PORT=3000
   # Set to 'production' when deployed
   NODE_ENV=development
   ```

4. Start the application:
   ```
   npm start
   ```
   
   For development with auto-reload:
   ```
   npm run dev
   ```

## Deployment

For production use, you need to:

1. Host this application on the domain for which you want to generate certificates
2. Make sure the domain is publicly accessible
3. Set `NODE_ENV=production` in your environment variables
4. Consider using a process manager like PM2 to keep the application running

When ready for production, modify the ACME client in `services/acmeClient.js` to use the production Let's Encrypt directory by changing:

```javascript
directoryUrl: acme.directory.letsencrypt.staging,
```

to:

```javascript
directoryUrl: acme.directory.letsencrypt.production,
```

## How It Works

1. Users enter their domain name and email address
2. The application communicates with the Let's Encrypt ACME server to request a certificate
3. Let's Encrypt challenges the application to verify domain ownership (HTTP-01 challenge)
4. The application responds to the challenge automatically
5. Upon successful verification, Let's Encrypt issues a certificate
6. The application displays the certificate and private key for the user to download

## Important Notes

- Let's Encrypt has rate limits. The staging environment has higher limits and should be used for testing.
- Certificates are valid for 90 days and need to be renewed before expiration.
- Keep your private key secure and never share it publicly.

## License

MIT 