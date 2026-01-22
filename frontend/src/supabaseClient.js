import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
const supabaseAnonKey = process.env.REACT_APP_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables. Please check your .env file.');
  console.error('REACT_APP_SUPABASE_URL:', supabaseUrl ? '✅ Set' : '❌ Missing');
  console.error('REACT_APP_SUPABASE_ANON_KEY:', supabaseAnonKey ? '✅ Set' : '❌ Missing');
}

// Create Supabase client with fallback to prevent crashes
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key',
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true
    }
  }
);

/**
 * Sign up a new user
 * @param {string} email - User's email address
 * @param {string} password - User's password
 * @param {string} name - User's full name
 * @returns {Promise<{data, error}>}
 */
export const signUp = async (email, password, name) => {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        name: name,
        role: 'user' // Default role
      },
      emailRedirectTo: window.location.origin
    }
  });

  return { data, error };
};

/**
 * Sign in an existing user
 * @param {string} email - User's email address
 * @param {string} password - User's password
 * @returns {Promise<{data, error}>}
 */
export const signIn = async (email, password) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  return { data, error };
};

/**
 * Sign out the current user
 * @returns {Promise<{error}>}
 */
export const signOut = async () => {
  const { error } = await supabase.auth.signOut();
  return { error };
};

/**
 * Get the current session
 * @returns {Promise<{data, error}>}
 */
export const getSession = async () => {
  const { data, error } = await supabase.auth.getSession();
  return { data, error };
};

/**
 * Get the current user
 * @returns {Promise<{data, error}>}
 */
export const getUser = async () => {
  const { data, error } = await supabase.auth.getUser();
  return { data, error };
};

/**
 * Send password reset email
 * @param {string} email - User's email address
 * @returns {Promise<{data, error}>}
 */
export const resetPassword = async (email) => {
  const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`
  });

  return { data, error };
};

/**
 * Update user password (after reset)
 * @param {string} newPassword - New password
 * @returns {Promise<{data, error}>}
 */
export const updatePassword = async (newPassword) => {
  const { data, error } = await supabase.auth.updateUser({
    password: newPassword
  });

  return { data, error };
};

/**
 * Listen for auth state changes
 * @param {function} callback - Callback function to handle auth state changes
 * @returns {object} Subscription object with unsubscribe method
 */
export const onAuthStateChange = (callback) => {
  return supabase.auth.onAuthStateChange(callback);
};

/**
 * Validate password strength
 * @param {string} password - Password to validate
 * @returns {object} {isValid: boolean, errors: string[]}
 */
export const validatePassword = (password) => {
  const errors = [];

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }

  if (!/\d/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean}
 */
export const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export default supabase;
