# Supabase Setup for Mining & Locked Balance

## Required SQL Functions & Tables

Run these SQL commands in your Supabase SQL Editor to set up mining and locked balance functionality.

### 1. Create swap_queue table (tracks pending swaps)

```sql
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
```

### 2. Create initiate_swap function (starts 7-day timer for wallet swap)

```sql
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
```

### 3. Create complete_pending_swap function (moves coins to wallet after 7 days)

```sql
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
```

### 4. Create auto_complete_swaps function (batch complete all eligible swaps)

```sql
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
```

## How It Works

### Mining Flow:

1. User clicks "Start Mining" on `/public/mining.html`
2. `startMining()` creates a mining session in database
3. Progress bar fills over 24 hours based on real time
4. After 24 hours, `completeMining()` is called automatically
5. Reward is added to `locked_balance` (not wallet yet)

### Locked Balance to Wallet Flow:

1. User clicks "Swap to Wallet" with locked balance
2. `swapToWallet()` calls `initiate_swap()` function
3. Coins moved from `locked_balance` → `swap_pending`
4. 7-day timer starts (`swap_timer`)
5. After 7 days, user can claim coins or they auto-complete
6. `checkAndCompleteSwaps()` moves coins from `swap_pending` → `cco_x_balance`

## User Table Fields Used

```
locked_balance    DECIMAL   - Coins from mining (can be swapped to wallet)
swap_pending      DECIMAL   - Coins waiting 7 days before wallet transfer
swap_timer        TIMESTAMP - When 7-day wait completes
cco_x_balance     DECIMAL   - Final wallet balance (can be transferred)
```

## Testing

### Test Mining:

1. Login to your account
2. Go to Mining page
3. Click "Start Mining"
4. Monitor progress (updates every second for 24 hours)
5. Check browser console for debug logs

### Test Swap:

1. After mining completes, check Locked Balance
2. Click "Swap to Wallet"
3. Coins move to swap_pending with 7-day timer
4. After 7 days, coins auto-move to wallet

## Notes

- Mining rewards: 2 CCOX per 24-hour session
- Swap wait time: 7 days (configurable in SQL if needed)
- RLS enforced: Users can only see/manage their own data
- All timestamps in UTC timezone
