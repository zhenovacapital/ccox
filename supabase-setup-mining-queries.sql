-- Create swap_queue table (tracks pending swaps)
CREATE TABLE IF NOT EXISTS public.swap_queue (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
    amount DECIMAL(20,8) NOT NULL,
    swap_initiated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
    swap_completes_at TIMESTAMP WITH TIME ZONE NOT NULL,
    status TEXT CHECK (status IN ('pending', 'completed', 'cancelled')) DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_swap_queue_user_id ON public.swap_queue(user_id);
CREATE INDEX IF NOT EXISTS idx_swap_queue_status ON public.swap_queue(status);
CREATE INDEX IF NOT EXISTS idx_swap_queue_complete_at ON public.swap_queue(swap_completes_at);

-- Enable RLS
ALTER TABLE public.swap_queue ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own swaps" ON public.swap_queue
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own swaps" ON public.swap_queue
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own swaps" ON public.swap_queue
    FOR UPDATE USING (auth.uid() = user_id);

-- Function to initiate locked balance to wallet swap (7-day timer)
CREATE OR REPLACE FUNCTION initiate_swap(p_user_id UUID, p_amount DECIMAL)
RETURNS jsonb AS $$
DECLARE
    v_locked_balance DECIMAL;
    v_result jsonb;
BEGIN
    SELECT locked_balance INTO v_locked_balance
    FROM public.users
    WHERE id = p_user_id;
    
    IF v_locked_balance IS NULL OR v_locked_balance < p_amount THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Insufficient locked balance'
        );
    END IF;
    
    UPDATE public.users
    SET locked_balance = locked_balance - p_amount,
        swap_pending = swap_pending + p_amount,
        swap_timer = TIMEZONE('utc'::text, NOW()) + INTERVAL '7 days'
    WHERE id = p_user_id;
    
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
    
    SELECT swap_pending, swap_timer INTO v_pending_amount, v_swap_timer
    FROM public.users
    WHERE id = p_user_id;
    
    IF v_pending_amount IS NULL OR v_pending_amount <= 0 THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'No pending swap'
        );
    END IF;
    
    IF v_swap_timer IS NULL OR v_current_time < v_swap_timer THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Swap timer not yet complete',
            'time_remaining', EXTRACT(EPOCH FROM (v_swap_timer - v_current_time)) || ' seconds'
        );
    END IF;
    
    UPDATE public.users
    SET cco_x_balance = cco_x_balance + v_pending_amount,
        swap_pending = 0,
        swap_timer = NULL
    WHERE id = p_user_id;
    
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
