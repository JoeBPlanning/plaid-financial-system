import React from 'react';

function DataSecurityModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 10000,
      padding: '20px'
    }}>
      <div style={{
        backgroundColor: 'white',
        padding: '30px',
        borderRadius: '12px',
        maxWidth: '800px',
        width: '100%',
        maxHeight: '90vh',
        overflowY: 'auto',
        boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)',
        position: 'relative'
      }}>
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '15px',
            right: '15px',
            background: 'none',
            border: 'none',
            fontSize: '24px',
            cursor: 'pointer',
            color: '#333'
          }}
        >
          &times;
        </button>
        <h1 style={{ margin: '0 0 20px 0', color: '#333', textAlign: 'center' }}>Data Privacy and Security Statement</h1>

        <p>At Bautista Planning and Analytics, we understand that the security and privacy of your financial data are paramount. This document outlines the measures we take to protect your information and our commitment to your privacy.</p>

        <h2 style={{ margin: '25px 0 15px 0', color: '#2D5074' }}>Our Commitment to Your Data Security</h2>
        <p>We employ industry-standard security practices and leverage robust third-party services to ensure your data is safe and secure.</p>

        <h3 style={{ margin: '20px 0 10px 0', color: '#333' }}>1. Secure Authentication (Powered by Supabase)</h3>
        <ul>
          <li><strong>No Direct Password Storage</strong>: We <strong>do not</strong> store your login passwords directly in our application's database. Instead, we use <strong>Supabase Auth</strong>, a leading authentication service. Supabase securely handles your login credentials using advanced hashing and encryption techniques. This means even we cannot access your raw password.</li>
          <li><strong>JSON Web Tokens (JWTs)</strong>: After you log in, Supabase issues a secure JSON Web Token (JWT). This token is used to verify your identity for all subsequent interactions with our backend. JWTs are cryptographically signed, making them tamper-proof and ensuring that only you can access your data.</li>
          <li><strong>Session Management</strong>: Your session is securely managed by the Supabase client, which handles token refreshing and expiration, further reducing the risk of unauthorized access.</li>
        </ul>

        <h3 style={{ margin: '20px 0 10px 0', color: '#333' }}>2. Data Protection and Isolation</h3>
        <ul>
          <li><strong>Supabase Database</strong>: Your financial data (transactions, summaries, etc.) is stored in a secure PostgreSQL database managed by Supabase. Supabase provides enterprise-grade security features, including data encryption at rest and in transit.</li>
          <li><strong>Row Level Security (RLS)</strong>: We implement <strong>Row Level Security (RLS)</strong> policies on our database tables. This is a powerful security feature that ensures:
            <ul>
              <li><strong>Data Isolation</strong>: You can only access and view your own financial data. One client cannot accidentally or maliciously view another client's information.</li>
              <li><strong>Role-Based Access</strong>: Our administrative staff (Advisors) have controlled access to client data only when necessary for providing services, and their access is also governed by strict RLS policies.</li>
            </ul>
          </li>
          <li><strong>Encryption</strong>: All data transmitted between your browser and our servers, and between our servers and Supabase, is encrypted using HTTPS (TLS/SSL). Data stored in the Supabase database is also encrypted at rest.</li>
        </ul>

        <h3 style={{ margin: '20px 0 10px 0', color: '#333' }}>3. No Data Selling or Sharing</h3>
        <ul>
          <li><strong>Your Data is Yours</strong>: We unequivocally state that we <strong>do not sell, rent, or trade your personal or financial data</strong> to any third parties for marketing or any other purposes.</li>
          <li><strong>Purpose of Data Collection</strong>: Your data is collected solely for the purpose of providing you with personalized financial insights, transaction categorization, and reporting services within this web application.</li>
        </ul>

        <h3 style={{ margin: '20px 0 10px 0', color: '#333' }}>4. Regular Security Audits and Updates</h3>
        <p>We are committed to continuously monitoring and updating our security practices to adapt to new threats and technologies. Our use of managed services like Supabase ensures that underlying infrastructure security is handled by experts.</p>

        <h2 style={{ margin: '25px 0 15px 0', color: '#2D5074' }}>Your Role in Security</h2>
        <p>While we take extensive measures to protect your data, your active participation is also crucial:</p>
        <ul>
          <li><strong>Strong Passwords</strong>: Always use a strong, unique password for your account.</li>
          <li><strong>Keep Credentials Private</strong>: Never share your login credentials with anyone.</li>
          <li><strong>Monitor Your Accounts</strong>: Regularly review your financial accounts for any suspicious activity.</li>
        </ul>

        <h2 style={{ margin: '25px 0 15px 0', color: '#2D5074' }}>Privacy Policy</h2>
        <p>For a more detailed explanation of how we collect, use, and protect your personal information, please refer to our full Privacy Policy.</p>
        <p><a href="https://bautistaplanningandanalytics.com/privacy-policy-financial-planning/" target="_blank" rel="noopener noreferrer" style={{ color: '#2D5074', textDecoration: 'underline' }}>View our full Privacy Policy</a></p>

        <p style={{ fontSize: '0.8em', color: '#999', marginTop: '30px' }}>
          <strong>Disclaimer</strong>: This document provides a general overview of security and privacy measures. It is not a substitute for legal advice. You should consult with a legal professional to draft a comprehensive Privacy Policy and Terms of Service that comply with all relevant laws and regulations for your specific business and jurisdiction.
        </p>
      </div>
    </div>
  );
}

export default DataSecurityModal;