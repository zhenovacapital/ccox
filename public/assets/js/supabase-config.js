// Supabase Configuration
const SUPABASE_URL = "https://lkwqkhxjcnqxyhowtutl.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_YUqvyCxmoxSkEKdgtGuMhA_CsIv_OB3";

// Initialize Supabase client (from CDN supabase lib)
// Create the client and then expose the client on window.supabase so older code that uses `supabase.auth.getUser()` keeps working.
const _lib = window.supabase; // library object provided by CDN
if (!_lib || !_lib.createClient) {
  console.error(
    "Supabase library not found. Make sure you included the CDN script before this file."
  );
}
const supabaseClient = _lib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
// Expose client for other files that call `supabase.*`
window.supabase = supabaseClient;

/* -------------------------
   AUTH FUNCTIONS
   ------------------------- */

async function signUp(email, password, username, referralCode = null) {
  try {
    // 1) check if username exists (case-insensitive check is optional)
    const { data: existingUser, error: checkErr } = await supabaseClient
      .from("users")
      .select("id")
      .eq("username", username)
      .maybeSingle(); // maybeSingle returns null if not found (no error)

    if (checkErr) throw checkErr;
    if (existingUser) {
      throw new Error("Username already taken");
    }

    // 2) Sign up with supabaseClient Auth (v2)
    const { data: authData, error: authError } =
      await supabaseClient.auth.signUp({
        email: email,
        password: password,
      });

    if (authError) throw authError;
    if (!authData || !authData.user || !authData.user.id) {
      throw new Error("Auth signup returned no user data");
    }

    // 3) Resolve referral (we assume referral code is a username; adjust if you use a separate referral_code column)
    let referrerId = null;
    if (referralCode) {
      const rc = referralCode.toUpperCase();
      const { data: referrer, error: refErr } = await supabaseClient
        .from("users")
        .select("id")
        .eq("username", rc)
        .maybeSingle();

      if (refErr) throw refErr;
      if (referrer) referrerId = referrer.id;
    }

    // 4) Insert profile into users table - use column names that exist in your DB (cco_x_balance, referrer_id)
    const { error: profileError } = await supabaseClient.from("users").upsert([
      {
        id: authData.user.id,
        username: username,
        email: email,
        cco_x_balance: 0, // ensure column exists; default 0
        referrer_id: referrerId, // store referrer id in referrer_id column
      },
    ], { onConflict: 'id' });

    if (profileError) throw profileError;

    // 5) If referral used, create a row in referrals table and give bonus
    if (referrerId) {
      const { error: referralError } = await supabaseClient
        .from("referrals")
        .insert([
          {
            referrer_id: referrerId,
            referred_id: authData.user.id,
            referral_code: referralCode.toUpperCase(), // optional, keep for record
            bonus_amount: 1, // 1 CCOX bonus for referrer
            created_at: new Date().toISOString(),
          },
        ]);
      if (referralError) throw referralError;

      // add bonus to referrer's locked balance
      await addToLockedBalance(referrerId, 1);
    }

    return authData;
  } catch (error) {
    // rethrow so calling code can display the message
    throw error;
  }
}

async function signIn(email, password) {
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email: email,
      password: password,
    });

    if (error) {
      // Log full error for easier debugging
      try {
        console.error("SignIn Error Details:", JSON.stringify(error, null, 2));
      } catch (e) {
        console.error("SignIn Error Details (non-serializable):", error);
      }

      // Provide clearer handling for common HTTP 400 Bad Request
      if (error.status === 400) {
        throw new Error("BAD_REQUEST: " + (error.message || "Invalid request"));
      }

      // Handle specific error cases
      if (error.message.includes("Email not confirmed")) {
        throw new Error("EMAIL_NOT_CONFIRMED");
      } else if (error.message.includes("Invalid login credentials")) {
        throw new Error("INVALID_CREDENTIALS");
      } else if (error.message.includes("User not found")) {
        throw new Error("USER_NOT_FOUND");
      } else {
        throw error;
      }
    }

    return data;
  } catch (error) {
    throw error;
  }
}

async function signOut() {
  const { error } = await supabaseClient.auth.signOut();
  if (error) throw error;
}

async function resendConfirmation(email) {
  const { error } = await supabaseClient.auth.resend({
    type: "signup",
    email: email,
  });
  if (error) throw error;
  return { success: true };
}

