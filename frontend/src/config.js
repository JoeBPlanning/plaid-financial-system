const config = {
  API_BASE: process.env.REACT_APP_API_BASE || 'http://localhost:3001',
};

// Export default config
export default config;

// Also export API_BASE as named export for backward compatibility
export const { API_BASE } = config;
