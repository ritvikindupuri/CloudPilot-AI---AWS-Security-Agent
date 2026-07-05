import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "http://localhost:54321";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "mock-anon-key";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