async function signInWithProvider(provider) {
  // Determine redirect URL dynamically based on current location
  // This ensures it works on both Localhost and Netlify
  const redirectUrl = new URL('dashboard.html', window.location.href).href;
  console.log("Initiating OAuth with redirect to:", redirectUrl);
  
  const { data, error } = await supabaseClient.auth.signInWithOAuth({
    provider: provider,
    options: {
      redirectTo: redirectUrl
    }
  });
  if (error) throw error;
  return data;
}

/* -------------------------
   DATABASE / PROFILE HELPERS
   ------------------------- */

async function getUserProfile(userId) {
  const { data, error } = await supabaseClient
    .from("users")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;

  // If no profile found, throw specific error to trigger creation logic in app.js
  if (!data) {
    const err = new Error("Profile not found");
    err.code = "PGRST116";
    throw err;
  }

  return data;
}

async function updateUserBalance(userId, currency, amount) {
  // currency expected like "CCOX", "USDT" -> field names: cco_x_balance, usdt_balance
  const balanceField =
    currency === "CCOX" ? "cco_x_balance" : currency.toLowerCase() + "_balance";

  // Read current balance (use maybeSingle to avoid throwing if missing row)
  const { data, error } = await supabaseClient
    .from("users")
    .select(balanceField)
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  const currentBalance =
    data && data[balanceField] ? Number(data[balanceField]) : 0;
  const newBalance = currentBalance + Number(amount);

  const { error: updateError } = await supabaseClient
    .from("users")
    .update({ [balanceField]: newBalance })
    .eq("id", userId);

  if (updateError) throw updateError;

  return newBalance;
}

/* -------------------------
   INTERNAL TRANSFER
   ------------------------- */

async function internalTransfer(senderId, recipient, amount, currency) {
  try {
    // find recipient by email or username
    const { data: recipientData, error: findError } = await supabaseClient
      .from("users")
      .select("id")
      .or(`email.eq.${recipient},username.eq.${recipient}`)
      .maybeSingle();

    if (findError) throw findError;
    if (!recipientData) throw new Error("Recipient not found");

    // check sender balance
    const senderBalanceField = currency.toLowerCase() + "_balance";
    const { data: senderData, error: senderError } = await supabaseClient
      .from("users")
      .select(senderBalanceField)
      .eq("id", senderId)
      .maybeSingle();

    if (senderError) throw senderError;
    const senderBalance =
      senderData && senderData[senderBalanceField]
        ? Number(senderData[senderBalanceField])
        : 0;
    if (senderBalance < Number(amount)) {
      throw new Error("Insufficient balance");
    }

    // perform updates (no transaction support here — consider using RPC to avoid race conditions)
    await updateUserBalance(senderId, currency, -Math.abs(Number(amount)));
    await updateUserBalance(
      recipientData.id,
      currency,
      Math.abs(Number(amount))
    );

    // record transaction
    const { error: transactionError } = await supabaseClient
      .from("transactions")
      .insert([
        {
          sender_id: senderId,
          recipient_id: recipientData.id,
          amount: Number(amount),
          currency: currency,
          type: "transfer",
          created_at: new Date().toISOString(),
        },
      ]);

    if (transactionError) throw transactionError;

    return { success: true, transaction_id: "tx_" + Date.now() };
  } catch (error) {
    throw error;
  }
}

/* -------------------------
   MINING SESSIONS
   ------------------------- */

