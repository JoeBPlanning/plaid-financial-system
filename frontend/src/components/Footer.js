import React from 'react';

function Footer({ onOpenDataSecurityModal }) {
  return (
    <footer style={{
      width: '100%',
      padding: '20px 0',
      backgroundColor: '#f8f9fa', // Light background
      color: '#6c757d', // Muted text color
      textAlign: 'center',
      fontSize: '0.9em',
      borderTop: '1px solid #e9ecef',
      marginTop: 'auto', // Pushes footer to the bottom if content is short
    }}>
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto',
        display: 'flex',
        justifyContent: 'center',
        gap: '20px',
        flexWrap: 'wrap'
      }}>
        <button onClick={onOpenDataSecurityModal} style={{ background: 'none', border: 'none', color: '#6c757d', cursor: 'pointer', fontSize: 'inherit', padding: 0 }}>Data Privacy & Security</button>
        <a href="https://bautistaplanningandanalytics.com/privacy-policy-financial-planning/" target="_blank" rel="noopener noreferrer" style={{ color: '#6c757d', textDecoration: 'none' }}>Privacy Policy</a>
        <a href="mailto:joe@bautistaplanningandanalytics.com?subject=Financial App Support Request" style={{ color: '#6c757d', textDecoration: 'none' }}>Contact Support</a>
      </div>
      <p style={{ margin: '15px 0 0 0' }}>&copy; {new Date().getFullYear()} Bautista Planning and Analytics. All rights reserved.</p>
    </footer>
  );
}

export default Footer;