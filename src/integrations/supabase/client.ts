import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "https://bdwyandtlndxqyrtxzfq.supabase.co";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_AUP0VYPqKH0Y6AUA9ESRqQ__nxrqW19";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
