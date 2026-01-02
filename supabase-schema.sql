-- CCOX Mining Platform Database Schema
-- Run this in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create users table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.users (
    id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    referral_code TEXT UNIQUE,
    referrer_id UUID REFERENCES public.users(id),
    cco_x_balance DECIMAL(20,8) DEFAULT 0,
    green_balance DECIMAL(20,8) DEFAULT 0,
    usdt_balance DECIMAL(20,8) DEFAULT 0,
    locked_balance DECIMAL(20,8) DEFAULT 0,
    swap_pending DECIMAL(20,8) DEFAULT 0,
    swap_timer TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Create mining_sessions table
CREATE TABLE IF NOT EXISTS public.mining_sessions (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    status TEXT CHECK (status IN ('active', 'completed', 'cancelled')) DEFAULT 'active',
    reward_amount DECIMAL(10,2) DEFAULT 2,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Create transactions table
CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    sender_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    recipient_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    amount DECIMAL(20,8) NOT NULL,
    currency TEXT CHECK (currency IN ('CCOX', 'USDT')) NOT NULL,
    type TEXT CHECK (type IN ('transfer', 'mining', 'referral', 'bonus')) DEFAULT 'transfer',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Create referrals table
CREATE TABLE IF NOT EXISTS public.referrals (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    referrer_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    referred_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    referral_code TEXT NOT NULL,
    bonus_amount DECIMAL(10,2) DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    UNIQUE(referrer_id, referred_id)
);

-- Create function to generate referral codes
CREATE OR REPLACE FUNCTION generate_referral_code()
RETURNS TEXT AS $$
DECLARE
    code TEXT;
    exists_check BOOLEAN;
BEGIN
    LOOP
        -- Generate 8-character random code
        code := UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 8));
        -- Check if code already exists
        SELECT EXISTS(SELECT 1 FROM public.users WHERE referral_code = code) INTO exists_check;
        EXIT WHEN NOT exists_check;
    END LOOP;
    RETURN code;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-generate referral code for new users
CREATE OR REPLACE FUNCTION set_referral_code()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.referral_code IS NULL THEN
        NEW.referral_code := generate_referral_code();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_set_referral_code
    BEFORE INSERT ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION set_referral_code();

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = TIMEZONE('utc'::text, NOW());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create swap_queue table to track pending wallet swaps
CREATE TABLE IF NOT EXISTS public.swap_queue (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    amount DECIMAL(20,8) NOT NULL,
    swap_initiated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    swap_completes_at TIMESTAMP WITH TIME ZONE NOT NULL,
    status TEXT CHECK (status IN ('pending', 'completed', 'cancelled')) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Create index for swap_queue
CREATE INDEX IF NOT EXISTS idx_swap_queue_user_id ON public.swap_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_swap_queue_status ON public.swap_queue(status);
CREATE INDEX IF NOT EXISTS idx_swap_queue_complete_at ON public.swap_queue(swap_completes_at);

-- Function to initiate locked balance to wallet swap (7-day timer)
CREATE OR REPLACE FUNCTION initiate_swap(p_user_id UUID, p_amount DECIMAL)
RETURNS jsonb AS $$
DECLARE
    v_locked_balance DECIMAL;
    v_result jsonb;
BEGIN
    -- Get current locked balance
    SELECT locked_balance INTO v_locked_balance
    FROM public.users
    WHERE id = p_user_id;
    
    -- Check if user has enough locked balance
    IF v_locked_balance IS NULL OR v_locked_balance < p_amount THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Insufficient locked balance'
        );
    END IF;
    
    -- Deduct from locked balance immediately
    UPDATE public.users
    SET locked_balance = locked_balance - p_amount,
        swap_pending = swap_pending + p_amount,
        swap_timer = TIMEZONE('utc'::text, NOW()) + INTERVAL '7 days'
    WHERE id = p_user_id;
    
    -- Insert into swap_queue
    INSERT INTO public.swap_queue (user_id, amount, swap_completes_at, status)
    VALUES (
        p_user_id,
        p_amount,
        TIMEZONE('utc'::text, NOW()) + INTERVAL '7 days',
        'pending'
    );
    
    RETURN jsonb_build_object(
        'success', true,
        'message', 'Swap initiated - coins will be available in 7 days',
        'amount', p_amount,
        'completes_at', TIMEZONE('utc'::text, NOW()) + INTERVAL '7 days'
    );
END;
$$ LANGUAGE plpgsql;

-- Function to complete pending swaps
CREATE OR REPLACE FUNCTION complete_pending_swap(p_user_id UUID)
RETURNS jsonb AS $$
DECLARE
    v_pending_amount DECIMAL;
    v_swap_timer TIMESTAMP WITH TIME ZONE;
    v_current_time TIMESTAMP WITH TIME ZONE;
