export const SUPABASE_URL = 'https://ymtmipkmknnsqleahlmi.supabase.co';
export const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InltdG1pcGtta25uc3FsZWFobG1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwOTU1MjUsImV4cCI6MjA4NTY3MTUyNX0.7pEza-TKBKJ_xqdBu93nLo-PRaHDcDIxW-bjZnrFJxw';

export function createSbClient() {
  // supabase global từ UMD script trong index.html
  return supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
}
