-- CCOX Mining Platform - Row Level Security (RLS) Setup
-- Run this in your Supabase SQL Editor after creating tables

-- ============================================
-- Enable RLS on all tables
-- ============================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mining_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.swap_queue ENABLE ROW LEVEL SECURITY;

-- ============================================
-- USERS TABLE POLICIES
-- ============================================

-- Users can read their own profile
CREATE POLICY "Users can read own profile"
ON public.users FOR SELECT
USING (auth.uid() = id);

-- Users can update their own profile (balance, username, etc.)
CREATE POLICY "Users can update own profile"
ON public.users FOR UPDATE
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- Users can insert their own profile (Required for Google/OAuth Signup)
CREATE POLICY "Users can insert own profile"
ON public.users FOR INSERT
WITH CHECK (auth.uid() = id);

-- Anyone can read public user info (email, username for search)
CREATE POLICY "Anyone can read user emails and usernames"
ON public.users FOR SELECT
USING (true);

-- ============================================
-- TRANSACTIONS TABLE POLICIES
-- ============================================

-- Users can read transactions where they are sender or recipient
CREATE POLICY "Users can read own transactions"
ON public.transactions FOR SELECT
USING (
  auth.uid() = sender_id 
  OR auth.uid() = recipient_id
);

-- Users can insert transactions (send money)
-- The backend handles validation
CREATE POLICY "Authenticated users can insert transactions"
ON public.transactions FOR INSERT
WITH CHECK (auth.role() = 'authenticated');

-- Users can update transactions where they are involved (if needed)
CREATE POLICY "Users can update own transactions"
ON public.transactions FOR UPDATE
USING (
  auth.uid() = sender_id 
  OR auth.uid() = recipient_id
)
WITH CHECK (
  auth.uid() = sender_id 
  OR auth.uid() = recipient_id
);

-- ============================================
-- MINING_SESSIONS TABLE POLICIES
-- ============================================

-- Users can read their own mining sessions
CREATE POLICY "Users can read own mining sessions"
ON public.mining_sessions FOR SELECT
USING (auth.uid() = user_id);

-- Authenticated users can insert mining sessions
CREATE POLICY "Authenticated users can insert mining sessions"
ON public.mining_sessions FOR INSERT
WITH CHECK (auth.role() = 'authenticated');

-- Users can update their own mining sessions
CREATE POLICY "Users can update own mining sessions"
ON public.mining_sessions FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- ============================================
-- REFERRALS TABLE POLICIES
-- ============================================

-- Users can read referrals where they are referrer or referred
CREATE POLICY "Users can read own referrals"
ON public.referrals FOR SELECT
USING (
  auth.uid() = referrer_id 
  OR auth.uid() = referred_id
);

-- Authenticated users can insert referrals
CREATE POLICY "Authenticated users can insert referrals"
ON public.referrals FOR INSERT
WITH CHECK (auth.role() = 'authenticated');

-- ============================================
-- SWAP_QUEUE TABLE POLICIES
-- ============================================

-- Users can read their own swap queue entries
CREATE POLICY "Users can read own swap queue"
ON public.swap_queue FOR SELECT
USING (auth.uid() = user_id);

-- Authenticated users can insert swap queue
CREATE POLICY "Authenticated users can insert swap queue"
ON public.swap_queue FOR INSERT
WITH CHECK (auth.role() = 'authenticated');

-- Users can update their own swap queue entries
CREATE POLICY "Users can update own swap queue"
ON public.swap_queue FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- ============================================
-- GRANTS (for read-only access to public info)
-- ============================================

-- Allow anonymous to read user public info for searching
GRANT SELECT ON public.users TO anon;
GRANT SELECT ON public.transactions TO anon;
GRANT SELECT ON public.mining_sessions TO anon;
GRANT SELECT ON public.referrals TO anon;
GRANT SELECT ON public.swap_queue TO anon;

-- Grant full access to authenticated users (RLS will filter)
GRANT ALL ON public.users TO authenticated;
GRANT ALL ON public.transactions TO authenticated;
GRANT ALL ON public.mining_sessions TO authenticated;
GRANT ALL ON public.referrals TO authenticated;
GRANT ALL ON public.swap_queue TO authenticated;

-- ============================================
-- IMPORTANT: Backend/Admin Access
-- ============================================
-- If you have backend functions or RPCs that need to update balances directly,
-- you may need to use database functions with SECURITY DEFINER option.
-- Example: The initiate_swap RPC should be able to update user balances.
-- This is already handled if the RPC is defined as SECURITY DEFINER.
