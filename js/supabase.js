export const SUPABASE_URL = 'https://jttwlfsfvaiivlyiyaxz.supabase.co';
export const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0dHdsZnNmdmFpaXZseWl5YXh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5ODcyNTgsImV4cCI6MjA4NjU2MzI1OH0.1c6iLV7Yznzs_3gQ_dV8Br02F9jJdHWhL-Hl2iASRuQ';

export function createSbClient() {
  // supabase global từ UMD script trong index.html
  return supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
}
