const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getKey() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  return Buffer.from(key, 'hex');
}

function encrypt(text) {
  if (!text) return null;
  
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  // Return iv:authTag:encryptedData
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

function decrypt(encryptedText) {
  if (!encryptedText) return null;
  
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format');
  }
  
  const iv = Buffer.from(parts[0], 'hex');
  const authTag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

// Helper functions for Plaid tokens (with fallback for legacy unencrypted tokens)
function encryptPlaidToken(token) {
  if (!token) return token;
  try {
    return encrypt(token);
  } catch (error) {
    console.error('Failed to encrypt Plaid token:', error.message);
    console.warn('⚠️  Storing token unencrypted. Set ENCRYPTION_KEY in .env for security.');
    return token; // Fallback for missing encryption key
  }
}

function decryptPlaidToken(encryptedToken) {
  if (!encryptedToken) return encryptedToken;
  try {
    return decrypt(encryptedToken);
  } catch (error) {
    // If decryption fails, might be legacy unencrypted token
    console.warn('Failed to decrypt token, returning as-is (might be legacy unencrypted):', error.message);
    return encryptedToken;
  }
}

module.exports = { encrypt, decrypt, encryptPlaidToken, decryptPlaidToken };