async function startMining(userId) {
  const MINING_REWARD = 2; // 2 CCOX per session
  const MINING_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
  try {
    // Get all active sessions for this user, ordered by most recent first
    const { data: activeSessions, error: findErr } = await supabaseClient
      .from("mining_sessions")
      .select("id,started_at,reward_amount")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("started_at", { ascending: false });

    if (findErr) throw findErr;

    // If there are multiple active sessions, keep only the most recent one and cancel others
    if (activeSessions && activeSessions.length > 1) {
      console.warn(
        `User ${userId} has ${activeSessions.length} active mining sessions. Cleaning up...`
      );

      // Cancel all but the most recent session
      const sessionsToCancel = activeSessions.slice(1);
      for (const session of sessionsToCancel) {
        await supabaseClient
          .from("mining_sessions")
          .update({
            status: "cancelled",
            completed_at: new Date().toISOString(),
          })
          .eq("id", session.id);
      }
    }

    // Use the most recent active session (first in the array)
    const existing =
      activeSessions && activeSessions.length > 0 ? activeSessions[0] : null;

    if (existing) {
      const startedAt = new Date(existing.started_at).toISOString();
      const endsAt = new Date(
        new Date(existing.started_at).getTime() + MINING_DURATION_MS
      ).toISOString();
      return {
        success: true,
        alreadyActive: true,
        session_id: existing.id,
        started_at: startedAt,
        ends_at: endsAt,
        reward: existing.reward_amount || MINING_REWARD,
      };
    }

    // Create new mining session and return session info
    const started_at = new Date().toISOString();
    const ends_at = new Date(Date.now() + MINING_DURATION_MS).toISOString();
    const { data, error } = await supabaseClient
      .from("mining_sessions")
      .insert([
        {
          user_id: userId,
          status: "active",
          reward_amount: MINING_REWARD,
          started_at: started_at,
        },
      ])
      .select("id, user_id, started_at, reward_amount")
      .single();

    if (error) throw error;

    return {
      success: true,
      alreadyActive: false,
      session_id: data.id,
      started_at: data.started_at,
      ends_at: ends_at,
      reward: data.reward_amount || MINING_REWARD,
    };
  } catch (error) {
    throw error;
  }
}

async function completeMining(userId) {
  const { data: session, error: findError } = await supabaseClient
    .from("mining_sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (findError) throw findError;
  if (!session) throw new Error("No active mining session found");

  const { error: updateError } = await supabaseClient
    .from("mining_sessions")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
    })
    .eq("id", session.id);

  if (updateError) throw updateError;

  // Record a mining transaction (do not add to wallet here).
  // Client will add to `locked_balance` using `addToLockedBalance`.
  const { error: txnErr } = await supabaseClient.from("transactions").insert([
    {
      sender_id: null,
      recipient_id: userId,
      amount: Number(session.reward_amount),
      currency: "CCOX",
      type: "mining",
      created_at: new Date().toISOString(),
    },
  ]);

  if (txnErr) throw txnErr;

  // Update locked balance immediately to ensure reward is not lost
  try {
    await addToLockedBalance(userId, session.reward_amount);
  } catch (balanceErr) {
    console.error("Failed to auto-update locked balance:", balanceErr);
    // We don't throw here to avoid breaking the UI flow, but we log it.
  }

  return { success: true, reward: session.reward_amount };
}

async function getActiveMiningSession(userId) {
  try {
    const { data, error } = await supabaseClient
      .from("mining_sessions")
      .select("id, started_at, reward_amount, status") // ends_at removed
      .eq("user_id", userId)
      .eq("status", "active")
      .order("started_at", { ascending: false });

    if (error) throw error;
    return data && data.length > 0 ? data[0] : null;
  } catch (error) {
    throw error;
  }
}

/* -------------------------
   TRANSACTIONS
   ------------------------- */

async function getTransactions(userId, limit = 10) {
  const { data, error } = await supabaseClient
    .from("transactions")
    .select(
      `
      *,
      sender:users!sender_id(username, email),
      recipient:users!recipient_id(username, email)
    `
    )
    .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data;
}

/* -------------------------
   REFERRALS & STATS
   ------------------------- */

async function getReferralStats(userId) {
  // count total referrals (use head:true to get count)
  const { count, error: countError } = await supabaseClient
    .from("referrals")
    .select("*", { count: "exact", head: true })
    .eq("referrer_id", userId);

  if (countError) throw countError;
  const totalReferrals = count || 0;

  // get total earned from referrals
  const { data: earningsData, error: earningsError } = await supabaseClient
    .from("referrals")
    .select("bonus_amount")
    .eq("referrer_id", userId);

  if (earningsError) throw earningsError;

  const totalEarned = (earningsData || []).reduce(
    (sum, ref) => sum + (ref.bonus_amount || 0),
    0
  );

  const referralClicks = 0; // placeholder for future tracking

  return {
    totalReferrals,
    totalEarned,
    referralClicks,
  };
}

