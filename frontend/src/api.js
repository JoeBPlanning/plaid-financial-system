import axios from 'axios';
import { supabase } from './supabaseClient';
import config from './config';

const api = axios.create({
  baseURL: config.API_BASE,
});

// Request interceptor to add the Supabase auth token to every request
api.interceptors.request.use(
  async (config) => {
    const { data: { session } } = await supabase.auth.getSession();

    if (session?.access_token) {
      config.headers.Authorization = `Bearer ${session.access_token}`;
    }

    return config;
  },
  (error) => {
    // Handle request errors
    return Promise.reject(error);
  }
);

export default api;
