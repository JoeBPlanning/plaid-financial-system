/**
 * Encryption Utility for Sensitive Data (Plaid Access Tokens)
 * Uses AES-256-GCM for authenticated encryption
 *
 * SETUP:
 * Generate an encryption key and add to .env:
 * node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * Add to .env:
 * ENCRYPTION_KEY=your-32-byte-hex-key-here
 */

const crypto = require('crypto');

// Algorithm configuration
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // For GCM mode
const AUTH_TAG_LENGTH = 16; // GCM authentication tag
const KEY_LENGTH = 32; // 256 bits

/**
 * Get encryption key from environment
 * Throws error if key is missing or invalid
 */
function getEncryptionKey() {
  const keyHex = process.env.ENCRYPTION_KEY;

  if (!keyHex) {
    throw new Error(
      'ENCRYPTION_KEY not found in environment variables. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }

  const key = Buffer.from(keyHex, 'hex');

  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `ENCRYPTION_KEY must be ${KEY_LENGTH} bytes (${KEY_LENGTH * 2} hex characters). ` +
      `Current key is ${key.length} bytes.`
    );
  }

  return key;
}

/**
 * Encrypt a plaintext string
 * Returns encrypted data in format: iv:authTag:encryptedData (all hex-encoded)
 *
 * @param {string} plaintext - The text to encrypt
 * @returns {string} Encrypted string in format "iv:authTag:ciphertext"
 */
function encrypt(plaintext) {
  if (!plaintext || typeof plaintext !== 'string') {
    throw new Error('Plaintext must be a non-empty string');
  }

  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Return: iv:authTag:encryptedData (all hex-encoded)
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  } catch (error) {
    console.error('Encryption error:', error.message);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypt an encrypted string
 * Expects format: iv:authTag:encryptedData (all hex-encoded)
 *
 * @param {string} encryptedData - The encrypted string to decrypt
 * @returns {string} Decrypted plaintext
 */
function decrypt(encryptedData) {
  if (!encryptedData || typeof encryptedData !== 'string') {
    throw new Error('Encrypted data must be a non-empty string');
  }

  try {
    const parts = encryptedData.split(':');

    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format. Expected format: iv:authTag:ciphertext');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    if (iv.length !== IV_LENGTH) {
      throw new Error(`Invalid IV length: ${iv.length}, expected ${IV_LENGTH}`);
    }

    if (authTag.length !== AUTH_TAG_LENGTH) {
      throw new Error(`Invalid auth tag length: ${authTag.length}, expected ${AUTH_TAG_LENGTH}`);
    }

    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error.message);
    throw new Error('Failed to decrypt data');
  }
}

/**
 * Check if a string appears to be encrypted (has the expected format)
 * @param {string} str - String to check
 * @returns {boolean} True if string appears to be encrypted
 */
function isEncrypted(str) {
  if (!str || typeof str !== 'string') {
    return false;
  }

  // Check if it matches the format: hex:hex:hex
  const parts = str.split(':');
  if (parts.length !== 3) {
    return false;
  }

  // Check if all parts are valid hex strings
  const hexRegex = /^[0-9a-fA-F]+$/;
  return parts.every(part => hexRegex.test(part));
}

/**
 * Safely encrypt a Plaid access token
 * Returns original token if encryption fails (with warning)
 * @param {string} token - Plaid access token
 * @returns {string} Encrypted token
 */
function encryptPlaidToken(token) {
  try {
    if (!token) {
      return token;
    }

    // Don't re-encrypt if already encrypted
    if (isEncrypted(token)) {
      console.warn('Token appears to already be encrypted');
      return token;
    }

    return encrypt(token);
  } catch (error) {
    console.error('Failed to encrypt Plaid token:', error.message);
    console.warn('⚠️  Storing token unencrypted. Set ENCRYPTION_KEY in .env for security.');
    return token; // Fallback: store unencrypted (not recommended for production)
  }
}

/**
 * Safely decrypt a Plaid access token
 * Returns original token if decryption fails (handles legacy unencrypted tokens)
 * @param {string} encryptedToken - Encrypted Plaid access token
 * @returns {string} Decrypted token
 */
function decryptPlaidToken(encryptedToken) {
  try {
    if (!encryptedToken) {
      return encryptedToken;
    }

    // Check if token is encrypted
    if (!isEncrypted(encryptedToken)) {
      console.warn('Token does not appear to be encrypted, returning as-is');
      return encryptedToken; // Legacy unencrypted token
    }

    return decrypt(encryptedToken);
  } catch (error) {
    console.error('Failed to decrypt Plaid token:', error.message);
    console.warn('⚠️  Returning encrypted token as-is. May cause Plaid API errors.');
    return encryptedToken; // Return encrypted (will likely fail at Plaid API)
  }
}

module.exports = {
  encrypt,
  decrypt,
  isEncrypted,
  encryptPlaidToken,
  decryptPlaidToken
};