async function getRecentReferrals(userId, limit = 10) {
  const { data, error } = await supabaseClient
    .from("referrals")
    .select(
      `
      *,
      referred_user:users!referred_id(username, created_at)
    `
    )
    .eq("referrer_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data;
}

async function getUserReferralCode(userId) {
  // If you store referral code as username or separate column, adjust here.
  // We'll return username as referral code if referral_code column is not present.
  const { data, error } = await supabaseClient
    .from("users")
    .select("referral_code, username")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  // prefer explicit referral_code column, otherwise fallback to username
  return data.referral_code || data.username;
}

/* -------------------------
   LEADERBOARD
   ------------------------- */

async function getLeaderboard(type = "mining") {
  let query;

  switch (type) {
    case "mining":
      query = supabaseClient
        .from("mining_sessions")
        .select(
          `
          user_id,
          users (username),
          reward_amount
        `
        )
        .eq("status", "completed");
      break;
    case "referral":
      // If you have a referral_count materialized column then use it; otherwise compute externally
      query = supabaseClient.from("referrals").select(`
          referrer_id,
          users (username),
          bonus_amount
        `);
      break;
    case "wealth":
      query = supabaseClient
        .from("users")
        .select("username, ccox_balance, green_balance, usdt_balance")
        .order("ccox_balance", { ascending: false });
      break;
    default:
      throw new Error("Unknown leaderboard type");
  }

  const { data, error } = await query.limit(10);
  if (error) throw error;
  return data;
}

/* -------------------------
   LOCKED BALANCE & SWAPS
   ------------------------- */

async function addToLockedBalance(userId, amount) {
  try {
    // Read current locked balance
    const { data, error } = await supabaseClient
      .from("users")
      .select("locked_balance")
      .eq("id", userId)
      .maybeSingle();

    if (error) throw error;
    const currentBalance =
      data && data.locked_balance ? Number(data.locked_balance) : 0;
    const newBalance = currentBalance + Number(amount);

    // Update locked balance
    const { error: updateError } = await supabaseClient
      .from("users")
      .update({ locked_balance: newBalance })
      .eq("id", userId);

    if (updateError) throw updateError;

    return newBalance;
  } catch (error) {
    throw error;
  }
}

async function swapToWallet(userId, amount) {
  try {
    // Call the supabaseClient function to initiate swap (7-day timer)
    const { data, error } = await supabaseClient.rpc("initiate_swap", {
      p_user_id: userId,
      p_amount: Number(amount),
    });

    if (error) throw error;
    if (!data.success) throw new Error(data.error || "Failed to initiate swap");

    return {
      success: true,
      message: data.message,
      completes_at: data.completes_at,
    };
  } catch (error) {
    throw error;
  }
}

async function checkAndCompleteSwaps() {
  try {
    // Get current user
    const {
      data: { user },
      error: authError,
    } = await supabaseClient.auth.getUser();
    if (authError) throw authError;
    if (!user) throw new Error("User not authenticated");

    // Call the supabaseClient function to complete pending swap if timer has expired
    const { data, error } = await supabaseClient.rpc("complete_pending_swap", {
      p_user_id: user.id,
    });

    if (error) {
      // Not an error if no pending swap, just return
      console.log("No pending swap or timer not complete");
      return { success: true, completed: false };
    }

    if (data.success) {
      return {
        success: true,
        completed: true,
        message: data.message,
        amount: data.amount,
      };
    } else {
      return { success: false, message: data.error };
    }
  } catch (error) {
    console.error("checkAndCompleteSwaps error:", error);
    return { success: false, error: error.message };
  }
}

/* -------------------------
   KYC
   ------------------------- */

async function getKYCStatus(userId) {
  try {
    const { data } = await supabaseClient
      .from("kyc_applications")
      .select("status")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data ? data.status : null;
  } catch (e) {
    console.error("getKYCStatus error:", e);
    return null;
  }
}

/* -------------------------
   EXPORTS
   ------------------------- */

window.SupabaseConfig = {
  supabase: supabaseClient,
  signUp,
  signIn,
  signOut,
  signInWithProvider,
  resendConfirmation,
  getUserProfile,
  updateUserBalance,
  internalTransfer,
  startMining,
  completeMining,
  getActiveMiningSession,
  getTransactions,
  getReferralStats,
  getRecentReferrals,
  getUserReferralCode,
  getLeaderboard,
  addToLockedBalance,
  swapToWallet,
  checkAndCompleteSwaps,
  getKYCStatus,
};