BEGIN
    v_current_time := TIMEZONE('utc'::text, NOW());
    
    -- Get pending swap info
    SELECT swap_pending, swap_timer INTO v_pending_amount, v_swap_timer
    FROM public.users
    WHERE id = p_user_id;
    
    -- Check if there's a pending swap
    IF v_pending_amount IS NULL OR v_pending_amount <= 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'No pending swap'
        );
    END IF;
    
    -- Check if 7 days have passed
    IF v_swap_timer IS NULL OR v_current_time < v_swap_timer THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Swap timer not yet complete',
            'time_remaining', EXTRACT(EPOCH FROM (v_swap_timer - v_current_time)) || ' seconds'
        );
    END IF;
    
    -- Move from swap_pending to cco_x_balance
    UPDATE public.users
    SET cco_x_balance = cco_x_balance + v_pending_amount,
        swap_pending = 0,
        swap_timer = NULL
    WHERE id = p_user_id;
    
    -- Mark swap as completed in swap_queue
    UPDATE public.swap_queue
    SET status = 'completed'
    WHERE user_id = p_user_id
        AND status = 'pending'
        AND swap_completes_at <= v_current_time;
    
    RETURN jsonb_build_object(
        'success', true,
        'message', 'Swap completed! Coins moved to wallet',
        'amount', v_pending_amount
    );
END;
$$ LANGUAGE plpgsql;

-- Function to check and auto-complete all eligible swaps
CREATE OR REPLACE FUNCTION auto_complete_swaps()
RETURNS TABLE(user_id UUID, amount DECIMAL, completed BOOLEAN) AS $$
BEGIN
    RETURN QUERY
    UPDATE public.users
    SET cco_x_balance = cco_x_balance + swap_pending,
        swap_pending = 0,
        swap_timer = NULL
    WHERE swap_pending > 0 
        AND swap_timer IS NOT NULL
        AND swap_timer <= TIMEZONE('utc'::text, NOW())
    RETURNING id, swap_pending, true;
END;
$$ LANGUAGE plpgsql;

-- Enable Row Level Security (RLS)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mining_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

-- RLS Policies for users table
CREATE POLICY "Users can view their own profile" ON public.users
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON public.users
    FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can view other users basic info" ON public.users
    FOR SELECT USING (true); -- Allow viewing usernames/emails for transfers

CREATE POLICY "Enable insert for authenticated users only" ON public.users
    FOR INSERT WITH CHECK (auth.uid() = id);

-- RLS Policies for mining_sessions table
CREATE POLICY "Users can view their own mining sessions" ON public.mining_sessions
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own mining sessions" ON public.mining_sessions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own mining sessions" ON public.mining_sessions
    FOR UPDATE USING (auth.uid() = user_id);

-- RLS Policies for transactions table
CREATE POLICY "Users can view their own transactions" ON public.transactions
    FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = recipient_id);

CREATE POLICY "Users can insert transactions they participate in" ON public.transactions
    FOR INSERT WITH CHECK (auth.uid() = sender_id OR auth.uid() = recipient_id);

-- RLS Policies for referrals table
CREATE POLICY "Users can view their own referral data" ON public.referrals
    FOR SELECT USING (auth.uid() = referrer_id OR auth.uid() = referred_id);

CREATE POLICY "Users can insert referral data they participate in" ON public.referrals
    FOR INSERT WITH CHECK (auth.uid() = referrer_id OR auth.uid() = referred_id);

-- RLS Policies for swap_queue table
CREATE POLICY "Users can view their own swaps" ON public.swap_queue
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own swaps" ON public.swap_queue
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own swaps" ON public.swap_queue
    FOR UPDATE USING (auth.uid() = user_id);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_username ON public.users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON public.users(referral_code);
CREATE INDEX IF NOT EXISTS idx_mining_sessions_user_id ON public.mining_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_mining_sessions_status ON public.mining_sessions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_sender_id ON public.transactions(sender_id);
CREATE INDEX IF NOT EXISTS idx_transactions_recipient_id ON public.transactions(recipient_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer_id ON public.referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred_id ON public.referrals(referred_id);

-- Create storage bucket for user avatars (optional)
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policy for avatars
CREATE POLICY "Avatar images are publicly accessible" ON storage.objects
    FOR SELECT USING (bucket_id = 'avatars');

CREATE POLICY "Users can upload their own avatar" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update their own avatar" ON storage.objects
    FOR UPDATE USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own avatar" ON storage.objects
    FOR DELETE USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Create storage bucket for KYC documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('kyc-documents', 'kyc-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for KYC documents
CREATE POLICY "Users can upload their own KYC documents" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'kyc-documents' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can view their own KYC documents" ON storage.objects
    FOR SELECT USING (bucket_id = 'kyc-documents' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update their own KYC documents" ON storage.objects
    FOR UPDATE USING (bucket_id = 'kyc-documents' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own KYC documents" ON storage.objects
    FOR DELETE USING (bucket_id = 'kyc-documents' AND auth.uid()::text = (storage.foldername(name))[1]);
